// ═════════════════════════════════════════════════════════════════════════════
// CONFIG — constantes mágicas centralizadas.
//
// Esto evita que 4096, 8000, 40000, 25000 estén regados por el codebase.
// Si necesitas ajustar un límite para un tenant especial o una promo, solo
// cambias aquí.
// ═════════════════════════════════════════════════════════════════════════════

// ─── Input / sanitización ──────────────────────────────────────────────────
export const MAX_USER_INPUT_CHARS = 4096;
export const MAX_USER_INPUT_CHARS_GUARDED = 2000; // input-guardrail (más agresivo)

// ─── History para LLM ──────────────────────────────────────────────────────
export const HISTORY_MAX_MESSAGES = 40;
export const HISTORY_MAX_CHARS = 40_000;
// Truncado por TOKENS estimados (ratio conservador 3 chars/token para
// español/mixed-content) en lugar de por chars puros. Evita el edge case
// donde un mensaje con emojis/acentos inflate tokens y desborde context.
// 40_000 chars / 3 = ~13,333 tokens safety budget.
export const HISTORY_MAX_TOKENS = Math.floor(HISTORY_MAX_CHARS / 3);
export const HISTORY_KEEP_RECENT = 5;

// ─── LLM orchestrator ──────────────────────────────────────────────────────
export const ORCHESTRATOR_PRIMARY_TIMEOUT_MS = 10_000;
export const ORCHESTRATOR_FALLBACK_TIMEOUT_MS = 10_000;
/** Wall-clock ceiling para TODO el turno (primary + fallback + tools).
 *  Peor caso sin esto: 10s primary timeout + tool exec + 10s fallback
 *  + tool exec ≈ 25s. En serverless edge eso ya pasó el p95 que queremos
 *  (<15s total) y puede encadenarse con Meta timeout de 20s. 18s deja
 *  margen para SmartResponse + persist + disclaimer downstream. */
export const ORCHESTRATOR_TOTAL_TIMEOUT_MS = 18_000;
export const ORCHESTRATOR_MAX_TOOL_ROUNDS = 5;
export const ORCHESTRATOR_MAX_TOKENS_WITH_TOOLS = 2000;
export const ORCHESTRATOR_MAX_TOKENS_NO_TOOLS = 800;

// ─── Tool executor ─────────────────────────────────────────────────────────
export const TOOL_TIMEOUT_MS = 4_000;
export const TOOL_RESULT_MAX_CHARS = 8_000;

// ─── Response generation (pipeline tradicional) ───────────────────────────
export const RESPONSE_GENERATION_TIMEOUT_MS = 15_000;

// ─── Multimedia ────────────────────────────────────────────────────────────
export const EXTRACT_CONTENT_TIMEOUT_MS = 25_000; // Whisper + Gemini budget
export const MEDIA_DOWNLOAD_TIMEOUT_MS = 15_000;
export const MEDIA_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024; // 25MB

// ─── Conversation lock ─────────────────────────────────────────────────────
export const CONV_LOCK_TTL_SECONDS = 30;

// ─── WhatsApp API ──────────────────────────────────────────────────────────
export const WA_24H_WINDOW_MS = 24 * 60 * 60 * 1000;
export const WA_SEND_TIMEOUT_MS = 10_000;

// ─── Plan pricing + limits (MXN/mes) ──────────────────────────────────────
// Fuente de verdad única para los precios de plan. Los dashboards de ROI/KPI
// deben leer de aquí, no hardcodear números distintos — auditoría encontró
// que kpi-calculator y roi tenían $499 hardcoded mientras billing usaba $599,
// desalineando los números mostrados a los tenants vs lo que Stripe cobraba.
export const PLAN_PRICES_MXN: Record<string, number> = {
  free_trial: 0,
  basic: 599,
  pro: 999,
  premium: 1499,
};

/**
 * Cap mensual de mensajes outbound por plan (reset UTC al cambio de mes).
 *
 * Historial:
 *   v1 (launch):  free 50, basic 500, pro 2000, premium 10000
 *   v2 (audit):   free 300 tras feedback "50 se queman en onboarding"
 *   v3 (trial):   free 2000 al introducir Stripe trial
 *   v4 (current): TODOS ilimitados — desde el plan esencial hasta ultimate.
 *                 El modelo de precio ahora es subscription-flat; el cap de
 *                 mensajes confundía al tenant ("¿por qué le cobran $599 si
 *                 solo usó 50 mensajes?") y penalizaba casos de uso legítimos
 *                 (recordatorios masivos, promos). El costo marginal por
 *                 mensaje es $0.005–$0.03 MXN (LLM + WhatsApp), despreciable
 *                 frente al precio del plan.
 *
 * Usamos Number.POSITIVE_INFINITY como sentinel de "sin límite". `gates.ts`
 * y `roi.ts` lo detectan con `isFinite()` antes de comparar. UI (`billing-
 * manager.tsx`) muestra "Mensajes ilimitados" en vez de la barra de progreso.
 */
export const PLAN_MSG_LIMITS_MONTHLY: Record<string, number> = {
  free_trial: Number.POSITIVE_INFINITY,
  basic: Number.POSITIVE_INFINITY,
  pro: Number.POSITIVE_INFINITY,
  premium: Number.POSITIVE_INFINITY,
};

// ─── Stripe trial ────────────────────────────────────────────────────────
/** Días de prueba gratis al suscribirse. Stripe NO cobra durante este
 *  período pero SÍ requiere método de pago válido (ver
 *  payment_method_collection en createCheckoutSession). Al terminar el
 *  trial Stripe cobra automáticamente el price del plan. */
export const STRIPE_TRIAL_DAYS = 30;

// ─── Voice billing (plan premium) ─────────────────────────────────────────
/** Minutos de voz incluidos en el plan premium ($1,499 MXN/mes).
 *  Consumo promedio observado por consultorio: ~300 min/mes.
 *  Costo real Retell: ~$0.07 USD/min = ~$1.40 MXN/min.
 *  Costo incluido: 300 × $1.40 = $420 MXN → margen bruto 71% antes de overage. */
export const VOICE_MINUTES_INCLUDED_PREMIUM = 300;
/** Precio por minuto adicional (overage) en MXN */
export const VOICE_OVERAGE_PRICE_MXN = 5;
/** Umbral (%) para alertar al dueño vía WhatsApp antes del overage */
export const VOICE_ALERT_THRESHOLD_PERCENT = 80;
/** Cap mensual de minutos overage por tenant. Si se excede, alertamos al
 * equipo y NO cobramos el exceso (defensa contra abuse / mal-config). */
export const VOICE_OVERAGE_MONTHLY_CAP = 1000; // 1000 min × $5 = $5,000 MXN max
/** Email/teléfono interno para alertas críticas de billing */
export const ATIENDE_OPS_PHONE = process.env.JAVIER_PHONE || '';

// ─── Timezone default ────────────────────────────────────────────────────
/** Default timezone cuando un tenant no configuró `timezone`.
 *  America/Mexico_City cubre CDMX + ~70% de México y es el IANA estándar.
 *  Tenants de otras zonas (Yucatán=America/Merida, Noroeste=America/Hermosillo,
 *  etc.) DEBEN configurarlo en onboarding. Si no lo hicieron, `resolveTenantTimezone`
 *  loguea un warning para que el equipo lo detecte y corrija.
 */
export const DEFAULT_TIMEZONE = 'America/Mexico_City';

/**
 * Resuelve el timezone IANA a usar para operaciones de fecha/hora de un
 * tenant. Devuelve `tenant.timezone` si es un string no-vacío; si no, el
 * default de la plataforma con warning para visibilidad.
 *
 * Antes cada call-site hacía `(tenant.timezone as string) || 'America/Merida'`
 * inline, lo que significaba que un tenant de CDMX sin timezone configurado
 * caía a UTC-5 (Mérida) en vez de UTC-6 (CDMX) — citas con 1h de offset.
 */
export function resolveTenantTimezone(tenant: { timezone?: unknown } | Record<string, unknown>): string {
  const tz = (tenant as { timezone?: unknown }).timezone;
  if (typeof tz === 'string' && tz.trim()) return tz;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[timezone] tenant sin timezone configurado — usando default', {
      default: DEFAULT_TIMEZONE,
    });
  }
  return DEFAULT_TIMEZONE;
}
