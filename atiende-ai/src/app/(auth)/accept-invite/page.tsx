'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

function AcceptInviteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setTokenError('Link de invitación inválido. Pedile al admin del consultorio que te mande uno nuevo.');
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token) return;
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const password = formData.get('password') as string;
    const name = formData.get('name') as string;

    try {
      const res = await fetch('/api/staff/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, name }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; redirect_to?: string };

      if (!res.ok) {
        toast.error(json.error || 'No pude aceptar tu invitación.');
        if (res.status === 410 || res.status === 404) {
          setTokenError(json.error || 'Link de invitación inválido o expirado.');
        }
        setLoading(false);
        return;
      }

      // Auto-login con las credenciales recién creadas. Necesitamos el email
      // del invite — el endpoint lo retornó en res, pero como el body no lo
      // incluye explícitamente para seguridad, hacemos login con un POST a
      // /api/auth/login que ya tiene la lógica.
      // Workaround: pedimos al user su email en el form? No — el invite ya
      // tiene email asociado. El backend podría devolverlo. Por ahora,
      // redirigimos a /login con un mensaje exitoso.
      toast.success('¡Tu cuenta está lista! Iniciá sesión con tu email y contraseña.');
      router.push('/login?welcome=1');
    } catch {
      toast.error('Error de red. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  if (tokenError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-zinc-50">
        <div className="w-full max-w-md text-center bg-white rounded-2xl p-10 shadow-sm ring-1 ring-zinc-200">
          <div className="text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-semibold text-zinc-900 mb-2">Invitación inválida</h1>
          <p className="text-zinc-600 text-sm leading-relaxed">{tokenError}</p>
          <button
            type="button"
            onClick={() => router.push('/login')}
            className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 transition-colors"
          >
            Ir a inicio de sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-gradient-to-br from-zinc-50 via-white to-blue-50">
      <div className="w-full max-w-md bg-white rounded-2xl p-10 shadow-sm ring-1 ring-zinc-200">
        <div className="mb-8">
          <div className="text-xs uppercase tracking-wider text-blue-600 font-semibold mb-2">
            Invitación a atiende.ai
          </div>
          <h1 className="text-2xl font-semibold text-zinc-900 tracking-tight">
            Completá tu cuenta
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Solo necesitás un nombre y una contraseña. Después podés iniciar sesión normalmente.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-zinc-700 block mb-1.5">
              Tu nombre completo
            </label>
            <input
              name="name"
              type="text"
              placeholder="Dr. Pérez García"
              required
              maxLength={120}
              className="w-full px-4 py-3 rounded-xl bg-zinc-50 border border-zinc-200 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-zinc-700 block mb-1.5">
              Contraseña (mín. 8 caracteres)
            </label>
            <div className="relative">
              <input
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                maxLength={200}
                className="w-full px-4 py-3 pr-12 rounded-xl bg-zinc-50 border border-zinc-200 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-3 flex items-center text-zinc-400 hover:text-zinc-700 transition-colors"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Creando cuenta…' : 'Aceptar invitación y crear cuenta'}
          </button>
        </form>

        <p className="mt-6 text-xs text-zinc-500 text-center leading-relaxed">
          Al continuar aceptás los términos de servicio y aviso de privacidad de atiende.ai.
        </p>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-zinc-400">Cargando…</div>}>
      <AcceptInviteInner />
    </Suspense>
  );
}
