// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC BOOKING — POST endpoint (Phase 2.A.2)
//
// El paciente rellena form en /book/<slug> y submit llega acá. Este handler:
//   1. Valida slug + enabled + monthly cap (mismo set de checks que availability)
//   2. Valida reCAPTCHA token (si RECAPTCHA_SECRET configurado)
//   3. Upsert del contact por phone (tenant-scoped)
//   4. Recheck de disponibilidad + INSERT atómico de appointment
//   5. Trigger de notifyOwner "nueva cita desde widget"
//
// Abuse controls:
//   - Rate limit per-IP: 5 bookings/hour (agresivo — paciente legítimo no
//     agenda múltiples citas en una hora)
//   - reCAPTCHA obligatorio en prod (fail-open en dev si no hay secret)
//   - Validación fuerte de phone format y campos
//   - monthly_bookings_cap previene abuse-at-scale aunque el attacker pase
//     rate limits
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { resolveTenantTimezone } from '@/lib/config';
import { buildLocalIso, isWithinBusinessHours } from '@/lib/actions/appointment-helpers';
import { normalizePhoneMx } from '@/lib/whatsapp/normalize-phone';
import { encryptPII } from '@/lib/utils/crypto';
import { notifyOwner } from '@/lib/actions/notifications';
import { trackError } from '@/lib/monitoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  patient_name: z.string().min(2).max(200).transform((s) => s.replace(/\s+/g, ' ').trim().slice(0, 120)),
  patient_phone: z.string().min(6).max(30),
  patient_email: z.string().email().max(200).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date YYYY-MM-DD'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time HH:MM 24h'),
  service_id: z.string().uuid().optional(),
  service_name: z.string().max(200).optional(),
  reason: z.string().max(300).optional(),
  // reCAPTCHA token (v3 action="book" or v2). Si no se setea
  // RECAPTCHA_SECRET, validación es skip (dev).
  recaptcha_token: z.string().optional(),
});

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

async function verifyRecaptcha(token: string | undefined, remoteip: string): Promise<boolean> {
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) {
    // Dev: no bloqueamos si no hay secret. En prod el deploy check debería
    // garantizar que RECAPTCHA_SECRET está seteado.
    if (process.env.NODE_ENV === 'production') {
      trackError('public_booking_recaptcha_missing_in_prod');
      return false;
    }
    return true;
  }
  if (!token) return false;

  try {
    const body = new URLSearchParams({ secret, response: token, remoteip });
    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = (await res.json()) as { success?: boolean; score?: number };
    if (!data.success) return false;
    // v3 también trae un score 0..1. Aceptamos >=0.5 como humano-probable.
    if (typeof data.score === 'number' && data.score < 0.5) return false;
    return true;
  } catch {
    return false;
  }
}

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

function generateConfirmationCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  if (!slug || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(slug)) {
    return NextResponse.json({ error: 'invalid_slug' }, { status: 400 });
  }

  // Rate limit per-IP: 5 bookings/hour. Un paciente legítimo no agenda
  // varias citas en una hora; este cap protege contra spam-at-scale.
  const ip = extractClientIp(req);
  const limited = await checkApiRateLimit(`public_booking_post:${ip}`, 5, 3600);
  if (limited) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_params', issues: parsed.error.issues.slice(0, 3) },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // reCAPTCHA
  const captchaOk = await verifyRecaptcha(input.recaptcha_token, ip);
  if (!captchaOk) {
    return NextResponse.json({ error: 'captcha_failed' }, { status: 403 });
  }

  // Cargar link
  const { data: link, error: linkErr } = await supabaseAdmin
    .from('public_booking_links')
    .select('id, tenant_id, staff_id, enabled, link_expires_at, monthly_bookings_cap')
    .eq('slug', slug)
    .maybeSingle();

  if (linkErr || !link) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!link.enabled) return NextResponse.json({ error: 'disabled' }, { status: 404 });
  if (link.link_expires_at && new Date(link.link_expires_at as string) < new Date()) {
    return NextResponse.json({ error: 'expired' }, { status: 404 });
  }

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('id, timezone, business_hours, status, wa_phone_number_id')
    .eq('id', link.tenant_id)
    .maybeSingle();
  if (!tenant || tenant.status !== 'active') {
    return NextResponse.json({ error: 'tenant_inactive' }, { status: 404 });
  }

  const timezone = resolveTenantTimezone(tenant as Record<string, unknown>);
  const businessHours = (tenant.business_hours as Record<string, string>) || {};

  // Monthly cap
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

  // Construir datetime en timezone del tenant
  const datetime = buildLocalIso(input.date, input.time, timezone);
  const datetimeMs = new Date(datetime).getTime();
  if (!Number.isFinite(datetimeMs) || datetimeMs < Date.now()) {
    return NextResponse.json({ error: 'past_datetime' }, { status: 400 });
  }
  if (!isWithinBusinessHours(datetime, businessHours, timezone)) {
    return NextResponse.json({ error: 'outside_business_hours' }, { status: 400 });
  }

  // Resolver service + duración
  let serviceId: string | null = null;
  let serviceName = input.service_name ?? 'Cita';
  let duration = 30;
  if (input.service_id) {
    const { data: svc } = await supabaseAdmin
      .from('services')
      .select('id, name, duration_minutes')
      .eq('id', input.service_id)
      .eq('tenant_id', link.tenant_id)
      .eq('active', true)
      .maybeSingle();
    if (svc) {
      serviceId = svc.id as string;
      serviceName = svc.name as string;
      duration = Number(svc.duration_minutes) || 30;
    }
  }
  const endDatetime = new Date(datetimeMs + duration * 60_000).toISOString();

  // Resolver staff — usar link.staff_id si está, sino el primer activo libre
  let staffQuery = supabaseAdmin
    .from('staff')
    .select('id, name, default_duration')
    .eq('tenant_id', link.tenant_id)
    .eq('active', true);
  if (link.staff_id) staffQuery = staffQuery.eq('id', link.staff_id);
  const { data: staffList } = await staffQuery;
  if (!staffList || staffList.length === 0) {
    return NextResponse.json({ error: 'no_staff_available' }, { status: 409 });
  }

  // Check de conflicto: traer citas del día y buscar staff libre
  const dayStartIso = buildLocalIso(input.date, '00:00', timezone);
  const dayEndIso = buildLocalIso(input.date, '23:59', timezone);
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
  const freeStaff = staffList.find((s) => !rangeConflicts(datetime, endDatetime, byStaff[s.id] || []));
  if (!freeStaff) {
    return NextResponse.json({ error: 'slot_taken' }, { status: 409 });
  }

  // Normalizar phone + upsert contact
  const normalizedPhone = normalizePhoneMx(input.patient_phone);
  const encryptedName = encryptPII(input.patient_name) ?? input.patient_name;
  const { data: existingContact } = await supabaseAdmin
    .from('contacts')
    .select('id')
    .eq('tenant_id', link.tenant_id)
    .eq('phone', normalizedPhone)
    .maybeSingle();

  let contactId: string;
  if (existingContact?.id) {
    contactId = existingContact.id as string;
    // No sobrescribimos name/email si el paciente ya existe — política
    // first-touch (el intake/agenda lo puede updatear luego).
  } else {
    const { data: newContact, error: contactErr } = await supabaseAdmin
      .from('contacts')
      .insert({
        tenant_id: link.tenant_id,
        phone: normalizedPhone,
        name: encryptedName,
        email: input.patient_email ?? null,
        marketing_source: 'public_booking',
      })
      .select('id')
      .single();
    if (contactErr || !newContact) {
      trackError('public_booking_contact_insert_failed');
      return NextResponse.json({ error: 'contact_create_failed' }, { status: 500 });
    }
    contactId = newContact.id as string;
  }

  // INSERT atómico del appointment. Unique-slot constraint lo protege de
  // race conditions.
  const confirmationCode = generateConfirmationCode();
  const { data: appointment, error: aptErr } = await supabaseAdmin
    .from('appointments')
    .insert({
      tenant_id: link.tenant_id,
      staff_id: freeStaff.id,
      service_id: serviceId,
      contact_id: contactId,
      customer_phone: normalizedPhone,
      customer_name: input.patient_name,
      datetime,
      end_datetime: endDatetime,
      duration_minutes: duration,
      status: 'scheduled',
      source: 'public_booking',
      confirmation_code: confirmationCode,
      reason: input.reason ?? null,
      public_booking_link_id: link.id,
    })
    .select('id')
    .single();

  if (aptErr || !appointment) {
    // 23505 = unique_violation (race)
    if ((aptErr as { code?: string } | null)?.code === '23505') {
      return NextResponse.json({ error: 'slot_taken' }, { status: 409 });
    }
    trackError('public_booking_insert_failed');
    return NextResponse.json({ error: 'create_failed', detail: aptErr?.message }, { status: 500 });
  }

  // Update last_booking_at en el link (best-effort)
  void supabaseAdmin
    .from('public_booking_links')
    .update({ last_booking_at: new Date().toISOString() })
    .eq('id', link.id);

  // Notificar al dueño
  void notifyOwner({
    tenantId: link.tenant_id,
    event: 'new_appointment',
    details:
      `🌐 NUEVA CITA — booking page\n\n` +
      `Paciente: ${input.patient_name} (${normalizedPhone})\n` +
      `Servicio: ${serviceName}\n` +
      `Doctor: ${freeStaff.name}\n` +
      `Fecha: ${input.date} ${input.time}\n` +
      `Código: ${confirmationCode}`,
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    appointment_id: appointment.id as string,
    confirmation_code: confirmationCode,
    service: serviceName,
    staff_name: freeStaff.name,
    datetime,
    duration_minutes: duration,
  });
}
