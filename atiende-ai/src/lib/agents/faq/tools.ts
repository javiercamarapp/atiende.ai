// ═════════════════════════════════════════════════════════════════════════════
// FAQ TOOLS — handlers SIN LLM (consultas directas a Supabase + format)
// Estos NO se registran en toolRegistry. Son funciones simples que el
// fast-path del processor invoca cuando hay match de pattern regex.
// ═════════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';

const DAYS_ES: Record<string, string> = {
  lun: 'Lunes', mar: 'Martes', mie: 'Miércoles', jue: 'Jueves',
  vie: 'Viernes', sab: 'Sábado', dom: 'Domingo',
};

/** Retorna horario formateado en español, agrupando días con misma ventana. */
export async function getBusinessHours(tenantId: string): Promise<string> {
  const { data: t } = await supabaseAdmin
    .from('tenants')
    .select('business_hours, timezone, name')
    .eq('id', tenantId)
    .single();

  if (!t?.business_hours) {
    return 'No tengo el horario cargado en este momento. Permítame verificar con el equipo.';
  }
  const hours = t.business_hours as Record<string, string>;

  const order = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
  const lines: string[] = [];
  for (const d of order) {
    const window = hours[d];
    if (!window || window === 'cerrado') {
      lines.push(`${DAYS_ES[d]}: cerrado`);
    } else {
      lines.push(`${DAYS_ES[d]}: ${window.replace('-', ' a ')}`);
    }
  }
  return `📅 Nuestro horario:\n${lines.join('\n')}`;
}

/** Retorna dirección + ciudad + Maps URL si existe. */
export async function getLocation(tenantId: string): Promise<string> {
  const { data: t } = await supabaseAdmin
    .from('tenants')
    .select('name, address, city, state, maps_url, parking_info')
    .eq('id', tenantId)
    .single();

  if (!t?.address) {
    return 'No tengo la dirección cargada. Permítame verificar con el equipo.';
  }

  const parts: string[] = [`📍 ${t.name}`, t.address];
  if (t.city || t.state) parts.push(`${t.city || ''}${t.city && t.state ? ', ' : ''}${t.state || ''}`.trim());
  if (t.maps_url) parts.push(`🗺️ ${t.maps_url}`);
  if (t.parking_info) parts.push(`🚗 ${t.parking_info}`);
  return parts.join('\n');
}

/** Retorna catálogo formateado: "- Servicio: $X MXN (N min)". */
export async function getServicesAndPrices(tenantId: string): Promise<string> {
  const { data: services } = await supabaseAdmin
    .from('services')
    .select('name, price, duration_minutes, category')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('category', { ascending: true });

  if (!services || services.length === 0) {
    return 'Permítame verificar nuestros servicios con el equipo.';
  }

  const lines = services.map((s) => {
    const price = s.price ? `$${s.price} MXN` : 'precio a consultar';
    const dur = s.duration_minutes ? ` (${s.duration_minutes} min)` : '';
    return `- ${s.name}: ${price}${dur}`;
  });

  return `💰 Nuestros servicios:\n${lines.join('\n')}`;
}

/** Retorna info de aseguradoras aceptadas (Phase 2: leer de tenants.accepted_insurances). */
export async function getInsuranceInfo(tenantId: string): Promise<string> {
  const { data: t } = await supabaseAdmin
    .from('tenants')
    .select('accepted_insurances')
    .eq('id', tenantId)
    .single();

  const list = (t?.accepted_insurances as string[] | undefined) || [];
  if (list.length === 0) {
    return 'Contamos con diferentes opciones de pago. Le recomendamos consultarlo directamente con el equipo en su próxima visita.';
  }
  return `🏥 Aceptamos:\n${list.map((i) => `- ${i}`).join('\n')}`;
}
