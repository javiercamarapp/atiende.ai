'use client';

import { toast } from 'sonner';
import {
  Calendar as CalIcon, CreditCard, Mail, Globe, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Integration = {
  key: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  connected: boolean;
};

export function KnowledgeAdvancedApis() {
  const integrations: Integration[] = [
    { key: 'google-calendar', name: 'Google Calendar', description: 'Sincroniza citas con el calendario del equipo.', icon: CalIcon, accent: 'bg-blue-50 text-blue-600', connected: false },
    { key: 'stripe', name: 'Stripe', description: 'Cobra anticipos con link de pago automático.', icon: CreditCard, accent: 'bg-violet-50 text-violet-600', connected: false },
    { key: 'gmail', name: 'Gmail', description: 'Procesa correos entrantes como tickets del bot.', icon: Mail, accent: 'bg-rose-50 text-rose-600', connected: false },
    { key: 'google-places', name: 'Google Places', description: 'Importa reseñas y horarios de tu ficha.', icon: Globe, accent: 'bg-emerald-50 text-emerald-600', connected: true },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">
        Conecta tus herramientas para que el agente tenga contexto en tiempo real.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {integrations.map((i) => (
          <div key={i.key} className="rounded-xl border border-zinc-100 bg-white p-4 flex items-center gap-3">
            <span className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${i.accent}`}>
              <i.icon className="w-5 h-5" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-zinc-900">{i.name}</p>
                {i.connected && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                    <Check className="w-3 h-3" />
                    Conectado
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-0.5 truncate">{i.description}</p>
            </div>
            <button
              onClick={() => toast.info(`${i.name}: integración en camino`)}
              className={cn(
                'text-xs font-medium px-3 py-1.5 rounded-lg transition shrink-0',
                i.connected
                  ? 'bg-zinc-50 border border-zinc-200 text-zinc-700 hover:bg-zinc-100'
                  : 'bg-[hsl(var(--brand-blue))] text-white hover:opacity-90',
              )}
            >
              {i.connected ? 'Configurar' : 'Conectar'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
