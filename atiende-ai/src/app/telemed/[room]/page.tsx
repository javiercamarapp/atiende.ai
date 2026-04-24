// ═════════════════════════════════════════════════════════════════════════════
// TELEMED landing page — /telemed/<room> (Phase 2.C.2)
//
// Cuando el bot manda `send_telemed_link`, el link apunta a esta página (no
// directo a meet.jit.si) por 2 razones:
//   1. Branding — el paciente ve el nombre del consultorio antes de saltar
//   2. Preflight — explicamos "necesitás cámara + micrófono" antes de que
//      el provider pida permiso ciego
//
// El link que se manda es /telemed/<room>?t=<appointment_id>. Validamos el
// room contra appointments.telemed_room para evitar que cualquiera se una
// a una sala random usando un room name adivinado.
// ═════════════════════════════════════════════════════════════════════════════

import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildTelemedUrl } from '@/lib/telemedicine/providers';
import { TelemedLaunch } from '@/components/public/telemed-launch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ room: string }>;
  searchParams: Promise<{ t?: string }>;
}

export async function generateMetadata() {
  return {
    title: 'Videoconsulta — atiende.ai',
    robots: { index: false, follow: false }, // nunca SEO, sólo acceso directo
  };
}

export default async function TelemedPage({ params, searchParams }: PageProps) {
  const { room } = await params;
  const { t: appointmentId } = await searchParams;
  if (!room || room.length < 8 || !/^atiende-[a-z0-9-]+$/.test(room)) notFound();

  // Validación: el room debe existir en una appointment activa (no cancelada).
  const { data: apt } = await supabaseAdmin
    .from('appointments')
    .select('id, tenant_id, status, datetime, is_telemedicine, customer_name, services:service_id(name)')
    .eq('telemed_room', room)
    .maybeSingle();

  if (!apt || !apt.is_telemedicine || apt.status === 'cancelled') notFound();

  // Si tenemos appointmentId querystring, validá que matchee (anti room-guessing)
  if (appointmentId && apt.id !== appointmentId) notFound();

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('name, telemedicine_provider, telemedicine_custom_url, phone')
    .eq('id', apt.tenant_id)
    .single();

  const provider = (tenant?.telemedicine_provider as 'jitsi' | 'daily' | 'custom_url') || 'jitsi';
  const customBase = (tenant?.telemedicine_custom_url as string | undefined) ?? null;
  const joinUrl = buildTelemedUrl(provider, room, customBase);

  const svc = Array.isArray(apt.services) ? apt.services[0] : apt.services;
  const appointmentTime = new Date(apt.datetime as string).toLocaleString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100 flex items-center justify-center p-5">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-7">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] mb-3">
            📹
          </div>
          <h1 className="text-xl font-semibold text-zinc-900">Videoconsulta</h1>
          <p className="text-sm text-zinc-500 mt-1.5">
            {tenant?.name ?? 'Tu consultorio'}
          </p>
        </div>

        <div className="bg-zinc-50 border border-zinc-100 rounded-xl p-4 mb-5 text-sm">
          <p className="text-zinc-600">
            Paciente: <strong className="text-zinc-900">{apt.customer_name || 'Invitado'}</strong>
          </p>
          {svc?.name && (
            <p className="text-zinc-600 mt-1">
              Servicio: <strong className="text-zinc-900">{svc.name}</strong>
            </p>
          )}
          <p className="text-zinc-600 mt-1 capitalize">{appointmentTime}</p>
        </div>

        <div className="text-[13px] text-zinc-600 leading-relaxed space-y-2 mb-5">
          <p>Antes de unirte:</p>
          <ul className="list-disc list-inside space-y-1 text-[12.5px] text-zinc-500">
            <li>Tu navegador te pedirá permiso para usar cámara y micrófono — acéptalos.</li>
            <li>Busca un lugar iluminado y silencioso.</li>
            <li>Si usas celular, usa audífonos para mejor calidad.</li>
          </ul>
        </div>

        <TelemedLaunch joinUrl={joinUrl} />

        <p className="text-[11px] text-zinc-400 text-center mt-5">
          Si no puedes entrar, llama al consultorio{tenant?.phone ? `: ${tenant.phone}` : ''}.
        </p>
      </div>
    </div>
  );
}
