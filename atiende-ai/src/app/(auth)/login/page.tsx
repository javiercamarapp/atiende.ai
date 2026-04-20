'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { SignInPage } from '@/components/ui/sign-in';
import { toast } from 'sonner';

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
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        toast.error(error.message === 'Invalid login credentials'
          ? 'Correo o contraseña incorrectos'
          : error.message);
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
