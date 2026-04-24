// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC BOOKING — availability endpoint (Phase 2.A.1)
//
// Sin auth. Un visitante entra a `/book/<slug>` y este endpoint le dice qué
// horarios hay libres el día que pida. Reutiliza la lógica de
// `check_availability` de agenda tools pero sin el contexto de un LLM.
//
// Abuse controls:
//   - Rate limit por IP via Redis (infra ya existente).
//   - El slug debe existir + estar enabled + no expirado.
//   - No expone datos sensibles: solo slots con start_time.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { resolveTenantTimezone } from '@/lib/config';
import {
  buildLocalIso,
  isWithinBusinessHours,
} from '@/lib/actions/appointment-helpers';

// In-memory range overlap check. `hasConflict` de appointment-helpers es
// async (hace query a la DB), acá las citas ya vienen pre-cargadas del
// query de este endpoint — no queremos N+1.
function rangeConflicts(
  startIso: string,
  endIso: string,
  busy: Array<{ start: string; end: string }>,
): boolean {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  return busy.some((b) => {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    return bs < e && be > s;
  });
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function extractClientIp(req: NextRequest): string {
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const parts = fwd.split(',');
    return parts[parts.length - 1].trim();
  }
  return 'unknown';
}

const QuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe ser YYYY-MM-DD'),
  service_id: z.string().uuid().optional(),
  duration_minutes: z.coerce.number().int().min(15).max(240).optional(),
});

type Slot = { start_time: string; end_time: string; duration_minutes: number };

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function minutesFromHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function hhmmFromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseHoursWindow(raw: string | undefined): { openMin: number; closeMin: number } | null {
  if (!raw || raw === 'cerrado' || !raw.includes('-')) return null;
  const [open, close] = raw.split('-');
  const openMin = minutesFromHHMM(open);
  const closeMin = minutesFromHHMM(close);
  if ([openMin, closeMin].some((n) => Number.isNaN(n))) return null;
  return { openMin, closeMin };
}

function dayKeyForDate(isoDate: string, timezone: string): string {
  const midday = buildLocalIso(isoDate, '12:00', timezone);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(new Date(midday)).toLowerCase();
  const map: Record<string, string> = {
    sun: 'dom', mon: 'lun', tue: 'mar', wed: 'mie',
    thu: 'jue', fri: 'vie', sat: 'sab',
  };
  return map[weekday] || 'lun';
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  if (!slug || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(slug)) {
    return NextResponse.json({ error: 'invalid_slug' }, { status: 400 });
  }

  // Rate limit por IP: 30 requests/min. Generoso para paciente legítimo
  // navegando días; agresivo suficiente contra scraping.
  const ip = extractClientIp(req);
  const limited = await checkApiRateLimit(`public_booking_avail:${ip}`, 30, 60);
  if (limited) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // Parse query
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    date: url.searchParams.get('date'),
    service_id: url.searchParams.get('service_id') || undefined,
    duration_minutes: url.searchParams.get('duration_minutes') || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_params', issues: parsed.error.issues.slice(0, 3) },
      { status: 400 },
    );
  }
  const { date, service_id, duration_minutes } = parsed.data;

  // Cargar el link + tenant
  const { data: link, error: linkErr } = await supabaseAdmin
    .from('public_booking_links')
    .select('id, tenant_id, staff_id, enabled, link_expires_at, monthly_bookings_cap, heading, subheading, brand_color_hex')
    .eq('slug', slug)
    .maybeSingle();

  if (linkErr || !link) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!link.enabled) {
    return NextResponse.json({ error: 'disabled' }, { status: 404 });
  }
  if (link.link_expires_at && new Date(link.link_expires_at as string) < new Date()) {
    return NextResponse.json({ error: 'expired' }, { status: 404 });
  }

  // Cargar tenant para timezone + business_hours
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('id, timezone, business_hours, status')
    .eq('id', link.tenant_id)
    .maybeSingle();

  if (!tenant || tenant.status !== 'active') {
    return NextResponse.json({ error: 'tenant_inactive' }, { status: 404 });
  }

  const timezone = resolveTenantTimezone(tenant as Record<string, unknown>);
  const businessHours = (tenant.business_hours as Record<string, string>) || {};

  // Monthly cap check: contar bookings del mes actual con este link
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count: monthBookings } = await supabaseAdmin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', link.tenant_id)
    .eq('public_booking_link_id', link.id)
    .gte('created_at', monthStart.toISOString());

  if ((monthBookings ?? 0) >= (link.monthly_bookings_cap ?? 100)) {
    return NextResponse.json({ error: 'monthly_cap_reached' }, { status: 503 });
  }

  // Fecha no puede ser pasada
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  if (date < today) {
    return NextResponse.json({ available: false, reason: 'past_date', slots: [] });
  }

  // Resolver business hours del día
  const dayKey = dayKeyForDate(date, timezone);
  const hoursWindow = parseHoursWindow(businessHours[dayKey]);
  if (!hoursWindow) {
    return NextResponse.json({
      available: false,
      reason: 'closed',
      slots: [],
      heading: link.heading,
      subheading: link.subheading,
      brand_color_hex: link.brand_color_hex,
    });
  }

  // Staff activo (opcionalmente filtrado por link.staff_id)
  let staffQuery = supabaseAdmin
    .from('staff')
    .select('id, name, default_duration')
    .eq('tenant_id', link.tenant_id)
    .eq('active', true);
  if (link.staff_id) staffQuery = staffQuery.eq('id', link.staff_id);
  const { data: staffList } = await staffQuery;
  if (!staffList || staffList.length === 0) {
    return NextResponse.json({
      available: false,
      reason: 'no_staff',
      slots: [],
      heading: link.heading,
      subheading: link.subheading,
      brand_color_hex: link.brand_color_hex,
    });
  }

  // Duración a usar para los slots
  let duration = duration_minutes ?? 30;
  if (service_id) {
    const { data: svc } = await supabaseAdmin
      .from('services')
      .select('duration_minutes')
      .eq('id', service_id)
      .eq('tenant_id', link.tenant_id)
      .maybeSingle();
    if (svc?.duration_minutes) duration = Number(svc.duration_minutes);
  } else if (staffList[0]?.default_duration) {
    duration = Number(staffList[0].default_duration);
  }

  // Citas existentes del día para resolver conflictos
  const dayStartIso = buildLocalIso(date, '00:00', timezone);
  const dayEndIso = buildLocalIso(date, '23:59', timezone);
  const { data: bookings } = await supabaseAdmin
    .from('appointments')
    .select('staff_id, datetime, end_datetime')
    .eq('tenant_id', link.tenant_id)
    .in('status', ['scheduled', 'confirmed'])
    .gte('datetime', dayStartIso)
    .lte('datetime', dayEndIso);

  const byStaff: Record<string, Array<{ start: string; end: string }>> = {};
  for (const b of (bookings || []) as Array<{ staff_id: string; datetime: string; end_datetime: string }>) {
    const sid = b.staff_id || 'unassigned';
    if (!byStaff[sid]) byStaff[sid] = [];
    byStaff[sid].push({ start: b.datetime, end: b.end_datetime });
  }

  // Generar slots cada 15 min dentro del window, y filtrar los que
  // tienen al menos un staff libre.
  const STEP_MIN = 15;
  const slots: Slot[] = [];
  for (let t = hoursWindow.openMin; t + duration <= hoursWindow.closeMin; t += STEP_MIN) {
    const startHHMM = hhmmFromMinutes(t);
    const startIso = buildLocalIso(date, startHHMM, timezone);
    const endIso = addMinutes(new Date(startIso), duration).toISOString();

    // ¿Pasó ya (para hoy)?
    if (new Date(startIso) < new Date()) continue;

    // ¿Business hours estrictamente? (defense-in-depth)
    if (!isWithinBusinessHours(startIso, businessHours, timezone)) continue;

    // Al menos un staff libre
    const anyFree = staffList.some((staff) => {
      const occupied = byStaff[staff.id] || [];
      return !rangeConflicts(startIso, endIso, occupied);
    });
    if (!anyFree) continue;

    slots.push({ start_time: startHHMM, end_time: hhmmFromMinutes(t + duration), duration_minutes: duration });
    if (slots.length >= 32) break; // cap: no mandamos más de 32 slots
  }

  return NextResponse.json({
    available: slots.length > 0,
    date,
    timezone,
    slots,
    // Branding + meta para la página pública
    heading: link.heading,
    subheading: link.subheading,
    brand_color_hex: link.brand_color_hex,
    business_hours_today: businessHours[dayKey],
  });
}
