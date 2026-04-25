'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { SignInPage } from '@/components/ui/sign-in';
import { toast } from 'sonner';

// `createClient` se mantiene importado para Google OAuth — el flujo PKCE
// requiere supabase.auth.signInWithOAuth() desde el browser.

export default function LoginPage() {
  const router = useRouter();
  const [, setLoading] = useState(false);

  const handleSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);

    const formData = new FormData(event.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    try {
      // Server-side login: rate-limited + brute-force protected (login-protection.ts).
      // Cookies Supabase se setean en el handler vía SSR cookie adapter.
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        toast.error(json.error || 'Error al iniciar sesión');
      } else {
        router.push('/home');
        router.refresh();
      }
    } catch {
      toast.error('Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/home` },
    });
  };

  return (
    <SignInPage
      title={
        <span className="font-light tracking-tighter text-zinc-900">
          Bienvenido
        </span>
      }
      description="Inicia sesión y automatiza tu negocio con inteligencia artificial"
      heroImageSrc="https://images.unsplash.com/photo-1556761175-b413da4baf72?w=1200&q=80"
      heroVideoSrc="/hero.mp4"
      onSignIn={handleSignIn}
      onGoogleSignIn={handleGoogleSignIn}
      onResetPassword={() => router.push('/forgot-password')}
      onCreateAccount={() => router.push('/register')}
    />
  );
}
