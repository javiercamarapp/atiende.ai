'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const emailVal = formData.get('email') as string;

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(emailVal, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        toast.error(error.message);
      } else {
        setEmail(emailVal);
        setSent(true);
      }
    } catch {
      toast.error('Error al enviar el correo');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="h-[100dvh] flex items-center justify-center p-8 bg-zinc-50">
        <div className="w-full max-w-md text-center">
          <div className="animate-element animate-delay-100 text-6xl mb-6">✉️</div>
          <h2 className="animate-element animate-delay-200 text-3xl font-semibold tracking-tight text-zinc-900">Correo enviado</h2>
          <p className="animate-element animate-delay-300 text-zinc-500 mt-3">
            Enviamos instrucciones para restablecer tu contraseña a <b className="text-zinc-900">{email}</b>
          </p>
          <p className="animate-element animate-delay-400 text-zinc-500 mt-2 text-sm">
            Revisa tu bandeja de entrada y sigue el link para crear una nueva contraseña.
          </p>
          <Link href="/login" className="animate-element animate-delay-500 inline-flex items-center gap-2 mt-8 text-sm text-zinc-500 hover:text-zinc-900 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Volver a iniciar sesión
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex items-center justify-center p-8 bg-zinc-50">
      <div className="w-full max-w-md">
        <div className="flex flex-col gap-6">
          <Link href="/login" className="animate-element animate-delay-100 flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900 transition-colors w-fit">
            <ArrowLeft className="w-4 h-4" /> Volver
          </Link>

          <div className="animate-element animate-delay-150 flex items-center gap-2 mb-1">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="8" fill="hsl(235 84% 55%)" />
              <path d="M8 12C8 9.79 9.79 8 12 8H20C22.21 8 24 9.79 24 12V18C24 20.21 22.21 22 20 22H14L10 25V22H12C9.79 22 8 20.21 8 18V12Z" fill="white" fillOpacity="0.95" />
              <circle cx="13" cy="15" r="1.25" fill="hsl(235 84% 55%)" />
              <circle cx="19" cy="15" r="1.25" fill="hsl(235 84% 55%)" />
            </svg>
            <span className="text-lg font-semibold tracking-tight text-zinc-900">atiende<span style={{color: 'hsl(235 84% 55%)'}}>.ai</span></span>
          </div>

          <h1 className="animate-element animate-delay-200 text-4xl font-semibold leading-tight text-zinc-900">
            <span className="font-light tracking-tighter">Recuperar contraseña</span>
          </h1>
          <p className="animate-element animate-delay-300 text-zinc-500">
            Ingresa tu correo y te enviaremos un link para restablecer tu contraseña.
          </p>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="animate-element animate-delay-400">
              <label className="text-sm font-medium text-zinc-600">Correo electrónico</label>
              <div className="rounded-2xl border border-zinc-200 bg-white transition-colors focus-within:border-[hsl(235,84%,55%)] focus-within:ring-2 focus-within:ring-[hsl(235,84%,55%,0.1)]">
                <input name="email" type="email" placeholder="tu@email.com" className="w-full bg-transparent text-sm p-4 rounded-2xl focus:outline-none text-zinc-900 placeholder:text-zinc-400" required />
              </div>
            </div>

            <button type="submit" disabled={loading} className="animate-element animate-delay-500 w-full rounded-2xl py-4 font-medium text-white hover:opacity-90 transition-colors disabled:opacity-50" style={{background: 'hsl(235 84% 55%)'}}>
              {loading ? 'Enviando...' : 'Enviar instrucciones'}
            </button>
          </form>

          <p className="animate-element animate-delay-600 text-center text-sm text-zinc-500">
            ¿Recordaste tu contraseña?{' '}
            <Link href="/login" className="font-medium hover:underline transition-colors" style={{color: 'hsl(235 84% 55%)'}}>Iniciar sesión</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
