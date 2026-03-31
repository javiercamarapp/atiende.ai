'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const s = createClient();
    const { error } = await s.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/onboarding/step-1` },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
        <Card className="w-full max-w-sm text-center p-8">
          <p className="text-4xl mb-4">{'📧'}</p>
          <h2 className="text-xl font-bold">Revisa tu email</h2>
          <p className="text-gray-500 mt-2 text-sm">Link de confirmacion enviado a <b>{email}</b></p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-blue-600">atiende.ai</CardTitle>
          <p className="text-gray-500 text-sm">Crea tu cuenta - 14 dias gratis</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handle} className="space-y-4">
            <div>
              <Label>Email</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@negocio.com" required />
            </div>
            <div>
              <Label>Contrasena</Label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimo 8 caracteres" minLength={8} required />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Creando...' : 'Crear Cuenta Gratis'}
            </Button>
          </form>
          <p className="text-center text-sm text-gray-500 mt-4">
            Ya tienes cuenta?{' '}
            <Link href="/login" className="text-blue-600 font-medium hover:underline">Inicia sesion</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
