// ═════════════════════════════════════════════════════════════════════════════
// PATIENT STATE SNAPSHOT — contexto crítico que debe sobrevivir a la
// truncación de history (HISTORY_MAX_MESSAGES=25).
//
// Construye un string compacto inyectable al system prompt con datos clave
// del paciente/contacto: próximas citas, plan de tratamiento, guardian
// registrado, intake completado. Esto evita que el LLM "olvide" en el turno
// 13 que el paciente es menor de edad y tiene un guardian, o que ya tiene
// 3 citas pendientes este mes.
//
// Se llama una vez por turno desde el processor — NO desde el orchestrator —
// porque el costo de las queries (4 selects ligeros) no debe agregarse al
// crítico path del LLM call. El processor pasa el resultado vía
// `OrchestratorContext.patientStateSnapshot`.
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';

const MAX_APPOINTMENTS = 3;
const MAX_TREATMENT_LINES = 2;

interface AppointmentRow {
  id: string;
  datetime: string;
  service_id: string | null;
  staff_id: string | null;
  status: string | null;
}

interface TreatmentRow {
  id: string;
  name: string | null;
  total_visits: number | null;
  completed_visits: number | null;
  status: string | null;
}

interface ContactRow {
  intake_completed: boolean | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  date_of_birth: string | null;
}

/**
 * Construye un snapshot compacto del estado del paciente. Devuelve `null`
 * si no hay nada relevante que reportar (paciente nuevo, sin citas, sin
 * intake) — en ese caso el caller no inyecta nada extra al system prompt.
 *
 * Best-effort: si una query falla, esa sección se omite. No throws.
 */
export async function buildPatientStateSnapshot(
  tenantId: string,
  contactId: string,
): Promise<string | null> {
  const lines: string[] = [];

  const [apptsRes, treatmentsRes, contactRes] = await Promise.allSettled([
    supabaseAdmin
      .from('appointments')
      .select('id, datetime, service_id, staff_id, status')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .gte('datetime', new Date().toISOString())
      .in('status', ['scheduled', 'confirmed'])
      .order('datetime', { ascending: true })
      .limit(MAX_APPOINTMENTS),
    supabaseAdmin
      .from('treatment_plans')
      .select('id, name, total_visits, completed_visits, status')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .eq('status', 'active')
      .limit(MAX_TREATMENT_LINES),
    supabaseAdmin
      .from('contacts')
      .select('intake_completed, guardian_name, guardian_phone, date_of_birth')
      .eq('tenant_id', tenantId)
      .eq('id', contactId)
      .maybeSingle(),
  ]);

  // Próximas citas
  if (apptsRes.status === 'fulfilled' && apptsRes.value.data?.length) {
    const appts = apptsRes.value.data as AppointmentRow[];
    const fmt = appts
      .map((a) => `${a.datetime.slice(0, 16).replace('T', ' ')} (${a.status})`)
      .join('; ');
    lines.push(`Próximas citas: ${fmt}`);
  }

  // Tratamientos activos
  if (treatmentsRes.status === 'fulfilled' && treatmentsRes.value.data?.length) {
    const treatments = treatmentsRes.value.data as TreatmentRow[];
    const fmt = treatments
      .map((t) => {
        const progress =
          t.total_visits != null && t.completed_visits != null
            ? ` (${t.completed_visits}/${t.total_visits} visitas)`
            : '';
        return `${t.name ?? 'tratamiento'}${progress}`;
      })
      .join('; ');
    lines.push(`Tratamiento activo: ${fmt}`);
  }

  // Guardian + intake
  if (contactRes.status === 'fulfilled' && contactRes.value.data) {
    const c = contactRes.value.data as ContactRow;
    if (c.guardian_name) {
      const phone = c.guardian_phone ? ` (${c.guardian_phone})` : '';
      lines.push(`Guardian registrado: ${c.guardian_name}${phone}`);
    }
    if (c.intake_completed === false) {
      lines.push('Intake pendiente: sí (preguntar antes de agendar si aplica)');
    }
    if (c.date_of_birth) {
      // Sin emojis ni texto markdown, solo un campo plano para el LLM.
      lines.push(`Fecha de nacimiento: ${c.date_of_birth}`);
    }
  }

  if (lines.length === 0) return null;
  return ['PATIENT STATE (no truncar — datos persistentes):', ...lines.map((l) => `- ${l}`)].join('\n');
}
