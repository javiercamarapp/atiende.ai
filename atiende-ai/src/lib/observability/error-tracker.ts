// ═════════════════════════════════════════════════════════════════════════════
// ERROR TRACKER — observabilidad sin dependencias duras
//
// Integra Sentry DINÁMICAMENTE (si está instalado) + fallback a Supabase
// `critical_errors` table para que siempre haya un audit trail.
//
// Instalación Sentry (opcional, recomendada):
//   npm i @sentry/nextjs
//   npx @sentry/wizard -i nextjs
//   Set SENTRY_DSN en Vercel env vars.
//
// Sin Sentry, este módulo sigue funcionando:
//   - Errores críticos → INSERT en critical_errors (PII-redacted)
//   - Métricas básicas → console.error structured
//   - Funciona offline-first (ni Sentry ni Supabase bloquean)
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { maskPhone } from '@/lib/utils/logger';

export interface ErrorContext {
  tenantId?: string;
  userId?: string;
  phone?: string;
  conversationId?: string;
  route?: string;
  agentName?: string;
  toolName?: string;
  model?: string;
  [key: string]: unknown;
}

// Dynamic Sentry import — no hard dep en package.json.
// Tipado laxo porque @sentry/nextjs puede o no estar instalado; si está,
// expone captureException/captureMessage que llamamos si DSN configurado.
interface SentryLike {
  captureException: (e: unknown, ctx?: unknown) => void;
  captureMessage: (m: string, level?: unknown) => void;
}
let _sentry: SentryLike | null | undefined;
async function getSentry(): Promise<SentryLike | null> {
  if (_sentry !== undefined) return _sentry;
  if (!process.env.SENTRY_DSN) {
    _sentry = null;
    return null;
  }
  try {
    // dynamic import con string var para que TS no pida types del paquete
    const modName = '@sentry/nextjs';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await (new Function('n', 'return import(n)')(modName) as Promise<any>));
    _sentry = mod as SentryLike;
    return _sentry;
  } catch {
    _sentry = null;
    return null;
  }
}

function sanitizeContext(ctx: ErrorContext): Record<string, unknown> {
  const { phone, ...rest } = ctx;
  return {
    ...rest,
    ...(phone ? { phone: maskPhone(phone) } : {}),
  };
}

/**
 * captureError — reporta error crítico a Sentry + Supabase.
 * NUNCA lanza; fail-open para no interrumpir el pipeline que falló.
 */
export async function captureError(
  err: unknown,
  context: ErrorContext = {},
  severity: 'fatal' | 'error' | 'warning' = 'error',
): Promise<void> {
  const safeCtx = sanitizeContext(context);
  const errorObj = err instanceof Error ? err : new Error(String(err));

  // Log structured to stdout (Vercel captura esto)
  console.error('[error-tracker]', JSON.stringify({
    level: severity,
    message: errorObj.message,
    name: errorObj.name,
    stack: errorObj.stack?.split('\n').slice(0, 10).join('\n'),
    context: safeCtx,
  }));

  // Envío a Sentry (dinámico)
  try {
    const sentry = await getSentry();
    if (sentry) {
      sentry.captureException(errorObj, {
        level: severity,
        contexts: { atiende: safeCtx },
        tags: {
          tenant_id: context.tenantId || 'unknown',
          route: context.route || 'unknown',
        },
      });
    }
  } catch {
    /* best effort */
  }

  // Persist en Supabase (sobrevive a caídas de Sentry)
  try {
    await supabaseAdmin.from('critical_errors').insert({
      tenant_id: context.tenantId || null,
      severity,
      error_name: errorObj.name,
      error_message: errorObj.message.slice(0, 1000),
      error_stack: errorObj.stack?.slice(0, 4000) || null,
      context: safeCtx,
      route: context.route || null,
      created_at: new Date().toISOString(),
    });
  } catch {
    /* tabla puede no existir aún — ver migración critical_errors.sql */
  }
}

/**
 * captureMessage — evento importante sin ser error (onboarding completado,
 * primer booking, etc.). Útil para métricas de producto.
 */
export async function captureMessage(
  message: string,
  context: ErrorContext = {},
  severity: 'info' | 'warning' = 'info',
): Promise<void> {
  console.info('[observability]', JSON.stringify({
    level: severity,
    message,
    context: sanitizeContext(context),
  }));

  try {
    const sentry = await getSentry();
    if (sentry) {
      sentry.captureMessage(message, severity);
    }
  } catch {
    /* best effort */
  }
}
