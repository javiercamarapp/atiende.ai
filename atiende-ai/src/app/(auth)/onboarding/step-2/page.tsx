'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MessageSquare, Phone, Zap } from 'lucide-react';

const AGENT_TYPES = [
  {
    key: 'chat',
    icon: <MessageSquare className="w-8 h-8 text-blue-600" />,
    title: 'Chat WhatsApp',
    price: 'Desde $499 MXN/mes',
    features: [
      'Responde mensajes 24/7',
      'Agenda citas automaticamente',
      'Responde audios de voz',
      'Envia recordatorios',
    ],
  },
  {
    key: 'voice',
    icon: <Phone className="w-8 h-8 text-green-600" />,
    title: 'Voz AI',
    price: 'Desde $3,000 MXN/mes',
    features: [
      'Contesta llamadas telefonicas',
      'Hace llamadas outbound',
      'Voz natural en espanol MX',
      'Transfiere a humano',
    ],
  },
  {
    key: 'both',
    icon: <Zap className="w-8 h-8 text-purple-600" />,
    title: 'Chat + Voz',
    price: 'Desde $4,999 MXN/mes',
    features: [
      'Todo lo de Chat WhatsApp',
      'Todo lo de Voz AI',
      'Historial unificado',
      'Dashboard combinado',
    ],
  },
];

export default function Step2() {
  const [selected, setSelected] = useState('');
  const router = useRouter();

  return (
    <div>
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold">Que tipo de agente necesitas?</h2>
        <p className="text-gray-500 text-sm mt-1">
          Puedes agregar mas despues
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {AGENT_TYPES.map(t => (
          <Card
            key={t.key}
            onClick={() => setSelected(t.key)}
            className={`p-4 cursor-pointer transition-all
              ${selected === t.key
                ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500'
                : 'hover:border-gray-300 hover:shadow-md'}`}
          >
            <div className="flex flex-col items-center text-center">
              {t.icon}
              <h3 className="font-bold mt-2">{t.title}</h3>
              <p className="text-blue-600 font-semibold text-sm">{t.price}</p>
              <ul className="mt-2 text-xs text-gray-600 space-y-1">
                {t.features.map(f => (
                  <li key={f}>✓ {f}</li>
                ))}
              </ul>
            </div>
          </Card>
        ))}
      </div>

      <Button
        className="w-full mt-6" size="lg" disabled={!selected}
        onClick={() => {
          localStorage.setItem('ob_agent_type', selected);
          router.push('/onboarding/step-3');
        }}
      >
        Siguiente →
      </Button>
    </div>
  );
}
