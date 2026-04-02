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
    <div className="h-[100dvh] flex items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="flex flex-col gap-6">
          <Link href="/login" className="animate-element animate-delay-100 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
            <ArrowLeft className="w-4 h-4" /> Volver
          </Link>

          <h1 className="animate-element animate-delay-200 text-4xl font-semibold leading-tight">
            <span className="font-light tracking-tighter">Nueva contraseña</span>
          </h1>
          <p className="animate-element animate-delay-300 text-muted-foreground">
            Ingresa tu nueva contraseña. Debe tener al menos 8 caracteres.
          </p>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="animate-element animate-delay-400">
              <label className="text-sm font-medium text-muted-foreground">Nueva contraseña</label>
              <div className="rounded-2xl border border-border bg-foreground/5 backdrop-blur-sm transition-colors focus-within:border-zinc-400/70 focus-within:bg-zinc-500/10">
                <div className="relative">
                  <input name="password" type={showPassword ? 'text' : 'password'} placeholder="Mínimo 8 caracteres" className="w-full bg-transparent text-sm p-4 pr-12 rounded-2xl focus:outline-none" required minLength={8} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-3 flex items-center">
                    {showPassword ? <EyeOff className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors" /> : <Eye className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="animate-element animate-delay-500">
              <label className="text-sm font-medium text-muted-foreground">Confirmar contraseña</label>
              <div className="rounded-2xl border border-border bg-foreground/5 backdrop-blur-sm transition-colors focus-within:border-zinc-400/70 focus-within:bg-zinc-500/10">
                <input name="confirm" type={showPassword ? 'text' : 'password'} placeholder="Repite tu contraseña" className="w-full bg-transparent text-sm p-4 rounded-2xl focus:outline-none" required minLength={8} />
              </div>
            </div>

            <button type="submit" disabled={loading} className="animate-element animate-delay-600 w-full rounded-2xl bg-zinc-900 py-4 font-medium text-white hover:bg-zinc-800 transition-colors disabled:opacity-50">
              {loading ? 'Actualizando...' : 'Actualizar contraseña'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
