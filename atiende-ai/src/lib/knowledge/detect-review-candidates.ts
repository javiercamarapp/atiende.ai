import { supabaseAdmin } from '@/lib/supabase/admin';

// Phrases the bot uses when it has nothing in RAG — the exact strings come
// from the system prompts in preview-chat + the live WhatsApp processor.
// Keep these lowercase; we lowercase inputs before matching.
const HESITATION_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /perm[ií]tame (verificar|confirmar)/, reason: 'explicit_hedge' },
  { re: /le (confirmo|confirmar[eé]) (en seguida|pronto|m[aá]s tarde)/, reason: 'deferred_answer' },
  { re: /no (tengo|cuento con) (esa|esta) informaci[oó]n/, reason: 'missing_info' },
  { re: /no (tengo|cuento con) detalles (espec[ií]ficos|exactos)/, reason: 'missing_info' },
  { re: /no puedo (darte|proporcionarte) (esa|esta) informaci[oó]n/, reason: 'missing_info' },
  { re: /consulte (directamente|con)/, reason: 'deflect' },
  { re: /contacte (directamente|a)/, reason: 'deflect' },
  { re: /disculp[ae]/, reason: 'apology' },
];

// Short, punctuation-only replies suggest the LLM bailed out.
function isTooShort(text: string): boolean {
  const compact = text.trim();
  return compact.length > 0 && compact.length < 20;
}

export interface HesitationResult {
  hesitated: boolean;
  reason?: string;
}

// Pure function: inspect a bot reply in the context of the customer
// question it was answering. Returns a reason tag when the reply looks
// like a hedge/deflection — safe to call synchronously after every
// generation step.
export function detectHesitation(customerMessage: string, botResponse: string): HesitationResult {
  if (!customerMessage || !botResponse) return { hesitated: false };
  const lower = botResponse.toLowerCase();
  for (const { re, reason } of HESITATION_PATTERNS) {
    if (re.test(lower)) return { hesitated: true, reason };
  }
  if (isTooShort(botResponse)) return { hesitated: true, reason: 'too_short' };
  return { hesitated: false };
}

// Upsert-on-conflict equivalent: skip if this exact pair is already in
// review_candidates for the tenant. Keeps the widget list tight even if
// the same question runs through multiple conversations.
export async function recordReviewCandidate(params: {
  tenantId: string;
  conversationId?: string | null;
  customerMessage: string;
  botResponse: string;
  reason: string;
}): Promise<{ recorded: boolean; error?: string }> {
  const { tenantId, conversationId, customerMessage, botResponse, reason } = params;

  const { data: existing } = await supabaseAdmin
    .from('review_candidates')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('customer_message', customerMessage)
    .eq('reviewed', false)
    .limit(1)
    .maybeSingle();

  if (existing) return { recorded: false };

  const { error } = await supabaseAdmin.from('review_candidates').insert({
    tenant_id: tenantId,
    conversation_id: conversationId ?? null,
    customer_message: customerMessage,
    bot_response: botResponse,
    detection_reason: reason,
  });

  if (error) return { recorded: false, error: error.message };

  await supabaseAdmin
    .from('tenants')
    .update({ last_review_detection_at: new Date().toISOString() })
    .eq('id', tenantId);

  return { recorded: true };
}

// Helper to scan recent bot messages for a tenant and populate
// review_candidates retroactively. Used by the sweep cron (added separately)
// so brand-new tenants see an initial set without waiting for traffic.
export async function sweepRecentMessages(params: {
  tenantId: string;
  sinceHours?: number;
  limit?: number;
}): Promise<{ scanned: number; recorded: number }> {
  const { tenantId, sinceHours = 168, limit = 100 } = params;
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

  // Get recent bot messages and their preceding customer message. The
  // messages table doesn't expose a reply_to column so we pair by
  // conversation + descending time and walk in pairs.
  type Row = {
    conversation_id: string;
    direction: string;
    sender_type: string;
    content: string | null;
    created_at: string;
  };

  const { data: rows } = await supabaseAdmin
    .from('messages')
    .select('conversation_id, direction, sender_type, content, created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', since)
    .order('conversation_id', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(limit * 4);

  const list = (rows ?? []) as Row[];
  let recorded = 0;
  let scanned = 0;

  // Walk each conversation; track last customer message, then when a bot
  // message appears, run detection.
  let lastCustomer: string | null = null;
  let lastConvId: string | null = null;
  for (const row of list) {
    if (row.conversation_id !== lastConvId) {
      lastCustomer = null;
      lastConvId = row.conversation_id;
    }
    if (row.sender_type === 'customer') {
      lastCustomer = row.content ?? null;
      continue;
    }
    // bot/agent reply
    if (!lastCustomer || !row.content) continue;
    scanned += 1;
    const result = detectHesitation(lastCustomer, row.content);
    if (!result.hesitated) continue;
    const rec = await recordReviewCandidate({
      tenantId,
      conversationId: row.conversation_id,
      customerMessage: lastCustomer,
      botResponse: row.content,
      reason: result.reason ?? 'unknown',
    });
    if (rec.recorded) recorded += 1;
    if (recorded >= limit) break;
    // Reset so the same customer msg isn't paired to multiple bot msgs.
    lastCustomer = null;
  }

  return { scanned, recorded };
}
