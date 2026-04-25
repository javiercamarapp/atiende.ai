import { supabaseAdmin } from '@/lib/supabase/admin';
import { decryptPII } from '@/lib/utils/crypto';

// ═══════════════════════════════════════════════════════════
// MULTI-TURN CONVERSATION MEMORY
// Gives the LLM context from previous messages in the thread.
// Supports adaptive windowing, topic extraction, and
// semantic compression for long conversations.
// ═══════════════════════════════════════════════════════════

interface ConversationMeta {
  status: string;
  assignedTo: string | null;
  tags: string[];
  customerName: string | null;
}

interface TopicSegment {
  topic: string;
  messageCount: number;
  resolved: boolean;
}

// ── CORE CONTEXT RETRIEVAL ────────────────────────────────

/**
 * Fetch the last N messages from a conversation for LLM context.
 * Default: 5 messages to balance context quality vs. token cost.
 */
export async function getConversationContext(
  conversationId: string,
  maxMessages = 5
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  // BUG FIX CRÍTICO: antes era `.order(asc).limit(5)` que traía los 5
  // PRIMEROS mensajes — el bot quedaba mirando solo el saludo inicial y
  // ignoraba los últimos turnos. Ahora ordenamos DESC para tomar los N
  // más recientes, y reverse() al final para que el LLM los reciba en
  // orden cronológico.
  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('direction, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(maxMessages);

  if (!messages?.length) return [];

  // PRIV-2: el content puede venir cifrado con prefijo `v1:` — decryptPII
  // detecta el prefijo y descifra; si no, devuelve el texto plano legacy.
  return messages
    .filter((m: { direction: string; content: string | null }) => m.content)
    .map((m: { direction: string; content: string | null }) => ({
      role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: decryptPII(m.content)!,
    }))
    .reverse(); // chronological order para el LLM
}

/**
 * Build a formatted conversation history prompt section.
 * Designed to be injected into the system prompt for multi-turn awareness.
 */
export function buildContextPrompt(
  messages: { role: string; content: string }[]
): string {
  if (!messages.length) return '';

  const lines = messages.map(m => {
    const speaker = m.role === 'user' ? 'Cliente' : 'Asistente';
    return `${speaker}: ${m.content}`;
  });

  return `═══ HISTORIAL DE CONVERSACION ═══\n${lines.join('\n')}\n═══ FIN DEL HISTORIAL ═══`;
}

// ── ENRICHED CONTEXT WITH METADATA ────────────────────────

/**
 * Get full conversation context including metadata (status, tags, assigned_to).
 * Useful for giving the LLM awareness of the conversation state.
 */
export async function getConversationWithMeta(
  conversationId: string,
  maxMessages = 5
): Promise<{
  messages: { role: 'user' | 'assistant'; content: string }[];
  meta: ConversationMeta;
}> {
  const [messagesResult, convResult] = await Promise.all([
    getConversationContext(conversationId, maxMessages),
    supabaseAdmin
      .from('conversations')
      .select('status, assigned_to, tags, customer_name')
      .eq('id', conversationId)
      .single(),
  ]);

  const conv = convResult.data;

  return {
    messages: messagesResult,
    meta: {
      status: (conv?.status as string) || 'open',
      assignedTo: (conv?.assigned_to as string) || null,
      tags: (conv?.tags as string[]) || [],
      customerName: (conv?.customer_name as string) || null,
    },
  };
}

/**
 * Build a rich system prompt section with both history and conversation state.
 * Drop-in replacement for the history section in processor.ts.
 */
export function buildFullContextPrompt(
  messages: { role: string; content: string }[],
  meta: ConversationMeta
): string {
  const parts: string[] = [];

  if (meta.customerName) {
    parts.push(`CLIENTE: ${meta.customerName}`);
  }
  if (meta.status !== 'open') {
    parts.push(`ESTADO: ${meta.status}`);
  }
  if (meta.tags.length > 0) {
    parts.push(`ETIQUETAS: ${meta.tags.join(', ')}`);
  }

  const metaSection = parts.length > 0
    ? `═══ CONTEXTO DE CONVERSACION ═══\n${parts.join('\n')}\n`
    : '';

  const historySection = buildContextPrompt(messages);

  return [metaSection, historySection].filter(Boolean).join('\n');
}

// ── ADAPTIVE CONTEXT WINDOW ───────────────────────────────

/**
 * Dynamically decide how many messages to include based on conversation
 * characteristics. Short, simple conversations get fewer messages (saves
 * tokens); long, complex ones get more context.
 *
 * Heuristic:
 *  - Base: 3 messages
 *  - +2 if conversation has >10 total messages (ongoing topic)
 *  - +2 if any tag indicates complexity (queja, urgente, medico)
 *  - +1 if conversation was reassigned (assigned_to is set)
 *  - Capped at 10 to keep prompt size reasonable
 */
export async function getAdaptiveContext(
  conversationId: string
): Promise<{
  messages: { role: 'user' | 'assistant'; content: string }[];
  meta: ConversationMeta;
  windowSize: number;
}> {
  // Fetch metadata first to decide window size
  const [convResult, countResult] = await Promise.all([
    supabaseAdmin
      .from('conversations')
      .select('status, assigned_to, tags, customer_name')
      .eq('id', conversationId)
      .single(),
    supabaseAdmin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId),
  ]);

  const conv = convResult.data;
  const totalMessages = countResult.count ?? 0;

  const meta: ConversationMeta = {
    status: (conv?.status as string) || 'open',
    assignedTo: (conv?.assigned_to as string) || null,
    tags: (conv?.tags as string[]) || [],
    customerName: (conv?.customer_name as string) || null,
  };

  // Adaptive window calculation
  let windowSize = 3;

  if (totalMessages > 10) windowSize += 2;

  const complexTags = ['queja', 'urgente', 'medico', 'legal', 'escalado'];
  if (meta.tags.some(t => complexTags.includes(t.toLowerCase()))) windowSize += 2;

  if (meta.assignedTo) windowSize += 1;

  windowSize = Math.min(windowSize, 10);

  const messages = await getConversationContext(conversationId, windowSize);

  return { messages, meta, windowSize };
}

// ── TOPIC EXTRACTION ──────────────────────────────────────

/**
 * Extract topic segments from conversation history.
 * Groups consecutive messages by topic using keyword detection.
 * Useful for providing the LLM with a high-level conversation map
 * when the full history is too long to include.
 */
export function extractTopics(
  messages: { role: string; content: string }[]
): TopicSegment[] {
  if (!messages.length) return [];

  const topicKeywords: Record<string, string[]> = {
    'cita': ['cita', 'agendar', 'horario', 'disponibilidad', 'cancelar cita', 'reagendar'],
    'pedido': ['pedido', 'orden', 'compra', 'producto', 'precio', 'envio', 'entrega'],
    'queja': ['queja', 'problema', 'malo', 'error', 'molesto', 'reclamo', 'devolucion'],
    'pago': ['pago', 'cobro', 'factura', 'precio', 'costo', 'tarjeta', 'transferencia'],
    'info': ['horario', 'direccion', 'ubicacion', 'telefono', 'contacto'],
    'saludo': ['hola', 'buenos dias', 'buenas tardes', 'buenas noches'],
  };

  const segments: TopicSegment[] = [];
  let currentTopic = 'general';
  let currentCount = 0;

  for (const msg of messages) {
    const lower = msg.content.toLowerCase();
    let detectedTopic = 'general';

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(kw => lower.includes(kw))) {
        detectedTopic = topic;
        break;
      }
    }

    if (detectedTopic !== currentTopic && currentCount > 0) {
      segments.push({
        topic: currentTopic,
        messageCount: currentCount,
        resolved: true, // Previous topic considered resolved when topic changes
      });
      currentTopic = detectedTopic;
      currentCount = 0;
    }

    currentTopic = detectedTopic;
    currentCount++;
  }

  // Add the last segment (still active, so not resolved)
  if (currentCount > 0) {
    segments.push({
      topic: currentTopic,
      messageCount: currentCount,
      resolved: false,
    });
  }

  return segments;
}

// ── SEMANTIC COMPRESSION ──────────────────────────────────

/**
 * Compress a long conversation history into a shorter summary + recent tail.
 * For conversations with 15+ messages, sending all of them wastes tokens.
 * Instead, summarize the older portion and keep recent messages verbatim.
 *
 * Returns a prompt-ready format:
 *   [summary of older messages]
 *   [last N verbatim messages]
 */
export function compressConversation(
  messages: { role: string; content: string }[],
  keepRecent = 4
): { summary: string; recentMessages: { role: string; content: string }[] } {
  if (messages.length <= keepRecent) {
    return { summary: '', recentMessages: messages };
  }

  const olderMessages = messages.slice(0, messages.length - keepRecent);
  const recentMessages = messages.slice(messages.length - keepRecent);

  // Extract key facts from older messages (lightweight, no LLM needed)
  const topics = extractTopics(olderMessages);
  const topicSummary = topics
    .map(t => `${t.topic} (${t.messageCount} msgs, ${t.resolved ? 'resuelto' : 'pendiente'})`)
    .join(', ');

  // Count messages by role in the older portion
  const userMsgs = olderMessages.filter(m => m.role === 'user').length;
  const assistantMsgs = olderMessages.filter(m => m.role === 'assistant').length;

  const summary = [
    `[Resumen de ${olderMessages.length} mensajes anteriores:`,
    `  ${userMsgs} del cliente, ${assistantMsgs} del asistente.`,
    topicSummary ? `  Temas tratados: ${topicSummary}.` : '',
    `  Primer mensaje del cliente: "${truncate(olderMessages.find(m => m.role === 'user')?.content || '', 80)}"`,
    ']',
  ].filter(Boolean).join('\n');

  return { summary, recentMessages };
}

/**
 * Build a token-efficient prompt that uses compression for long conversations.
 * Automatically decides whether to compress based on message count.
 */
export function buildCompressedContextPrompt(
  messages: { role: string; content: string }[],
  meta?: ConversationMeta
): string {
  const parts: string[] = [];

  // Meta section
  if (meta) {
    const metaParts: string[] = [];
    if (meta.customerName) metaParts.push(`CLIENTE: ${meta.customerName}`);
    if (meta.status !== 'open') metaParts.push(`ESTADO: ${meta.status}`);
    if (meta.tags.length > 0) metaParts.push(`ETIQUETAS: ${meta.tags.join(', ')}`);

    if (metaParts.length > 0) {
      parts.push(`═══ CONTEXTO DE CONVERSACION ═══\n${metaParts.join('\n')}`);
    }
  }

  // History section (compressed if needed)
  if (messages.length > 6) {
    const { summary, recentMessages } = compressConversation(messages);
    if (summary) parts.push(summary);
    parts.push(buildContextPrompt(recentMessages));
  } else {
    parts.push(buildContextPrompt(messages));
  }

  return parts.filter(Boolean).join('\n\n');
}

// ── HELPERS ───────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
