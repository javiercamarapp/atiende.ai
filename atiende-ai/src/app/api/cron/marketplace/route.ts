import { NextRequest, NextResponse } from 'next/server';
import { executeCronAgents } from '@/lib/marketplace/engine';
import { requireCronAuth } from '@/lib/agents/internal/cron-helpers';

export async function GET(request: NextRequest) {
  const authFail = requireCronAuth(request);
  if (authFail) return authFail;

  const now = new Date();
  const hour = now.getUTCHours();
  const dayOfWeek = now.getUTCDay();
  const dayOfMonth = now.getUTCDate();

  const results: Record<string, { executed: number }> = {};

  // Hourly — match agents with this hour
  results[`h${hour}`] = await executeCronAgents(`0 ${hour} * * *`);

  // Weekday-only agents (Mon-Fri)
  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    results[`wd${hour}`] = await executeCronAgents(`0 ${hour} * * 1-5`);
  }

  // Monday agents (reportes, rendimiento_staff)
  if (dayOfWeek === 1) {
    results[`mon${hour}`] = await executeCronAgents(`0 ${hour} * * 1`);
  }

  // MWF agents (cobrador: Mon, Wed, Fri)
  if ([1, 3, 5].includes(dayOfWeek)) {
    results[`mwf${hour}`] = await executeCronAgents(`0 ${hour} * * 1,3,5`);
  }

  // First of month (reactivacion)
  if (dayOfMonth === 1) {
    results[`m1_${hour}`] = await executeCronAgents(`0 ${hour} 1 * *`);
  }

  // Sunday midnight (faq_builder)
  if (dayOfWeek === 0 && hour === 0) {
    results.sun0 = await executeCronAgents('0 0 * * 0');
  }

  const total = Object.values(results).reduce((sum, r) => sum + r.executed, 0);

  return NextResponse.json({ ok: true, total, results });
}
