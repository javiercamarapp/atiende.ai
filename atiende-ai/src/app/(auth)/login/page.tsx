'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { SignInPage } from '@/components/ui/sign-in';
import { toast } from 'sonner';

const testimonials = [
  {
    avatarSrc: 'https://randomuser.me/api/portraits/women/57.jpg',
    name: 'Dra. María González',
    handle: 'Dentista, Mérida',
    text: 'Redujimos no-shows en 70%. El bot agenda citas a las 11pm.',
  },
  {
    avatarSrc: 'https://randomuser.me/api/portraits/men/64.jpg',
    name: 'Roberto Sánchez',
    handle: 'Taquería, Cancún',
    text: '10 pedidos extra por noche. Se pagó solo en la primera semana.',
  },
  {
    avatarSrc: 'https://randomuser.me/api/portraits/men/32.jpg',
    name: 'Ana Martínez',
    handle: 'Inmobiliaria, Playa del Carmen',
    text: 'Cerramos 3 ventas que habríamos perdido. El bot califica leads 24/7.',
  },
];

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
        <span className="font-light tracking-tighter">
          Bienvenido a{' '}
          <span className="font-semibold">useatiende.ai</span>
        </span>
      }
      description="Inicia sesión y automatiza tu negocio con inteligencia artificial"
      heroImageSrc="https://images.unsplash.com/photo-1556761175-b413da4baf72?w=1200&q=80"
      heroVideoSrc="/hero.mp4"
      testimonials={testimonials}
      onSignIn={handleSignIn}
      onGoogleSignIn={handleGoogleSignIn}
      onResetPassword={() => router.push('/forgot-password')}
      onCreateAccount={() => router.push('/register')}
    />
  );
}
