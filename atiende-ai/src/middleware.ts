import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          // AUDIT-VC R11: cookies hardenadas (SameSite=lax + Secure + HttpOnly).
          // Supabase SSR ya setea HttpOnly por default, pero aquí somos
          // explícitos para defensa en profundidad. `lax` (no strict) para que
          // el flujo de OAuth redirect funcione.
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...options,
              httpOnly: options?.httpOnly ?? true,
              secure: options?.secure ?? process.env.NODE_ENV === 'production',
              sameSite: options?.sameSite ?? 'lax',
            }));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Rutas publicas que no necesitan auth
  const publicPaths = ['/login', '/register', '/forgot-password', '/reset-password', '/api/webhook'];
  const isPublic = path === '/' || publicPaths.some(p => path === p || path.startsWith(p + '/'));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Si esta autenticado y va a login/register/landing, redirigir a dashboard
  if (user && (path === '/' || path === '/login' || path === '/register')) {
    const url = request.nextUrl.clone();
    url.pathname = '/home';
    return NextResponse.redirect(url);
  }

  // OWASP Security Headers
  supabaseResponse.headers.set('X-Content-Type-Options', 'nosniff');
  supabaseResponse.headers.set('X-Frame-Options', 'DENY');
  supabaseResponse.headers.set('X-XSS-Protection', '1; mode=block');
  supabaseResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  supabaseResponse.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // AUDIT R15: CSP antes faltaba. Sin CSP no hay defensa contra XSS reflejado
  // ni inyección de scripts de terceros. Permite:
  //   - self para HTML/assets de nuestro dominio
  //   - unsafe-inline/unsafe-eval necesarios para Next.js RSC + hydration
  //   - supabase.co para realtime/storage
  //   - OpenRouter + Anthropic para llamadas desde cliente (si aplica)
  //   - Stripe Elements (billing)
  //   - Meta WhatsApp CDN (media previews)
  supabaseResponse.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https: http:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co " +
        "https://openrouter.ai https://api.anthropic.com https://api.openai.com " +
        "https://api.stripe.com https://*.upstash.io https://graph.facebook.com " +
        "https://api.retellai.com https://api.deepgram.com https://api.elevenlabs.io " +
        "https://o4511223361896448.ingest.us.sentry.io",
      "frame-src 'self' https://js.stripe.com",
      "media-src 'self' blob: https:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join('; '),
  );

  // AUDIT-VC R11 + R15: HSTS siempre activa (antes solo en prod). Ya estás
  // HTTPS en Vercel incluso para preview deploys, y tests nuevos validan
  // esto como parte del header set.
  supabaseResponse.headers.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload',
  );

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Skip Next internals, the webhook API, and any public static asset
    // (anything with a common file extension). Without the extension group,
    // requests for /public files like /hero.mp4 get intercepted by the auth
    // middleware and redirected to /login, so the browser receives HTML
    // instead of the binary file.
    '/((?!_next/static|_next/image|favicon.ico|api/webhook|.*\\.(?:mp4|webm|mov|m4v|ogg|ogv|png|jpg|jpeg|gif|webp|svg|ico|mp3|wav|pdf|woff|woff2|ttf|eot|otf|txt|xml)).*)',
  ],
};
