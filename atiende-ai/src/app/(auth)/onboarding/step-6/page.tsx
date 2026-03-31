'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, CheckCircle, Rocket } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function Step6() {
  const router = useRouter();
  const [phase, setPhase] = useState<'preview'|'creating'|'done'>('preview');
  const [testInput, setTestInput] = useState('');
  const [testResponse, setTestResponse] = useState('');
  const [testing, setTesting] = useState(false);

  // Test the bot before activating
  const testBot = async () => {
    if (!testInput.trim()) return;
    setTesting(true);
    try {
      const res = await fetch('/api/onboarding/test-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: testInput,
          businessType: localStorage.getItem('ob_business_type'),
          businessInfo: JSON.parse(localStorage.getItem('ob_business_info') || '{}'),
          answers: JSON.parse(localStorage.getItem('ob_answers') || '{}'),
        }),
      });
      const data = await res.json();
      setTestResponse(data.reply);
    } catch {
      setTestResponse('Error al probar. Intenta de nuevo.');
    }
    setTesting(false);
  };

  // Create the agent (calls backend to generate prompt + ingest KB)
  const createAgent = async () => {
    setPhase('creating');
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      const res = await fetch('/api/onboarding/create-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          businessType: localStorage.getItem('ob_business_type'),
          agentType: localStorage.getItem('ob_agent_type'),
          businessInfo: JSON.parse(localStorage.getItem('ob_business_info') || '{}'),
          answers: JSON.parse(localStorage.getItem('ob_answers') || '{}'),
          waConnected: localStorage.getItem('ob_wa_connected') === 'true',
          waPhoneId: localStorage.getItem('ob_wa_phone_id'),
        }),
      });

      const data = await res.json();
      if (data.success) {
        // Limpiar localStorage
        ['ob_business_type','ob_agent_type','ob_business_info',
         'ob_answers','ob_wa_connected','ob_wa_phone_id']
          .forEach(k => localStorage.removeItem(k));
        setPhase('done');
      }
    } catch (error) {
      console.error('Error creando agente:', error);
    }
  };

  if (phase === 'creating') {
    return (
      <div className="text-center py-16">
        <Loader2 className="w-16 h-16 text-blue-500 mx-auto mb-4 animate-spin" />
        <h2 className="text-xl font-bold mb-2">Creando tu agente AI...</h2>
        <p className="text-gray-500 text-sm">
          Generando prompt personalizado, creando base de conocimiento,
          configurando WhatsApp...
        </p>
        <div className="mt-6 space-y-2 text-sm text-gray-400">
          <p>✓ Analizando tus respuestas...</p>
          <p>✓ Generando prompt de espanol mexicano...</p>
          <p>✓ Creando base de conocimiento anti-alucinacion...</p>
          <p>⏳ Activando agente...</p>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="text-center py-16">
        <CheckCircle className="w-20 h-20 text-green-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">Tu agente esta listo!</h2>
        <p className="text-gray-500 mb-8">
          Ya esta contestando a tus clientes en WhatsApp 24/7
        </p>
        <Button size="lg" onClick={() => router.push('/')}>
          <Rocket className="mr-2" /> Ir a mi Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold">Prueba tu agente</h2>
        <p className="text-gray-500 text-sm mt-1">
          Escribe un mensaje como si fueras un cliente
        </p>
      </div>

      {/* Chat simulator */}
      <div className="bg-green-50 rounded-xl p-4 border border-green-200">
        <div className="min-h-[120px] mb-3">
          {testResponse && (
            <div className="bg-white rounded-lg p-3 text-sm border">
              <p className="text-xs text-gray-400 mb-1">Tu asistente:</p>
              {testResponse}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            value={testInput}
            onChange={e => setTestInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && testBot()}
            placeholder="Ej: Cuanto cuesta una limpieza?"
          />
          <Button onClick={testBot} disabled={testing}>
            {testing ? <Loader2 className="animate-spin" /> : 'Enviar'}
          </Button>
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <Button variant="outline" size="lg" onClick={() => router.push('/onboarding/step-5')}>
          ← Anterior
        </Button>
        <Button
          className="flex-1" size="lg"
          onClick={createAgent}
        >
          <Rocket className="mr-2" /> Crear y Activar mi Agente
        </Button>
      </div>
    </div>
  );
}
