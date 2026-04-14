// ═══════════════════════════════════════════════════════════
// APPOINTMENT HELPERS — Reusable booking logic
// Used by: handleNewAppointment, handleModifyConfirm, handleReservation
// Fixes bugs A (conflict), B (staff match), C (timezone), D (business hours),
// E (service match), H (no staff), I (state context).
// ═══════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';

// ─── Timezone helpers ──────────────────────────────────────────────────────

/**
 * Build an ISO timestamp (with offset) for `date` + `time` interpreted in
 * `timezone`. Fixes bug C: the previous code concatenated `${date}T${time}:00`
 * with no offset, so Postgres read it as UTC instead of Merida local time.
 *
 * Examples (timezone = "America/Merida"):
 *   buildLocalIso("2026-05-12", "10:00", "America/Merida")
 *     → "2026-05-12T10:00:00-06:00"
 *
 * Handles both standard offsets and DST transitions by asking Intl for the
 * offset that applies *at the requested instant*.
 */
export function buildLocalIso(date: string, time: string, timezone: string): string {
  const [hh, mm] = time.split(':').map(Number);
  const naive = new Date(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
  const offsetMinutes = getTimezoneOffsetMinutes(naive, timezone);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  return `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00${sign}${oh}:${om}`;
}

/**
 * Offset of `timezone` at instant `at`, in minutes. -360 for UTC-6 (Mexico,
 * standard time), +540 for UTC+9 (Tokyo). Sign follows ISO-8601 convention:
 * "14:00-06:00" means 14:00 in a zone 6h BEHIND UTC.
 */
function getTimezoneOffsetMinutes(at: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(at).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  // Intl can return hour "24" for midnight — normalize to 0.
  const hour = Number(parts.hour) % 24;
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    hour, Number(parts.minute), Number(parts.second),
  );
  return Math.round((asIfUtc - at.getTime()) / 60000);
}

/** Return the day-of-week key used in `business_hours` JSONB for `datetime`. */
export function dayKeyForDatetime(datetime: string, timezone: string): string {
  const days = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
  const d = new Date(datetime);
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  const weekday = dtf.format(d).toLowerCase();
  // Intl gives "sun", "mon", ..., "sat" — map to the es-MX keys.
  const map: Record<string, string> = {
    sun: 'dom', mon: 'lun', tue: 'mar', wed: 'mie', thu: 'jue', fri: 'vie', sat: 'sab',
  };
  return map[weekday] || days[d.getDay()];
}

/** "HH:MM" in `timezone` for `datetime`. */
export function timeOfDayInTimezone(datetime: string, timezone: string): string {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit',
  });
  return dtf.format(new Date(datetime));
}

// ─── Business hours validation (bug D) ────────────────────────────────────

/**
 * True iff `datetime` falls inside the tenant's business hours window for
 * that day-of-week. Used to reject bookings at 3am or on closed days.
 */
export function isWithinBusinessHours(
  datetime: string,
  businessHours: Record<string, string> | null,
  timezone: string,
): boolean {
  if (!businessHours) return true;
  const dayKey = dayKeyForDatetime(datetime, timezone);
  const todayHours = businessHours[dayKey];
  if (!todayHours || todayHours === 'cerrado') return false;

  const [open, close] = todayHours.split('-');
  if (!open || !close) return true;

  const current = timeOfDayInTimezone(datetime, timezone);
  const [ch, cm] = current.split(':').map(Number);
  const [oh, om] = open.split(':').map(Number);
  const [clh, clm] = close.split(':').map(Number);

  const cMin = ch * 60 + cm;
  const oMin = oh * 60 + om;
  const clMin = clh * 60 + clm;
  return cMin >= oMin && cMin <= clMin;
}

// ─── Conflict check (bug A) ────────────────────────────────────────────────

/**
 * True iff there's an existing scheduled/confirmed appointment for this
 * tenant (optionally filtered to a specific staff) that overlaps the window
 * [datetime, datetime + durationMinutes).
 *
 * Two appointments overlap when: existing.datetime < new.end_datetime AND
 * existing.end_datetime > new.datetime.
 */
export async function hasConflict(opts: {
  tenantId: string;
  staffId: string | null;
  datetime: string;
  durationMinutes: number;
}): Promise<boolean> {
  const newStart = new Date(opts.datetime).toISOString();
  const newEnd = new Date(
    new Date(opts.datetime).getTime() + opts.durationMinutes * 60000,
  ).toISOString();

  let query = supabaseAdmin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', opts.tenantId)
    .in('status', ['scheduled', 'confirmed'])
    // Overlap: existing.datetime < newEnd AND existing.end_datetime > newStart
    .lt('datetime', newEnd)
    .gt('end_datetime', newStart);

  if (opts.staffId) query = query.eq('staff_id', opts.staffId);

  const { count } = await query;
  return (count ?? 0) > 0;
}

// ─── Staff selection (bug B) ───────────────────────────────────────────────

export interface StaffRow {
  id: string;
  name: string;
  google_calendar_id: string | null;
  default_duration: number | null;
}

/**
 * Match a user-mentioned staff name against the active staff list. Falls back
 * to the first active staff member if no name was mentioned or no match found.
 * Returns null iff there's no active staff at all (bug H handled by caller).
 */
export function findMatchingStaff(
  staffList: StaffRow[] | null,
  requestedName: string | null | undefined,
): StaffRow | null {
  if (!staffList || staffList.length === 0) return null;
  if (requestedName && requestedName.trim().length > 0) {
    const needle = requestedName.toLowerCase().trim();
    // Try exact match, then "starts with", then substring.
    const exact = staffList.find((s) => s.name.toLowerCase() === needle);
    if (exact) return exact;
    const startsWith = staffList.find((s) => s.name.toLowerCase().startsWith(needle));
    if (startsWith) return startsWith;
    const contains = staffList.find((s) => s.name.toLowerCase().includes(needle));
    if (contains) return contains;
  }
  return staffList[0];
}

// ─── Service selection (bug E) ─────────────────────────────────────────────

export interface ServiceRow {
  id: string;
  name: string;
  duration_minutes: number | null;
  price: number | string | null;
}

/**
 * Match a user-mentioned service name against the active service list.
 * Prioritizes exact match over partial match to avoid "limpieza" grabbing
 * "limpieza dental" when "limpieza facial" was meant.
 * Returns null if no service query is provided and the caller has to decide
 * whether to use a default.
 */
export function findMatchingService(
  serviceList: ServiceRow[] | null,
  requestedName: string | null | undefined,
): ServiceRow | null {
  if (!serviceList || serviceList.length === 0) return null;
  if (!requestedName || requestedName.trim().length === 0) return null;

  const needle = requestedName.toLowerCase().trim();
  const exact = serviceList.find((s) => s.name.toLowerCase() === needle);
  if (exact) return exact;
  const startsWith = serviceList.find((s) => s.name.toLowerCase().startsWith(needle));
  if (startsWith) return startsWith;
  // Among substring matches, prefer the one with the shortest name (most
  // specific match). This avoids accidentally picking a long unrelated item.
  const contains = serviceList
    .filter((s) => s.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.length - b.name.length);
  return contains[0] || null;
}

// ─── Formatting helpers ────────────────────────────────────────────────────

/** Format a datetime in es-MX using the tenant timezone. */
export function formatDateTimeMx(datetime: string, timezone: string) {
  const d = new Date(datetime);
  const dateFmt = new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long',
  }).format(d);
  const timeFmt = new Intl.DateTimeFormat('es-MX', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit',
  }).format(d);
  return { dateFmt, timeFmt };
}
