'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [email, setEmail] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const emailVal = formData.get('email') as string;
    const password = formData.get('password') as string;
    const name = formData.get('name') as string;

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signUp({
        email: emailVal,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/onboarding`,
          data: { full_name: name },
        },
      });

      if (error) {
        toast.error(error.message);
      } else {
        setEmail(emailVal);
        setSuccess(true);
      }
    } catch {
      toast.error('Error al crear cuenta');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="h-[100dvh] flex items-center justify-center p-8">
        <div className="w-full max-w-md text-center">
          <div className="animate-element animate-delay-100 text-6xl mb-6">📧</div>
          <h2 className="animate-element animate-delay-200 text-3xl font-semibold tracking-tight">Revisa tu correo</h2>
          <p className="animate-element animate-delay-300 text-zinc-500 mt-3">
            Enviamos un link de confirmación a <b className="text-zinc-900">{email}</b>
          </p>
          <p className="animate-element animate-delay-400 text-zinc-500 mt-2 text-sm">
            Haz click en el link para activar tu cuenta y empezar a configurar tu asistente AI.
          </p>
          <Link href="/login" className="animate-element animate-delay-500 inline-flex items-center gap-2 mt-8 text-sm text-zinc-500 hover:text-zinc-900 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Volver a iniciar sesión
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col md:flex-row w-[100dvw] bg-zinc-50">
      {/* Left: form */}
      <section className="flex-1 flex items-center justify-center p-8">
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

            <h1 className="animate-element animate-delay-200 text-4xl md:text-5xl font-semibold leading-tight text-zinc-900">
              <span className="font-light tracking-tighter">Crea tu cuenta</span>
            </h1>
            <p className="animate-element animate-delay-300 text-zinc-500">14 días gratis. Sin tarjeta de crédito.</p>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="animate-element animate-delay-300">
                <label className="text-sm font-medium text-zinc-600">Nombre completo</label>
                <div className="rounded-2xl border border-zinc-200 bg-white transition-colors focus-within:border-[hsl(235,84%,55%)] focus-within:ring-2 focus-within:ring-[hsl(235,84%,55%,0.1)]">
                  <input name="name" type="text" placeholder="Tu nombre" className="w-full bg-transparent text-sm p-4 rounded-2xl focus:outline-none text-zinc-900 placeholder:text-zinc-400" required />
                </div>
              </div>

              <div className="animate-element animate-delay-400">
                <label className="text-sm font-medium text-zinc-600">Correo electrónico</label>
                <div className="rounded-2xl border border-zinc-200 bg-white transition-colors focus-within:border-[hsl(235,84%,55%)] focus-within:ring-2 focus-within:ring-[hsl(235,84%,55%,0.1)]">
                  <input name="email" type="email" placeholder="tu@negocio.com" className="w-full bg-transparent text-sm p-4 rounded-2xl focus:outline-none text-zinc-900 placeholder:text-zinc-400" required />
                </div>
              </div>

              <div className="animate-element animate-delay-500">
                <label className="text-sm font-medium text-zinc-600">Contraseña</label>
                <div className="rounded-2xl border border-zinc-200 bg-white transition-colors focus-within:border-[hsl(235,84%,55%)] focus-within:ring-2 focus-within:ring-[hsl(235,84%,55%,0.1)]">
                  <div className="relative">
                    <input name="password" type={showPassword ? 'text' : 'password'} placeholder="Mínimo 8 caracteres" className="w-full bg-transparent text-sm p-4 pr-12 rounded-2xl focus:outline-none text-zinc-900 placeholder:text-zinc-400" required minLength={8} />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-3 flex items-center">
                      {showPassword ? <EyeOff className="w-5 h-5 text-zinc-500 hover:text-zinc-900 transition-colors" /> : <Eye className="w-5 h-5 text-zinc-500 hover:text-zinc-900 transition-colors" />}
                    </button>
                  </div>
                </div>
              </div>

              <button type="submit" disabled={loading} className="animate-element animate-delay-600 w-full rounded-2xl py-4 font-medium text-white hover:opacity-90 transition-colors disabled:opacity-50" style={{background: 'hsl(235 84% 55%)'}}>
                {loading ? 'Creando cuenta...' : 'Crear cuenta gratis'}
              </button>
            </form>

            <p className="animate-element animate-delay-700 text-center text-sm text-zinc-500">
              ¿Ya tienes cuenta?{' '}
              <Link href="/login" className="font-medium hover:underline transition-colors" style={{color: 'hsl(235 84% 55%)'}}>Iniciar sesión</Link>
            </p>
          </div>
        </div>
      </section>

      {/* Right: hero */}
      <section className="hidden md:block flex-1 relative p-4">
        <div className="animate-slide-right animate-delay-300 absolute inset-4 rounded-3xl overflow-hidden">
          <video
            src="/hero.mp4"
            poster="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1200&q=80"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            className="w-full h-full object-cover"
          />
        </div>
      </section>
    </div>
  );
}
