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
      '24 horas antes de cada cita, el paciente recibe un recordatorio por WhatsApp con opción de confirmar o reagendar. Menos no-shows, más ingresos.',
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
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (!autoOpen || typeof window === 'undefined') return;
    // If the user just returned from OAuth, always show the tour on that
    // landing. The ?calendar=connected flag is stripped after opening so a
    // plain refresh won't re-trigger it.
    setTourOpen(true);
    setShowConfetti(true);
    const t = window.setTimeout(() => setShowConfetti(false), 1800);
    const url = new URL(window.location.href);
    url.searchParams.delete('calendar');
    window.history.replaceState({}, '', url.toString());
    return () => window.clearTimeout(t);
  }, [autoOpen]);

  const connected = INTEGRATIONS.filter((i) => i.status === 'connected');
  const available = INTEGRATIONS.filter((i) => i.status !== 'connected');

  return (
    <>
      {/* ── Connections bar ── */}
      <section className="relative glass-card p-4 md:p-5 animate-element overflow-hidden">
        <div aria-hidden className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-gradient-to-br from-[hsl(var(--brand-blue-soft))] to-transparent blur-2xl pointer-events-none" />
        <div className="relative flex items-start justify-between gap-3 mb-3.5">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                Conexiones
              </p>
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
            </div>
            <h3 className="text-[15px] font-semibold text-zinc-900 mt-0.5">
              {connected.length} {connected.length === 1 ? 'servicio sincronizado' : 'servicios sincronizados'}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setTourOpen(true)}
            className="inline-flex items-center gap-1.5 text-[12px] text-[hsl(var(--brand-blue))] hover:opacity-80 font-medium shrink-0 transition"
          >
            <Sparkles className="w-3 h-3" />
            Ver tour
          </button>
        </div>

        <div className="relative flex flex-wrap gap-2">
          {connected.map((i, idx) => (
            <span
              key={i.key}
              className="stagger-item inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full bg-white ring-1 ring-zinc-200 text-[12.5px] text-zinc-800 font-medium shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
              style={{ animationDelay: `${idx * 60}ms` }}
            >
              {i.logo}
              {i.name}
              <Check className="w-3.5 h-3.5 text-emerald-600" strokeWidth={3} />
            </span>
          ))}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] text-[12.5px] font-medium hover:bg-[hsl(var(--brand-blue))]/15 transition-all"
          >
            <Plus className={cn('w-3.5 h-3.5 transition-transform duration-300', expanded && 'rotate-45')} />
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

      {/* ── Confetti burst (solo al regresar del OAuth) ── */}
      {showConfetti && (
        <div aria-hidden className="fixed inset-0 z-50 pointer-events-none overflow-hidden">
          {Array.from({ length: 32 }).map((_, i) => {
            const colors = ['#3b82f6', '#6366f1', '#8b5cf6', '#22c55e', '#f59e0b'];
            const color = colors[i % colors.length];
            const left = `${(i * 3.125) % 100}%`;
            const delay = `${(i % 8) * 60}ms`;
            const rot = `${(i * 37) % 360}deg`;
            return (
              <span
                key={i}
                className="absolute top-0 w-1.5 h-2.5 rounded-[2px] confetti-piece"
                style={{
                  left,
                  backgroundColor: color,
                  animationDelay: delay,
                  transform: `rotate(${rot})`,
                }}
              />
            );
          })}
        </div>
      )}

      {/* ── Welcome tour (premium) ── */}
      <Dialog open={tourOpen} onOpenChange={setTourOpen}>
        <DialogContent className="sm:max-w-[520px] p-0 overflow-hidden gap-0 border border-zinc-200/70 shadow-2xl shadow-zinc-900/10 bg-white text-zinc-900">
          <DialogHeader className="sr-only">
            <DialogTitle>Tour del Calendario</DialogTitle>
            <DialogDescription>
              Guía interactiva para aprovechar la sincronización de Google Calendar.
            </DialogDescription>
          </DialogHeader>

          <button
            type="button"
            onClick={() => setTourOpen(false)}
            aria-label="Cerrar"
            className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-white/90 backdrop-blur ring-1 ring-zinc-200 flex items-center justify-center text-zinc-500 hover:text-zinc-900 hover:bg-white hover:scale-105 transition-all"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          {/* Progress bar (premium) */}
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-zinc-100 z-10">
            <div
              className="h-full bg-gradient-to-r from-[hsl(var(--brand-blue))] via-[hsl(235_84%_68%)] to-[hsl(var(--brand-blue))] transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] bg-[length:200%_100%] animate-[shimmer_3s_linear_infinite]"
              style={{ width: `${((stepIndex + 1) / TOUR_STEPS.length) * 100}%` }}
            />
          </div>

          {/* Hero — step-specific illustration */}
          <div className="relative h-[200px] bg-gradient-to-br from-[hsl(var(--brand-blue-soft))] via-white to-[hsl(var(--brand-blue-soft))]/40 overflow-hidden">
            {/* Ambient orbs */}
            <div aria-hidden className="absolute -top-20 -left-16 w-64 h-64 rounded-full bg-[hsl(var(--brand-blue))]/15 blur-3xl" />
            <div aria-hidden className="absolute -bottom-24 -right-12 w-56 h-56 rounded-full bg-indigo-400/15 blur-3xl" />

            {/* Grid pattern */}
            <div
              aria-hidden
              className="absolute inset-0 opacity-[0.04]"
              style={{
                backgroundImage:
                  'linear-gradient(to right, #000 1px, transparent 1px), linear-gradient(to bottom, #000 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }}
            />

            {/* Step illustration */}
            <div key={`hero-${stepIndex}`} className="relative h-full flex items-center justify-center animate-element">
              <StepHero step={TOUR_STEPS[stepIndex]} index={stepIndex} />
            </div>

            {/* Step counter pill */}
            <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/80 backdrop-blur ring-1 ring-zinc-200 text-[10.5px] font-semibold text-zinc-600 uppercase tracking-wider">
              <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse-soft" />
              Paso {stepIndex + 1} de {TOUR_STEPS.length}
            </div>
          </div>

          {/* Copy block — fondo blanco explícito para legibilidad
              independientemente del tema de la app (dark mode, glass-card, etc) */}
          <div className="px-7 pt-5 pb-6 min-h-[170px] flex flex-col bg-white">
            <div key={`copy-${stepIndex}`} className="animate-element">
              <h3 className="text-[19px] font-semibold text-zinc-900 tracking-tight leading-tight">
                {TOUR_STEPS[stepIndex].title}
              </h3>
              <p className="mt-2 text-[14px] text-zinc-700 leading-relaxed">
                {TOUR_STEPS[stepIndex].description}
              </p>
            </div>

            {/* Nav */}
            <div className="mt-auto pt-6 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                {TOUR_STEPS.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setStepIndex(i)}
                    aria-label={`Paso ${i + 1}`}
                    className={cn(
                      'h-1.5 rounded-full transition-all duration-300',
                      i === stepIndex
                        ? 'w-7 bg-gradient-to-r from-[hsl(var(--brand-blue))] to-[hsl(235_84%_68%)]'
                        : i < stepIndex
                          ? 'w-1.5 bg-[hsl(var(--brand-blue))]/30 hover:bg-[hsl(var(--brand-blue))]/50'
                          : 'w-1.5 bg-zinc-200 hover:bg-zinc-300',
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
                  className="w-9 h-9 rounded-full ring-1 ring-zinc-200 flex items-center justify-center text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 hover:ring-zinc-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {stepIndex < TOUR_STEPS.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setStepIndex((i) => Math.min(TOUR_STEPS.length - 1, i + 1))}
                    className="group inline-flex items-center gap-1.5 h-9 px-5 rounded-full bg-gradient-to-r from-[hsl(var(--brand-blue))] to-[hsl(235_84%_64%)] text-white text-[13px] font-medium hover:shadow-lg hover:shadow-[hsl(var(--brand-blue))]/30 hover:-translate-y-0.5 transition-all"
                  >
                    Siguiente
                    <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setTourOpen(false)}
                    className="group inline-flex items-center gap-1.5 h-9 px-5 rounded-full bg-gradient-to-r from-[hsl(var(--brand-blue))] to-[hsl(235_84%_64%)] text-white text-[13px] font-medium hover:shadow-lg hover:shadow-[hsl(var(--brand-blue))]/30 hover:-translate-y-0.5 transition-all"
                  >
                    <Sparkles className="w-3.5 h-3.5 group-hover:rotate-12 transition-transform" />
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

function StepHero({ step, index }: { step: TourStep; index: number }) {
  const Icon = step.icon;
  // Step-specific accent visuals built from raw SVG/elements so each step feels distinct.
  if (index === 0) {
    // Bidirectional sync: two cards connected by animated arrows
    return (
      <div className="relative flex items-center gap-4">
        <MiniLogoBadge variant="google" />
        <SyncArrows />
        <MiniLogoBadge variant="atiende" />
      </div>
    );
  }
  if (index === 1) {
    // IA agenda: bubble + calendar
    return (
      <div className="relative flex items-end gap-3">
        <div className="stagger-item w-24 h-14 rounded-2xl rounded-bl-sm bg-white ring-1 ring-zinc-200 shadow-sm flex items-center justify-center px-2 gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
          <span className="text-[10.5px] font-semibold text-zinc-700">¿Mañana 3 pm?</span>
        </div>
        <div className="stagger-item flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(235_84%_68%)] shadow-xl shadow-[hsl(var(--brand-blue))]/30 animate-float">
          <Icon className="w-7 h-7 text-white" strokeWidth={1.75} />
        </div>
      </div>
    );
  }
  if (index === 2) {
    // Reminders: clock + notification chip (24h antes only)
    return (
      <div className="relative flex items-center gap-3">
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-xl shadow-amber-400/30 animate-float">
          <Icon className="w-7 h-7 text-white" strokeWidth={1.75} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="stagger-item inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white ring-1 ring-zinc-200 shadow-sm text-[11.5px] font-semibold text-zinc-800">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse-soft" /> 24 horas antes
          </span>
        </div>
      </div>
    );
  }
  if (index === 3) {
    // Rescheduling: calendar + refresh
    return (
      <div className="relative">
        <div className="flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-xl shadow-emerald-400/30 animate-float">
          <Icon className="w-9 h-9 text-white" strokeWidth={1.75} />
        </div>
        <span className="absolute -top-1 -right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-white ring-1 ring-zinc-200 animate-pulse-soft">
          <Check className="w-3 h-3 text-emerald-600" strokeWidth={3} />
        </span>
      </div>
    );
  }
  // index === 4: More integrations
  return (
    <div className="relative flex items-center gap-2.5">
      <MiniLogoBadge variant="google" size="sm" />
      <MiniLogoBadge variant="whatsapp" size="sm" />
      <div className="stagger-item w-9 h-9 rounded-xl border-2 border-dashed border-zinc-300 flex items-center justify-center text-zinc-400">
        <Plus className="w-4 h-4" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="stagger-item text-[10px] font-semibold text-zinc-500">Outlook</span>
        <span className="stagger-item text-[10px] font-semibold text-zinc-500">Apple</span>
        <span className="stagger-item text-[10px] font-semibold text-zinc-500">Zoom</span>
      </div>
    </div>
  );
}

function MiniLogoBadge({ variant, size = 'md' }: { variant: 'google' | 'atiende' | 'whatsapp'; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'w-9 h-9' : 'w-12 h-12';
  const inner = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
  if (variant === 'google') {
    return (
      <div className={cn('stagger-item relative rounded-2xl bg-white shadow-xl shadow-zinc-900/10 ring-1 ring-zinc-200 flex items-center justify-center animate-float', dim)}>
        <svg viewBox="0 0 48 48" className={inner} aria-hidden>
          <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
          <path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
          <path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        </svg>
      </div>
    );
  }
  if (variant === 'whatsapp') {
    return (
      <div className={cn('stagger-item rounded-2xl bg-[#25D366] shadow-xl shadow-emerald-500/30 flex items-center justify-center text-white font-bold animate-float', dim)}>
        W
      </div>
    );
  }
  return (
    <div className={cn('stagger-item rounded-2xl bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(235_84%_68%)] shadow-xl shadow-[hsl(var(--brand-blue))]/30 flex items-center justify-center animate-float', dim)}>
      <CalendarCheck2 className={cn('text-white', inner)} strokeWidth={2} />
    </div>
  );
}

function SyncArrows() {
  return (
    <div aria-hidden className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <div className="h-[2px] w-8 bg-gradient-to-r from-transparent via-[hsl(var(--brand-blue))] to-[hsl(var(--brand-blue))] animate-[shimmer_2s_linear_infinite] bg-[length:200%_100%]" />
        <ChevronRight className="w-3.5 h-3.5 text-[hsl(var(--brand-blue))]" strokeWidth={2.5} />
      </div>
      <div className="flex items-center gap-1 flex-row-reverse">
        <div className="h-[2px] w-8 bg-gradient-to-l from-transparent via-[hsl(235_84%_68%)] to-[hsl(235_84%_68%)] animate-[shimmer_2s_linear_infinite] bg-[length:200%_100%]" />
        <ChevronLeft className="w-3.5 h-3.5 text-[hsl(235_84%_68%)]" strokeWidth={2.5} />
      </div>
    </div>
  );
}
