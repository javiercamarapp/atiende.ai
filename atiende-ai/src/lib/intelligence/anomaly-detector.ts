// ═════════════════════════════════════════════════════════════════════════════
// ANOMALY DETECTOR — Phase 6.3
//
// Compara métricas del día actual vs baseline 30d. Umbral: >2 desviaciones
// estándar = anomalía. Retorna mensaje en español mexicano listo para UI.
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';

export interface Anomaly {
  metric: string;
  current_value: number;
  expected_value: number;
  deviation_pct: number;
  type: 'positive' | 'negative';
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

const Z_THRESHOLD = 2;

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function stddev(xs: number[], mu: number): number {
  if (xs.length < 2) return 0;
  const variance = xs.reduce((s, v) => s + (v - mu) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

function zScore(current: number, mu: number, sd: number): number {
  if (sd === 0) return 0;
  return (current - mu) / sd;
}

function pctDelta(current: number, expected: number): number {
  if (expected === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - expected) / expected) * 100);
}

// ─────────────────────────────────────────────────────────────────────────────

export async function detectAnomalies(tenantId: string): Promise<Anomaly[]> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);
  const start30d = new Date(todayStart.getTime() - 30 * 86_400_000);
  const weekAgo = new Date(todayStart.getTime() - 7 * 86_400_000);

  const [aptsRecent, msgsRecent, noShowWeek, totalWeek, newPatientsThisWeek, newPatientsHistory, responseTimes] = await Promise.all([
    // Citas agendadas por día (últimos 31 días)
    supabaseAdmin
      .from('appointments')
      .select('datetime, created_at')
      .eq('tenant_id', tenantId)
      .gte('datetime', start30d.toISOString())
      .lt('datetime', todayEnd.toISOString()),
    // Mensajes por día (últimos 30 días para tiempo de respuesta)
    supabaseAdmin
      .from('messages')
      .select('direction, created_at, response_time_ms')
      .eq('tenant_id', tenantId)
      .gte('created_at', start30d.toISOString()),
    // Conteos para no-show esta semana
    supabaseAdmin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'no_show')
      .gte('datetime', weekAgo.toISOString()),
    supabaseAdmin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('datetime', weekAgo.toISOString()),
    // Pacientes nuevos esta semana
    supabaseAdmin
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', weekAgo.toISOString()),
    // Pacientes nuevos por semana histórica (últimas 8 semanas sin contar esta)
    supabaseAdmin
      .from('contacts')
      .select('created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', new Date(todayStart.getTime() - 8 * 7 * 86_400_000).toISOString())
      .lt('created_at', weekAgo.toISOString()),
    // Response times promedios por día
    supabaseAdmin
      .from('messages')
      .select('response_time_ms, created_at')
      .eq('tenant_id', tenantId)
      .eq('direction', 'outbound')
      .not('response_time_ms', 'is', null)
      .gte('created_at', start30d.toISOString()),
  ]);

  const anomalies: Anomaly[] = [];

  // ── 1. Citas agendadas hoy vs promedio diario 30d ──────────────────────────
  const aptRows = (aptsRecent.data as Array<{ datetime: string; created_at: string }> | null) || [];
  const aptsByDay = new Map<string, number>();
  for (const a of aptRows) {
    const day = new Date(a.datetime).toISOString().slice(0, 10);
    aptsByDay.set(day, (aptsByDay.get(day) ?? 0) + 1);
  }
  const todayKey = todayStart.toISOString().slice(0, 10);
  const aptsToday = aptsByDay.get(todayKey) ?? 0;
  const aptsHistorical: number[] = [];
  for (let d = 0; d < 30; d++) {
    const day = new Date(todayStart.getTime() - (d + 1) * 86_400_000).toISOString().slice(0, 10);
    aptsHistorical.push(aptsByDay.get(day) ?? 0);
  }
  {
    const mu = mean(aptsHistorical);
    const sd = stddev(aptsHistorical, mu);
    const z = zScore(aptsToday, mu, sd);
    if (Math.abs(z) >= Z_THRESHOLD && mu >= 1) {
      const deltaPct = pctDelta(aptsToday, mu);
      const positive = z > 0;
      anomalies.push({
        metric: 'citas_hoy_vs_promedio',
        current_value: aptsToday,
        expected_value: Math.round(mu),
        deviation_pct: deltaPct,
        type: positive ? 'positive' : 'negative',
        severity: positive ? 'info' : Math.abs(deltaPct) > 50 ? 'critical' : 'warning',
        message: positive
          ? `Hoy tienes ${Math.abs(deltaPct)}% más citas que tu promedio diario (${aptsToday} vs ${Math.round(mu)}) 🎉`
          : `Hoy tienes ${Math.abs(deltaPct)}% menos citas que tu promedio diario (${aptsToday} vs ${Math.round(mu)}) ⚠️`,
      });
    }
  }

  // ── 2. No-show rate hoy vs promedio 30d ────────────────────────────────────
  {
    const noShowsByDay = new Map<string, number>();
    const totalByDay = new Map<string, number>();
    for (const a of aptRows) {
      const day = new Date(a.datetime).toISOString().slice(0, 10);
      totalByDay.set(day, (totalByDay.get(day) ?? 0) + 1);
    }
    // no_show status requires another fetch
    const { data: noShows } = await supabaseAdmin
      .from('appointments')
      .select('datetime')
      .eq('tenant_id', tenantId)
      .eq('status', 'no_show')
      .gte('datetime', start30d.toISOString())
      .lt('datetime', todayEnd.toISOString());

    for (const a of (noShows as Array<{ datetime: string }> | null) || []) {
      const day = new Date(a.datetime).toISOString().slice(0, 10);
      noShowsByDay.set(day, (noShowsByDay.get(day) ?? 0) + 1);
    }

    const rateToday = (totalByDay.get(todayKey) ?? 0) > 0
      ? Math.round((100 * (noShowsByDay.get(todayKey) ?? 0)) / (totalByDay.get(todayKey) ?? 1))
      : 0;
    const ratesHistorical: number[] = [];
    for (let d = 0; d < 30; d++) {
      const day = new Date(todayStart.getTime() - (d + 1) * 86_400_000).toISOString().slice(0, 10);
      const total = totalByDay.get(day) ?? 0;
      const ns = noShowsByDay.get(day) ?? 0;
      if (total > 0) ratesHistorical.push((100 * ns) / total);
    }
    if (ratesHistorical.length >= 5 && (totalByDay.get(todayKey) ?? 0) >= 3) {
      const mu = mean(ratesHistorical);
      const sd = stddev(ratesHistorical, mu);
      const z = zScore(rateToday, mu, sd);
      if (z >= Z_THRESHOLD) {
        anomalies.push({
          metric: 'no_show_rate_hoy',
          current_value: rateToday,
          expected_value: Math.round(mu),
          deviation_pct: pctDelta(rateToday, mu),
          type: 'negative',
          severity: rateToday > 30 ? 'critical' : 'warning',
          message: `Tu tasa de no-show hoy (${rateToday}%) está muy por encima de tu promedio de 30 días (${Math.round(mu)}%) ⚠️`,
        });
      }
    }
  }

  // ── 3. Nuevos pacientes esta semana vs promedio semanal ────────────────────
  {
    const thisWeekCount = newPatientsThisWeek.count ?? 0;
    const historical = (newPatientsHistory.data as Array<{ created_at: string }> | null) || [];
    const byWeek = new Map<string, number>();
    for (const r of historical) {
      const d = new Date(r.created_at);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = weekStart.toISOString().slice(0, 10);
      byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
    }
    const weekly = Array.from(byWeek.values());
    if (weekly.length >= 4) {
      const mu = mean(weekly);
      const sd = stddev(weekly, mu);
      const z = zScore(thisWeekCount, mu, sd);
      if (Math.abs(z) >= Z_THRESHOLD && mu >= 1) {
        const deltaPct = pctDelta(thisWeekCount, mu);
        const positive = z > 0;
        anomalies.push({
          metric: 'nuevos_pacientes_semana',
          current_value: thisWeekCount,
          expected_value: Math.round(mu),
          deviation_pct: deltaPct,
          type: positive ? 'positive' : 'negative',
          severity: positive ? 'info' : 'warning',
          message: positive
            ? `Esta semana llegaron ${thisWeekCount} pacientes nuevos, ${Math.abs(deltaPct)}% más que tu promedio semanal 🎉`
            : `Esta semana solo llegaron ${thisWeekCount} pacientes nuevos, ${Math.abs(deltaPct)}% menos que tu promedio semanal`,
        });
      }
    }
  }

  // ── 4. Tiempo de respuesta promedio hoy vs 30d ──────────────────────────────
  {
    const rt = (responseTimes.data as Array<{ response_time_ms: number | null; created_at: string }> | null) || [];
    const rtByDay = new Map<string, number[]>();
    for (const r of rt) {
      if (typeof r.response_time_ms !== 'number') continue;
      const day = new Date(r.created_at).toISOString().slice(0, 10);
      if (!rtByDay.has(day)) rtByDay.set(day, []);
      rtByDay.get(day)!.push(r.response_time_ms);
    }
    const avgByDay: number[] = [];
    let avgToday = 0;
    for (const [day, arr] of rtByDay) {
      const avg = mean(arr);
      if (day === todayKey) avgToday = avg;
      else avgByDay.push(avg);
    }
    if (avgByDay.length >= 7 && avgToday > 0) {
      const mu = mean(avgByDay);
      const sd = stddev(avgByDay, mu);
      const z = zScore(avgToday, mu, sd);
      if (z >= Z_THRESHOLD) {
        const deltaPct = pctDelta(avgToday, mu);
        anomalies.push({
          metric: 'tiempo_respuesta_hoy',
          current_value: Math.round(avgToday),
          expected_value: Math.round(mu),
          deviation_pct: deltaPct,
          type: 'negative',
          severity: deltaPct > 100 ? 'critical' : 'warning',
          message: `Tu tiempo de respuesta hoy es ${Math.abs(deltaPct)}% más lento que tu promedio (${Math.round(avgToday / 1000)}s vs ${Math.round(mu / 1000)}s)`,
        });
      }
    }
  }

  // Referenciamos los counts para no dejar unused
  void noShowWeek.count;
  void totalWeek.count;
  void msgsRecent;

  return anomalies;
}
