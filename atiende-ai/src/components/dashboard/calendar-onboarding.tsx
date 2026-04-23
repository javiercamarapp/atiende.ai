'use client';

import { useEffect, useState } from 'react';
import {
  CalendarDays,
  CalendarCheck2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type Status = 'connected' | 'available' | 'soon';

interface Integration {
  key: string;
  name: string;
  description: string;
  status: Status;
  logo: React.ReactNode;
}

interface TourStep {
  icon: LucideIcon;
  title: string;
  description: string;
}

const GOOGLE_LOGO = (
  <svg viewBox="0 0 48 48" className="w-6 h-6" aria-hidden>
    <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
);

const OUTLOOK_LOGO = (
  <div className="w-6 h-6 rounded bg-[#0078D4] flex items-center justify-center text-white text-[11px] font-bold">O</div>
);
const APPLE_LOGO = (
  <div className="w-6 h-6 rounded bg-zinc-900 flex items-center justify-center text-white text-[11px] font-bold"></div>
);
const WA_LOGO = (
  <div className="w-6 h-6 rounded bg-[#25D366] flex items-center justify-center text-white text-[11px] font-bold">W</div>
);
const ZOOM_LOGO = (
  <div className="w-6 h-6 rounded bg-[#2D8CFF] flex items-center justify-center text-white text-[10px] font-bold">Zm</div>
);

const INTEGRATIONS: Integration[] = [
  {
    key: 'google',
    name: 'Google Calendar',
    description: 'Sincronización bidireccional en tiempo real',
    status: 'connected',
    logo: GOOGLE_LOGO,
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Confirmaciones y recordatorios automáticos',
    status: 'connected',
    logo: WA_LOGO,
  },
  {
    key: 'outlook',
    name: 'Outlook / Microsoft 365',
    description: 'Para equipos con Microsoft',
    status: 'soon',
    logo: OUTLOOK_LOGO,
  },
  {
    key: 'apple',
    name: 'Apple Calendar (iCloud)',
    description: 'Tu calendario personal en iPhone',
    status: 'soon',
    logo: APPLE_LOGO,
  },
  {
    key: 'zoom',
    name: 'Zoom',
    description: 'Links de videollamada automáticos',
    status: 'soon',
    logo: ZOOM_LOGO,
  },
];

const TOUR_STEPS: TourStep[] = [
  {
    icon: CalendarCheck2,
    title: 'Tu Google Calendar ya está sincronizado',
    description:
      'Cada cita que agendamos por WhatsApp aparece al instante en tu Google Calendar, y los eventos que creas ahí también se reflejan aquí. Sin duplicados, sin conflictos.',
  },
  {
    icon: MessageSquare,
    title: 'La IA agenda por ti en WhatsApp',
    description:
      'Cuando un paciente pide cita por WhatsApp, la IA revisa tu disponibilidad real en Google Calendar, propone horarios y reserva — sin que levantes un dedo.',
  },
  {
    icon: Clock,
    title: 'Recordatorios automáticos',
    description:
      '24 h antes y 2 h antes de cada cita, el paciente recibe un recordatorio por WhatsApp con opción de confirmar o reagendar. Menos no-shows, más ingresos.',
  },
  {
    icon: RefreshCw,
    title: 'Reagenda y cancela en un tap',
    description:
      'Desde cualquier cita en el calendario puedes reagendar, cancelar o enviar un mensaje al paciente. Todo queda registrado.',
  },
  {
    icon: Plus,
    title: 'Más integraciones pronto',
    description:
      'Outlook, Apple Calendar, Zoom y más. Puedes ver y solicitar integraciones desde el panel de Conexiones arriba del calendario.',
  },
];

export function CalendarOnboarding({ autoOpen }: { autoOpen: boolean }) {
  const [tourOpen, setTourOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!autoOpen) return;
    const key = 'calendar_tour_seen_v1';
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(key)) return;
    setTourOpen(true);
    window.localStorage.setItem(key, '1');
    const url = new URL(window.location.href);
    url.searchParams.delete('calendar');
    window.history.replaceState({}, '', url.toString());
  }, [autoOpen]);

  const connected = INTEGRATIONS.filter((i) => i.status === 'connected');
  const available = INTEGRATIONS.filter((i) => i.status !== 'connected');

  return (
    <>
      {/* ── Connections bar ── */}
      <section className="glass-card p-4 md:p-5 animate-element">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
              Conexiones
            </p>
            <h3 className="text-[15px] font-semibold text-zinc-900 mt-0.5">
              {connected.length} {connected.length === 1 ? 'servicio sincronizado' : 'servicios sincronizados'}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setTourOpen(true)}
            className="text-[12px] text-[hsl(var(--brand-blue))] hover:opacity-80 font-medium shrink-0"
          >
            Ver tour
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {connected.map((i) => (
            <span
              key={i.key}
              className="inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full bg-white ring-1 ring-zinc-200 text-[12.5px] text-zinc-800 font-medium"
            >
              {i.logo}
              {i.name}
              <Check className="w-3.5 h-3.5 text-emerald-600" strokeWidth={3} />
            </span>
          ))}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] text-[12.5px] font-medium hover:opacity-90 transition"
          >
            <Plus className={cn('w-3.5 h-3.5 transition-transform', expanded && 'rotate-45')} />
            {expanded ? 'Ocultar' : 'Añadir integración'}
          </button>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t border-zinc-100 grid grid-cols-1 sm:grid-cols-2 gap-2 animate-element">
            {available.map((i) => (
              <div
                key={i.key}
                className="flex items-start gap-3 p-3 rounded-xl bg-zinc-50 ring-1 ring-zinc-100"
              >
                <div className="shrink-0 mt-0.5">{i.logo}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-zinc-900 truncate">{i.name}</p>
                    <span className="text-[9.5px] uppercase tracking-wider font-semibold text-zinc-500 bg-white ring-1 ring-zinc-200 px-1.5 py-0.5 rounded-full">
                      Próximamente
                    </span>
                  </div>
                  <p className="text-[11.5px] text-zinc-500 mt-0.5 leading-snug">{i.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Welcome tour ── */}
      <Dialog open={tourOpen} onOpenChange={setTourOpen}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden gap-0">
          <button
            type="button"
            onClick={() => setTourOpen(false)}
            aria-label="Cerrar"
            className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-white/80 backdrop-blur ring-1 ring-zinc-200 flex items-center justify-center text-zinc-500 hover:text-zinc-900 transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          <div className="relative bg-gradient-to-br from-[hsl(var(--brand-blue-soft))] via-white to-white px-6 pt-8 pb-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(235_84%_68%)] flex items-center justify-center shadow-lg shadow-[hsl(var(--brand-blue))]/20">
                <CalendarDays className="w-5 h-5 text-white" />
              </div>
              <div>
                <DialogHeader className="text-left p-0 space-y-0">
                  <DialogTitle className="text-[17px] font-semibold text-zinc-900">
                    ¡Listo! Tu calendario está conectado
                  </DialogTitle>
                  <DialogDescription className="text-[12.5px] text-zinc-500 mt-0.5">
                    Un tour rápido para sacarle provecho desde hoy.
                  </DialogDescription>
                </DialogHeader>
              </div>
            </div>
          </div>

          <div className="px-6 py-6 min-h-[220px] flex flex-col">
            <TourCard step={TOUR_STEPS[stepIndex]} key={stepIndex} />

            <div className="mt-auto pt-6 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                {TOUR_STEPS.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setStepIndex(i)}
                    aria-label={`Paso ${i + 1}`}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      i === stepIndex ? 'w-6 bg-[hsl(var(--brand-blue))]' : 'w-1.5 bg-zinc-200 hover:bg-zinc-300',
                    )}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                  disabled={stepIndex === 0}
                  aria-label="Anterior"
                  className="w-9 h-9 rounded-full ring-1 ring-zinc-200 flex items-center justify-center text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 transition disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {stepIndex < TOUR_STEPS.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setStepIndex((i) => Math.min(TOUR_STEPS.length - 1, i + 1))}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-[hsl(var(--brand-blue))] text-white text-[13px] font-medium hover:opacity-90 transition"
                  >
                    Siguiente
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setTourOpen(false)}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-[hsl(var(--brand-blue))] text-white text-[13px] font-medium hover:opacity-90 transition"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Empezar
                  </button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TourCard({ step }: { step: TourStep }) {
  const Icon = step.icon;
  return (
    <div className="animate-element">
      <div className="w-10 h-10 rounded-lg bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] flex items-center justify-center">
        <Icon className="w-5 h-5" />
      </div>
      <h4 className="mt-3.5 text-[16px] font-semibold text-zinc-900 tracking-tight">
        {step.title}
      </h4>
      <p className="mt-1.5 text-[13.5px] text-zinc-600 leading-relaxed">
        {step.description}
      </p>
    </div>
  );
}
