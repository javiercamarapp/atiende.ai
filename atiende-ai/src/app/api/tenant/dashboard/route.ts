// ═════════════════════════════════════════════════════════════════════════════
// GET /api/tenant/dashboard
//
// Métricas operativas para el dueño del tenant — booking funnel, costo,
// citas activas, waitlist, top services, latencia promedio.
//
// Auth: Supabase user session (no CRON_SECRET — esto lo consume la UI
// del dashboard del dueño del consultorio).
//
// Response shape:
//   {
//     period: 'today' | 'week' | 'month',
//     funnel: { msgs_received, classified_appointment, booked, no_show },
//     appointments: { scheduled, confirmed, total_active, completed_period },
//     cost_usd: { today, week, month },
//     waitlist: { active, fulfilled_period },
//     top_services: [{ name, count }],
//     latency_p50_ms, latency_p95_ms,
//     classifier_avg_confidence,
//   }
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  period: z.enum(['today', 'week', 'month']).optional().default('week'),
});

function periodStart(period: 'today' | 'week' | 'month'): Date {
  const now = new Date();
  if (period === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (period === 'week') {
    return new Date(now.getTime() - 7 * 24 * 3600_000);
  }
  return new Date(now.getTime() - 30 * 24 * 3600_000);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const period = QuerySchema.parse({
      period: req.nextUrl.searchParams.get('period'),
    }).period;

    // Get user's tenant (owner)
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, name')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!tenant) {
      return NextResponse.json({ error: 'No tenant found for user' }, { status: 403 });
    }

    const tenantId = tenant.id as string;
    const sinceDate = periodStart(period);
    const sinceIso = sinceDate.toISOString();
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const weekStart = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const monthStart = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

    // Run independent queries in parallel
    const [
      msgsInbound,
      msgsAppointmentIntent,
      apptsBookedPeriod,
      apptsNoShowPeriod,
      apptsScheduled,
      apptsConfirmed,
      apptsCompletedPeriod,
      costToday,
      costWeek,
      costMonth,
      waitlistActive,
      waitlistFulfilledPeriod,
      topServices,
      latencyData,
      classifierConfidence,
    ] = await Promise.all([
      supabaseAdmin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('direction', 'inbound')
        .gte('created_at', sinceIso),

      supabaseAdmin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('direction', 'inbound')
        .like('intent', 'APPOINTMENT_%')
        .gte('created_at', sinceIso),

      supabaseAdmin
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .gte('created_at', sinceIso),

      supabaseAdmin
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'no_show')
        .gte('datetime', sinceIso),

      supabaseAdmin
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'scheduled')
        .gte('datetime', new Date().toISOString()),

      supabaseAdmin
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'confirmed')
        .gte('datetime', new Date().toISOString()),

      supabaseAdmin
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'completed')
        .gte('datetime', sinceIso),

      supabaseAdmin
        .from('messages')
        .select('cost_usd')
        .eq('tenant_id', tenantId)
        .gte('created_at', todayStart),

      supabaseAdmin
        .from('messages')
        .select('cost_usd')
        .eq('tenant_id', tenantId)
        .gte('created_at', weekStart),

      supabaseAdmin
        .from('messages')
        .select('cost_usd')
        .eq('tenant_id', tenantId)
        .gte('created_at', monthStart),

      // Waitlist (puede no existir en dev — try/catch externo)
      supabaseAdmin
        .from('appointment_waitlist')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'active'),

      supabaseAdmin
        .from('appointment_waitlist')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'fulfilled')
        .gte('created_at', sinceIso),

      // Top services (puede no estar populado si la tabla es pequeña)
      supabaseAdmin
        .from('appointments')
        .select('service_id, services:service_id(name)')
        .eq('tenant_id', tenantId)
        .gte('created_at', sinceIso)
        .not('service_id', 'is', null)
        .limit(500),

      supabaseAdmin
        .from('messages')
        .select('response_time_ms')
        .eq('tenant_id', tenantId)
        .eq('direction', 'outbound')
        .not('response_time_ms', 'is', null)
        .gte('created_at', sinceIso)
        .limit(1000),

      supabaseAdmin
        .from('classification_feedback')
        .select('confidence')
        .eq('tenant_id', tenantId)
        .gte('created_at', sinceIso)
        .limit(1000),
    ]);

    // Sum cost arrays
    const sumCost = (rows: { cost_usd: number | null }[] | null): number => {
      if (!rows) return 0;
      return rows.reduce((acc, r) => acc + (Number(r.cost_usd) || 0), 0);
    };

    // Top services aggregation
    const serviceCount: Record<string, number> = {};
    for (const row of (topServices.data || []) as Array<{ services: { name?: string } | { name?: string }[] | null }>) {
      const svc = Array.isArray(row.services) ? row.services[0] : row.services;
      const name = svc?.name || 'Sin nombre';
      serviceCount[name] = (serviceCount[name] || 0) + 1;
    }
    const topServicesList = Object.entries(serviceCount)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Latency p50/p95
    const latencies = ((latencyData.data as { response_time_ms: number }[] | null) || [])
      .map((r) => Number(r.response_time_ms))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    const p50 = latencies.length ? latencies[Math.floor(latencies.length * 0.5)] : 0;
    const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : 0;

    // Classifier confidence average
    const confidences = ((classifierConfidence.data as { confidence: number }[] | null) || [])
      .map((r) => Number(r.confidence))
      .filter((n) => Number.isFinite(n));
    const avgConfidence = confidences.length
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0;

    const msgs_received = msgsInbound.count ?? 0;
    const classified_appointment = msgsAppointmentIntent.count ?? 0;
    const booked = apptsBookedPeriod.count ?? 0;
    const conversion_rate = classified_appointment > 0
      ? Math.round((booked / classified_appointment) * 100)
      : 0;

    return NextResponse.json({
      tenant: { id: tenantId, name: tenant.name },
      period,
      generated_at: new Date().toISOString(),
      funnel: {
        msgs_received,
        classified_appointment,
        booked,
        no_show: apptsNoShowPeriod.count ?? 0,
        conversion_pct: conversion_rate,
      },
      appointments: {
        scheduled: apptsScheduled.count ?? 0,
        confirmed: apptsConfirmed.count ?? 0,
        total_active: (apptsScheduled.count ?? 0) + (apptsConfirmed.count ?? 0),
        completed_period: apptsCompletedPeriod.count ?? 0,
      },
      cost_usd: {
        today: Number(sumCost(costToday.data).toFixed(4)),
        week: Number(sumCost(costWeek.data).toFixed(4)),
        month: Number(sumCost(costMonth.data).toFixed(4)),
      },
      waitlist: {
        active: waitlistActive.count ?? 0,
        fulfilled_period: waitlistFulfilledPeriod.count ?? 0,
      },
      top_services: topServicesList,
      latency_ms: {
        p50,
        p95,
        sample_size: latencies.length,
      },
      classifier_avg_confidence: Number(avgConfidence.toFixed(3)),
    });
  } catch (err) {
    logger.error(
      '[tenant/dashboard] unhandled',
      err instanceof Error ? err : new Error(String(err)),
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
