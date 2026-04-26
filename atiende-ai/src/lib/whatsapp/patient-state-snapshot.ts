// ═════════════════════════════════════════════════════════════════════════════
// Patient State Snapshot — inyecta estado crítico al system prompt
//
// Problema: aunque truncamos historial a 25 mensajes, el LLM puede perder
// info clave entre turnos (nombre del paciente, si ya reservó, su edad
// guardada, etc). Esto hace que el bot REPITA preguntas o pregunte si
// quiere reservar cuando ya reservó.
//
// Solución: antes de cada llamada al LLM, leemos el estado canónico del
// paciente desde la BD y lo inyectamos al system prompt como bloque
// estructurado. El LLM ve el ESTADO REAL aunque el historial se haya
// truncado.
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { decryptPII } from '@/lib/utils/crypto';

export async function buildPatientStateSnapshot(
  tenantId: string,
  contactId: string,
  timezone = 'America/Merida',
): Promise<string> {
  if (!contactId) return '';

  const [contactRes, aptsRes] = await Promise.all([
    supabaseAdmin
      .from('contacts')
      .select('name, intake_completed, intake_data, allergies, chronic_conditions, current_medications, insurance')
      .eq('id', contactId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from('appointments')
      .select('id, datetime, status, confirmation_code, services:service_id(name), staff:staff_id(name)')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .gte('datetime', new Date().toISOString())
      .neq('status', 'cancelled')
      .order('datetime', { ascending: true })
      .limit(5),
  ]);

  const contact = contactRes.data;
  const apts = aptsRes.data || [];

  if (!contact && apts.length === 0) return '';

  const lines: string[] = [];
  lines.push('═══ ESTADO ACTUAL DEL PACIENTE — fuente de verdad ═══');

  if (contact) {
    const decryptedName = decryptPII((contact.name as string) || '') || (contact.name as string) || '';
    if (decryptedName && !decryptedName.startsWith('v1:')) {
      lines.push(`Nombre: ${decryptedName}`);
    }
    const intakeData = (contact.intake_data as Record<string, unknown> | null) || {};
    const knownFields: string[] = [];
    if (intakeData.age != null) knownFields.push(`edad ${intakeData.age}`);
    if (intakeData.gender) knownFields.push(`género ${intakeData.gender}`);
    if (intakeData.allergies) knownFields.push(`alergias: ${intakeData.allergies}`);
    if (intakeData.chronic_conditions) knownFields.push(`crónicas: ${intakeData.chronic_conditions}`);
    if (intakeData.current_medications) knownFields.push(`medicamentos: ${intakeData.current_medications}`);
    if (knownFields.length > 0) {
      lines.push(`Datos guardados: ${knownFields.join(' · ')}`);
    }
    if (contact.intake_completed === true) {
      lines.push('Intake: COMPLETO — NO preguntes de nuevo nombre/edad/género ni los datos de arriba.');
    } else {
      lines.push('Intake: INCOMPLETO — pedir lo que falta de los obligatorios (nombre, edad, género).');
    }
    if ((contact.insurance as string) && contact.insurance !== '') {
      lines.push(`Seguro: ${contact.insurance}`);
    }
  }

  if (apts.length > 0) {
    lines.push('');
    lines.push('Citas activas (futuras o de hoy, NO canceladas):');
    for (const a of apts) {
      const svc = Array.isArray(a.services) ? a.services[0] : a.services;
      const staff = Array.isArray(a.staff) ? a.staff[0] : a.staff;
      const dt = new Date(a.datetime as string);
      // Bug fix: SIEMPRE pasar timeZone option. Vercel host TZ es UTC, así
      // que sin esto las citas guardadas en local-time-as-UTC se mostraban
      // con offset (10am Mérida → 16:00 UTC → el LLM repetía 16:00 al
      // paciente). Ahora usamos el timezone del tenant.
      const fmt = dt.toLocaleString('es-MX', {
        timeZone: timezone,
        weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const parts = [
        `  • ${fmt}`,
        svc?.name ? `(${svc.name})` : '',
        staff?.name ? `con ${staff.name}` : '',
        `[${a.status}]`,
        a.confirmation_code ? `código ${a.confirmation_code}` : '',
      ].filter(Boolean);
      lines.push(parts.join(' '));
    }
    lines.push('');
    lines.push('IMPORTANTE: Si el paciente pide cita Y ya tiene una activa: NO ofrecer agendar otra. Confirmar la existente o ofrecer modificar/cancelar.');
  } else {
    lines.push('');
    lines.push('Citas activas: ninguna.');
  }

  lines.push('═══ FIN DEL ESTADO ═══');
  return lines.join('\n');
}
