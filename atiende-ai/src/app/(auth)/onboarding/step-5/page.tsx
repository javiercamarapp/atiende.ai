'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { MessageSquare, CheckCircle, AlertCircle } from 'lucide-react';

export default function Step5() {
  const router = useRouter();
  const [status, setStatus] = useState<'idle'|'connecting'|'connected'|'error'>('idle');
  const [skip, setSkip] = useState(false);

  const connectWhatsApp = () => {
    setStatus('connecting');

    // Meta Embedded Signup via Facebook Login SDK
    // @ts-expect-error FB SDK loaded via script tag
    window.FB?.login((response: { authResponse?: { code: string } }) => {
      if (response.authResponse) {
        // Enviar code al backend para completar setup
        fetch('/api/whatsapp/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: response.authResponse.code,
          }),
        })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            setStatus('connected');
            localStorage.setItem('ob_wa_connected', 'true');
            localStorage.setItem('ob_wa_phone_id', data.phone_number_id);
          } else {
            setStatus('error');
          }
        })
        .catch(() => setStatus('error'));
      } else {
        setStatus('error');
      }
    }, {
      config_id: process.env.NEXT_PUBLIC_META_CONFIG_ID,
      response_type: 'code',
      override_default_response_type: true,
      extras: {
        feature: 'whatsapp_embedded_signup',
        version: 2,
        sessionInfoVersion: 3,
      },
    });
  };

  return (
    <div>
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold">Conectar tu WhatsApp</h2>
        <p className="text-gray-500 text-sm mt-1">
          Conecta tu numero de WhatsApp Business para que el bot
          pueda responder a tus clientes
        </p>
      </div>

      <div className="bg-white rounded-xl p-6 border text-center">
        {status === 'idle' && (
          <>
            <MessageSquare className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <Button
              size="lg"
              className="bg-green-500 hover:bg-green-600"
              onClick={connectWhatsApp}
            >
              🟢 Conectar mi WhatsApp
            </Button>
            <p className="text-xs text-gray-400 mt-3">
              Necesitas una cuenta de Facebook Business
            </p>
          </>
        )}

        {status === 'connecting' && (
          <div className="py-8">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500
              border-t-transparent rounded-full mx-auto mb-3" />
            <p>Conectando con Meta...</p>
          </div>
        )}

        {status === 'connected' && (
          <>
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <p className="font-bold text-green-700">WhatsApp conectado!</p>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <p className="text-red-600 mb-3">Error al conectar</p>
            <Button variant="outline" onClick={connectWhatsApp}>
              Reintentar
            </Button>
          </>
        )}
      </div>

      {/* Opcion de saltar */}
      {status !== 'connected' && (
        <button
          className="w-full text-center text-sm text-gray-400 mt-4
            hover:text-gray-600"
          onClick={() => {
            setSkip(true);
            localStorage.setItem('ob_wa_connected', 'false');
          }}
        >
          Saltar por ahora (puedes conectar despues)
        </button>
      )}

      <Button
        className="w-full mt-6" size="lg"
        disabled={status !== 'connected' && !skip}
        onClick={() => router.push('/onboarding/step-6')}
      >
        {status === 'connected' ? 'Siguiente →' : 'Continuar sin WA →'}
      </Button>
    </div>
  );
}
