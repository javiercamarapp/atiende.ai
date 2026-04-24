'use client';
// ═════════════════════════════════════════════════════════════════════════════
// BookingForm — client component renderizado dentro de /book/[slug]/page.tsx
//
// Flujo:
//   1. Usuario elige servicio + fecha
//   2. Fetch GET /api/public/booking/<slug>/availability?date=...&service_id=...
//      → muestra los slots devueltos
//   3. Usuario elige slot + rellena nombre/teléfono/opcional email/motivo
//   4. Carga reCAPTCHA v3 (si NEXT_PUBLIC_RECAPTCHA_SITE_KEY está seteada)
//      y genera token al submit
//   5. POST /api/public/booking/<slug> → muestra confirmación con código
// ═════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';

interface Service {
  id: string;
  name: string;
  duration_minutes: number;
  price: number | null;
}

interface Slot {
  start_time: string;
  end_time: string;
  duration_minutes: number;
}

interface Props {
  slug: string;
  services: Service[];
  brandColor: string;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'loading_slots' }
  | { kind: 'slots_ready' }
  | { kind: 'submitting' }
  | { kind: 'confirmed'; confirmationCode: string; datetime: string; staffName: string }
  | { kind: 'error'; message: string };

const RECAPTCHA_SITE = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

// Cargar reCAPTCHA v3 una sola vez
function useRecaptcha() {
  const [ready, setReady] = useState(!RECAPTCHA_SITE);
  useEffect(() => {
    if (!RECAPTCHA_SITE) return;
    if ((window as Window & { grecaptcha?: unknown }).grecaptcha) {
      setReady(true);
      return;
    }
    const s = document.createElement('script');
    s.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE}`;
    s.async = true;
    s.onload = () => setReady(true);
    document.body.appendChild(s);
  }, []);
  const getToken = async (): Promise<string | undefined> => {
    if (!RECAPTCHA_SITE) return undefined;
    const g = (window as Window & { grecaptcha?: { execute: (k: string, opts: { action: string }) => Promise<string>; ready: (cb: () => void) => void } }).grecaptcha;
    if (!g) return undefined;
    return new Promise((resolve) => {
      g.ready(async () => {
        try {
          const token = await g.execute(RECAPTCHA_SITE, { action: 'book' });
          resolve(token);
        } catch {
          resolve(undefined);
        }
      });
    });
  };
  return { ready, getToken };
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function maxIso(daysAhead = 60): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function BookingForm({ slug, services, brandColor }: Props) {
  const [serviceId, setServiceId] = useState(services[0]?.id || '');
  const [date, setDate] = useState(todayIso());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [patientEmail, setPatientEmail] = useState('');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const recaptcha = useRecaptcha();

  // Fetch availability cuando cambia date o service
  useEffect(() => {
    if (status.kind === 'submitting' || status.kind === 'confirmed') return;
    let abort = false;
    setStatus({ kind: 'loading_slots' });
    setSelectedSlot(null);
    const url = new URL(`/api/public/booking/${slug}/availability`, window.location.origin);
    url.searchParams.set('date', date);
    if (serviceId) url.searchParams.set('service_id', serviceId);
    fetch(url.toString())
      .then((r) => r.json())
      .then((data) => {
        if (abort) return;
        if (data.error) {
          setStatus({ kind: 'error', message: data.error });
          setSlots([]);
        } else {
          setSlots(data.slots || []);
          setStatus({ kind: 'slots_ready' });
        }
      })
      .catch(() => {
        if (!abort) setStatus({ kind: 'error', message: 'network' });
      });
    return () => { abort = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, serviceId, slug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !patientName.trim() || !patientPhone.trim()) return;
    setStatus({ kind: 'submitting' });

    const token = await recaptcha.getToken();

    try {
      const res = await fetch(`/api/public/booking/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_name: patientName.trim(),
          patient_phone: patientPhone.trim(),
          patient_email: patientEmail.trim() || undefined,
          date,
          time: selectedSlot,
          service_id: serviceId || undefined,
          reason: reason.trim() || undefined,
          recaptcha_token: token,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus({ kind: 'error', message: data.error || 'create_failed' });
        return;
      }
      setStatus({
        kind: 'confirmed',
        confirmationCode: data.confirmation_code,
        datetime: data.datetime,
        staffName: data.staff_name,
      });
    } catch {
      setStatus({ kind: 'error', message: 'network' });
    }
  };

  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId),
    [services, serviceId],
  );

  if (status.kind === 'confirmed') {
    return (
      <div className="text-center py-6">
        <div className="text-3xl mb-3">✅</div>
        <h2 className="text-lg font-semibold text-zinc-900 mb-2">¡Cita reservada!</h2>
        <p className="text-sm text-zinc-600 mb-4">
          Le enviamos el recordatorio por WhatsApp 24 h antes.
        </p>
        <div className="inline-block rounded-xl bg-zinc-50 border border-zinc-200 px-4 py-3 text-left text-sm">
          <div className="text-zinc-500 text-[11px] uppercase tracking-wider">Código</div>
          <div className="font-mono font-semibold text-zinc-900">{status.confirmationCode}</div>
          <div className="mt-2 text-zinc-600">{status.staffName}</div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Servicio */}
      {services.length > 0 && (
        <div>
          <label className="block text-[12px] uppercase tracking-wider text-zinc-500 mb-1.5">
            Servicio
          </label>
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-zinc-200 bg-white focus:border-zinc-400 focus:outline-none text-sm"
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.price ? ` · $${Number(s.price).toLocaleString('es-MX')} MXN` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Fecha */}
      <div>
        <label className="block text-[12px] uppercase tracking-wider text-zinc-500 mb-1.5">
          Día
        </label>
        <input
          type="date"
          value={date}
          min={todayIso()}
          max={maxIso(60)}
          onChange={(e) => setDate(e.target.value)}
          className="w-full h-11 px-3 rounded-xl border border-zinc-200 bg-white focus:border-zinc-400 focus:outline-none text-sm"
        />
      </div>

      {/* Slots */}
      <div>
        <label className="block text-[12px] uppercase tracking-wider text-zinc-500 mb-1.5">
          Hora
        </label>
        {status.kind === 'loading_slots' && (
          <div className="text-sm text-zinc-500">Buscando disponibilidad…</div>
        )}
        {status.kind === 'slots_ready' && slots.length === 0 && (
          <div className="text-sm text-zinc-500">Sin horarios disponibles este día. Probá otro.</div>
        )}
        {slots.length > 0 && (
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {slots.map((s) => {
              const selected = selectedSlot === s.start_time;
              return (
                <button
                  key={s.start_time}
                  type="button"
                  onClick={() => setSelectedSlot(s.start_time)}
                  className="h-10 rounded-lg border text-sm font-medium transition"
                  style={
                    selected
                      ? { background: brandColor, color: 'white', borderColor: brandColor }
                      : { background: 'white', color: '#18181b', borderColor: '#e4e4e7' }
                  }
                >
                  {s.start_time}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Datos del paciente */}
      <div className="pt-2 space-y-3">
        <div>
          <label className="block text-[12px] uppercase tracking-wider text-zinc-500 mb-1.5">
            Nombre completo
          </label>
          <input
            type="text"
            required
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            placeholder="Juan Pérez"
            className="w-full h-11 px-3 rounded-xl border border-zinc-200 bg-white focus:border-zinc-400 focus:outline-none text-sm"
          />
        </div>
        <div>
          <label className="block text-[12px] uppercase tracking-wider text-zinc-500 mb-1.5">
            WhatsApp
          </label>
          <input
            type="tel"
            required
            value={patientPhone}
            onChange={(e) => setPatientPhone(e.target.value)}
            placeholder="55 1234 5678"
            className="w-full h-11 px-3 rounded-xl border border-zinc-200 bg-white focus:border-zinc-400 focus:outline-none text-sm"
          />
        </div>
        <div>
          <label className="block text-[12px] uppercase tracking-wider text-zinc-500 mb-1.5">
            Email <span className="text-zinc-400 normal-case">(opcional)</span>
          </label>
          <input
            type="email"
            value={patientEmail}
            onChange={(e) => setPatientEmail(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-zinc-200 bg-white focus:border-zinc-400 focus:outline-none text-sm"
          />
        </div>
        <div>
          <label className="block text-[12px] uppercase tracking-wider text-zinc-500 mb-1.5">
            Motivo <span className="text-zinc-400 normal-case">(opcional)</span>
          </label>
          <input
            type="text"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej. limpieza dental"
            className="w-full h-11 px-3 rounded-xl border border-zinc-200 bg-white focus:border-zinc-400 focus:outline-none text-sm"
          />
        </div>
      </div>

      {/* Error */}
      {status.kind === 'error' && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[13px] text-rose-800">
          {status.message === 'slot_taken'
            ? 'Ese horario se acaba de ocupar. Probá otro.'
            : status.message === 'captcha_failed'
              ? 'Verificación de seguridad falló. Recargá e intentá de nuevo.'
              : status.message === 'rate_limited'
                ? 'Demasiados intentos. Probá en unos minutos.'
                : status.message === 'monthly_cap_reached'
                  ? 'El consultorio alcanzó su cupo mensual en esta página. Contactanos por WhatsApp.'
                  : 'No pudimos agendar. Intentá de nuevo.'}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={
          !selectedSlot ||
          !patientName.trim() ||
          !patientPhone.trim() ||
          status.kind === 'submitting' ||
          !recaptcha.ready
        }
        className="w-full h-12 rounded-xl text-white font-medium text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: brandColor }}
      >
        {status.kind === 'submitting'
          ? 'Reservando…'
          : selectedService && selectedSlot
            ? `Reservar ${selectedService.name} a las ${selectedSlot}`
            : 'Reservar cita'}
      </button>

      {RECAPTCHA_SITE && (
        <p className="text-[10px] text-zinc-400 text-center pt-2">
          Protegido por reCAPTCHA · Google{' '}
          <a href="https://policies.google.com/privacy" className="underline" target="_blank" rel="noreferrer">
            Privacidad
          </a>
          {' · '}
          <a href="https://policies.google.com/terms" className="underline" target="_blank" rel="noreferrer">
            Términos
          </a>
        </p>
      )}
    </form>
  );
}
