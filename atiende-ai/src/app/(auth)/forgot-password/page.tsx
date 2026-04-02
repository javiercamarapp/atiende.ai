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
      <div className="h-[100dvh] flex items-center justify-center p-8">
        <div className="w-full max-w-md text-center">
          <div className="animate-element animate-delay-100 text-6xl mb-6">✉️</div>
          <h2 className="animate-element animate-delay-200 text-3xl font-semibold tracking-tight">Correo enviado</h2>
          <p className="animate-element animate-delay-300 text-muted-foreground mt-3">
            Enviamos instrucciones para restablecer tu contraseña a <b className="text-foreground">{email}</b>
          </p>
          <p className="animate-element animate-delay-400 text-muted-foreground mt-2 text-sm">
            Revisa tu bandeja de entrada y sigue el link para crear una nueva contraseña.
          </p>
          <Link href="/login" className="animate-element animate-delay-500 inline-flex items-center gap-2 mt-8 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Volver a iniciar sesión
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="flex flex-col gap-6">
          <Link href="/login" className="animate-element animate-delay-100 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
            <ArrowLeft className="w-4 h-4" /> Volver
          </Link>

          <h1 className="animate-element animate-delay-200 text-4xl font-semibold leading-tight">
            <span className="font-light tracking-tighter">Recuperar contraseña</span>
          </h1>
          <p className="animate-element animate-delay-300 text-muted-foreground">
            Ingresa tu correo y te enviaremos un link para restablecer tu contraseña.
          </p>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="animate-element animate-delay-400">
              <label className="text-sm font-medium text-muted-foreground">Correo electrónico</label>
              <div className="rounded-2xl border border-border bg-foreground/5 backdrop-blur-sm transition-colors focus-within:border-zinc-400/70 focus-within:bg-zinc-500/10">
                <input name="email" type="email" placeholder="tu@email.com" className="w-full bg-transparent text-sm p-4 rounded-2xl focus:outline-none" required />
              </div>
            </div>

            <button type="submit" disabled={loading} className="animate-element animate-delay-500 w-full rounded-2xl bg-zinc-900 py-4 font-medium text-white hover:bg-zinc-800 transition-colors disabled:opacity-50">
              {loading ? 'Enviando...' : 'Enviar instrucciones'}
            </button>
          </form>

          <p className="animate-element animate-delay-600 text-center text-sm text-muted-foreground">
            ¿Recordaste tu contraseña?{' '}
            <Link href="/login" className="text-zinc-900 font-medium hover:underline transition-colors">Iniciar sesión</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
