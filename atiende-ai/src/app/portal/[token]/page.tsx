// ═════════════════════════════════════════════════════════════════════════════
// PATIENT PORTAL — /portal/<token> (Phase 3)
//
// El paciente llega acá desde un link firmado que el agente le envió por
// WhatsApp. El token contiene (tenant_id, contact_id, expiry) HMAC-firmado.
// NO hay login — el HMAC + expiry + el hecho de que el link llegó al número
// del paciente son la autenticación.
//
// Lo que ve el paciente (SOAP-lite):
//   - Sus datos básicos (nombre)
//   - Historial de visitas completadas (fecha, servicio, doctor, notas del
//     doctor si existen)
//   - Planes de tratamiento activos (cuántas sesiones completadas / quedan)
//   - Próxima cita si la tiene
//
// Privacidad: un paciente sólo puede ver SUS datos (scopeado por contact_id
// del token). No hay riesgo de enumerar otros pacientes porque el token no
// permite swap de IDs (firmado).
// ═════════════════════════════════════════════════════════════════════════════

import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verifyPortalToken } from '@/lib/portal/token';
import { decryptPII } from '@/lib/utils/crypto';
import { displayPatientName } from '@/lib/utils/patient-display';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata() {
  return {
    title: 'Mi historial — atiende.ai',
    robots: { index: false, follow: false },
  };
}

export default async function PatientPortalPage({ params }: PageProps) {
  const { token } = await params;
  const result = verifyPortalToken(token);
  if (!result.ok) {
    // Distinguimos "expirado" del resto para dar un mensaje útil al paciente
    // sin revelar si el contact existía o no (info disclosure).
    if (result.reason === 'expired') return <ExpiredPage />;
    notFound();
  }

  const { tenantId, contactId } = result;

  const [tenantRes, contactRes, appointmentsRes, treatmentPlanRes] = await Promise.all([
    supabaseAdmin
      .from('tenants')
      .select('name, phone, business_type')
      .eq('id', tenantId)
      .single(),
    supabaseAdmin
      .from('contacts')
      .select('id, name, name_enc, phone, phone_enc')
      .eq('id', contactId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from('appointments')
      .select('id, datetime, status, customer_name, doctor_notes, services:service_id(name), staff:staff_id(name), is_telemedicine, payment_status')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .order('datetime', { ascending: false })
      .limit(25),
    supabaseAdmin
      .from('treatment_plans')
      .select('id, plan_name, plan_type, total_sessions, status, started_at')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .in('status', ['active', 'paused', 'completed'])
      .order('started_at', { ascending: false }),
  ]);

  if (!contactRes.data) notFound();
  const tenant = tenantRes.data;
  const contact = contactRes.data;
  const appointments = appointmentsRes.data || [];
  const plans = treatmentPlanRes.data || [];

  const patientName = displayPatientName(
    decryptPII(contact.name_enc as string | null) || (contact.name as string | null),
    contact.phone as string | null,
  );

  const upcoming = appointments.filter(
    (a) => a.status !== 'cancelled' && new Date(a.datetime as string) >= new Date(),
  );
  const past = appointments.filter(
    (a) => a.status === 'completed' || new Date(a.datetime as string) < new Date(),
  );

  // Sesiones por plan activo para contar progreso
  const planIds = plans.map((p) => p.id as string);
  const sessionsByPlan: Record<string, { completed: number; total: number; next?: string | null }> = {};
  if (planIds.length > 0) {
    const { data: sessions } = await supabaseAdmin
      .from('treatment_sessions')
      .select('plan_id, status, expected_date')
      .in('plan_id', planIds);
    for (const p of plans) {
      const rows = (sessions || []).filter((s) => s.plan_id === p.id);
      const completed = rows.filter((r) => r.status === 'completed').length;
      const next = rows.find((r) => r.status === 'pending')?.expected_date as string | null;
      sessionsByPlan[p.id as string] = {
        completed,
        total: p.total_sessions as number,
        next,
      };
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <header className="bg-white rounded-2xl shadow-sm p-6 mb-5 border border-zinc-100">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">
            {tenant?.name ?? 'Consultorio'}
          </p>
          <h1 className="text-2xl font-semibold text-zinc-900 mt-1">
            Hola, {patientName}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Aquí puede consultar su historial de visitas y tratamientos.
          </p>
        </header>

        {upcoming.length > 0 && (
          <section className="bg-white rounded-2xl shadow-sm p-6 mb-5 border border-zinc-100">
            <h2 className="text-sm font-semibold text-zinc-900 mb-3">
              Próxima{upcoming.length > 1 ? 's' : ''} cita{upcoming.length > 1 ? 's' : ''}
            </h2>
            <ul className="space-y-3">
              {upcoming.map((a) => {
                const svc = Array.isArray(a.services) ? a.services[0] : a.services;
                const staff = Array.isArray(a.staff) ? a.staff[0] : a.staff;
                return (
                  <li key={a.id as string} className="border-l-2 border-[hsl(var(--brand-blue))] pl-3">
                    <p className="text-sm text-zinc-900 font-medium capitalize">
                      {new Date(a.datetime as string).toLocaleString('es-MX', {
                        weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {svc?.name ?? 'Consulta'}{staff?.name ? ` · ${staff.name}` : ''}
                      {a.is_telemedicine ? ' · videollamada' : ''}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {plans.length > 0 && (
          <section className="bg-white rounded-2xl shadow-sm p-6 mb-5 border border-zinc-100">
            <h2 className="text-sm font-semibold text-zinc-900 mb-3">Mis tratamientos</h2>
            <ul className="space-y-3">
              {plans.map((p) => {
                const s = sessionsByPlan[p.id as string];
                return (
                  <li key={p.id as string} className="bg-zinc-50 rounded-xl p-3">
                    <p className="text-sm font-medium text-zinc-900">{p.plan_name}</p>
                    {s && (
                      <>
                        <div className="mt-2 h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[hsl(var(--brand-blue))]"
                            style={{ width: `${Math.min(100, (s.completed / s.total) * 100)}%` }}
                          />
                        </div>
                        <p className="text-xs text-zinc-500 mt-1.5">
                          Sesión {s.completed} de {s.total}
                          {s.next ? ` · próxima sugerida ${s.next}` : ''}
                        </p>
                      </>
                    )}
                    <p className="text-[11px] text-zinc-400 mt-1.5 uppercase">
                      {p.status === 'active' ? 'En curso' : p.status === 'paused' ? 'Pausado' : 'Completado'}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="bg-white rounded-2xl shadow-sm p-6 mb-5 border border-zinc-100">
          <h2 className="text-sm font-semibold text-zinc-900 mb-3">Historial de visitas</h2>
          {past.length === 0 ? (
            <p className="text-sm text-zinc-500">Aún no tiene visitas completadas.</p>
          ) : (
            <ul className="space-y-4">
              {past.slice(0, 15).map((a) => {
                const svc = Array.isArray(a.services) ? a.services[0] : a.services;
                const staff = Array.isArray(a.staff) ? a.staff[0] : a.staff;
                return (
                  <li key={a.id as string} className="border-b border-zinc-100 last:border-0 pb-3 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-zinc-900 capitalize">
                          {new Date(a.datetime as string).toLocaleDateString('es-MX', {
                            day: 'numeric', month: 'long', year: 'numeric',
                          })}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {svc?.name ?? 'Consulta'}{staff?.name ? ` · ${staff.name}` : ''}
                        </p>
                      </div>
                      {a.status === 'cancelled' && (
                        <span className="text-[10px] uppercase bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded">
                          Cancelada
                        </span>
                      )}
                    </div>
                    {a.doctor_notes && a.status === 'completed' && (
                      <details className="mt-2 text-sm">
                        <summary className="text-[13px] text-[hsl(var(--brand-blue))] cursor-pointer select-none">
                          Notas del doctor
                        </summary>
                        <p className="mt-2 text-zinc-700 whitespace-pre-wrap text-[13px] leading-relaxed bg-zinc-50 rounded-lg p-3">
                          {a.doctor_notes as string}
                        </p>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="text-[11px] text-zinc-400 text-center">
          ¿Dudas? Escriba por WhatsApp al consultorio{tenant?.phone ? `: ${tenant.phone}` : ''}.
        </p>
      </div>
    </div>
  );
}

function ExpiredPage() {
  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-5">
      <div className="max-w-sm bg-white rounded-2xl shadow-sm p-7 text-center">
        <h1 className="text-lg font-semibold text-zinc-900">Este enlace ya expiró</h1>
        <p className="text-sm text-zinc-500 mt-2 leading-relaxed">
          Por seguridad, los enlaces al portal son válidos por 30 días.
          Escribe por WhatsApp al consultorio y pide un nuevo enlace a tu historial.
        </p>
      </div>
    </div>
  );
}
