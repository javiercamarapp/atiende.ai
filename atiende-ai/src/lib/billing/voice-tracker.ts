// ═════════════════════════════════════════════════════════════════════════════
// VOICE TRACKER — medidor de minutos de voz por tenant con overage.
//
// Se invoca desde el webhook Retell cuando termina una llamada
// (`call_ended`). Hace 3 cosas:
//   1. Log individual en voice_call_logs (audit trail)
//   2. UPSERT atómico en voice_usage vía RPC increment_voice_minutes
//   3. Retorna el estado actual (totalThisMonth, overage, percentUsed)
//      para que el caller pueda alertar al dueño si pasa umbral.
//
// Reglas:
//   - Llamadas < 5 segundos NO se cobran (rings, hang-ups accidentales)
//   - Redondeo al minuto superior (Math.ceil) — práctica estándar telco
//   - Si tenant.voice_minutes_included = 0 (plan básico) todo es overage
//     técnicamente, pero el cron de billing solo cobra los que tienen
//     stripe_subscription_item_voice_id (lo cual solo se setea en premium)
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';

export interface VoiceTrackResult {
  minutesUsed: number;        // minutos de ESTA llamada
  totalThisMonth: number;     // total acumulado del mes
  included: number;           // minutos incluidos del plan
  overage: number;            // minutos excedentes
  isOverage: boolean;
  percentUsed: number;        // % del cupo consumido
  remaining: number;          // minutos restantes antes de overage
}

/** Track one call at end. NEVER throws — siempre retorna un result. */
export async function trackVoiceCall(
  tenantId: string,
  retellCallId: string,
  durationSeconds: number,
): Promise<VoiceTrackResult> {
  // Llamadas muy cortas (rings accidentales) no se cobran
  if (durationSeconds < 5) {
    return {
      minutesUsed: 0,
      totalThisMonth: 0,
      included: 200,
      overage: 0,
      isOverage: false,
      percentUsed: 0,
      remaining: 200,
    };
  }

  const durationMinutes = Math.ceil(durationSeconds / 60);
  const yearMonth = new Date().toISOString().substring(0, 7);

  // Obtener minutos incluidos del plan del tenant
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('plan, voice_minutes_included')
    .eq('id', tenantId)
    .single();

  const included = (tenant?.voice_minutes_included as number) ?? 0;

  // Registrar llamada individual (best effort — si UNIQUE colisiona = dup del
  // webhook, ya lo tenemos contado)
  try {
    const { error } = await supabaseAdmin.from('voice_call_logs').insert({
      tenant_id: tenantId,
      retell_call_id: retellCallId,
      duration_seconds: durationSeconds,
      duration_minutes: durationMinutes,
      year_month: yearMonth,
    });
    if (error && error.code !== '23505') {
      console.warn('[voice-tracker] voice_call_logs insert:', error.message);
    }
    if (error && error.code === '23505') {
      // Ya procesado este call_id — salimos para no doble-contar
      return {
        minutesUsed: 0,
        totalThisMonth: 0,
        included,
        overage: 0,
        isOverage: false,
        percentUsed: 0,
        remaining: included,
      };
    }
  } catch (err) {
    console.warn('[voice-tracker] log insert exception:', err instanceof Error ? err.message : err);
  }

  // UPSERT atómico en voice_usage
  const { data, error: rpcErr } = await supabaseAdmin.rpc('increment_voice_minutes', {
    p_tenant_id: tenantId,
    p_year_month: yearMonth,
    p_minutes: durationMinutes,
    p_included: included,
  });

  if (rpcErr) {
    console.error('[voice-tracker] RPC failed:', rpcErr.message);
    return {
      minutesUsed: durationMinutes,
      totalThisMonth: durationMinutes,
      included,
      overage: Math.max(0, durationMinutes - included),
      isOverage: durationMinutes > included,
      percentUsed: included > 0 ? Math.round((durationMinutes / included) * 100) : 0,
      remaining: Math.max(0, included - durationMinutes),
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const totalThisMonth = Number(row?.minutes_used ?? durationMinutes);
  const overage = Number(row?.overage_minutes ?? 0);
  const isOverage = overage > 0;
  const percentUsed = included > 0 ? Math.round((totalThisMonth / included) * 100) : 0;
  const remaining = Math.max(0, included - totalThisMonth);

  // Marcar este call como overage si corresponde
  if (isOverage) {
    try {
      await supabaseAdmin
        .from('voice_call_logs')
        .update({ is_overage: true })
        .eq('retell_call_id', retellCallId);
    } catch {
      /* best effort */
    }
  }

  console.info(
    `[voice-tracker] tenant=${tenantId.substring(0, 8)} ` +
    `+${durationMinutes}min total=${totalThisMonth}/${included} ` +
    `overage=${overage} pct=${percentUsed}%`,
  );

  return {
    minutesUsed: durationMinutes,
    totalThisMonth,
    included,
    overage,
    isOverage,
    percentUsed,
    remaining,
  };
}

/**
 * Lectura read-only del uso del mes — para dashboard del tenant.
 *
 * AUDIT-R8 ALTO: si el tenant aún no tiene fila en voice_usage del mes
 * (típico al inicio de cada mes), antes retornaba `included=0` lo cual hacía
 * el dashboard mostrar "0/0 minutos" y `percentUsed=0`. Ahora caemos a
 * `tenants.voice_minutes_included` para mostrar el cupo real desde el día 1.
 */
export async function getVoiceUsageThisMonth(tenantId: string): Promise<{
  minutesUsed: number;
  included: number;
  remaining: number;
  overage: number;
  percentUsed: number;
}> {
  const yearMonth = new Date().toISOString().substring(0, 7);

  const [usageRes, tenantRes] = await Promise.all([
    supabaseAdmin
      .from('voice_usage')
      .select('minutes_used, minutes_included')
      .eq('tenant_id', tenantId)
      .eq('year_month', yearMonth)
      .maybeSingle(),
    supabaseAdmin
      .from('tenants')
      .select('voice_minutes_included')
      .eq('id', tenantId)
      .maybeSingle(),
  ]);

  const minutesUsed = Number(usageRes.data?.minutes_used ?? 0);
  // Prefer voice_usage.minutes_included (snapshot del mes), fallback al plan
  // actual del tenant. Garantiza que un tenant nuevo del mes ve su cupo real.
  const included = Number(
    usageRes.data?.minutes_included ?? tenantRes.data?.voice_minutes_included ?? 0,
  );
  const remaining = Math.max(0, included - minutesUsed);
  const overage = Math.max(0, minutesUsed - included);
  const percentUsed = included > 0 ? Math.round((minutesUsed / included) * 100) : 0;

  return { minutesUsed, included, remaining, overage, percentUsed };
}
