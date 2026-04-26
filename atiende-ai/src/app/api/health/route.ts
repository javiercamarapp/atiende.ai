import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getMetrics, pingRedis } from '@/lib/monitoring';

export const dynamic = 'force-dynamic';

// PUBLIC ENDPOINT — Used by Vercel, load balancers, and uptime monitors
// Returns minimal status for unauthenticated requests
// Returns full operational metrics only with valid CRON_SECRET bearer token
export async function GET(req: NextRequest) {
  // Minimal public health check.
  // Audit fix: timing-safe constant comparison para CRON_SECRET. El `===`
  // anterior permitía teóricamente enumeración por timing del secret.
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  let isAuthed = false;
  if (cronSecret && authHeader) {
    const expected = `Bearer ${cronSecret}`;
    const aBuf = Buffer.from(authHeader);
    const eBuf = Buffer.from(expected);
    isAuthed = aBuf.length === eBuf.length && timingSafeEqual(aBuf, eBuf);
  }

  if (!isAuthed) {
    return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() });
  }

  const start = Date.now();

  // ─── Database (Supabase) ──────────────────────────────────────────────
  let dbOk = false;
  try {
    const { error } = await supabaseAdmin.from('tenants').select('id').limit(1);
    dbOk = !error;
  } catch {
    dbOk = false;
  }

  // ─── Redis ────────────────────────────────────────────────────────────
  let redisOk = false;
  try {
    redisOk = await pingRedis();
  } catch {
    redisOk = false;
  }

  // ─── LLM API (OpenRouter) ────────────────────────────────────────────
  // Solo verificamos que la key esté presente — un ping live sería caro y
  // los providers tienen sus propios SLAs. Si la key no está, el webhook
  // explota al primer mensaje.
  let llmOk = false;
  try {
    llmOk = !!process.env.OPENROUTER_API_KEY;
  } catch {
    llmOk = false;
  }

  // ─── Calendar sync backlog ───────────────────────────────────────────
  // Si hay >50 citas pendientes de sincronizar O alguna marcada 'failed'
  // (5 reintentos agotados), el calendario del staff está fuera de sync.
  // Esto degrada la confianza del agente: el cliente cree que tiene cita
  // pero el doctor no la ve en su calendar.
  let calendarBacklog = { pending: 0, failed: 0, ok: true };
  try {
    const { count: pendingCount } = await supabaseAdmin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .in('calendar_sync_status', ['pending', 'cancel']);
    const { count: failedCount } = await supabaseAdmin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('calendar_sync_status', 'failed');
    calendarBacklog = {
      pending: pendingCount ?? 0,
      failed: failedCount ?? 0,
      ok: (pendingCount ?? 0) < 50 && (failedCount ?? 0) === 0,
    };
  } catch {
    // schema sin columna aún — no es bloqueante
  }

  // ─── Cron last-run timestamps ─────────────────────────────────────────
  let cronLastRuns: Record<string, string | null> = {};
  try {
    const cronJobs = ['reminders', 'analytics', 'marketplace', 'sync-menu', 'trial-warning', 'daily-briefing', 'cleanup'];
    const { data } = await supabaseAdmin
      .from('cron_runs')
      .select('job_name, created_at')
      .in('job_name', cronJobs)
      .order('created_at', { ascending: false })
      .limit(cronJobs.length);

    cronLastRuns = Object.fromEntries(cronJobs.map((j) => [j, null]));
    if (data) {
      for (const row of data) {
        // Keep only the most recent per job
        if (!cronLastRuns[row.job_name]) {
          cronLastRuns[row.job_name] = row.created_at;
        }
      }
    }
  } catch {
    // cron_runs table may not exist yet — that's fine
    cronLastRuns = {};
  }

  // ─── Metrics summary ─────────────────────────────────────────────────
  let metrics = null;
  try {
    metrics = await getMetrics();
  } catch {
    metrics = null;
  }

  // ─── Overall status ──────────────────────────────────────────────────
  const allHealthy = dbOk; // DB is the only hard requirement
  const status = allHealthy ? 'ok' : 'degraded';

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      latencyMs: Date.now() - start,
      services: {
        database: dbOk ? 'ok' : 'down',
        redis: redisOk ? 'ok' : 'unavailable',
        llm: llmOk ? 'configured' : 'missing_key',
        calendarSync: calendarBacklog.ok ? 'ok' : 'degraded',
      },
      calendarBacklog,
      cronLastRuns,
      metrics,
    },
    { status: allHealthy ? 200 : 503 },
  );
}
