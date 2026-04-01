'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';

const RESPONSES: Record<string, { label: string; text: string }[]> = {
  general: [
    { label: 'Saludo', text: 'Hola, ¿en qué le puedo ayudar?' },
    { label: 'Espera', text: 'Permítame un momento, estoy verificando la información.' },
    { label: 'Despedida', text: '¡Gracias por contactarnos! Que tenga un excelente día.' },
    { label: 'Horario', text: 'Nuestro horario es de lunes a viernes de 9:00 a 18:00 y sábados de 9:00 a 14:00.' },
  ],
  dental: [
    { label: 'Cita', text: 'Con gusto le agendo su cita. ¿Qué día y horario le funciona mejor?' },
    { label: 'Primera vez', text: 'Para su primera visita necesita traer identificación oficial y llegar 15 minutos antes.' },
    { label: 'Urgencia', text: 'Si tiene dolor intenso, puede acudir directamente sin cita. Atendemos urgencias.' },
  ],
  restaurant: [
    { label: 'Pedido', text: '¡Con mucho gusto! ¿Qué le gustaría ordenar?' },
    { label: 'Delivery', text: 'El tiempo de entrega es aproximadamente 30-45 minutos.' },
    { label: 'Menú', text: 'Le comparto nuestro menú del día. ¿Tiene alguna alergia o preferencia?' },
  ],
};

interface CannedResponsesProps {
  businessType: string;
  onSelect: (text: string) => void;
}

export function CannedResponses({ businessType, onSelect }: CannedResponsesProps) {
  const [open, setOpen] = useState(false);
  const responses = [...(RESPONSES.general || []), ...(RESPONSES[businessType] || [])];

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-zinc-400 hover:text-zinc-600">
        <MessageSquare className="w-4 h-4 mr-1" /> Respuestas rápidas
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5 p-2 bg-zinc-50 rounded-lg border animate-in fade-in duration-200">
      {responses.map(r => (
        <button
          key={r.label}
          onClick={() => { onSelect(r.text); setOpen(false); }}
          className="text-xs px-2.5 py-1.5 rounded-full bg-white border border-zinc-200 hover:border-emerald-300 hover:bg-emerald-50 transition-colors"
        >
          {r.label}
        </button>
      ))}
      <button onClick={() => setOpen(false)} className="text-xs px-2 py-1 text-zinc-400 hover:text-zinc-600">✕</button>
    </div>
  );
}
