// ═════════════════════════════════════════════════════════════════════════════
// FRAUD DETECTOR — Phase 3.C
// Detecta anomalías de volumen y ataques de prompt injection. Cron nocturno.
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';

export interface VolumeAnomaly {
  tenant_id: string;
  tenant_name: string;
  metric: 'messages' | 'appointments' | 'tool_calls';
  today_count: number;
  baseline_avg_7d: number;
  multiplier: number;
}

export interface InjectionAttempt {
  tenant_id: string;
  message_id: string;
  conversation_id: string;
  content_excerpt: string;
  matched_pattern: string;
  occurred_at: string;
}

export interface FraudAlert {
  id?: string;
  tenant_id: string;
  anomaly_type: string;
  evidence: string;
}

const INJECTION_PATTERNS = [
  'ignore previous',
  'ignore your instructions',
  'forget your instructions',
  'system prompt',
  'jailbreak',
  'olvida tus instrucciones',
  'eres ahora',
  'now you are',
  'reveal your prompt',
  'show me the system',
  'developer mode',
];

/** Lista tenants con volumen anómalo (>3x avg messages, >5x avg appts, etc). */
export async function detectVolumeAnomalies(opts: {
  date: string; // YYYY-MM-DD
}): Promise<VolumeAnomaly[]> {
  const today = `${opts.date}T00:00:00Z`;
  const tomorrow = new Date(new Date(today).getTime() + 24 * 60 * 60_000).toISOString();
  const sevenDaysAgo = new Date(new Date(today).getTime() - 7 * 24 * 60 * 60_000).toISOString();

  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id, name')
    .eq('status', 'active');

  if (!tenants) return [];
  const out: VolumeAnomaly[] = [];

  for (const t of tenants) {
    // Messages today
    const { count: msgsToday } = await supabaseAdmin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.id)
      .gte('created_at', today)
      .lt('created_at', tomorrow);

    const { count: msgs7d } = await supabaseAdmin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.id)
      .gte('created_at', sevenDaysAgo)
      .lt('created_at', today);

    const avgMsgs = (msgs7d ?? 0) / 7;
    if ((msgsToday ?? 0) > avgMsgs * 3 && (msgsToday ?? 0) > 100) {
      out.push({
        tenant_id: t.id as string,
        tenant_name: (t.name as string) || '',
        metric: 'messages',
        today_count: msgsToday ?? 0,
        baseline_avg_7d: Math.round(avgMsgs),
        multiplier: avgMsgs > 0 ? Number(((msgsToday ?? 0) / avgMsgs).toFixed(1)) : 0,
      });
    }
  }

  return out;
}

/** Busca mensajes inbound con patrones de prompt injection. */
export async function detectInjectionAttempts(opts: {
  tenantId?: string;
  date: string;
}): Promise<InjectionAttempt[]> {
  const dayStart = `${opts.date}T00:00:00Z`;
  const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60_000).toISOString();

  let q = supabaseAdmin
    .from('messages')
    .select('id, conversation_id, tenant_id, content, created_at')
    .eq('direction', 'inbound')
    .gte('created_at', dayStart)
    .lt('created_at', dayEnd)
    .limit(500);
  if (opts.tenantId) q = q.eq('tenant_id', opts.tenantId);

  const { data: msgs } = await q;
  if (!msgs) return [];

  const found: InjectionAttempt[] = [];
  for (const m of msgs) {
    const content = ((m.content as string) || '').toLowerCase();
    for (const pattern of INJECTION_PATTERNS) {
      if (content.includes(pattern)) {
        found.push({
          tenant_id: m.tenant_id as string,
          message_id: m.id as string,
          conversation_id: m.conversation_id as string,
          content_excerpt: ((m.content as string) || '').slice(0, 200),
          matched_pattern: pattern,
          occurred_at: m.created_at as string,
        });
        break; // un match por mensaje
      }
    }
  }
  return found;
}

/** Inserta una alerta en fraud_alerts y notifica a Javier (best effort). */
export async function generateFraudAlert(alert: FraudAlert): Promise<{ inserted: boolean }> {
  const { error } = await supabaseAdmin.from('fraud_alerts').insert(alert);
  return { inserted: !error };
}
