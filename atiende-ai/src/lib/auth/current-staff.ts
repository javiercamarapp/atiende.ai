// ═════════════════════════════════════════════════════════════════════════════
// CURRENT STAFF — helpers para resolver el staff/role del user autenticado
//
// Cada user logueado en /dashboard tiene un row en `staff` (FK user_id).
// El row tiene su `tenant_id`, `role`, y `plan`. Estos helpers son la
// fuente de verdad para:
//   - "¿qué tenant pertenece este user?" → staff.tenant_id
//   - "¿qué puede hacer este user?" → staff.role + permisos
//   - "¿qué features tiene activas?" → staff.plan + plan-features map
//
// Caché por request: una sola query por handler. Si necesitás varias
// veces dentro del mismo request, usá `cache()` de React server.
// ═════════════════════════════════════════════════════════════════════════════

import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export type StaffRole = 'owner' | 'admin' | 'doctor' | 'receptionist';

export type StaffPlan = 'trialing' | 'esencial' | 'pro' | 'ultimate' | 'cancelled';

export interface CurrentStaff {
  staffId: string;
  tenantId: string;
  userId: string;
  role: StaffRole;
  name: string;
  email: string;
  isBillable: boolean;
  plan: StaffPlan;
  trialEndsAt: string | null;
  subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'unpaid';
}

/**
 * Resuelve el staff del usuario actualmente logueado.
 *
 * Devuelve `null` si:
 *   - No hay sesión (usuario no logueado)
 *   - El user existe en auth.users pero NO tiene staff row asociado
 *     (raro — ocurre si admin borró el staff manualmente)
 *
 * Lanza si Supabase falla (caller debe try/catch en handlers críticos).
 */
export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Lookup vía supabaseAdmin para bypass RLS en este punto crítico
  // (RLS depende de get_user_tenant_ids() que a su vez depende de auth.uid)
  const { data } = await supabaseAdmin
    .from('staff')
    .select('id, tenant_id, name, role, is_billable, plan, trial_ends_at, subscription_status')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!data) return null;

  return {
    staffId: data.id as string,
    tenantId: data.tenant_id as string,
    userId: user.id,
    role: (data.role as StaffRole) || 'doctor',
    name: (data.name as string) || '',
    email: user.email || '',
    isBillable: data.is_billable === true,
    plan: (data.plan as StaffPlan) || 'trialing',
    trialEndsAt: (data.trial_ends_at as string) || null,
    subscriptionStatus: (data.subscription_status as CurrentStaff['subscriptionStatus']) || 'trialing',
  };
}

/**
 * Variante más estricta: lanza error si no hay staff. Usar en routes que
 * SIEMPRE requieren un user logueado con tenant — más simple que andar
 * verificando null en cada caller.
 */
export async function requireCurrentStaff(): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();
  if (!staff) {
    throw new UnauthorizedError('No hay staff asociado a este usuario');
  }
  return staff;
}

export class UnauthorizedError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ForbiddenError';
  }
}

// ─── Permission helpers ──────────────────────────────────────────────────

const ROLE_HIERARCHY: Record<StaffRole, number> = {
  owner: 4,
  admin: 3,
  receptionist: 2,
  doctor: 1,
};

/**
 * Verifica si el role del staff es >= al requerido.
 * Ej: hasRole(staff, 'admin') → true para owner y admin, false para doctor.
 */
export function hasRole(staff: CurrentStaff, required: StaffRole): boolean {
  return ROLE_HIERARCHY[staff.role] >= ROLE_HIERARCHY[required];
}

/** Solo owner del consultorio puede gestionar billing, invites, eliminar staff. */
export function canManageTeam(staff: CurrentStaff): boolean {
  return staff.role === 'owner';
}

/** Owner + admin pueden cancelar citas; doctores solo las suyas. */
export function canCancelAnyAppointment(staff: CurrentStaff): boolean {
  return hasRole(staff, 'admin');
}

/** Receptionist y arriba pueden agendar para cualquier doctor. */
export function canBookForOthers(staff: CurrentStaff): boolean {
  return hasRole(staff, 'receptionist');
}

// ─── Plan / feature flags ────────────────────────────────────────────────

// Pricing model finalizado:
//   - Esencial $599: bot WhatsApp + agenda + Calendar + recordatorios.
//     Conversaciones ILIMITADAS (sin cap mensual).
//   - Pro $999: Esencial + marketing AI (marketplace agents: cobrador,
//     reseñas, reactivación, cumpleaños, referidos, nurturing, etc.) +
//     personal AI (personalización avanzada del bot por consultorio) +
//     waitlist + recurring + family + pagos + CFDI + telemed.
//   - Ultimate $1499: Pro + voice agent (200 min incluidos) +
//     multi-sucursal + analytics avanzado + soporte prioritario.
//   - Trial: 30 días con todas las features de Ultimate desbloqueadas.
const PLAN_FEATURES: Record<StaffPlan, Set<string>> = {
  trialing: new Set([
    // Trial = todas las features de Ultimate desbloqueadas (el cliente
    // prueba el producto completo). Después del trial, las features se
    // cierran al plan elegido.
    'agenda', 'recordatorios', 'gcal',
    'unlimited_conversations',
    'waitlist', 'recurring', 'family',
    'marketing_ai', 'personal_ai',
    'pagos', 'cfdi', 'telemed',
    'voice', 'multilocation', 'analytics_avanzado', 'priority_support',
  ]),
  esencial: new Set([
    'agenda', 'recordatorios', 'gcal',
    'unlimited_conversations',
  ]),
  pro: new Set([
    'agenda', 'recordatorios', 'gcal',
    'unlimited_conversations',
    'waitlist', 'recurring', 'family',
    'marketing_ai',  // marketplace agents (cobrador, reseñas, etc.)
    'personal_ai',   // personalización avanzada del bot
    'pagos', 'cfdi', 'telemed',
  ]),
  ultimate: new Set([
    'agenda', 'recordatorios', 'gcal',
    'unlimited_conversations',
    'waitlist', 'recurring', 'family',
    'marketing_ai', 'personal_ai',
    'pagos', 'cfdi', 'telemed',
    'voice', 'multilocation', 'analytics_avanzado', 'priority_support',
  ]),
  cancelled: new Set([]), // sin acceso (read-only o lockout)
};

/**
 * Verifica si el plan del staff incluye una feature específica.
 * Trial = todas las features (para que el cliente pruebe el plan completo).
 * Después del trial, las features se cierran al plan que pagó.
 */
export function hasFeature(staff: CurrentStaff, feature: string): boolean {
  const features = PLAN_FEATURES[staff.plan];
  return features?.has(feature) ?? false;
}

/**
 * ¿El trial del doctor sigue activo? Si sí, todas las features están abiertas
 * sin importar el plan que termine eligiendo después.
 */
export function isInTrial(staff: CurrentStaff): boolean {
  if (staff.subscriptionStatus !== 'trialing') return false;
  if (!staff.trialEndsAt) return false;
  return new Date(staff.trialEndsAt) > new Date();
}

/** Días restantes del trial (0 si ya expiró o si no está en trial). */
export function trialDaysLeft(staff: CurrentStaff): number {
  if (!isInTrial(staff)) return 0;
  if (!staff.trialEndsAt) return 0;
  const ms = new Date(staff.trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}
