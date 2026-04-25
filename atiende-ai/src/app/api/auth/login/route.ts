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
    return NextResponse.json(
      {
        error: 'Cuenta bloqueada temporalmente por intentos fallidos.',
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
    // Mensaje genérico — no filtrar si el email existe vs password incorrecto.
    return NextResponse.json(
      { error: 'Correo o contraseña incorrectos' },
      { status: 401 },
    );
  }

  await clearLoginAttempts(email, ip);
  return NextResponse.json({
    ok: true,
    user: { id: data.user.id, email: data.user.email },
  });
}
