'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const password = formData.get('password') as string;
    const confirm = formData.get('confirm') as string;

    if (password !== confirm) {
      toast.error('Las contraseñas no coinciden');
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        toast.error(error.message);
      } else {
        toast.success('Contraseña actualizada correctamente');
        router.push('/login');
      }
    } catch {
      toast.error('Error al actualizar contraseña');
    } finally {
      setLoading(false);
    }
  };

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
            <span className="font-light tracking-tighter">Nueva contraseña</span>
          </h1>
          <p className="animate-element animate-delay-300 text-zinc-500">
            Ingresa tu nueva contraseña. Debe tener al menos 8 caracteres.
          </p>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="animate-element animate-delay-400">
              <label className="text-sm font-medium text-zinc-600">Nueva contraseña</label>
              <div className="rounded-2xl border border-zinc-200 bg-white transition-colors focus-within:border-[hsl(235,84%,55%)] focus-within:ring-2 focus-within:ring-[hsl(235,84%,55%,0.1)]">
                <div className="relative">
                  <input name="password" type={showPassword ? 'text' : 'password'} placeholder="Mínimo 8 caracteres" className="w-full bg-transparent text-sm p-4 pr-12 rounded-2xl focus:outline-none text-zinc-900 placeholder:text-zinc-400" required minLength={8} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-3 flex items-center">
                    {showPassword ? <EyeOff className="w-5 h-5 text-zinc-400 hover:text-zinc-700 transition-colors" /> : <Eye className="w-5 h-5 text-zinc-400 hover:text-zinc-700 transition-colors" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="animate-element animate-delay-500">
              <label className="text-sm font-medium text-zinc-600">Confirmar contraseña</label>
              <div className="rounded-2xl border border-zinc-200 bg-white transition-colors focus-within:border-[hsl(235,84%,55%)] focus-within:ring-2 focus-within:ring-[hsl(235,84%,55%,0.1)]">
                <input name="confirm" type={showPassword ? 'text' : 'password'} placeholder="Repite tu contraseña" className="w-full bg-transparent text-sm p-4 rounded-2xl focus:outline-none text-zinc-900 placeholder:text-zinc-400" required minLength={8} />
              </div>
            </div>

            <button type="submit" disabled={loading} className="animate-element animate-delay-600 w-full rounded-2xl py-4 font-medium text-white hover:opacity-90 transition-colors disabled:opacity-50" style={{background: 'hsl(235 84% 55%)'}}>
              {loading ? 'Actualizando...' : 'Actualizar contraseña'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
