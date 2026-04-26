// ═════════════════════════════════════════════════════════════════════════════
// AGENDA TOOLS — Phase 2.A complete
//
// 5 tools que reúsan helpers de `appointment-helpers.ts` (Phase 1 bug-fixed):
//   - check_availability   (A.2)
//   - book_appointment     (A.3)
//   - get_my_appointments  (A.1)
//   - modify_appointment   (A.4)
//   - cancel_appointment   (A.1)
//
// Todas scoped por tenantId + customer_phone para prevenir prompt-injection
// cross-patient. Todas retornan {success, error_code, message, next_step}
// para que el LLM sepa qué responder sin ver detalles técnicos.
//
// Registro: side-effect al importar. `agenda/index.ts` importa este file
// para forzar el registerTool() global.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  buildLocalIso,
  formatDateTimeMx,
  hasConflict,
  isWithinBusinessHours,
  findMatchingService,
  findMatchingStaff,
  type StaffRow,
  type ServiceRow,
} from '@/lib/actions/appointment-helpers';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';
import { resolveTenantTimezone } from '@/lib/config';
import { normalizePhoneMx } from '@/lib/whatsapp/normalize-phone';

// ─── Tool 1: check_availability ──────────────────────────────────────────────
const CheckAvailArgs = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe ser YYYY-MM-DD'),
    service_type: z.string().min(1).max(120).optional(),
    staff_id: z.string().uuid().optional(),
    location_id: z.string().uuid().optional(),
    duration_minutes: z.number().int().min(15).max(240).optional().default(30),
  })
  .strict();

/**
 * Resuelve qué location aplica a este check/book. Retorna:
 *   - locationId: el UUID a usar (puede ser del arg o inferido si solo
 *     hay una activa)
 *   - needsLocation: true si el tenant tiene ≥2 locations activas y no
 *     se pasó location_id — el agente debe preguntar cuál.
 *   - locationRow: null cuando el tenant no usa locations (back-compat).
 */
async function resolveLocationContext(tenantId: string, providedLocationId?: string): Promise<{
  locationId: string | null;
  needsLocation: boolean;
  locationOptions: Array<{ id: string; name: string; city: string | null; is_primary: boolean }>;
}> {
  const { data: locations } = await supabaseAdmin
    .from('locations')
    .select('id, name, city, is_primary')
    .eq('tenant_id', tenantId)
    .eq('active', true);

  const active = locations ?? [];
  if (active.length === 0) {
    // Tenant sin locations configuradas — back-compat single-location
    return { locationId: null, needsLocation: false, locationOptions: [] };
  }

  if (providedLocationId) {
    const match = active.find((l) => l.id === providedLocationId);
    if (!match) {
      // Location inválida (otra tenant o inactiva) — tratamos como si no se hubiera pasado
      return { locationId: null, needsLocation: active.length > 1, locationOptions: active };
    }
    return { locationId: match.id as string, needsLocation: false, locationOptions: active };
  }

  if (active.length === 1) {
    return { locationId: active[0].id as string, needsLocation: false, locationOptions: active };
  }

  // ≥2 locations activas y no se especificó — agente debe preguntar
  return { locationId: null, needsLocation: true, locationOptions: active };
}

/** Slot buffer entre citas (min). Evita encimar citas que terminan "justito". */
const SLOT_BUFFER_MINUTES = 15;
/** Máximo slots que devolvemos al LLM para no saturar el prompt. */
const MAX_SLOTS_RETURNED = 8;

interface Slot {
  time: string;
  end_time: string;
  staff_id: string;
  staff_name: string;
}

interface StaffSlim {
  id: string;
  name: string;
  default_duration: number | null;
}

function todayIsoInTz(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function dayKeyFromDate(dateIso: string, timezone: string): string {
  // dateIso = YYYY-MM-DD ; queremos el key 'lun' | 'mar' | ... en la TZ del tenant.
  // Construimos mediodía para evitar edge cases de TZ en los límites del día.
  const midday = buildLocalIso(dateIso, '12:00', timezone);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(new Date(midday)).toLowerCase();
  const map: Record<string, string> = {
    sun: 'dom', mon: 'lun', tue: 'mar', wed: 'mie', thu: 'jue', fri: 'vie', sat: 'sab',
  };
  return map[weekday] || 'lun';
}

function parseHoursWindow(raw: string | undefined):
  | { openMin: number; closeMin: number }
  | null {
  if (!raw || raw === 'cerrado' || !raw.includes('-')) return null;
  const [open, close] = raw.split('-');
  if (!open || !close) return null;
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  if ([oh, om, ch, cm].some((n) => Number.isNaN(n))) return null;
  return { openMin: oh * 60 + om, closeMin: ch * 60 + cm };
}

/** Busca la siguiente fecha con ≥1 slot libre, hasta 14 días adelante. */
async function findNextAvailableDate(opts: {
  tenantId: string;
  startDate: string; // YYYY-MM-DD
  timezone: string;
  businessHours: Record<string, string>;
  durationMinutes: number;
  staffList: StaffSlim[];
}): Promise<string | null> {
  // PERF-2: 1 query batch trayendo TODAS las citas del rango (14 días) en vez
  // de hacer (14 días) × (N staff) queries individuales. Con 5 staff ahorra
  // 70 round-trips a Supabase y el TOOL_TIMEOUT_MS = 4_000 ya no se agota.
  const start = new Date(opts.startDate + 'T00:00:00Z');
  const rangeStart = new Date(start.getTime() + 86_400_000).toISOString();
  const rangeEnd = new Date(start.getTime() + 15 * 86_400_000).toISOString();

  const { data: bookings } = await supabaseAdmin
    .from('appointments')
    .select('staff_id, datetime, end_datetime')
    .eq('tenant_id', opts.tenantId)
    .in('status', ['scheduled', 'confirmed'])
    .gte('datetime', rangeStart)
    .lt('datetime', rangeEnd);

  // Index local: staffId → array de [startMs, endMs]
  const idx = new Map<string, Array<[number, number]>>();
  for (const b of (bookings || []) as Array<{ staff_id: string; datetime: string; end_datetime: string }>) {
    const arr = idx.get(b.staff_id) || [];
    arr.push([new Date(b.datetime).getTime(), new Date(b.end_datetime).getTime()]);
    idx.set(b.staff_id, arr);
  }

  for (let i = 1; i <= 14; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    const dayKey = dayKeyFromDate(iso, opts.timezone);
    const win = parseHoursWindow(opts.businessHours[dayKey]);
    if (!win) continue;

    const firstOpen = `${String(Math.floor(win.openMin / 60)).padStart(2, '0')}:${String(win.openMin % 60).padStart(2, '0')}`;
    const dtIso = buildLocalIso(iso, firstOpen, opts.timezone);
    const slotStart = new Date(dtIso).getTime();
    const slotEnd = slotStart + opts.durationMinutes * 60_000;

    // ¿Hay al menos un staff libre en ese primer slot? (in-memory check)
    for (const staff of opts.staffList) {
      const conflicts = idx.get(staff.id) || [];
      const hasConflict = conflicts.some(([s, e]) => s < slotEnd && e > slotStart);
      if (!hasConflict) return iso;
    }
  }
  return null;
}

registerTool('check_availability', {
  schema: {
    type: 'function',
    function: {
      name: 'check_availability',
      description:
        'Consulta horarios disponibles para agendar una cita. Llamar ANTES de book_appointment. Resolver fechas relativas (mañana, lunes, etc.) a YYYY-MM-DD antes de invocar. Retorna slots libres o un next_available_date si la fecha pedida está llena/cerrada.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          service_type: { type: 'string', description: 'Opcional' },
          staff_id: { type: 'string', description: 'UUID opcional' },
          duration_minutes: { type: 'number', description: 'Default 30, entre 15 y 240' },
        },
        required: ['date'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = CheckAvailArgs.parse(rawArgs);
    const timezone = resolveTenantTimezone(ctx.tenant);
    const durationMinutes = args.duration_minutes ?? 30;

    // 0. Location resolution — si el tenant tiene ≥2 locations activas
    // y no se pasó location_id, pedir al agente que pregunte cuál.
    const loc = await resolveLocationContext(ctx.tenantId, args.location_id);
    if (loc.needsLocation) {
      return {
        available: false,
        reason: 'NEEDS_LOCATION',
        message:
          'El consultorio tiene varias sucursales. Preguntale al paciente en cuál quiere agendar antes de seguir.',
        locations: loc.locationOptions.map((l) => ({
          id: l.id,
          name: l.name,
          city: l.city,
          is_primary: l.is_primary,
        })),
      };
    }

    // 1. Fecha no puede ser pasada (en TZ del tenant)
    const today = todayIsoInTz(timezone);
    if (args.date < today) {
      return {
        available: false,
        reason: 'PAST_DATE',
        message: 'La fecha solicitada ya pasó. Pide al paciente otra fecha.',
      };
    }

    // 1.5. Fecha no puede ser día festivo configurado (best effort — si tabla
    // no existe, el query falla silenciosamente y se considera no-festivo).
    try {
      const { data: holiday } = await supabaseAdmin
        .from('tenant_holidays')
        .select('reason')
        .eq('tenant_id', ctx.tenantId)
        .eq('date', args.date)
        .maybeSingle();
      if (holiday) {
        return {
          available: false,
          reason: 'HOLIDAY',
          message: `El consultorio no atiende esa fecha (${holiday.reason}).`,
        };
      }
    } catch {
      /* tenant_holidays no migrated yet — skip */
    }

    // 2. ¿Es día laboral según business_hours?
    const businessHours =
      (ctx.tenant.business_hours as Record<string, string>) || {};
    const dayKey = dayKeyFromDate(args.date, timezone);
    const window = parseHoursWindow(businessHours[dayKey]);
    if (!window) {
      // Cerrado ese día → buscar próximo día laboral con disponibilidad
      const { data: staffList } = await supabaseAdmin
        .from('staff')
        .select('id, name, default_duration')
        .eq('tenant_id', ctx.tenantId)
        .eq('active', true);

      const nextAvailable = staffList && staffList.length > 0
        ? await findNextAvailableDate({
            tenantId: ctx.tenantId,
            startDate: args.date,
            timezone,
            businessHours,
            durationMinutes,
            staffList: staffList as StaffSlim[],
          })
        : null;

      return {
        available: false,
        reason: 'CLOSED',
        message: 'El consultorio no atiende ese día.',
        next_available_date: nextAvailable,
      };
    }

    // 3. Cargar staff activo (filtrado opcional por staff_id y por location)
    let staffQuery = supabaseAdmin
      .from('staff')
      .select('id, name, default_duration')
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true);
    if (args.staff_id) staffQuery = staffQuery.eq('id', args.staff_id);

    // Si hay location resuelta, filtrar staff que atienden ahí (join con
    // staff_locations). Traemos los staff_ids elegibles y filtramos en
    // memoria en vez de agregar .in() con un IN grande.
    if (loc.locationId) {
      const { data: staffLocRows } = await supabaseAdmin
        .from('staff_locations')
        .select('staff_id')
        .eq('location_id', loc.locationId);
      const eligibleIds = (staffLocRows || []).map((r) => r.staff_id as string);
      if (eligibleIds.length === 0) {
        return {
          available: false,
          reason: 'NO_STAFF_AT_LOCATION',
          message:
            'Esa sucursal todavía no tiene doctores asignados. Pide al paciente elegir otra o contactar al consultorio.',
        };
      }
      staffQuery = staffQuery.in('id', eligibleIds);
    }

    const { data: staffRows } = await staffQuery;
    const staffList = (staffRows || []) as StaffSlim[];

    if (staffList.length === 0) {
      return {
        available: false,
        reason: 'NO_STAFF',
        message: args.staff_id
          ? 'El profesional solicitado no está disponible.'
          : 'No hay profesionales activos para agendar en línea.',
      };
    }

    // 4. Cargar citas ocupadas del día (de TODO el staff activo, filtrar per-staff después)
    //    Ventana del día completa en TZ del tenant → UTC.
    const dayStartIso = buildLocalIso(args.date, '00:00', timezone);
    const dayEndIso = new Date(
      new Date(dayStartIso).getTime() + 24 * 60 * 60_000,
    ).toISOString();

    const { data: bookings } = await supabaseAdmin
      .from('appointments')
      .select('staff_id, datetime, end_datetime')
      .eq('tenant_id', ctx.tenantId)
      .in('status', ['scheduled', 'confirmed'])
      .gte('datetime', dayStartIso)
      .lt('datetime', dayEndIso);

    const byStaff: Record<string, Array<{ start: number; end: number }>> = {};
    for (const b of bookings || []) {
      const sid = (b.staff_id as string) || 'unassigned';
      if (!byStaff[sid]) byStaff[sid] = [];
      const start = new Date(b.datetime as string).getTime();
      const end = b.end_datetime
        ? new Date(b.end_datetime as string).getTime()
        : start + durationMinutes * 60_000;
      byStaff[sid].push({ start, end });
    }

    // 5. Generar candidatos cada `durationMinutes` minutos desde openMin hasta
    //    (closeMin - durationMinutes). Para cada candidato, buscar al menos
    //    un staff libre (con buffer). Saltar candidatos en el pasado (hoy).
    const nowMs = Date.now();
    const stepMinutes = durationMinutes;
    const slots: Slot[] = [];

    for (
      let minuteOfDay = window.openMin;
      minuteOfDay + durationMinutes <= window.closeMin;
      minuteOfDay += stepMinutes
    ) {
      const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
      const mm = String(minuteOfDay % 60).padStart(2, '0');
      const startIso = buildLocalIso(args.date, `${hh}:${mm}`, timezone);
      const startMs = new Date(startIso).getTime();
      const endMs = startMs + durationMinutes * 60_000;

      if (startMs < nowMs) continue; // no sugerir slots que ya pasaron

      // Confirmar que el slot cae dentro de business_hours (defense in depth)
      if (!isWithinBusinessHours(startIso, businessHours, timezone)) continue;

      // Buscar un staff libre para este slot (respetando buffer)
      const bufferMs = SLOT_BUFFER_MINUTES * 60_000;
      const freeStaff = staffList.find((staff) => {
        const occupied = byStaff[staff.id] || [];
        return !occupied.some((o) => o.start - bufferMs < endMs && o.end + bufferMs > startMs);
      });

      if (freeStaff) {
        const endHH = String(Math.floor((minuteOfDay + durationMinutes) / 60)).padStart(2, '0');
        const endMM = String((minuteOfDay + durationMinutes) % 60).padStart(2, '0');
        slots.push({
          time: `${hh}:${mm}`,
          end_time: `${endHH}:${endMM}`,
          staff_id: freeStaff.id,
          staff_name: freeStaff.name,
        });
        if (slots.length >= MAX_SLOTS_RETURNED) break;
      }
    }

    if (slots.length === 0) {
      const nextAvailable = await findNextAvailableDate({
        tenantId: ctx.tenantId,
        startDate: args.date,
        timezone,
        businessHours,
        durationMinutes,
        staffList,
      });
      return {
        available: false,
        reason: 'FULL',
        message: 'No hay horarios disponibles ese día.',
        next_available_date: nextAvailable,
      };
    }

    const { dateFmt } = formatDateTimeMx(buildLocalIso(args.date, '12:00', timezone), timezone);
    return {
      available: true,
      date: args.date,
      date_human: dateFmt,
      duration_minutes: durationMinutes,
      slots,
      total_available: slots.length,
      more_slots_exist: slots.length === MAX_SLOTS_RETURNED,
    };
  },
});

// ─── Tool 2: book_appointment ────────────────────────────────────────────────
const BookArgs = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe ser YYYY-MM-DD'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time debe ser HH:MM 24h'),
    service_type: z.string().min(1).max(120),
    // Nombres mexicanos largos (ej. 5+ apellidos compuestos) pueden llegar
    // a ~120 chars. Aceptamos hasta 300 como red de seguridad, pero
    // TRUNCAMOS a 120 + limpiamos saltos de línea / spam de espacios antes
    // de persistir. Así un LLM que pase "Nombre\n\n\n(...)" no rompe el
    // catálogo de pacientes.
    patient_name: z
      .string()
      .min(1)
      .max(300)
      .transform((s) => s.replace(/\s+/g, ' ').trim().slice(0, 120)),
    patient_phone: z.string().min(6).max(20),
    staff_id: z.string().uuid().optional(),
    location_id: z.string().uuid().optional(),
    // Motivo de la cita. Campo separado de `notes` para facilitar analytics
    // y mostrarlo como columna "Motivo" en el historial del paciente.
    // Ejemplos: "limpieza dental", "dolor de muela superior derecho",
    // "revisión de ortodoncia", "extracción de muela del juicio".
    reason: z.string().min(1).max(300).optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

/**
 * Genera un confirmation code seguro y human-friendly.
 *
 * Diseño:
 *  - 12 bytes random (96 bits de entropía) → 2^96 posibilidades.
 *    Un atacante con 1B intentos/segundo necesitaría ~10^21 años para
 *    enumerar el espacio. Antes eran 32 bits (2^32 ≈ 4B), brute-forceable
 *    en horas si tenías acceso a la API y querías cancelar citas ajenas.
 *  - Encoding base32 (Crockford-style: sin I/L/O/U para evitar confusión
 *    visual), uppercase, 16 chars total. Más legible al teléfono que UUID.
 *  - Sin guiones para que se pueda dictar fácil.
 *
 * Defensa adicional contra brute-force a nivel API:
 *  - cancel_appointment / modify_appointment requieren MATCH del
 *    customer_phone (handler line 1287), así que aún si alguien adivina
 *    un código, NO puede cancelar la cita de otro paciente sin además
 *    suplantar el WhatsApp.
 */
const CONFIRMATION_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // 32 chars (sin I/L/O/U)
function generateConfirmationCode(): string {
  const bytes = new Uint8Array(12); // 96 bits
  crypto.getRandomValues(bytes);
  // Convertimos cada nibble (4 bits) a un char del alphabet → 24 chars,
  // tomamos los primeros 16 para keep it readable (80 bits efectivos
  // post-encoding, todavía 1.2 × 10^24 — más que suficiente).
  let out = '';
  for (let i = 0; i < bytes.length && out.length < 16; i++) {
    out += CONFIRMATION_ALPHABET[bytes[i] & 0x1f];
    out += CONFIRMATION_ALPHABET[(bytes[i] >> 3) & 0x1f];
  }
  return out.slice(0, 16);
}

registerTool('book_appointment', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'book_appointment',
      description:
        'Crea una cita confirmada en la base de datos. SOLO llamar después de: (1) check_availability confirmó disponibilidad, (2) el paciente confirmó TODOS los datos explícitamente incluyendo el motivo. Nunca llamar sin confirmación del paciente.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM (24h)' },
          service_type: { type: 'string' },
          patient_name: { type: 'string' },
          patient_phone: { type: 'string' },
          staff_id: { type: 'string', description: 'UUID opcional — si se omite se elige un staff libre' },
          location_id: { type: 'string', description: 'UUID opcional de la sucursal. Si el tenant tiene ≥2 locations activas, es REQUERIDO — el check_availability previo retornará reason=NEEDS_LOCATION y deberás preguntar al paciente cuál eligió.' },
          reason: {
            type: 'string',
            description:
              'Motivo de la cita en palabras del paciente, breve (5-30 palabras). Ejemplos: "limpieza dental de rutina", "dolor en muela superior derecha hace 3 días", "revisión de ortodoncia mensual", "extracción de muela del juicio inferior". Debe preguntarse ANTES de book_appointment; si el paciente no dice nada específico, pedir explícitamente ("¿cuál es el motivo de la visita?").',
          },
          notes: { type: 'string', description: 'Opcional — anotaciones internas adicionales (no del motivo). Ej. "primera vez", "llega con acompañante".' },
        },
        required: ['date', 'time', 'service_type', 'patient_name', 'patient_phone'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const parse = BookArgs.safeParse(rawArgs);
    if (!parse.success) {
      console.warn('[tool:book_appointment] validation failed:', parse.error.issues);
      return {
        success: false,
        error_code: 'INVALID_ARGS',
        message:
          'Permítame verificar los datos. ¿Puede confirmarme el día, la hora y su nombre completo?',
      };
    }
    const args = parse.data;
    args.patient_phone = normalizePhoneMx(args.patient_phone);

    // Location resolution — si el tenant tiene ≥2 locations activas y no
    // se pasó location_id, rechazamos el book con NEEDS_LOCATION.
    // check_availability ya debería haber devuelto este error; acá es
    // defense-in-depth por si el LLM llama book sin haber llamado check.
    const loc = await resolveLocationContext(ctx.tenantId, args.location_id);
    if (loc.needsLocation) {
      return {
        success: false,
        error_code: 'NEEDS_LOCATION',
        message:
          'Hay varias sucursales. Preguntale al paciente en cuál quiere su cita y volvé a llamar book_appointment con location_id.',
        locations: loc.locationOptions.map((l) => ({
          id: l.id,
          name: l.name,
          city: l.city,
        })),
      };
    }

    // Defensa contra LLM que pasa el teléfono como nombre. Si patient_name
    // es solo dígitos / + / espacios / guiones (≥7 chars) asumimos que el
    // LLM se confundió y uso el teléfono. Preferimos ctx.customerName
    // (profile.name de WhatsApp) — si tampoco tenemos eso, caemos a
    // "Paciente" + últimos 4 del teléfono para que el dueño pueda
    // distinguir en su calendario sin exponer el número completo.
    const looksLikePhone = /^[+\d\s\-()]{7,}$/.test(args.patient_name) && !/[a-záéíóúñ]/i.test(args.patient_name);
    if (looksLikePhone) {
      const digits = args.patient_phone.replace(/\D/g, '');
      const last4 = digits.slice(-4) || '0000';
      args.patient_name = (ctx.customerName && ctx.customerName.trim())
        || `Paciente ${last4}`;
      console.warn('[book_appointment] LLM passed phone-like patient_name — substituted', {
        originalLooksLikePhone: true,
        substituted: args.patient_name,
        hasCustomerName: Boolean(ctx.customerName),
      });
    }

    const timezone = resolveTenantTimezone(ctx.tenant);
    const datetime = buildLocalIso(args.date, args.time, timezone);

    // 1. Validar que la fecha no es pasada
    if (new Date(datetime).getTime() < Date.now()) {
      return {
        success: false,
        error_code: 'PAST_DATE',
        message: 'Esa fecha y hora ya pasaron.',
      };
    }

    // 2. Validar business hours (defense in depth — check_availability ya lo validó)
    const businessHours =
      (ctx.tenant.business_hours as Record<string, string>) || null;
    if (!isWithinBusinessHours(datetime, businessHours, timezone)) {
      return {
        success: false,
        error_code: 'OUTSIDE_HOURS',
        message: 'Ese horario está fuera del horario de atención.',
        next_step: 'Llama check_availability para ver slots válidos.',
      };
    }

    // 3. Cargar staff activo; elegir por staff_id o fuzzy-match por nombre.
    // Si hay location resuelta, filtramos por los staff_ids que atienden ahí.
    let eligibleStaffIds: string[] | null = null;
    if (loc.locationId) {
      const { data: staffLocRows } = await supabaseAdmin
        .from('staff_locations')
        .select('staff_id')
        .eq('location_id', loc.locationId);
      eligibleStaffIds = (staffLocRows || []).map((r) => r.staff_id as string);
      if (eligibleStaffIds.length === 0) {
        return {
          success: false,
          error_code: 'NO_STAFF_AT_LOCATION',
          message: 'Esa sucursal no tiene doctores asignados. Elige otra sucursal o contacta al consultorio.',
        };
      }
    }

    let staffBaseQuery = supabaseAdmin
      .from('staff')
      .select('id, name, google_calendar_id, default_duration')
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true);
    if (eligibleStaffIds) staffBaseQuery = staffBaseQuery.in('id', eligibleStaffIds);
    const { data: staffRows } = await staffBaseQuery;

    if (!staffRows || staffRows.length === 0) {
      return {
        success: false,
        error_code: 'NO_STAFF',
        message: 'No hay profesionales activos para agendar en línea.',
        next_step: 'Escala a humano (escalate_to_human).',
      };
    }

    let staffMember: StaffRow | null = null;
    if (args.staff_id) {
      staffMember = (staffRows.find((s) => s.id === args.staff_id) as StaffRow) || null;
      if (!staffMember) {
        return {
          success: false,
          error_code: 'STAFF_NOT_FOUND',
          message: 'El profesional solicitado no existe o no está activo.',
        };
      }
    } else {
      // Sin staff específico: dejamos el fuzzy-match (aunque no hay name en args,
      // en la práctica caerá al primer disponible después del conflict check).
      staffMember = findMatchingStaff(staffRows as StaffRow[], null);
    }
    if (!staffMember) {
      return {
        success: false,
        error_code: 'NO_STAFF',
        message: 'No encontré un profesional disponible.',
      };
    }

    // 4. Match service (para grabar service_id + duración real)
    const { data: serviceRows } = await supabaseAdmin
      .from('services')
      .select('id, name, duration_minutes, price')
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true);

    const matchedService = findMatchingService(
      (serviceRows || []) as ServiceRow[],
      args.service_type,
    );

    // Rechaza solo precios NULL/undefined/negativos — precio
    // EXACTO de 0 es legítimo (valoración inicial gratis, lectura de
    // estudios, consulta de cortesía). El catálogo clínico mexicano
    // comúnmente marca servicios gratuitos con price=0 intencional.
    if (
      matchedService &&
      (matchedService.price === null ||
        matchedService.price === undefined ||
        Number(matchedService.price) < 0)
    ) {
      return {
        success: false,
        error_code: 'INVALID_SERVICE_PRICE',
        message:
          'Ese servicio tiene un precio inválido en el catálogo. Por favor pídale al consultorio que lo corrija antes de agendar.',
      };
    }

    const duration = matchedService?.duration_minutes
      || staffMember.default_duration
      || 30;
    const endDt = new Date(
      new Date(datetime).getTime() + duration * 60_000,
    ).toISOString();

    // 5. Conflict check (previene double-booking — el slot pudo haberse tomado
    //    entre el check_availability y este book_appointment)
    const conflict = await hasConflict({
      tenantId: ctx.tenantId,
      staffId: staffMember.id,
      datetime,
      durationMinutes: duration,
    });
    if (conflict) {
      return {
        success: false,
        error_code: 'SLOT_TAKEN',
        message: 'Ese horario ya no está disponible.',
        next_step:
          'Llama check_availability de nuevo para obtener slots actualizados. Si el paciente NO encuentra ninguno que le acomode, ofrécele entrar a la lista de espera con add_to_waitlist (le notificamos cuando se libera un slot).',
      };
    }

    // 6. INSERT atómico
    const confirmationCode = generateConfirmationCode();
    const { data: appointment, error } = await supabaseAdmin
      .from('appointments')
      .insert({
        tenant_id: ctx.tenantId,
        staff_id: staffMember.id,
        service_id: matchedService?.id ?? null,
        contact_id: ctx.contactId,
        conversation_id: ctx.conversationId,
        customer_phone: args.patient_phone,
        customer_name: args.patient_name,
        datetime,
        end_datetime: endDt,
        duration_minutes: duration,
        status: 'scheduled',
        source: 'orchestrator',
        confirmation_code: confirmationCode,
        reason: args.reason?.trim() || null,
        notes: args.notes ?? null,
        location_id: loc.locationId,
      })
      .select('id')
      .single();

    if (error || !appointment) {
      // 23505 = unique_violation (uniq_appointment_slot). Race condition:
      // otro paciente ganó el slot entre nuestro hasConflict y este INSERT.
      if ((error as { code?: string } | null)?.code === '23505') {
        return {
          success: false,
          error_code: 'SLOT_TAKEN',
          message: 'Ese horario acaba de ser ocupado por otro paciente. Pídele que elija otro.',
          next_step:
            'Llama check_availability de nuevo para obtener slots actualizados.',
        };
      }
      console.warn('[tool:book_appointment] INSERT failed:', error?.message);
      return {
        success: false,
        error_code: 'INSERT_FAILED',
        message: 'Tuve un problema registrando la cita.',
        next_step:
          'Disculpa al paciente y avísale que el equipo lo va a contactar. Puedes llamar escalate_to_human.',
      };
    }

    // 7. Google Calendar sync (best effort)
    let calendar_synced = false;
    if (staffMember.google_calendar_id) {
      try {
        const { createCalendarEvent } = await import('@/lib/calendar/google');
        const ev = await createCalendarEvent({
          staffId: staffMember.id,
          calendarId: staffMember.google_calendar_id,
          summary: `${matchedService?.name || args.service_type} - ${args.patient_name}`,
          description: `WhatsApp: ${args.patient_phone}${args.reason ? `\nMotivo: ${args.reason}` : ''}${args.notes ? `\nNotas: ${args.notes}` : ''}\nCódigo: ${confirmationCode}`,
          startTime: datetime,
          endTime: endDt,
          attendeeEmail: undefined,
          signal: ctx.signal,
        });
        if (ev?.eventId) {
          await supabaseAdmin
            .from('appointments')
            .update({ google_event_id: ev.eventId })
            .eq('id', appointment.id);
          calendar_synced = true;
        }
      } catch (err) {
        console.warn('[tool:book_appointment] Calendar sync failed:', err);
      }
    }

    // 8. notifyOwner — si falla, persistimos `owner_notified=false` en la
    // fila de la cita para que el cron `/api/cron/notify-retry` pueda
    // reprocesar con backoff exponencial.
    const { dateFmt, timeFmt } = formatDateTimeMx(datetime, timezone);
    let ownerNotified = false;
    let ownerNotifyError: string | undefined;
    try {
      const { notifyOwner } = await import('@/lib/actions/notifications');
      const res = await notifyOwner({
        tenantId: ctx.tenantId,
        event: 'new_appointment',
        details: `${args.patient_name} (${args.patient_phone})\n${matchedService?.name || args.service_type} con ${staffMember.name}\n${dateFmt} ${timeFmt}\nCódigo: ${confirmationCode}`,
      });
      ownerNotified = res.ok;
      if (!res.ok) ownerNotifyError = res.error;
    } catch (err) {
      ownerNotifyError = err instanceof Error ? err.message : String(err);
      console.warn('[book_appointment] notifyOwner threw:', ownerNotifyError);
    }
    // Persistir resultado en la cita para visibilidad + retry posterior.
    // Si las columnas no existen aún (schema antiguo), el UPDATE falla en
    // silencio — la migración contact_send_errors/appointments_owner_notify
    // añade las columnas.
    try {
      await supabaseAdmin
        .from('appointments')
        .update({
          owner_notified: ownerNotified,
          owner_notified_at: ownerNotified ? new Date().toISOString() : null,
          owner_notify_error: ownerNotifyError ?? null,
        })
        .eq('id', appointment.id);
    } catch {
      /* columna nueva — schema no aplicado aún */
    }

    // 9. Marketplace event
    try {
      const { executeEventAgents } = await import('@/lib/marketplace/engine');
      await executeEventAgents('appointment.completed', {
        tenant_id: ctx.tenantId,
        customer_phone: args.patient_phone,
        customer_name: args.patient_name,
        service_name: matchedService?.name,
      });
    } catch {
      /* best effort */
    }

    return {
      success: true,
      appointment: {
        appointment_id: appointment.id as string,
        confirmation_code: confirmationCode,
        datetime_iso: datetime,
        date_human: dateFmt,
        time_human: timeFmt,
        service: matchedService?.name || args.service_type,
        staff_name: staffMember.name,
        duration_minutes: duration,
        price: matchedService?.price ?? null,
        calendar_synced,
      },
      summary: `Cita agendada para ${dateFmt} a las ${timeFmt} con ${staffMember.name}. Código: ${confirmationCode}`,
    };
  },
});

// ─── Tool 3: get_my_appointments ─────────────────────────────────────────────
const GetMyArgs = z
  .object({
    patient_phone: z.string().min(6).max(20),
    include_past: z.boolean().optional().default(false),
  })
  .strict();

interface FormattedAppointment {
  appointment_id: string;
  confirmation_code: string | null;
  datetime_iso: string;
  datetime_formatted: string;
  service: string | null;
  staff_name: string | null;
  status: string;
}

registerTool('get_my_appointments', {
  schema: {
    type: 'function',
    function: {
      name: 'get_my_appointments',
      description:
        'Obtiene las citas del paciente identificado por su número de WhatsApp. Por defecto solo retorna citas futuras.',
      parameters: {
        type: 'object',
        properties: {
          patient_phone: { type: 'string' },
          include_past: { type: 'boolean', description: 'Default false' },
        },
        required: ['patient_phone'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = GetMyArgs.parse(rawArgs);
    args.patient_phone = normalizePhoneMx(args.patient_phone);
    const timezone = resolveTenantTimezone(ctx.tenant);

    let q = supabaseAdmin
      .from('appointments')
      .select(`
        id,
        confirmation_code,
        datetime,
        status,
        notes,
        service_id,
        staff_id,
        services:service_id(name),
        staff:staff_id(name)
      `)
      .eq('tenant_id', ctx.tenantId)
      .eq('customer_phone', args.patient_phone)
      .order('datetime', { ascending: true })
      .limit(10);

    if (!args.include_past) {
      q = q.gte('datetime', new Date().toISOString());
    }

    const { data, error } = await q;

    if (error) {
      return {
        success: false,
        error_code: 'QUERY_FAILED',
        message: 'No pude consultar sus citas en este momento.',
        appointments: [],
      };
    }

    const appointments: FormattedAppointment[] = (data || []).map((row) => {
      const { dateFmt, timeFmt } = formatDateTimeMx(row.datetime as string, timezone);
      const serviceRel = row.services as { name?: string } | null;
      const staffRel = row.staff as { name?: string } | null;
      return {
        appointment_id: row.id as string,
        confirmation_code: (row.confirmation_code as string | null) ?? null,
        datetime_iso: row.datetime as string,
        datetime_formatted: `${dateFmt} a las ${timeFmt}`,
        service: serviceRel?.name ?? null,
        staff_name: staffRel?.name ?? null,
        status: row.status as string,
      };
    });

    if (appointments.length === 0) {
      return {
        success: true,
        count: 0,
        appointments: [],
        message: args.include_past
          ? 'Este paciente no tiene citas registradas en el sistema.'
          : 'Este paciente no tiene citas futuras agendadas.',
      };
    }

    return {
      success: true,
      count: appointments.length,
      appointments,
    };
  },
});

// ─── Tool 4: modify_appointment ──────────────────────────────────────────────
const ModifyArgs = z
  .object({
    appointment_id: z
      .string()
      .optional()
      .refine((val) => !val || UUID_RE.test(val), {
        message:
          'appointment_id debe ser UUID. Para códigos cortos como ABC12345 usa el campo confirmation_code.',
      }),
    // Acepta tanto formato nuevo (16 chars base32 Crockford, sin I/L/O/U)
    // como legacy (6-10 hex). Mantener compat con códigos generados antes
    // del cambio de entropía. Nuevos códigos siempre 16 chars.
    confirmation_code: z.string().regex(/^[A-Z0-9]{6,16}$/).optional(),
    patient_phone: z.string().min(6).max(20).optional(),
    new_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    new_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    reason: z.string().max(500).optional(),
  })
  .strict()
  .refine((d) => d.appointment_id || d.confirmation_code, {
    message: 'Provee appointment_id o confirmation_code.',
  })
  .refine((d) => d.new_date || d.new_time, {
    message: 'Debes proveer new_date o new_time (o ambos).',
  });

registerTool('modify_appointment', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'modify_appointment',
      description:
        'Reagenda una cita existente a nueva fecha y/o hora. Verifica ownership (tenant + customer_phone), que la cita sea futura, que el nuevo slot esté en horario laboral y libre (hasConflict excluyendo la cita que se mueve).',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'UUID de la cita (opcional si se da confirmation_code).' },
          confirmation_code: { type: 'string', description: 'Código corto (6-10 alfanumérico) — opcional si se da appointment_id.' },
          patient_phone: { type: 'string', description: 'IGNORADO — el sistema usa el WhatsApp autenticado del sender.' },
          new_date: { type: 'string', description: 'YYYY-MM-DD — opcional si solo cambia la hora.' },
          new_time: { type: 'string', description: 'HH:MM (24h) — opcional si solo cambia el día.' },
          reason: { type: 'string', description: 'Opcional: motivo del cambio.' },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const parse = ModifyArgs.safeParse(rawArgs);
    if (!parse.success) {
      console.warn('[tool:modify_appointment] validation failed:', parse.error.issues);
      return {
        success: false,
        error_code: 'INVALID_ARGS',
        message:
          'Permítame verificar los datos. ¿Puede confirmarme el código de cita y la nueva fecha u hora que prefiere?',
      };
    }
    const args = parse.data;
    // CRÍTICO: usar ctx.customerPhone (del WhatsApp autenticado), NO el phone
    // del LLM. El LLM puede inventar/inyectar phone de OTRO paciente —
    // prompt injection IDOR. Solo el sender real puede modificar sus citas.
    const ownerPhone = normalizePhoneMx(ctx.customerPhone || '');
    const timezone = resolveTenantTimezone(ctx.tenant);

    // Defense-in-depth log: si LLM pasó un patient_phone distinto al sender,
    // es señal de posible IDOR attempt o LLM hallucination. Solo loguear,
    // el handler ignora args.patient_phone igual.
    if (args.patient_phone) {
      const llmPhone = normalizePhoneMx(args.patient_phone);
      if (llmPhone && llmPhone !== ownerPhone) {
        console.warn('[modify_appointment] phone_mismatch: LLM pasó un phone distinto al sender — posible IDOR attempt', {
          tenant_id: ctx.tenantId,
          sender: ownerPhone.slice(0, 6) + '***',
          llm_provided: llmPhone.slice(0, 6) + '***',
        });
      }
    }

    // Resolver appointment_id desde confirmation_code si es necesario.
    let resolvedId = args.appointment_id;
    if (!resolvedId && args.confirmation_code) {
      const { data: byCode } = await supabaseAdmin
        .from('appointments')
        .select('id')
        .eq('tenant_id', ctx.tenantId)
        .eq('customer_phone', ownerPhone)
        .eq('confirmation_code', args.confirmation_code.toUpperCase())
        .gt('datetime', new Date().toISOString())
        .maybeSingle();
      if (!byCode) {
        return {
          success: false,
          error_code: 'NOT_FOUND',
          message: 'No encontré ninguna cita futura con ese código a su nombre.',
        };
      }
      resolvedId = byCode.id as string;
    }

    // 1. SELECT scoped por (id, tenant_id, customer_phone del SENDER REAL)
    // Incluimos customer_name y service_id para poder recrear el Google
    // Calendar event después del UPDATE.
    const { data: apt, error: readErr } = await supabaseAdmin
      .from('appointments')
      .select(
        'id, staff_id, service_id, datetime, end_datetime, duration_minutes, status, google_event_id, notes, customer_name, customer_phone, confirmation_code',
      )
      .eq('id', resolvedId!)
      .eq('tenant_id', ctx.tenantId)
      .eq('customer_phone', ownerPhone)
      .single();

    if (readErr || !apt) {
      return {
        success: false,
        error_code: 'NOT_FOUND',
        message: 'No encontré una cita con ese identificador a nombre de este paciente.',
        next_step: 'Llama get_my_appointments para listar sus citas.',
      };
    }

    if (new Date(apt.datetime as string).getTime() < Date.now()) {
      return {
        success: false,
        error_code: 'PAST_APPOINTMENT',
        message: 'Esa cita ya pasó — no puede reagendarse.',
      };
    }
    if (apt.status === 'cancelled') {
      return {
        success: false,
        error_code: 'CANCELLED',
        message: 'Esa cita fue cancelada previamente. Agenda una nueva con book_appointment.',
      };
    }

    // 2. Componer el nuevo datetime — reusar la fecha/hora original si una es opcional
    const origDt = new Date(apt.datetime as string);
    const origDateIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(origDt);
    const origTimeIso = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit',
    }).format(origDt);

    const newDate = args.new_date || origDateIso;
    const newTime = args.new_time || origTimeIso;
    const newDatetime = buildLocalIso(newDate, newTime, timezone);

    if (new Date(newDatetime).getTime() < Date.now()) {
      return {
        success: false,
        error_code: 'PAST_DATE',
        message: 'La nueva fecha y hora ya pasaron.',
      };
    }

    // 3. Validar nuevo slot dentro de business hours
    const businessHours =
      (ctx.tenant.business_hours as Record<string, string>) || null;
    if (!isWithinBusinessHours(newDatetime, businessHours, timezone)) {
      return {
        success: false,
        error_code: 'OUTSIDE_HOURS',
        message: 'El nuevo horario está fuera del horario de atención.',
        next_step: 'Llama check_availability para ver opciones válidas.',
      };
    }

    const duration = (apt.duration_minutes as number) || 30;
    const newEndDt = new Date(
      new Date(newDatetime).getTime() + duration * 60_000,
    ).toISOString();

    // 4. Conflict check EXCLUYENDO la propia cita (si no, detectaría colisión
    //    consigo misma cuando solo cambia la hora dentro del mismo slot original).
    const newStart = new Date(newDatetime).toISOString();
    const { count: conflictCount } = await supabaseAdmin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .eq('staff_id', apt.staff_id as string)
      .neq('id', apt.id)
      .in('status', ['scheduled', 'confirmed'])
      .lt('datetime', newEndDt)
      .gt('end_datetime', newStart);

    if ((conflictCount ?? 0) > 0) {
      return {
        success: false,
        error_code: 'SLOT_TAKEN',
        message: 'El nuevo horario ya está ocupado.',
        next_step: 'Llama check_availability para slots alternativos.',
      };
    }

    // 5. UPDATE + persistir notes con motivo si se dio
    const mergedNotes = args.reason
      ? `${apt.notes ? apt.notes + ' | ' : ''}Reagenda: ${args.reason}`
      : apt.notes;

    const { error: updErr } = await supabaseAdmin
      .from('appointments')
      .update({
        datetime: newDatetime,
        end_datetime: newEndDt,
        notes: mergedNotes,
        // Reset status to scheduled — si estaba 'confirmed' queremos que se
        // re-confirme con el nuevo horario.
        status: 'scheduled',
      })
      .eq('id', apt.id);

    if (updErr) {
      return {
        success: false,
        error_code: 'UPDATE_FAILED',
        message: 'Tuve un problema registrando el cambio.',
      };
    }

    // 6. Actualizar Google Calendar — CANCEL del viejo Y CREATE del nuevo
    // evento. El bug anterior solo cancelaba asumiendo que un "sync
    // posterior" recrearía el evento; en realidad no existía ese sync y el
    // doctor veía la cita desaparecer de su Google Calendar.
    let calendar_unsync_attempted = false;
    let calendar_resync_ok = false;
    let new_google_event_id: string | null = null;
    if (apt.google_event_id) {
      calendar_unsync_attempted = true;
      try {
        // Prefer updateCalendarEvent (patch) — keeps event id, attendees, links.
        const { updateCalendarEvent } = await import('@/lib/calendar/google');
        const [{ data: staffRow }, { data: serviceRow }] = await Promise.all([
          supabaseAdmin
            .from('staff')
            .select('google_calendar_id, name')
            .eq('id', apt.staff_id as string)
            .maybeSingle(),
          apt.service_id
            ? supabaseAdmin
                .from('services')
                .select('name')
                .eq('id', apt.service_id as string)
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        const calendarId = staffRow?.google_calendar_id as string | undefined;
        const serviceName = (serviceRow?.name as string) || 'Consulta';
        if (calendarId) {
          const ev = await updateCalendarEvent({
            staffId: apt.staff_id as string,
            calendarId,
            eventId: apt.google_event_id as string,
            signal: ctx.signal,
            summary: `${serviceName} - ${apt.customer_name || 'Paciente'}`,
            description:
              `WhatsApp: ${apt.customer_phone}${mergedNotes ? `\nNotas: ${mergedNotes}` : ''}` +
              (apt.confirmation_code ? `\nCódigo: ${apt.confirmation_code}` : ''),
            startTime: newDatetime,
            endTime: newEndDt,
          });
          if (ev?.eventId) {
            new_google_event_id = ev.eventId;
            calendar_resync_ok = true;
          }
        }
      } catch (err) {
        console.warn('[tool:modify_appointment] Calendar update failed:', err);
      }
    }

    const { dateFmt: oldDateFmt, timeFmt: oldTimeFmt } = formatDateTimeMx(
      apt.datetime as string,
      timezone,
    );
    const { dateFmt: newDateFmt, timeFmt: newTimeFmt } = formatDateTimeMx(
      newDatetime,
      timezone,
    );

    // 7. Notify owner
    try {
      const { notifyOwner } = await import('@/lib/actions/notifications');
      await notifyOwner({
        tenantId: ctx.tenantId,
        event: 'new_appointment', // reuse closest existing event
        details: `Reagendamiento: ${ownerPhone}\nAntes: ${oldDateFmt} ${oldTimeFmt}\nAhora: ${newDateFmt} ${newTimeFmt}${args.reason ? `\nMotivo: ${args.reason}` : ''}`,
      });
    } catch {
      /* best effort */
    }

    return {
      success: true,
      modified: {
        appointment_id: apt.id as string,
        old_datetime_iso: apt.datetime as string,
        old_datetime_formatted: `${oldDateFmt} a las ${oldTimeFmt}`,
        new_datetime_iso: newDatetime,
        new_datetime_formatted: `${newDateFmt} a las ${newTimeFmt}`,
        calendar_unsync_attempted,
        calendar_resync_ok,
        new_google_event_id,
      },
      summary: `Su cita fue reagendada de ${oldDateFmt} ${oldTimeFmt} a ${newDateFmt} ${newTimeFmt}.`,
    };
  },
});

// ─── Tool 5: cancel_appointment ──────────────────────────────────────────────
// Si el LLM mete un código corto en `appointment_id` (UUID), Zod fallaba
// con un mensaje genérico y el LLM podía reintentar con el mismo error en
// bucle. Ahora lo redirige explícitamente a usar `confirmation_code` en el
// mensaje de error.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CancelArgs = z
  .object({
    appointment_id: z
      .string()
      .optional()
      .refine((val) => !val || UUID_RE.test(val), {
        message:
          'appointment_id debe ser UUID. Para códigos cortos como ABC12345 usa el campo confirmation_code.',
      }),
    // Acepta tanto formato nuevo (16 chars base32 Crockford, sin I/L/O/U)
    // como legacy (6-10 hex). Mantener compat con códigos generados antes
    // del cambio de entropía. Nuevos códigos siempre 16 chars.
    confirmation_code: z.string().regex(/^[A-Z0-9]{6,16}$/).optional(),
    patient_phone: z.string().min(6).max(20).optional(),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict()
  .refine((d) => d.appointment_id || d.confirmation_code, {
    message: 'Provee appointment_id o confirmation_code.',
  });

registerTool('cancel_appointment', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'cancel_appointment',
      description:
        'Cancela una cita. Verifica (scoped server-side) que la cita pertenezca al paciente que escribe y que sea futura.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'UUID de la cita.' },
          patient_phone: { type: 'string', description: 'Número WhatsApp del paciente.' },
          reason: { type: 'string', description: 'Opcional: motivo breve.' },
        },
        required: ['appointment_id', 'patient_phone'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = CancelArgs.parse(rawArgs);
    // CRÍTICO: usar ctx.customerPhone (sender real), NO args.patient_phone
    // del LLM (vulnerable a IDOR via prompt injection).
    const ownerPhone = normalizePhoneMx(ctx.customerPhone || '');
    const timezone = resolveTenantTimezone(ctx.tenant);

    // Defense-in-depth: si el LLM pasó un patient_phone DISTINTO al sender
    // real, lo logueamos como warning (posible prompt injection o LLM
    // hallucinando IDs de otros pacientes para cancelar citas ajenas).
    // El handler ignora args.patient_phone igual, pero el log permite a
    // ops detectar patrones de abuso.
    if (args.patient_phone) {
      const llmPhone = normalizePhoneMx(args.patient_phone);
      if (llmPhone && llmPhone !== ownerPhone) {
        console.warn('[cancel_appointment] phone_mismatch: LLM pasó un phone distinto al sender — posible IDOR attempt', {
          tenant_id: ctx.tenantId,
          sender: ownerPhone.slice(0, 6) + '***',
          llm_provided: llmPhone.slice(0, 6) + '***',
        });
      }
    }

    // Si dieron confirmation_code, resolver el appointment_id real
    let resolvedId = args.appointment_id;
    if (!resolvedId && args.confirmation_code) {
      const { data: byCode } = await supabaseAdmin
        .from('appointments')
        .select('id')
        .eq('tenant_id', ctx.tenantId)
        .eq('customer_phone', ownerPhone)
        .eq('confirmation_code', args.confirmation_code.toUpperCase())
        .gt('datetime', new Date().toISOString())
        .maybeSingle();
      if (!byCode) {
        return {
          success: false,
          error_code: 'NOT_FOUND',
          message: 'No encontré ninguna cita futura con ese código a su nombre.',
        };
      }
      resolvedId = byCode.id as string;
    }

    // 1. Verificar existencia + ownership + futura — un solo query scoped por
    //    tenantId + customer_phone para que el LLM no pueda cancelar una cita
    //    de otro paciente inyectándole un appointment_id arbitrario.
    const { data: apt, error: readErr } = await supabaseAdmin
      .from('appointments')
      .select('id, datetime, status, google_event_id, customer_phone, staff_id, staff:staff_id(google_calendar_id)')
      .eq('id', resolvedId!)
      .eq('tenant_id', ctx.tenantId)
      .eq('customer_phone', ownerPhone)
      .single();

    if (readErr || !apt) {
      return {
        success: false,
        error_code: 'NOT_FOUND',
        message:
          'No encontré una cita con ese identificador a nombre de este paciente.',
        next_step:
          'Si el paciente no tiene el código de confirmación, llama get_my_appointments para listar sus citas.',
      };
    }

    const aptDate = new Date(apt.datetime as string);
    if (aptDate.getTime() < Date.now()) {
      return {
        success: false,
        error_code: 'PAST_APPOINTMENT',
        message: 'Esa cita ya pasó — no puede cancelarse.',
      };
    }

    if (apt.status === 'cancelled') {
      const { dateFmt, timeFmt } = formatDateTimeMx(apt.datetime as string, timezone);
      return {
        success: true,
        already_cancelled: true,
        cancelled: {
          appointment_id: apt.id as string,
          datetime_formatted: `${dateFmt} a las ${timeFmt}`,
        },
        message: 'La cita ya estaba cancelada previamente.',
      };
    }

    // 2. UPDATE status + reason + timestamp
    const { error: updErr } = await supabaseAdmin
      .from('appointments')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: args.reason ?? null,
      })
      .eq('id', apt.id);

    if (updErr) {
      return {
        success: false,
        error_code: 'UPDATE_FAILED',
        message:
          'Tuve un problema registrando la cancelación. Ya notifiqué al equipo.',
      };
    }

    // 3. Cancel Google Calendar event (best effort — no bloquea el retorno)
    let calendar_unsync_attempted = false;
    if (apt.google_event_id) {
      calendar_unsync_attempted = true;
      try {
        const { cancelCalendarEvent } = await import('@/lib/calendar/google');
        const staffRel = Array.isArray(apt.staff) ? apt.staff[0] : apt.staff;
        const calendarId = (staffRel as { google_calendar_id: string | null } | null)?.google_calendar_id;
        if (calendarId) {
          await cancelCalendarEvent(calendarId, apt.google_event_id as string, apt.staff_id as string, ctx.signal);
        }
      } catch (err) {
        console.warn('[tool:cancel_appointment] Calendar unsync failed:', err);
      }
    }

    // 4. Marketplace event (smart-followup puede querer reagendar) — best effort
    try {
      const { executeEventAgents } = await import('@/lib/marketplace/engine');
      await executeEventAgents('appointment.cancelled', {
        tenant_id: ctx.tenantId,
        appointment_id: apt.id,
      });
    } catch {
      /* best effort */
    }

    // 5. Notificar al dueño
    try {
      const { notifyOwner } = await import('@/lib/actions/notifications');
      const { dateFmt, timeFmt } = formatDateTimeMx(apt.datetime as string, timezone);
      await notifyOwner({
        tenantId: ctx.tenantId,
        event: 'complaint', // reuso del evento existente más cercano
        details: `Cancelación: ${args.patient_phone}\nCita: ${dateFmt} ${timeFmt}${args.reason ? `\nMotivo: ${args.reason}` : ''}`,
      });
    } catch {
      /* best effort */
    }

    // 6. Clasificar motivo de cancelación con LLM (best effort, fire-and-forget)
    //    Se dispara en background — no bloqueamos la respuesta al paciente.
    if (ctx.conversationId) {
      const { classifyCancellationReason } = await import(
        '@/lib/intelligence/conversation-analysis'
      );
      classifyCancellationReason(ctx.conversationId, apt.id as string).catch(() => {
        /* best effort */
      });
    }

    const { dateFmt, timeFmt } = formatDateTimeMx(apt.datetime as string, timezone);
    return {
      success: true,
      cancelled: {
        appointment_id: apt.id as string,
        datetime_iso: apt.datetime as string,
        datetime_formatted: `${dateFmt} a las ${timeFmt}`,
        calendar_unsync_attempted,
      },
      message: `Su cita del ${dateFmt} a las ${timeFmt} fue cancelada exitosamente.`,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// A.6  CONFIRM_APPOINTMENT — paciente responde "sí" / "confirmo" a un
//      recordatorio o propuesta de reagenda. Marca la cita como 'confirmed'.
//      Scoped por tenantId + customer_phone (no IDOR).
// ═══════════════════════════════════════════════════════════════════════════
const ConfirmArgs = z
  .object({
    appointment_id: z.string().uuid().optional(),
    patient_phone: z.string(),
  })
  .strict();

registerTool('confirm_appointment', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'confirm_appointment',
      description:
        'Marca una cita futura del paciente como confirmada. Úsalo cuando el paciente responda afirmativamente a un recordatorio o propuesta de reagenda ("sí", "confirmo", "de acuerdo", "ahí estaré"). Si no pasas appointment_id, toma la próxima cita del paciente.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'UUID de la cita. Opcional — si no, se usa la próxima.' },
          patient_phone: { type: 'string' },
        },
        required: ['patient_phone'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = ConfirmArgs.parse(rawArgs);
    const ownerPhone = normalizePhoneMx(ctx.customerPhone || '');
    const timezone = resolveTenantTimezone(ctx.tenant);

    let q = supabaseAdmin
      .from('appointments')
      .select('id, datetime, status')
      .eq('tenant_id', ctx.tenantId)
      .eq('customer_phone', ownerPhone)
      .in('status', ['scheduled', 'confirmed'])
      .gt('datetime', new Date().toISOString())
      .order('datetime', { ascending: true })
      .limit(1);
    if (args.appointment_id) q = q.eq('id', args.appointment_id);

    const { data: apt } = await q.maybeSingle();

    if (!apt) {
      return {
        success: false,
        error_code: 'NOT_FOUND',
        message: 'No encontré una cita futura a su nombre para confirmar.',
        next_step: 'Llama get_my_appointments para listar o book_appointment si quiere una nueva.',
      };
    }

    if (apt.status === 'confirmed') {
      const { dateFmt, timeFmt } = formatDateTimeMx(apt.datetime as string, timezone);
      return {
        success: true,
        already_confirmed: true,
        message: `Perfecto, su cita del ${dateFmt} a las ${timeFmt} ya está confirmada.`,
      };
    }

    const { error } = await supabaseAdmin
      .from('appointments')
      .update({ status: 'confirmed' })
      .eq('id', apt.id);

    if (error) {
      return {
        success: false,
        error_code: 'DB_UPDATE_FAILED',
        message: 'No pude marcar la confirmación. Inténtelo en un momento.',
      };
    }

    const { dateFmt, timeFmt } = formatDateTimeMx(apt.datetime as string, timezone);
    return {
      success: true,
      confirmed: {
        appointment_id: apt.id as string,
        datetime_iso: apt.datetime as string,
        datetime_formatted: `${dateFmt} a las ${timeFmt}`,
      },
      message: `Confirmada — lo esperamos el ${dateFmt} a las ${timeFmt}.`,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// A.7  LIST_DOCTOR_SCHEDULE — el agente consulta la agenda del doctor para
//      un día específico y puede responder al paciente "hoy tengo 10 am y
//      5 pm libres". También útil para detectar si un doctor está a capacidad.
//      No expone datos personales de otros pacientes — solo agregados.
// ═══════════════════════════════════════════════════════════════════════════
const ListScheduleArgs = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    staff_name: z.string().optional(),
  })
  .strict();

registerTool('list_doctor_schedule', {
  schema: {
    type: 'function',
    function: {
      name: 'list_doctor_schedule',
      description:
        'Devuelve cuántas citas tiene el doctor ese día y a qué horas. No retorna datos personales de los pacientes, solo los slots ocupados. Útil cuando el paciente pregunta "¿qué tan ocupado está el doctor tal día?".',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
          staff_name: { type: 'string', description: 'Opcional — nombre del staff/doctor' },
        },
        required: ['date'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = ListScheduleArgs.parse(rawArgs);
    const timezone = resolveTenantTimezone(ctx.tenant);
    const dayStart = buildLocalIso(args.date, '00:00', timezone);
    const dayEnd = buildLocalIso(args.date, '23:59', timezone);

    // Staff
    const { data: staffAll } = await supabaseAdmin
      .from('staff')
      .select('id, name, default_duration, google_calendar_id')
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true);

    const staffRows = (staffAll || []) as StaffRow[];
    const staff = args.staff_name
      ? findMatchingStaff(staffRows, args.staff_name)
      : staffRows[0];

    if (!staff) {
      return {
        success: false,
        error_code: 'NO_STAFF',
        message: 'No encuentro registro del doctor/staff.',
      };
    }

    // Local appointments that day
    const { data: apts } = await supabaseAdmin
      .from('appointments')
      .select('datetime, duration_minutes, status')
      .eq('tenant_id', ctx.tenantId)
      .eq('staff_id', staff.id)
      .gte('datetime', dayStart)
      .lte('datetime', dayEnd)
      .in('status', ['scheduled', 'confirmed']);

    const busy: Array<{ start: string; end: string }> = ((apts || []) as Array<{ datetime: string; duration_minutes: number | null }>).map((a) => {
      const s = new Date(a.datetime);
      const e = new Date(s.getTime() + (a.duration_minutes || staff.default_duration || 30) * 60000);
      return { start: s.toISOString(), end: e.toISOString() };
    });

    // Google events
    if (staff.google_calendar_id) {
      try {
        const { listCalendarEvents } = await import('@/lib/calendar/google');
        const evs = await listCalendarEvents({
          staffId: staff.id,
          calendarId: staff.google_calendar_id,
          timeMin: dayStart,
          timeMax: dayEnd,
          timezone,
        });
        for (const e of evs) {
          if (e.startTime && e.endTime && e.status !== 'cancelled') {
            busy.push({ start: e.startTime, end: e.endTime });
          }
        }
      } catch { /* best effort */ }
    }

    busy.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    return {
      success: true,
      date: args.date,
      staff_name: staff.name,
      total_busy: busy.length,
      busy_slots: busy.map((b) => ({
        start: new Date(b.start).toLocaleTimeString('es-MX', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }),
        end: new Date(b.end).toLocaleTimeString('es-MX', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }),
      })),
      message:
        busy.length === 0
          ? `${staff.name} tiene el día libre el ${args.date}.`
          : `${staff.name} tiene ${busy.length} compromiso(s) el ${args.date}.`,
    };
  },
});

// ─── Tool: send_payment_link ────────────────────────────────────────────────
// Crea un Stripe Checkout Session one-time para la cita y lo manda al
// paciente por WhatsApp. El webhook de Stripe (kind='appointment_payment')
// marca payment_status='paid' cuando el paciente completa el checkout.
const SendPaymentLinkArgs = z
  .object({
    appointment_id: z.string().uuid(),
    amount_mxn: z.number().min(1).max(100_000).optional(),
    message_prefix: z.string().max(300).optional(),
  })
  .strict();

registerTool('send_payment_link', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'send_payment_link',
      description:
        'Genera un link de pago de Stripe para una cita y lo envía al paciente por WhatsApp. Usar cuando el paciente quiere prepagar su cita o cuando el dueño instruye "cobrar anticipo". Si amount_mxn se omite, usa el precio del servicio registrado en la cita; si la cita no tiene service_id vinculado, requiere amount_mxn explícito.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          amount_mxn: { type: 'number', description: 'Monto a cobrar. Si se omite, se usa el precio del service asociado.' },
          message_prefix: { type: 'string', description: 'Opcional: texto que antecede al link. Ej: "Adjunto su link para el anticipo."' },
        },
        required: ['appointment_id'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = SendPaymentLinkArgs.parse(rawArgs);

    // Traer la cita + servicio (scoped por tenant — defense in depth).
    const { data: apt, error: aptErr } = await supabaseAdmin
      .from('appointments')
      .select('id, customer_phone, customer_name, datetime, service_id, services:service_id(name, price), payment_status')
      .eq('id', args.appointment_id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();

    if (aptErr || !apt) {
      return { sent: false, error: 'appointment_not_found_or_not_in_tenant' };
    }
    if (apt.payment_status === 'paid') {
      return { sent: false, error: 'already_paid', message: 'La cita ya está pagada.' };
    }

    const svc = Array.isArray(apt.services) ? apt.services[0] : apt.services;
    const amountMxn = args.amount_mxn ?? (svc?.price ? Number(svc.price) : null);
    if (!amountMxn || amountMxn <= 0) {
      return {
        sent: false,
        error: 'amount_missing',
        message: 'La cita no tiene precio configurado y no se pasó amount_mxn.',
      };
    }

    // Crear el Stripe Checkout Session
    const { createAppointmentPaymentLink } = await import('@/lib/billing/stripe');
    let paymentUrl: string;
    let sessionId: string;
    try {
      const result = await createAppointmentPaymentLink({
        appointmentId: apt.id as string,
        tenantId: ctx.tenantId,
        amountMxn,
        patientName: (apt.customer_name as string) || 'Paciente',
        patientPhone: apt.customer_phone as string,
        description: svc?.name
          ? `${svc.name} — ${(apt.customer_name as string) || 'Paciente'}`
          : `Cita ${new Date(apt.datetime as string).toLocaleDateString('es-MX', { timeZone: resolveTenantTimezone(ctx.tenant) })}`,
      });
      paymentUrl = result.url;
      sessionId = result.sessionId;
    } catch (err) {
      return {
        sent: false,
        error: 'stripe_create_failed',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    // Persistir el link en la cita
    await supabaseAdmin
      .from('appointments')
      .update({
        payment_amount_mxn: amountMxn,
        stripe_checkout_session_id: sessionId,
        payment_link_url: paymentUrl,
        payment_link_created_at: new Date().toISOString(),
      })
      .eq('id', apt.id)
      .eq('tenant_id', ctx.tenantId);

    // Mandar el mensaje por WhatsApp
    const phoneNumberId = (ctx.tenant.wa_phone_number_id as string) || '';
    if (phoneNumberId) {
      const prefix = args.message_prefix?.trim()
        || `Para confirmar su cita puede prepagar su consulta aquí:`;
      const text = `${prefix}\n\n${paymentUrl}\n\nMonto: $${amountMxn.toLocaleString('es-MX')} MXN. El link es válido por 24 horas.`;
      try {
        const { sendTextMessageSafe } = await import('@/lib/whatsapp/send');
        await sendTextMessageSafe(phoneNumberId, apt.customer_phone as string, text, { tenantId: ctx.tenantId });
      } catch {
        // No fallamos el tool si el send falla — el link igual quedó guardado
        // en appointments.payment_link_url, el dashboard lo muestra.
      }
    }

    return {
      sent: true,
      appointment_id: apt.id as string,
      payment_url: paymentUrl,
      amount_mxn: amountMxn,
      expires_in_hours: 24,
    };
  },
});

// ─── Tool: mark_appointment_telemedicine ───────────────────────────────────
// Cuando el paciente dice "quiero que sea por videollamada" (o el agente
// detecta que la visita es consulta remota), marcamos la cita como telemed
// y generamos un room. El link se envía 15 min antes vía send_telemed_link
// o vía el cron pre-visit.
const MarkTelemedArgs = z.object({
  appointment_id: z.string().uuid(),
  is_telemedicine: z.boolean().default(true),
}).strict();

registerTool('mark_appointment_telemedicine', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'mark_appointment_telemedicine',
      description:
        'Marca una cita como telemedicina (videollamada) en vez de presencial. Usar cuando el paciente explícitamente pide consulta remota. El tenant debe tener telemedicine_enabled=true en su config. Genera un telemed_room único; el link se envía después con send_telemed_link.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          is_telemedicine: { type: 'boolean', description: 'Default true; pasalo false si querés revertir a presencial.' },
        },
        required: ['appointment_id'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = MarkTelemedArgs.parse(rawArgs);

    const telemedEnabled = ctx.tenant.telemedicine_enabled === true;
    if (!telemedEnabled && args.is_telemedicine) {
      return {
        success: false,
        error_code: 'TELEMED_NOT_ENABLED',
        message: 'Este consultorio no tiene telemedicina habilitada. Ofrecé cita presencial.',
      };
    }

    const { generateRoomName } = await import('@/lib/telemedicine/providers');
    const room = args.is_telemedicine ? generateRoomName(args.appointment_id) : null;

    const { data, error } = await supabaseAdmin
      .from('appointments')
      .update({
        is_telemedicine: args.is_telemedicine,
        telemed_room: room,
      })
      .eq('id', args.appointment_id)
      .eq('tenant_id', ctx.tenantId)
      .select('id, is_telemedicine, telemed_room')
      .single();

    if (error || !data) return { success: false, error: error?.message };
    return { success: true, ...data };
  },
});

// ─── Tool: send_telemed_link ────────────────────────────────────────────────
// Genera el URL del provider y lo envía al paciente por WhatsApp. Usado
// por el cron pre-visit 15 min antes de la cita, o on-demand por el agente
// cuando el paciente pregunta "¿y el link?".
const SendTelemedArgs = z.object({
  appointment_id: z.string().uuid(),
}).strict();

registerTool('send_telemed_link', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'send_telemed_link',
      description:
        'Envía por WhatsApp al paciente el link de videollamada para una cita de telemedicina. Si el paciente pregunta "¿y el link?" usar este. Requiere que la cita tenga is_telemedicine=true (ver mark_appointment_telemedicine).',
      parameters: {
        type: 'object',
        properties: { appointment_id: { type: 'string' } },
        required: ['appointment_id'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = SendTelemedArgs.parse(rawArgs);

    const { data: apt } = await supabaseAdmin
      .from('appointments')
      .select('id, is_telemedicine, telemed_room, customer_phone, datetime')
      .eq('id', args.appointment_id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();

    if (!apt) return { sent: false, error: 'appointment_not_found' };
    if (!apt.is_telemedicine) {
      return {
        sent: false,
        error: 'not_telemedicine',
        message: 'Esa cita no está marcada como telemedicina. Usar mark_appointment_telemedicine primero.',
      };
    }
    if (!apt.telemed_room) {
      return { sent: false, error: 'no_room' };
    }

    // Landing page propio con branding (valida el room + guía permisos)
    // antes de redirigir al provider (Jitsi / Daily / custom). Ver
    // src/app/telemed/[room]/page.tsx. El ?t=<appointment_id> agrega defensa
    // extra contra room-guessing.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    const url = `${baseUrl}/telemed/${apt.telemed_room}?t=${apt.id}`;

    const phoneNumberId = (ctx.tenant.wa_phone_number_id as string) || '';
    if (phoneNumberId) {
      const text =
        `Su consulta virtual está por comenzar. Abra este link para entrar:\n\n${url}\n\n` +
        `Funciona en cualquier navegador (Chrome/Safari) — le pedirá permiso de cámara y micrófono. ` +
        `Si no puede entrar, llame al consultorio y lo acomodamos.`;
      try {
        const { sendTextMessageSafe } = await import('@/lib/whatsapp/send');
        await sendTextMessageSafe(phoneNumberId, apt.customer_phone as string, text, { tenantId: ctx.tenantId });
      } catch {
        /* best effort */
      }
    }

    await supabaseAdmin
      .from('appointments')
      .update({ telemed_link_sent_at: new Date().toISOString() })
      .eq('id', apt.id);

    return { sent: true, url };
  },
});

// ─── Tool: add_to_waitlist ─────────────────────────────────────────────────
//
// Captura el lead cuando el paciente quería agendar pero no había slot.
// Cuando otra cita se cancela, el cron `runOptimizador` (en marketplace)
// busca matches en esta tabla por preferencias y notifica al primero en
// FIFO. Esto convierte un "no hay" en una conversión asíncrona.
const WaitlistArgs = z
  .object({
    service_type: z.string().min(1).max(120).optional(),
    staff_id: z.string().uuid().optional(),
    preferred_date_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
      .optional(),
    preferred_date_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
      .optional(),
    // Ventana del día que prefiere — si el paciente dice "en la mañana"
    // o "después del mediodía", lo capturamos así. Default 'any'.
    preferred_time_window: z.enum(['morning', 'afternoon', 'evening', 'any']).optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

registerTool('add_to_waitlist', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'add_to_waitlist',
      description:
        'Agrega al paciente a la lista de espera cuando NO hay slot disponible que le acomode. Le notificaremos por WhatsApp si otra cita se libera y matchea sus preferencias. NO usar si hay slots disponibles — primero ofrecer agendar normal con check_availability.',
      parameters: {
        type: 'object',
        properties: {
          service_type: { type: 'string', description: 'Servicio que quiere (limpieza, ortodoncia, etc.)' },
          staff_id: { type: 'string', description: 'UUID opcional del doctor preferido.' },
          preferred_date_from: { type: 'string', description: 'YYYY-MM-DD desde cuándo acepta.' },
          preferred_date_to: { type: 'string', description: 'YYYY-MM-DD hasta cuándo acepta.' },
          preferred_time_window: {
            type: 'string',
            enum: ['morning', 'afternoon', 'evening', 'any'],
            description: 'Franja del día preferida.',
          },
          notes: { type: 'string', description: 'Cualquier otra preferencia (urgente, flexible, etc.)' },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = WaitlistArgs.parse(rawArgs);
    const ownerPhone = normalizePhoneMx(ctx.customerPhone || '');

    if (!ownerPhone) {
      return {
        success: false,
        error_code: 'NO_PHONE',
        message: 'Necesitamos un número para contactarle cuando se libere el slot.',
      };
    }

    // Resolver service_id si pasaron service_type
    let serviceId: string | null = null;
    let durationMinutes = 30;
    if (args.service_type) {
      const { data: services } = await supabaseAdmin
        .from('services')
        .select('id, name, duration_minutes')
        .eq('tenant_id', ctx.tenantId)
        .eq('active', true);
      const match = findMatchingService((services || []) as ServiceRow[], args.service_type);
      if (match) {
        serviceId = (match.id as string) || null;
        durationMinutes = match.duration_minutes || 30;
      }
    }

    // Dedup: si ya está en waitlist activa para este servicio, actualizamos
    // las preferencias en lugar de duplicar.
    const { data: existing } = await supabaseAdmin
      .from('appointment_waitlist')
      .select('id, notified_count')
      .eq('tenant_id', ctx.tenantId)
      .eq('customer_phone', ownerPhone)
      .eq('status', 'active')
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from('appointment_waitlist')
        .update({
          service_id: serviceId,
          staff_id: args.staff_id || null,
          preferred_date_from: args.preferred_date_from || null,
          preferred_date_to: args.preferred_date_to || null,
          preferred_time_window: args.preferred_time_window || 'any',
          duration_minutes: durationMinutes,
          notes: args.notes || null,
        })
        .eq('id', existing.id);
      return {
        success: true,
        already_on_waitlist: true,
        message: 'Ya está en nuestra lista de espera. Actualizamos sus preferencias.',
      };
    }

    const { error } = await supabaseAdmin.from('appointment_waitlist').insert({
      tenant_id: ctx.tenantId,
      contact_id: ctx.contactId || null,
      customer_phone: ownerPhone,
      customer_name: ctx.customerName || null,
      service_id: serviceId,
      staff_id: args.staff_id || null,
      preferred_date_from: args.preferred_date_from || null,
      preferred_date_to: args.preferred_date_to || null,
      preferred_time_window: args.preferred_time_window || 'any',
      duration_minutes: durationMinutes,
      notes: args.notes || null,
    });

    if (error) {
      console.warn('[add_to_waitlist] insert failed', { err: error.message });
      return {
        success: false,
        error_code: 'INSERT_FAILED',
        message: 'No pude agregarle a la lista en este momento. Por favor intente de nuevo o llámenos.',
      };
    }

    return {
      success: true,
      message:
        'Listo, está en la lista de espera. Le avisaremos por aquí apenas se libere un horario que le acomode.',
    };
  },
});

// ─── Tool: book_recurring_series ───────────────────────────────────────────
//
// Para citas que se repiten en serie (limpieza dental cada 6 meses,
// ortodoncia mensual, fisio semanal). Una sola llamada del LLM crea N
// occurrencias con el mismo `recurrence_group_id`, así cancel/modify puede
// targetear toda la serie.
//
// Estrategia ante conflictos: se bookea lo que se puede; las fechas
// conflictivas se devuelven en `skipped_dates` para que el LLM pueda
// preguntar al paciente si quiere alternativas. NO se hace rollback.
const RecurringArgs = z
  .object({
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 24h'),
    service_type: z.string().min(1).max(120).optional(),
    staff_id: z.string().uuid().optional(),
    patient_name: z.string().min(1).max(200),
    reason: z.string().min(1).max(200),
    // Cada cuántas semanas se repite. 1=semanal, 4=mensual, 26=semestral.
    interval_weeks: z.number().int().min(1).max(52),
    // Cuántas ocurrencias generar (mín 2 = es serie). Cap 24 para evitar
    // que el LLM cree 1000 citas accidentalmente.
    occurrences: z.number().int().min(2).max(24),
  })
  .strict();

registerTool('book_recurring_series', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'book_recurring_series',
      description:
        'Crea una serie de citas recurrentes (ej. limpieza dental cada 6 meses por 2 años, ortodoncia mensual por 1 año). USAR cuando el paciente menciona periodicidad clara como "cada X semanas/meses" o "1 vez al mes por Y meses". Ejemplo: para "limpieza cada 6 meses por 2 años" → interval_weeks=26, occurrences=4. Si hay conflictos en algunas fechas, devuelve `skipped_dates` y el agente debe preguntar al paciente si quiere alternativas para esas.',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: 'YYYY-MM-DD primera cita' },
          time: { type: 'string', description: 'HH:MM 24h (mismo horario para todas)' },
          service_type: { type: 'string', description: 'Servicio (limpieza, ajuste, etc.)' },
          staff_id: { type: 'string', description: 'UUID del doctor (opcional)' },
          patient_name: { type: 'string' },
          reason: { type: 'string' },
          interval_weeks: { type: 'number', description: '1=semanal, 4=mensual, 13=trimestral, 26=semestral, 52=anual' },
          occurrences: { type: 'number', description: 'Cantidad de citas (entre 2 y 24)' },
        },
        required: ['start_date', 'time', 'patient_name', 'reason', 'interval_weeks', 'occurrences'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = RecurringArgs.parse(rawArgs);
    const ownerPhone = normalizePhoneMx(ctx.customerPhone || '');
    if (!ownerPhone) {
      return { success: false, error_code: 'NO_PHONE', message: 'No tengo tu número.' };
    }

    const timezone = resolveTenantTimezone(ctx.tenant);
    const businessHours = ctx.tenant.business_hours as Record<string, string> | null;

    // Cargar staff + service
    const { data: staffList } = await supabaseAdmin
      .from('staff')
      .select('id, name, default_duration')
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true);
    const staff = findMatchingStaff((staffList || []) as StaffRow[], args.staff_id);
    if (!staff) {
      return {
        success: false,
        error_code: 'NO_STAFF',
        message: 'No encontré un profesional disponible para la serie.',
      };
    }

    let serviceId: string | null = null;
    let durationMinutes = staff.default_duration || 30;
    if (args.service_type) {
      const { data: services } = await supabaseAdmin
        .from('services')
        .select('id, name, duration_minutes, price')
        .eq('tenant_id', ctx.tenantId)
        .eq('active', true);
      const match = findMatchingService((services || []) as ServiceRow[], args.service_type);
      if (match) {
        serviceId = (match.id as string) || null;
        durationMinutes = match.duration_minutes || durationMinutes;
      }
    }

    const recurrenceGroupId = crypto.randomUUID();
    const startBaseTs = new Date(buildLocalIso(args.start_date, args.time, timezone)).getTime();
    const intervalMs = args.interval_weeks * 7 * 24 * 60 * 60 * 1000;

    const booked: Array<{ id: string; datetime: string }> = [];
    const skipped: Array<{ date: string; reason: string }> = [];

    for (let i = 0; i < args.occurrences; i++) {
      const occurDate = new Date(startBaseTs + i * intervalMs);
      const dateIso = occurDate.toISOString().slice(0, 10);
      const datetime = buildLocalIso(dateIso, args.time, timezone);
      const endDt = new Date(new Date(datetime).getTime() + durationMinutes * 60_000).toISOString();

      // Business hours check
      if (!isWithinBusinessHours(datetime, businessHours, timezone)) {
        skipped.push({ date: dateIso, reason: 'fuera de horario del consultorio' });
        continue;
      }

      // Conflict pre-check (best-effort; el EXCLUDE constraint es la fuente de verdad)
      const conflict = await hasConflict({
        tenantId: ctx.tenantId,
        staffId: staff.id,
        datetime,
        durationMinutes,
      });
      if (conflict) {
        skipped.push({ date: dateIso, reason: 'horario ocupado' });
        continue;
      }

      const { data: row, error } = await supabaseAdmin
        .from('appointments')
        .insert({
          tenant_id: ctx.tenantId,
          staff_id: staff.id,
          service_id: serviceId,
          contact_id: ctx.contactId,
          conversation_id: ctx.conversationId,
          customer_phone: ownerPhone,
          customer_name: args.patient_name,
          datetime,
          end_datetime: endDt,
          duration_minutes: durationMinutes,
          status: 'scheduled',
          source: 'chat',
          notes: `Serie recurrente (${i + 1}/${args.occurrences}): ${args.reason}`,
          recurrence_group_id: recurrenceGroupId,
        })
        .select('id, datetime')
        .single();

      if (error || !row) {
        const isConflict = error?.code === '23P01' ||
          /exclusion|appointments_no_overlap|overlap/i.test(error?.message ?? '');
        skipped.push({
          date: dateIso,
          reason: isConflict ? 'horario ocupado (race)' : 'error de inserción',
        });
        continue;
      }

      booked.push({ id: row.id as string, datetime: row.datetime as string });
    }

    if (booked.length === 0) {
      return {
        success: false,
        error_code: 'ALL_CONFLICTS',
        message: 'Ninguna de las fechas de la serie funcionó. Pediré al paciente alternativas.',
        skipped_dates: skipped,
      };
    }

    return {
      success: true,
      recurrence_group_id: recurrenceGroupId,
      booked_count: booked.length,
      total_requested: args.occurrences,
      first_date: booked[0].datetime,
      last_date: booked[booked.length - 1].datetime,
      skipped_dates: skipped,
      message: skipped.length > 0
        ? `Agendé ${booked.length} de ${args.occurrences} citas. Las ${skipped.length} restantes están en conflicto — pregúntale al paciente si quiere alternativas para esas fechas.`
        : `✅ Serie completa de ${booked.length} citas agendada.`,
    };
  },
});

// ─── Tool: cancel_recurring_series ─────────────────────────────────────────
//
// Cancela TODAS las citas futuras de una serie recurrente (las pasadas se
// dejan como están). Verifica ownership por customer_phone — nadie puede
// cancelar la serie de otro paciente.
const CancelSeriesArgs = z
  .object({
    recurrence_group_id: z.string().uuid(),
    reason: z.string().max(500).optional(),
  })
  .strict();

registerTool('cancel_recurring_series', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'cancel_recurring_series',
      description:
        'Cancela TODA una serie de citas recurrentes. Solo cancela las citas FUTURAS de la serie (las pasadas quedan como están). USAR cuando el paciente dice "cancela toda la serie" o "ya no quiero seguir con las citas de cada mes". Para cancelar UNA cita individual, usa cancel_appointment.',
      parameters: {
        type: 'object',
        properties: {
          recurrence_group_id: { type: 'string', description: 'UUID del grupo (devuelto por book_recurring_series o get_my_appointments)' },
          reason: { type: 'string' },
        },
        required: ['recurrence_group_id'],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = CancelSeriesArgs.parse(rawArgs);
    const ownerPhone = normalizePhoneMx(ctx.customerPhone || '');
    if (!ownerPhone) {
      return { success: false, error_code: 'NO_PHONE', message: 'No tengo tu número.' };
    }

    // Defense-in-depth: verificar que la serie pertenece al sender
    const { data: future } = await supabaseAdmin
      .from('appointments')
      .select('id, datetime, customer_phone')
      .eq('tenant_id', ctx.tenantId)
      .eq('recurrence_group_id', args.recurrence_group_id)
      .eq('customer_phone', ownerPhone)
      .gt('datetime', new Date().toISOString())
      .in('status', ['scheduled', 'confirmed']);

    if (!future || future.length === 0) {
      return {
        success: false,
        error_code: 'NOT_FOUND',
        message: 'No encontré una serie tuya con citas futuras pendientes.',
      };
    }

    const ids = future.map((r) => r.id as string);
    const { error } = await supabaseAdmin
      .from('appointments')
      .update({
        status: 'cancelled',
        cancellation_reason: args.reason || 'serie cancelada por el paciente',
      })
      .in('id', ids);

    if (error) {
      // Retry sin cancellation_reason si la columna no existe
      await supabaseAdmin
        .from('appointments')
        .update({ status: 'cancelled' })
        .in('id', ids);
    }

    return {
      success: true,
      cancelled_count: ids.length,
      message: `✅ Cancelé ${ids.length} citas futuras de tu serie. Las pasadas quedan como están.`,
    };
  },
});
