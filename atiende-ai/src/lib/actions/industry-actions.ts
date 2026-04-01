import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage, sendButtonMessage, sendListMessage } from '@/lib/whatsapp/send';
import { notifyOwner } from './notifications';

// ═══════════════════════════════════════════════════════════
// INDUSTRY-SPECIFIC AGENTIC ACTIONS
// Each business type has unique workflows that a human employee would do
// ═══════════════════════════════════════════════════════════

interface IndustryContext {
  tenantId: string;
  phoneNumberId: string;
  customerPhone: string;
  customerName: string;
  contactId: string;
  conversationId: string;
  businessType: string;
  tenant: Record<string, unknown>;
  intent: string;
  content: string;
}

export async function executeIndustryAction(ctx: IndustryContext): Promise<{ acted: boolean; message?: string }> {
  const handlers: Record<string, (c: IndustryContext) => Promise<{ acted: boolean; message?: string }>> = {
    dental: dentalActions,
    medical: medicalActions,
    restaurant: restaurantActions,
    taqueria: restaurantActions,
    cafe: restaurantActions,
    hotel: hotelActions,
    real_estate: realEstateActions,
    salon: salonActions,
    barbershop: salonActions,
    spa: spaActions,
    psychologist: psychologistActions,
    veterinary: veterinaryActions,
    gym: gymActions,
    pharmacy: pharmacyActions,
    nutritionist: nutritionistActions,
    school: schoolActions,
    insurance: insuranceActions,
    mechanic: mechanicActions,
  };

  const handler = handlers[ctx.businessType];
  if (!handler) return { acted: false };

  try {
    return await handler(ctx);
  } catch {
    return { acted: false };
  }
}

// ═══ DENTAL: Citas, urgencias dentales, seguimiento post-tratamiento ═══
async function dentalActions(ctx: IndustryContext): Promise<{ acted: boolean; message?: string }> {
  if (ctx.intent === 'EMERGENCY') {
    await notifyOwner({ tenantId: ctx.tenantId, event: 'emergency', details: `🦷 URGENCIA DENTAL\nPaciente: ${ctx.customerName}\nTel: ${ctx.customerPhone}\nMensaje: ${ctx.content.slice(0, 100)}` });
    return { acted: true, message: '🦷 Entendemos que tiene una urgencia dental. Acuda directamente a la clínica, atendemos urgencias sin cita previa. Si hay sangrado abundante o inflamación severa, acuda a urgencias hospitalarias.' };
  }
  if (ctx.content.toLowerCase().includes('radiograf') || ctx.content.toLowerCase().includes('rayos x')) {
    return { acted: true, message: '📋 Para estudios de radiografía dental, necesitará:\n\n• Identificación oficial\n• Orden del dentista (si aplica)\n\nEl estudio se realiza en consultorio. ¿Le agendo una cita?' };
  }
  return { acted: false };
}

// ═══ MEDICAL: Triaje, recetas, resultados, urgencias ═══
async function medicalActions(ctx: IndustryContext): Promise<{ acted: boolean; message?: string }> {
  if (ctx.intent === 'EMERGENCY') {
    const keywords = ['dolor pecho', 'no puedo respirar', 'sangre', 'desmayo', 'convuls'];
    const is911 = keywords.some(k => ctx.content.toLowerCase().includes(k));
    if (is911) {
      await notifyOwner({ tenantId: ctx.tenantId, event: 'emergency', details: `🚨 EMERGENCIA MÉDICA 911\nPaciente: ${ctx.customerName}\n${ctx.content.slice(0, 150)}` });
      return { acted: true, message: '🚨 EMERGENCIA: Por favor llame al 911 inmediatamente. Si puede, acuda a urgencias del hospital más cercano. He notificado a nuestro equipo.' };
    }
  }
  if (ctx.content.toLowerCase().includes('resultado') || ctx.content.toLowerCase().includes('estudio')) {
    return { acted: true, message: '📋 Los resultados de estudios se entregan en consultorio por confidencialidad. ¿Le gustaría agendar una cita de seguimiento con el doctor para revisarlos?' };
  }
  return { acted: false };
}

// ═══ RESTAURANT: Pedidos, menú del día, alergias, reservaciones ═══
async function restaurantActions(ctx: IndustryContext): Promise<{ acted: boolean; message?: string }> {
  const lower = ctx.content.toLowerCase();
  if (lower.includes('menu del dia') || lower.includes('menú del día') || lower.includes('que tienen hoy')) {
    const { data: services } = await supabaseAdmin.from('services').select('name, price, description').eq('tenant_id', ctx.tenantId).eq('active', true).eq('category', 'menu_del_dia').limit(10);
    if (services?.length) {
      const items = services.map(s => `• ${s.name} — $${s.price}`).join('\n');
      return { acted: true, message: `🍽️ Menú del día:\n\n${items}\n\n¿Qué le gustaría ordenar?` };
    }
  }
  if (lower.includes('alergia') || lower.includes('alérg') || lower.includes('celiac') || lower.includes('gluten')) {
    return { acted: true, message: '⚠️ Tomamos las alergias muy en serio. Por favor indíquenos exactamente a qué es alérgico y nuestro chef verificará cada ingrediente de su orden. ¿Qué alergia tiene?' };
  }
  if (ctx.intent === 'ORDER_NEW') {
    await notifyOwner({ tenantId: ctx.tenantId, event: 'new_order', details: `🍽️ NUEVO PEDIDO\nCliente: ${ctx.customerName}\nTel: ${ctx.customerPhone}\nPedido: ${ctx.content.slice(0, 200)}` });
  }
  return { acted: false };
}

// ═══ HOTEL: Check-in, amenidades, upgrade, late checkout ═══
async function hotelActions(ctx: IndustryContext): Promise<{ acted: boolean; message?: string }> {
  const lower = ctx.content.toLowerCase();
  if (lower.includes('check-in') || lower.includes('check in') || lower.includes('llegada')) {
    return { acted: true, message: '🏨 Check-in:\n\n🕐 Hora: 3:00 PM\n📋 Requisitos: Identificación oficial + tarjeta de crédito para garantía\n\nSi necesita early check-in, podemos verificar disponibilidad. ¿A qué hora llegaría?' };
  }
  if (lower.includes('late checkout') || lower.includes('salida tarde')) {
    return { acted: true, message: '🏨 Late checkout: Sujeto a disponibilidad. Podemos extender hasta las 2:00 PM sin cargo adicional (según disponibilidad). ¿Le confirmo con recepción?' };
  }
  if (lower.includes('alberca') || lower.includes('piscina') || lower.includes('gym') || lower.includes('spa')) {
    return { acted: true, message: '🏊 Amenidades disponibles para huéspedes:\n\n• Alberca: 7:00 AM - 10:00 PM\n• Gimnasio: 6:00 AM - 11:00 PM\n• Spa: Con cita previa\n\n¿Le gustaría reservar algún servicio de spa?' };
  }
  return { acted: false };
}

// ═══ REAL ESTATE: BANT qualification, visitas, crédito ═══
async function realEstateActions(ctx: IndustryContext): Promise<{ acted: boolean; message?: string }> {
  const lower = ctx.content.toLowerCase();
  if (lower.includes('credito') || lower.includes('crédito') || lower.includes('infonavit') || lower.includes('hipoteca')) {
    await supabaseAdmin.from('leads').upsert({
      tenant_id: ctx.tenantId, contact_id: ctx.contactId, conversation_id: ctx.conversationId,
      customer_phone: ctx.customerPhone, customer_name: ctx.customerName,
      credit_type: lower.includes('infonavit') ? 'infonavit' : lower.includes('bancario') ? 'bancario' : 'consulta',
      status: 'contacted', temperature: 'warm',
    }, { onConflict: 'tenant_id,contact_id' });

    return { acted: true, message: '🏠 Con gusto le ayudo con información de crédito.\n\n¿Podría indicarme:\n1. ¿Tipo de crédito? (Infonavit, bancario, contado)\n2. ¿Presupuesto aproximado?\n3. ¿Zona de interés?\n\nEsto me ayuda a encontrar las mejores opciones para usted.' };
  }
  if (lower.includes('visita') || lower.includes('ver') || lower.includes('conocer')) {
    await notifyOwner({ tenantId: ctx.tenantId, event: 'lead_hot', details: `🏠 LEAD CALIENTE\n${ctx.customerName} quiere visitar propiedad\nTel: ${ctx.customerPhone}\n${ctx.content.slice(0, 100)}` });
    return { acted: true, message: '🏠 ¡Excelente! Me encantaría agendar una visita. ¿Qué día y horario le funciona mejor? Nuestras visitas son de lunes a sábado de 9:00 a 18:00.' };
  }
  return { acted: false };
}

// ═══ SALON/BARBERSHOP: Estilista específico, productos ═══
async function salonActions(ctx: IndustryContext): Promise<{ acted: boolean; message?: string }> {
  const lower = ctx.content.toLowerCase();
  if (lower.includes('color') || lower.includes('tinte') || lower.includes('mechas') || lower.includes('balayage')) {
    return { acted: true, message: '💇‍♀️ Para servicios de color, le recomendamos una valoración previa (sin costo) para determinar el mejor tratamiento para su cabello. ¿Le agendo una valoración?' };
  }
  if (lower.includes('producto') || lower.includes('shampoo') || lower.includes('tratamiento capilar')) {
    return { acted: true, message: '✨ Tenemos productos profesionales disponibles para venta. Puede adquirirlos en su próxima visita o preguntar por envío a domicilio. ¿Qué tipo de producto busca?' };
  }
  return { acted: false };
}

// ═══ SPA: Paquetes, parejas, gift cards ═══
async function spaActions(ctx: IndustryContext): Promise<{ acted: boolean; message?: string }> {
  const lower = ctx.content.toLowerCase();
  if (lower.includes('pareja') || lower.includes('duo') || lower.includes('aniversario')) {
    return { acted: true, message: '💑 ¡Tenemos paquetes especiales para parejas!\n\nIncluyen masaje relajante + facial + acceso a área húmeda. ¿Le gustaría conocer los paquetes disponibles y sus precios?' };
  }
  if (lower.includes('regalo') || lower.includes('gift') || lower.includes('tarjeta de regalo')) {
    return { acted: true, message: '🎁 ¡Excelente idea! Ofrecemos tarjetas de regalo personalizadas desde $500 MXN. ¿Para qué monto le gustaría y a nombre de quién?' };
  }
  return { acted: false };
}

// ═══ PSYCHOLOGIST: Sesiones, confidencialidad, primera vez ═══
async function psychologistActions(ctx: IndustryContext): Promise<{ acted: boolean; message?: string }> {
  const lower = ctx.content.toLowerCase();
  if (lower.includes('primera vez') || lower.includes('primera sesion') || lower.includes('primera sesión') || lower.includes('nunca he ido')) {
    return { acted: true, message: '🧠 Es completamente normal sentir inquietud antes de la primera sesión. Le cuento cómo funciona:\n\n1. La sesión dura 50 minutos\n2. Es totalmente confidencial\n3. Usted habla de lo que necesite\n4. No hay juicio, solo escucha profesional\n\n¿Le gustaría agendar su primera sesión?' };
  }
  if (lower.includes('online') || lower.includes('en línea') || lower.includes('virtual') || lower.includes('videollamada')) {
    return { acted: true, message: '💻 Sí, ofrecemos sesiones en línea por videollamada. Funcionan igual que presenciales, con la misma confidencialidad. ¿Preferiría agendar presencial o en línea?' };
  }
  return { acted: false };
}

// ═══ VETERINARY: Urgencias, vacunas, cachorro ═══
async function veterinaryActions(ctx: IndustryContext): Promise<{ acted: boolean; message?: string }> {
  const lower = ctx.content.toLowerCase();
  const urgencyWords = ['envenen', 'atropell', 'convulsion', 'no respira', 'sangr', 'vomit', 'intoxic'];
  if (urgencyWords.some(w => lower.includes(w))) {
    await notifyOwner({ tenantId: ctx.tenantId, event: 'emergency', details: `🐾 URGENCIA VETERINARIA\nDueño: ${ctx.customerName}\n${ctx.content.slice(0, 150)}` });
    return { acted: true, message: '🐾 ¡URGENCIA! Traiga a su mascota INMEDIATAMENTE. Mientras llega:\n\n• NO le dé medicamentos humanos\n• Manténgalo abrigado y tranquilo\n• Si fue envenenamiento, NO induzca vómito\n\nEstamos listos para recibirlo. ¡Venga ya!' };
  }
  if (lower.includes('vacuna') || lower.includes('cachorro') || lower.includes('gatito') || lower.includes('desparasit')) {
    return { acted: true, message: '💉 Esquema de vacunación:\n\n🐶 Cachorros: Primera vacuna a las 6-8 semanas\n🐱 Gatitos: Primera vacuna a las 8 semanas\n\n¿Qué edad tiene su mascota? Le indico qué vacunas necesita y agendamos.' };
  }
  return { acted: false };
}

// ═══ GYM: Membresías, clases, trial ═══
async function gymActions(ctx: IndustryContext): Promise<{ acted: boolean; message?: string }> {
  const lower = ctx.content.toLowerCase();
  if (lower.includes('prueba') || lower.includes('trial') || lower.includes('probar') || lower.includes('conocer')) {
    return { acted: true, message: '💪 ¡Claro! Ofrecemos un día de prueba GRATIS para que conozca nuestras instalaciones. Solo necesita:\n\n• Identificación oficial\n• Ropa deportiva\n• Toalla\n\n¿Qué día le gustaría venir?' };
  }
  if (lower.includes('clase') || lower.includes('horario de clase') || lower.includes('zumba') || lower.includes('yoga') || lower.includes('spinning')) {
    return { acted: true, message: '🗓️ Nuestras clases grupales están incluidas en todas las membresías. ¿Qué tipo de clase le interesa? Le comparto el horario de esa disciplina.' };
  }
  return { acted: false };
}

// ═══ PHARMACY: Disponibilidad, envío, receta ═══
async function pharmacyActions(ctx: IndustryContext): Promise<{ acted: boolean; message?: string }> {
  const lower = ctx.content.toLowerCase();
  if (lower.includes('receta') || lower.includes('controlado') || lower.includes('antibiotico') || lower.includes('antibiótico')) {
    return { acted: true, message: '💊 Los medicamentos controlados y antibióticos requieren receta médica vigente. Puede traerla a la farmacia o enviar foto de la receta por este chat para verificar disponibilidad. ¿Tiene receta?' };
  }
  if (lower.includes('envío') || lower.includes('envio') || lower.includes('domicilio') || lower.includes('entreg')) {
    return { acted: true, message: '🛵 Sí, hacemos envío a domicilio.\n\n• Pedido mínimo: $200 MXN\n• Envío gratis en compras mayores a $500\n• Tiempo estimado: 30-60 minutos\n\n¿Qué productos necesita?' };
  }
  return { acted: false };
}

// ═══ NUTRITIONIST: Consultas, planes, online ═══
async function nutritionistActions(ctx: IndustryContext): Promise<{ acted: boolean; message?: string }> {
  const lower = ctx.content.toLowerCase();
  if (lower.includes('plan alimenticio') || lower.includes('dieta') || lower.includes('plan de alimenta')) {
    return { acted: true, message: '🥗 Los planes alimenticios son personalizados según sus objetivos, estado de salud y estilo de vida. En la primera consulta:\n\n• Evaluación nutricional completa\n• Mediciones (peso, talla, % grasa)\n• Plan personalizado a 4 semanas\n\n¿Le agendo su primera consulta?' };
  }
  return { acted: false };
}

// ═══ SCHOOL: Inscripciones, becas, horarios ═══
async function schoolActions(ctx: IndustryContext): Promise<{ acted: boolean; message?: string }> {
  const lower = ctx.content.toLowerCase();
  if (lower.includes('inscripcion') || lower.includes('inscripción') || lower.includes('requisitos')) {
    return { acted: true, message: '📚 Documentos para inscripción:\n\n• Acta de nacimiento\n• CURP\n• Boleta del ciclo anterior\n• 2 fotografías tamaño infantil\n• Comprobante de domicilio\n\n¿Para qué nivel sería la inscripción?' };
  }
  if (lower.includes('beca') || lower.includes('descuento') || lower.includes('apoyo')) {
    return { acted: true, message: '🎓 Contamos con programa de becas. El proceso incluye:\n\n1. Solicitud formal\n2. Estudio socioeconómico\n3. Evaluación académica\n\n¿Le gustaría iniciar el proceso? Le agendo una cita con el departamento de becas.' };
  }
  return { acted: false };
}

// ═══ INSURANCE: Cotizaciones, siniestros, pólizas ═══
async function insuranceActions(ctx: IndustryContext): Promise<{ acted: boolean; message?: string }> {
  const lower = ctx.content.toLowerCase();
  if (lower.includes('siniestro') || lower.includes('choque') || lower.includes('accidente') || lower.includes('robo')) {
    await notifyOwner({ tenantId: ctx.tenantId, event: 'emergency', details: `🛡️ REPORTE DE SINIESTRO\nCliente: ${ctx.customerName}\n${ctx.content.slice(0, 150)}` });
    await supabaseAdmin.from('conversations').update({ status: 'human_handoff', tags: ['siniestro', 'urgent'] }).eq('id', ctx.conversationId);
    return { acted: true, message: '🛡️ Lamento mucho lo sucedido. He notificado a nuestro equipo de siniestros.\n\nMientras tanto:\n1. Asegúrese de estar a salvo\n2. Tome fotos del incidente\n3. NO mueva el vehículo (si es accidente vial)\n4. Anote datos del otro involucrado\n\nUn asesor le contactará en los próximos minutos.' };
  }
  if (lower.includes('cotiza') || lower.includes('cuánto cuesta') || lower.includes('precio seguro')) {
    await supabaseAdmin.from('leads').upsert({
      tenant_id: ctx.tenantId, contact_id: ctx.contactId, customer_phone: ctx.customerPhone,
      customer_name: ctx.customerName, status: 'new', temperature: 'warm',
    }, { onConflict: 'tenant_id,contact_id' });
    return { acted: true, message: '📊 Con gusto le cotizo. Necesito algunos datos:\n\n1. ¿Qué tipo de seguro? (Auto, vida, gastos médicos, hogar)\n2. ¿Para quién? (Individual, familiar)\n3. ¿Cobertura deseada?\n\nCon esta info le preparo las mejores opciones.' };
  }
  return { acted: false };
}

// ═══ MECHANIC: Diagnóstico, cotización, cita ═══
async function mechanicActions(ctx: IndustryContext): Promise<{ acted: boolean; message?: string }> {
  const lower = ctx.content.toLowerCase();
  if (lower.includes('ruido') || lower.includes('falla') || lower.includes('prende') || lower.includes('freno') || lower.includes('aceite')) {
    return { acted: true, message: '🔧 Para darle un diagnóstico preciso necesitamos revisar su vehículo en persona. Le recomiendo:\n\n1. Agende una cita de diagnóstico\n2. Traiga su vehículo en horario de atención\n3. Describa cuándo empezó el problema\n\n⚠️ Si el vehículo no enciende o hay humo, NO lo maneje — solicite grúa.\n\n¿Le agendo para diagnóstico?' };
  }
  return { acted: false };
}
