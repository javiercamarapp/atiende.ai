import { supabaseAdmin } from '@/lib/supabase/admin';

export interface IntentStat {
  intent: string;
  total: number;
  resolved: number;
  escalated: number;
  rate: number;
}

export async function getIntentStats(tenantId: string, days = 30): Promise<IntentStat[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('intent, sender_type')
    .eq('tenant_id', tenantId)
    .eq('direction', 'inbound')
    .not('intent', 'is', null)
    .gte('created_at', since);

  if (!messages?.length) return [];

  const stats = new Map<string, { total: number; resolved: number; escalated: number }>();

  for (const m of messages) {
    const intent = m.intent || 'OTHER';
    const existing = stats.get(intent) || { total: 0, resolved: 0, escalated: 0 };
    existing.total++;
    if (m.sender_type === 'bot') existing.resolved++;
    else if (m.sender_type === 'human') existing.escalated++;
    stats.set(intent, existing);
  }

  return Array.from(stats.entries())
    .map(([intent, s]) => ({
      intent,
      total: s.total,
      resolved: s.resolved,
      escalated: s.escalated,
      rate: s.total > 0 ? Math.round((s.resolved / s.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);
}
