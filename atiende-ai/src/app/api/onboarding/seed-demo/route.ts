import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ingestKnowledgeBatch } from '@/lib/rag/search';

// Embeddings ingestion can take 5-15s for 3-5 chunks.
export const maxDuration = 60;

interface DemoSeed {
  services: Array<{ name: string; description: string; price: number; duration_minutes: number; category: string }>;
  staff: Array<{ name: string; role: string; speciality?: string; default_duration: number }>;
  knowledge: Array<{ content: string; category: string }>;
  business_hours: Record<string, string>;
}

const DEFAULT_HOURS: Record<string, string> = {
  lun: '09:00-18:00',
  mar: '09:00-18:00',
  mie: '09:00-18:00',
  jue: '09:00-18:00',
  vie: '09:00-18:00',
  sab: '09:00-14:00',
};

const SEEDS: Record<string, DemoSeed> = {
  dental: {
    services: [
      { name: 'Consulta de valoración', description: 'Revisión general + diagnóstico', price: 500, duration_minutes: 30, category: 'consulta' },
      { name: 'Limpieza dental', description: 'Profilaxis + pulido', price: 900, duration_minutes: 45, category: 'preventivo' },
      { name: 'Resina estética', description: 'Por pieza, incluye anestesia', price: 1500, duration_minutes: 60, category: 'restaurativo' },
    ],
    staff: [
      { name: 'Dra. Ana López', role: 'Odontóloga general', default_duration: 30 },
      { name: 'Dr. Carlos Ramírez', role: 'Endodoncista', speciality: 'endodoncia', default_duration: 60 },
    ],
    knowledge: [
      { content: 'Aceptamos pagos en efectivo, transferencia, tarjeta de crédito y débito. No manejamos seguros dentales directos pero damos factura desglosada para reembolso.', category: 'pagos' },
      { content: 'Estamos en Calle 60 #452, Centro, Mérida. Hay estacionamiento gratuito para pacientes sobre la calle lateral.', category: 'ubicacion' },
      { content: 'Para primera consulta, llegar 10 minutos antes. No es necesario ayuno. Traer radiografías previas si las tiene.', category: 'primera_consulta' },
    ],
    business_hours: DEFAULT_HOURS,
  },
  medical: {
    services: [
      { name: 'Consulta general', description: 'Evaluación médica', price: 700, duration_minutes: 30, category: 'consulta' },
      { name: 'Consulta de seguimiento', description: 'Revisión de tratamiento', price: 500, duration_minutes: 20, category: 'seguimiento' },
      { name: 'Certificado médico', description: 'Emisión con revisión', price: 400, duration_minutes: 15, category: 'administrativo' },
    ],
    staff: [
      { name: 'Dr. Javier Mendoza', role: 'Médico general', default_duration: 30 },
    ],
    knowledge: [
      { content: 'Horarios de atención: lunes a viernes 9am-6pm, sábados 9am-2pm. Consultas de urgencia solo previo pago.', category: 'horarios' },
      { content: 'Recibimos efectivo, transferencia y tarjetas. Damos factura electrónica con RFC.', category: 'pagos' },
    ],
    business_hours: DEFAULT_HOURS,
  },
  salon: {
    services: [
      { name: 'Corte de cabello mujer', description: 'Incluye lavado', price: 350, duration_minutes: 45, category: 'cabello' },
      { name: 'Tinte completo', description: 'Hasta cabello mediano', price: 900, duration_minutes: 120, category: 'color' },
      { name: 'Manicure gel', description: 'Esmaltado semipermanente', price: 300, duration_minutes: 60, category: 'unas' },
    ],
    staff: [
      { name: 'Sofía Pérez', role: 'Estilista senior', default_duration: 45 },
      { name: 'Mariana Torres', role: 'Manicurista', default_duration: 60 },
    ],
    knowledge: [
      { content: 'Para servicios de color pedimos 30% de anticipo por transferencia. Cancelación con menos de 4 horas no es reembolsable.', category: 'cancelacion' },
      { content: 'Si es tu primera visita menciónalo para aplicarte 10% de descuento.', category: 'promociones' },
    ],
    business_hours: { ...DEFAULT_HOURS, lun: 'cerrado' },
  },
  veterinary: {
    services: [
      { name: 'Consulta general', description: 'Revisión clínica', price: 450, duration_minutes: 30, category: 'consulta' },
      { name: 'Vacunación', description: 'Vacuna + certificado', price: 350, duration_minutes: 15, category: 'preventivo' },
      { name: 'Esterilización', description: 'Cirugía + seguimiento', price: 1800, duration_minutes: 90, category: 'cirugia' },
    ],
    staff: [
      { name: 'MVZ. Paola García', role: 'Veterinaria', default_duration: 30 },
    ],
    knowledge: [
      { content: 'Para cirugías pedimos ayuno de 12 horas previo. Traer al pet con correa o transportadora.', category: 'preparacion' },
      { content: 'Urgencias fuera de horario: llamar al celular del consultorio — se cobra tarifa especial.', category: 'urgencias' },
    ],
    business_hours: DEFAULT_HOURS,
  },
};

const FALLBACK_SEED: DemoSeed = {
  services: [
    { name: 'Servicio básico', description: 'Descripción por defecto', price: 500, duration_minutes: 30, category: 'general' },
    { name: 'Servicio intermedio', description: 'Descripción por defecto', price: 900, duration_minutes: 60, category: 'general' },
    { name: 'Servicio premium', description: 'Descripción por defecto', price: 1500, duration_minutes: 90, category: 'general' },
  ],
  staff: [
    { name: 'Profesional 1', role: 'Titular', default_duration: 30 },
  ],
  knowledge: [
    { content: 'Aceptamos efectivo, transferencia y tarjeta. Damos factura si la solicitas al agendar.', category: 'pagos' },
  ],
  business_hours: DEFAULT_HOURS,
};

function pickSeed(businessType: string): DemoSeed {
  if (SEEDS[businessType]) return SEEDS[businessType];
  // Similar verticals fallback
  if (['barbershop', 'spa'].includes(businessType)) return SEEDS.salon;
  if (['nutritionist', 'dermatologist', 'psychologist', 'gynecologist', 'pediatrician', 'ophthalmologist'].includes(businessType)) {
    return SEEDS.medical;
  }
  return FALLBACK_SEED;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { checkApiRateLimit } = await import('@/lib/api-rate-limit');
    if (await checkApiRateLimit(`${user.id}:seed_demo`, 3, 60)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, business_type')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!tenant) {
      return NextResponse.json(
        { error: 'No encontramos tu agente. Completa el onboarding primero.' },
        { status: 404 },
      );
    }

    void req;
    const seed = pickSeed(tenant.business_type);

    const [existingServices, existingStaff] = await Promise.all([
      supabaseAdmin.from('services').select('id').eq('tenant_id', tenant.id).limit(1),
      supabaseAdmin.from('staff').select('id').eq('tenant_id', tenant.id).limit(1),
    ]);

    const addedServices = !existingServices.data?.length
      ? await supabaseAdmin.from('services').insert(
          seed.services.map((s) => ({ ...s, tenant_id: tenant.id, active: true })),
        ).select('id').then((r) => r.data?.length || 0)
      : 0;

    const addedStaff = !existingStaff.data?.length
      ? await supabaseAdmin.from('staff').insert(
          seed.staff.map((s) => ({ ...s, tenant_id: tenant.id, active: true })),
        ).select('id').then((r) => r.data?.length || 0)
      : 0;

    await supabaseAdmin
      .from('tenants')
      .update({ business_hours: seed.business_hours, updated_at: new Date().toISOString() })
      .eq('id', tenant.id);

    let addedKnowledge = 0;
    try {
      await ingestKnowledgeBatch(tenant.id, seed.knowledge, 'demo_seed');
      addedKnowledge = seed.knowledge.length;
    } catch (err) {
      console.error('[seed-demo] embedding ingest failed:', err);
    }

    return NextResponse.json({
      success: true,
      added: {
        services: addedServices,
        staff: addedStaff,
        knowledge: addedKnowledge,
        business_hours: true,
      },
    });
  } catch (err) {
    console.error('[seed-demo] error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
