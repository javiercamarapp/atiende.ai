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
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options));
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

  // OWASP Security Headers (CSP removed — Next.js requires inline scripts)
  supabaseResponse.headers.set('X-Content-Type-Options', 'nosniff');
  supabaseResponse.headers.set('X-Frame-Options', 'DENY');
  supabaseResponse.headers.set('X-XSS-Protection', '1; mode=block');
  supabaseResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  supabaseResponse.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

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
