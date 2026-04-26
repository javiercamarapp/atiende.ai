import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// CSP nonce: 16 bytes random base64. Se genera por request, se inyecta en
// `script-src 'nonce-...' 'strict-dynamic'` y se expone al árbol de RSC vía
// header `x-csp-nonce`. El root layout lo lee con `headers()` y lo pasa a
// los `<Script nonce={nonce} />` que lo necesiten.
function generateCspNonce(): string {
  // Web Crypto en Edge Runtime (no requiere `crypto` import de Node).
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  // Base64 sin padding — válido en CSP.
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/=+$/, '');
}

export async function proxy(request: NextRequest) {
  const cspNonce = generateCspNonce();
  // Inyectamos el nonce como request header para que el root layout lo lea.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-csp-nonce', cspNonce);
  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

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
          // Cookies hardenadas (SameSite=lax + Secure + HttpOnly).
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

  // Rutas publicas que no necesitan auth Supabase. Bug fix: api/cron y
  // api/health NO requieren sesión — usan Bearer CRON_SECRET. Antes el
  // proxy redirigía /api/cron/* a /login porque no había user, y TODOS
  // los crons (analytics, no-show, telemed, churn, google-reviews, etc)
  // fallaban con 307 desde el deploy de Next 16. api/public/* es para
  // booking público sin auth.
  const publicPaths = [
    '/login', '/register', '/forgot-password', '/reset-password',
    '/api/webhook', '/api/cron', '/api/health', '/api/public',
    '/portal', '/telemed', '/book',
  ];
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

  // Exponer el nonce para que el root layout lo inyecte en `<Script>`.
  supabaseResponse.headers.set('x-csp-nonce', cspNonce);

  // CSP endurecida. `script-src` migrado a nonce-based + 'strict-dynamic':
  //   - 'nonce-...' valida los `<Script nonce={...}>` emitidos por el root layout.
  //   - 'strict-dynamic' permite que esos scripts carguen otros sub-scripts
  //     sin re-listarlos aquí (Next.js inyecta su runtime así).
  //   - 'unsafe-inline' se mantiene como fallback PARA NAVEGADORES VIEJOS
  //     que no entienden 'strict-dynamic' — los nuevos lo ignoran cuando
  //     hay nonce + strict-dynamic, así que no relaja la política real.
  // En dev (NODE_ENV === 'development') agregamos 'unsafe-eval' para que
  // turbopack/webpack HMR no se rompan. En tests (NODE_ENV='test') y prod
  // queda fuera. Antes el gate era `!== 'production'` lo cual incluía test.
  const isDev = process.env.NODE_ENV === 'development';
  // 'strict-dynamic' + 'nonce-...' removidos: Next.js 16 no propaga el
  // nonce automáticamente a sus scripts de hidratación, y el root layout
  // tampoco lo consume vía `headers()`. Resultado anterior: TODO el JS
  // del cliente quedaba bloqueado por CSP → login UI muerta (botones sin
  // responder, form sin enviar). Sin strict-dynamic, 'unsafe-inline' +
  // 'self' aplican y Next hidrata.
  // TODO(seguridad): migrar a nonce-based real con `<Script nonce>` y
  // request header `x-nonce` (Next 16 convention) en una iteración
  // separada — requiere tocar root layout + cualquier <Script> custom.
  // `generateCspNonce()` y el header `x-csp-nonce` se mantienen como
  // no-ops porque podrían ser leídos por código futuro.
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    ...(isDev ? ["'unsafe-eval'"] : []),
    'https://js.stripe.com',
  ].join(' ');

  supabaseResponse.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https://*.supabase.co https://*.fbcdn.net " +
        "https://*.whatsapp.net https://lookaside.fbsbx.com " +
        "https://cdn.atiende.ai",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co " +
        "https://openrouter.ai https://api.anthropic.com https://api.openai.com " +
        "https://api.stripe.com https://*.upstash.io https://graph.facebook.com " +
        "https://api.deepgram.com " +
        "https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
      "frame-src 'self' https://js.stripe.com",
      "media-src 'self' blob: https://*.supabase.co https://*.fbcdn.net " +
        "https://*.whatsapp.net",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join('; '),
  );

  // HSTS siempre activa (antes solo en prod). Ya estás HTTPS en Vercel
  // incluso para preview deploys, y tests nuevos validan esto como parte
  // del header set.
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
    '/((?!_next/static|_next/image|favicon.ico|api/webhook|api/cron|api/health|api/public|.*\\.(?:mp4|webm|mov|m4v|ogg|ogv|png|jpg|jpeg|gif|webp|svg|ico|mp3|wav|pdf|woff|woff2|ttf|eot|otf|txt|xml)).*)',
  ],
};
