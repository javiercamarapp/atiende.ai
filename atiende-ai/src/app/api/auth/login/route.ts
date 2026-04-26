// ═════════════════════════════════════════════════════════════════════════════
// /api/auth/login — server-side login con brute-force protection
//
// Antes: la página /login llamaba directo a supabase.auth.signInWithPassword
// desde el cliente. Sin gate intermedio = sin rate-limit ni lockout.
//
// Ahora: el cliente POSTea aquí; este handler:
//   1. Aplica progressive delay + lockout (login-protection.ts)
//   2. Pega un per-IP rate-limit duro (anti enumeración masiva)
//   3. Llama signInWithPassword desde el server client (cookies Supabase
//      se setean vía la SSR cookie adapter, igual que antes)
//   4. Registra fail/success en Redis para que el contador siga vivo
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  checkLoginAllowed,
  recordFailedLogin,
  clearLoginAttempts,
} from '@/lib/auth/login-protection';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 15;

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  // Top-level try/catch para garantizar que el frontend SIEMPRE reciba JSON
  // con `error` field. Antes una excepción no manejada (Supabase timeout,
  // Redis caído inesperado, env var faltante) tiraba 500 con HTML — el
  // frontend hacía res.json() que fallaba → json={} → json.error=undefined
  // → toast "Error al iniciar sesión" genérico sin info diagnostica.
  try {
    // Per-IP hard cap (defensa contra enumeración: 30 attempts/min/IP).
    if (await checkApiRateLimit(`login_ip:${ip}`, 30, 60)) {
      logger.warn('[login] ip rate-limit exceeded', { ip });
      return NextResponse.json(
        { error: 'Demasiados intentos desde tu red. Intenta más tarde.' },
        { status: 429 },
      );
    }

    const raw = await req.json().catch(() => null);
    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
    }
    const { email, password } = parsed.data;

    // Per-email lockout + progressive delay (5 fallos → lockout 15min).
    const check = await checkLoginAllowed(email, ip);
    if (!check.allowed) {
      const minutesLeft = check.lockedUntil
        ? Math.max(1, Math.ceil((check.lockedUntil - Date.now()) / 60000))
        : 15;
      return NextResponse.json(
        {
          error: `Cuenta bloqueada temporalmente por intentos fallidos. Intenta en ${minutesLeft} minutos o restablece la contraseña.`,
          lockedUntil: check.lockedUntil ?? null,
        },
        { status: 429 },
      );
    }
    if (check.delayMs > 0) {
      await new Promise((r) => setTimeout(r, check.delayMs));
    }

    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      await recordFailedLogin(email, ip);
      // Loggear el motivo REAL para diagnóstico sin filtrarlo al cliente.
      // Antes el "Correo o contraseña incorrectos" se enviaba para AMBOS
      // casos (email no existe + password mal + email no confirmado), lo
      // cual confunde al user que sabe su password. Ahora distinguimos:
      //   - "email_not_confirmed" → mensaje específico
      //   - el resto → mensaje genérico (no filtra existencia de email)
      const msg = error?.message?.toLowerCase() || '';
      logger.warn('[login] supabase auth failed', {
        email_masked: email.replace(/(.{3}).*(@.*)/, '$1***$2'),
        ip,
        supabase_error: error?.message?.slice(0, 200),
        status: error?.status,
      });
      if (msg.includes('email not confirmed') || msg.includes('email_not_confirmed')) {
        return NextResponse.json(
          {
            error:
              'Tu correo no está confirmado. Revisa tu inbox para el link de confirmación, o pídele al admin que lo confirme manualmente.',
          },
          { status: 401 },
        );
      }
      return NextResponse.json(
        { error: 'Correo o contraseña incorrectos. Si olvidaste tu contraseña, usa el link de "¿Olvidaste tu contraseña?".' },
        { status: 401 },
      );
    }

    await clearLoginAttempts(email, ip);
    return NextResponse.json({
      ok: true,
      user: { id: data.user.id, email: data.user.email },
    });
  } catch (err) {
    // Error no manejado del path crítico (Supabase timeout, Redis flap,
    // env var faltante, network error, etc). Devolvemos JSON estructurado
    // para que el frontend muestre algo útil al usuario en vez del genérico.
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error('[login] unhandled exception', err instanceof Error ? err : undefined, {
      ip,
      err: errMsg.slice(0, 500),
    });
    // Capturamos casos comunes para mensaje específico.
    let userMsg = 'Tuvimos un problema temporal procesando tu inicio de sesión. Intenta en unos segundos.';
    if (/timeout|timed out|fetch failed/i.test(errMsg)) {
      userMsg = 'El servicio tardó en responder. Intenta de nuevo.';
    } else if (/SUPABASE|supabase.*key|getallmissing/i.test(errMsg)) {
      userMsg = 'Configuración del servidor incompleta. Avisa al administrador.';
    }
    return NextResponse.json({ error: userMsg }, { status: 500 });
  }
}
