import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';
import { analyzeSentiment } from '@/lib/intelligence/sentiment';
import { isBusinessOpen } from '@/lib/actions/business-hours';
import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════
// SMART FOLLOW-UP AGENT
// Detects abandoned conversations (asked about service but
// didn't book) and sends personalized follow-up messages
// using LLM generation. Respects business hours and
// frequency limits (max 1 follow-up per contact per week).
// ═══════════════════════════════════════════════════════════

const MAX_FOLLOWUPS_PER_RUN = 30;
const FOLLOWUP_COOLDOWN_DAYS = 7;
const ABANDONMENT_WINDOW_HOURS = 48;
const MIN_MESSAGES_FOR_CONTEXT = 2;

interface AbandonedConversation {
  conversationId: string;
  contactId: string;
  phone: string;
  contactName: string;
  lastMessages: string[];
  detectedIntent: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  hoursInactive: number;
}

/**
 * Identifies conversations where a customer expressed interest (asked about
 * services, prices, appointments, or orders) but the conversation went cold
 * without a booking or purchase.
 */
async function findAbandonedConversations(tenantId: string): Promise<AbandonedConversation[]> {
  const now = new Date();
  const cutoffRecent = new Date(now.getTime() - ABANDONMENT_WINDOW_HOURS * 3600000).toISOString();
  const cutoffOld = new Date(now.getTime() - 14 * 86400000).toISOString(); // Max 14 days old

  // Fetch conversations that went inactive in the abandonment window
  const { data: conversations } = await supabaseAdmin
    .from('conversations')
    .select('id, contact_id, last_message_at, metadata')
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .lt('last_message_at', cutoffRecent)
    .gte('last_message_at', cutoffOld)
    .not('contact_id', 'is', null)
    .limit(100);

  if (!conversations?.length) return [];

  // Fetch contacts in bulk
  const contactIds = conversations.map(c => c.contact_id).filter(Boolean) as string[];
  const { data: contacts } = await supabaseAdmin
    .from('contacts')
    .select('id, phone, name')
    .in('id', contactIds);

  const contactMap = new Map((contacts || []).map(c => [c.id, c]));

  // Fetch recent messages for these conversations
  const convIds = conversations.map(c => c.id);
  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('conversation_id, content, direction, created_at')
    .in('conversation_id', convIds)
    .order('created_at', { ascending: false })
    .limit(500);

  // Group messages by conversation
  const msgByConv = new Map<string, Array<{ content: string; direction: string }>>();
  for (const msg of messages || []) {
    if (!msg.content) continue;
    const list = msgByConv.get(msg.conversation_id) || [];
    list.push({ content: msg.content, direction: msg.direction });
    msgByConv.set(msg.conversation_id, list);
  }

  // Filter: only conversations with service-interest signals and no booking
  const interestKeywords = [
    'cita', 'agendar', 'reservar', 'disponible', 'disponibilidad',
    'precio', 'costo', 'cuanto', 'cuánto', 'servicio', 'tratamiento',
    'pedido', 'menu', 'menú', 'paquete', 'cotizacion', 'cotización',
    'horario', 'turno', 'consulta', 'sesion', 'sesión',
  ];

  const bookingSignals = [
    'confirmado', 'agendado', 'reservado', 'pedido realizado',
    'listo', 'perfecto', 'nos vemos', 'gracias por agendar',
  ];

  const abandoned: AbandonedConversation[] = [];

  for (const conv of conversations) {
    const contact = contactMap.get(conv.contact_id);
    if (!contact) continue;

    const convMessages = msgByConv.get(conv.id) || [];
    if (convMessages.length < MIN_MESSAGES_FOR_CONTEXT) continue;

    // Check for interest signals in customer messages
    const customerMessages = convMessages
      .filter(m => m.direction === 'inbound')
      .map(m => m.content.toLowerCase());

    const hasInterest = customerMessages.some(msg =>
      interestKeywords.some(kw => msg.includes(kw))
    );

    if (!hasInterest) continue;

    // Check that no booking was completed
    const allText = convMessages.map(m => m.content.toLowerCase()).join(' ');
    const wasBooked = bookingSignals.some(signal => allText.includes(signal));
    if (wasBooked) continue;

    // Detect overall conversation sentiment
    const combinedText = customerMessages.join('. ');
    const { label: sentiment } = analyzeSentiment(combinedText);

    // Skip if customer was clearly negative/angry — avoid annoying them
    if (sentiment === 'negative') continue;

    // Determine what they were interested in
    let detectedIntent = 'servicio general';
    if (customerMessages.some(m => m.includes('cita') || m.includes('agendar') || m.includes('consulta'))) {
      detectedIntent = 'agendar cita';
    } else if (customerMessages.some(m => m.includes('precio') || m.includes('costo') || m.includes('cuanto'))) {
      detectedIntent = 'informacion de precios';
    } else if (customerMessages.some(m => m.includes('pedido') || m.includes('menu') || m.includes('menú'))) {
      detectedIntent = 'hacer pedido';
    } else if (customerMessages.some(m => m.includes('cotizacion') || m.includes('cotización'))) {
      detectedIntent = 'cotizacion';
    }

    const lastMessageAt = new Date(conv.last_message_at as string);
    const hoursInactive = Math.floor((now.getTime() - lastMessageAt.getTime()) / 3600000);

    abandoned.push({
      conversationId: conv.id,
      contactId: conv.contact_id as string,
      phone: contact.phone,
      contactName: contact.name || '',
      lastMessages: convMessages.slice(0, 5).map(m => m.content),
      detectedIntent,
      sentiment,
      hoursInactive,
    });
  }

  return abandoned;
}

/**
 * Check if a follow-up was already sent to this contact within the cooldown period.
 * Uses the audit_log table to track follow-up history.
 */
async function wasRecentlyFollowedUp(tenantId: string, contactId: string): Promise<boolean> {
  const cooldownDate = new Date(Date.now() - FOLLOWUP_COOLDOWN_DAYS * 86400000).toISOString();

  const { count } = await supabaseAdmin
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('action', 'smart_followup.sent')
    .gte('created_at', cooldownDate)
    .contains('details', { contact_id: contactId });

  return (count ?? 0) > 0;
}

/**
 * Generate a personalized follow-up message using LLM.
 * The message is warm, non-pushy, and references what the customer asked about.
 */
async function generateFollowupMessage(
  tenantName: string,
  contactName: string,
  intent: string,
  lastMessages: string[],
): Promise<string> {
  const conversationSnippet = lastMessages.slice(0, 3).join('\n');

  const response = await generateResponse({
    model: MODELS.STANDARD,
    system: `Eres el asistente de ${tenantName}. Genera un mensaje de seguimiento breve (max 2 oraciones) para un cliente que pregunto sobre "${intent}" pero no concreto. El tono es amable, no insistente, profesional. En español mexicano. NO uses emojis excesivos. Solo 1 emoji maximo. NO incluyas links ni precios inventados. Responde SOLO con el mensaje, sin comillas ni explicaciones.`,
    messages: [{
      role: 'user',
      content: `Nombre del cliente: ${contactName || 'Cliente'}\nUltimos mensajes de la conversacion:\n${conversationSnippet}`,
    }],
    temperature: 0.6,
    maxTokens: 150,
  });

  return response.text.trim();
}

/**
 * Main entry point: runs the smart follow-up agent for a tenant.
 * Finds abandoned conversations, filters by cooldown, generates
 * personalized messages, and sends via WhatsApp.
 *
 * @returns Count of sent and skipped follow-ups.
 */
export async function runSmartFollowup(
  tenantId: string,
  config: Record<string, unknown> = {},
): Promise<{ sent: number; skipped: number }> {
  const log = logger.child({ tenantId, agent: 'smart_followup' });
  let sent = 0;
  let skipped = 0;

  try {
    // Fetch tenant info
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('name, wa_phone_number_id, business_hours')
      .eq('id', tenantId)
      .single();

    if (!tenant?.wa_phone_number_id) {
      log.warn('Tenant missing WhatsApp phone number ID');
      return { sent: 0, skipped: 0 };
    }

    // Respect business hours if configured (unless overridden in config)
    const respectHours = config.ignore_business_hours !== true;
    if (respectHours && !isBusinessOpen(tenant.business_hours as Record<string, string> | null)) {
      log.info('Outside business hours, skipping run');
      return { sent: 0, skipped: 0 };
    }

    // Find abandoned conversations
    const abandoned = await findAbandonedConversations(tenantId);
    log.info('Abandoned conversations found', { count: abandoned.length });

    if (!abandoned.length) {
      return { sent: 0, skipped: 0 };
    }

    // Process each abandoned conversation
    for (const conv of abandoned.slice(0, MAX_FOLLOWUPS_PER_RUN)) {
      try {
        // Check cooldown
        const recentlyFollowedUp = await wasRecentlyFollowedUp(tenantId, conv.contactId);
        if (recentlyFollowedUp) {
          skipped++;
          continue;
        }

        // Generate personalized message
        const message = await generateFollowupMessage(
          tenant.name as string,
          conv.contactName,
          conv.detectedIntent,
          conv.lastMessages,
        );

        // Send the message
        await sendTextMessage(tenant.wa_phone_number_id as string, conv.phone, message);

        // Log the follow-up for cooldown tracking and auditing
        await supabaseAdmin.from('audit_log').insert({
          tenant_id: tenantId,
          action: 'smart_followup.sent',
          details: {
            contact_id: conv.contactId,
            conversation_id: conv.conversationId,
            phone: conv.phone,
            intent: conv.detectedIntent,
            hours_inactive: conv.hoursInactive,
            message_preview: message.slice(0, 80),
          },
        });

        sent++;
      } catch (err) {
        skipped++;
        log.error('Failed to send follow-up', err instanceof Error ? err : new Error(String(err)), {
          contactId: conv.contactId,
        });
      }
    }

    log.info('Smart follow-up run completed', { sent, skipped });
  } catch (err) {
    log.error('Smart follow-up agent failed', err instanceof Error ? err : new Error(String(err)));
  }

  return { sent, skipped };
}
