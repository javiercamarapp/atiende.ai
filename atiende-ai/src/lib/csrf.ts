// ═════════════════════════════════════════════════════════════════════════════
// CSRF — defense-in-depth para mutaciones same-origin
//
// Estrategia híbrida:
//   1. validateOrigin() — chequeo barato del header `Origin` contra APP_URL.
//      Cubre el ~95% de los ataques: forms cross-site no pueden falsear Origin.
//   2. Double-submit cookie — token aleatorio en cookie `csrf_token` + el mismo
//      valor en header `x-csrf-token` (o body field `_csrf`). Comparación con
//      crypto.timingSafeEqual. Defense extra contra subdominios maliciosos
//      capaces de poner cookies en el dominio raíz pero NO de leerlas para
//      reflejarlas en headers (Same-Origin Policy).
//
// La cookie se setea como SameSite=Lax (compatible con OAuth flows) + Secure
// en prod + httpOnly=false (el cliente debe poder leerla para reflejar el
// valor en el header en cada fetch).
// ═════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';
import { cookies } from 'next/headers';

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_BODY_FIELD = '_csrf';
const TOKEN_BYTES = 32;
const COOKIE_MAX_AGE_S = 60 * 60 * 8; // 8h, similar a sesión Supabase

export function validateOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl || !origin) return true; // Allow in development
  return origin === appUrl;
}

function timingSafeStringEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Asegura que existe un CSRF token en cookies. Si ya hay uno, lo reutiliza.
 * Llamar desde Server Components / route handlers GET para que el cliente lo
 * tenga disponible antes del primer POST.
 */
export async function ensureCsrfToken(): Promise<string> {
  const store = await cookies();
  const existing = store.get(CSRF_COOKIE)?.value;
  if (existing && existing.length === TOKEN_BYTES * 2) return existing;

  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  store.set(CSRF_COOKIE, token, {
    httpOnly: false, // el cliente DEBE poder leerlo para reflejarlo en el header
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_S,
  });
  return token;
}

/**
 * Valida CSRF en una request mutante (POST/PUT/PATCH/DELETE).
 * Doble-submit: cookie === header (o body._csrf si el caller lo pasó).
 * Usa timingSafeEqual.
 *
 * Llamar AL PRINCIPIO de cada route handler mutante:
 *
 *   if (!(await validateCsrf(req))) {
 *     return NextResponse.json({ error: 'CSRF check failed' }, { status: 403 });
 *   }
 */
export async function validateCsrf(
  request: Request,
  bodyToken?: string | null,
): Promise<boolean> {
  // Origin chequeo primero — es gratis y bloquea CSRF clásico.
  if (!validateOrigin(request)) return false;

  const store = await cookies();
  const cookieToken = store.get(CSRF_COOKIE)?.value ?? null;
  if (!cookieToken) return false;

  const headerToken = request.headers.get(CSRF_HEADER);
  if (headerToken && timingSafeStringEqual(cookieToken, headerToken)) return true;
  if (bodyToken && timingSafeStringEqual(cookieToken, bodyToken)) return true;
  return false;
}

export const CSRF_FIELD_NAMES = {
  cookie: CSRF_COOKIE,
  header: CSRF_HEADER,
  bodyField: CSRF_BODY_FIELD,
} as const;
