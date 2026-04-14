import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';
import { ingestKnowledgeBatch } from '@/lib/rag/search';
import { createRetellAgent } from '@/lib/voice/retell';
import { getChatTemplate } from '@/lib/templates/chat/index';
import { getVoiceTemplate } from '@/lib/templates/voice/index';

// Heavy route: generates a system prompt, ingests knowledge chunks with
// OpenAI embeddings, and optionally provisions a Retell voice agent. Can
// exceed 60s on the first run. 180s fits within Vercel Pro's 300s cap.
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  try {
    // Validate auth — must have a valid session
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll() {
            // No-op for route handler reads
          },
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const { checkApiRateLimit } = await import('@/lib/api-rate-limit');
    if (await checkApiRateLimit(`${user.id}:create_agent`, 3, 60)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await req.json();
    const {
      businessType, agentType, businessInfo, answers,
      waConnected, waPhoneId
    } = body;

    // Use authenticated user ID, never trust client-provided userId
    const userId = user.id;

    // 1. CREAR TENANT
    const slug = businessInfo.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);

    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .insert({
        user_id: userId,
        name: businessInfo.name,
        slug: `${slug}-${Date.now().toString(36)}`,
        business_type: businessType,
        email: businessInfo.email,
        phone: businessInfo.phone,
        address: businessInfo.address,
        city: businessInfo.city || 'Merida',
        state: businessInfo.state || 'Yucatan',
        website: businessInfo.website,
        wa_phone_number_id: waConnected ? waPhoneId : null,
        has_chat_agent: agentType === 'chat' || agentType === 'both',
        has_voice_agent: agentType === 'voice' || agentType === 'both',
        status: 'active',
      })
      .select()
      .single();

    if (tenantError || !tenant) {
      return NextResponse.json(
        { success: false, error: 'Failed to create tenant' },
        { status: 500 }
      );
    }

    // 2. GUARDAR RESPUESTAS DE ONBOARDING
    const responseRows = Object.entries(answers).map(([key, value]) => ({
      tenant_id: tenant.id,
      step: 4,
      question_key: key,
      answer: typeof value === 'string' ? { text: value } : { value },
    }));
    await supabaseAdmin.from('onboarding_responses').insert(responseRows);

    // 3. GENERAR SYSTEM PROMPT CON LLM
    const chatTemplate = getChatTemplate(businessType);

    const promptResult = await generateResponse({
      model: MODELS.GENERATOR,
      system: `Genera un system prompt en espanol mexicano para un chatbot de WhatsApp.

USA ESTE TEMPLATE BASE (manten TODOS los guardrails intactos):
${chatTemplate}

DATOS DEL NEGOCIO:
Nombre: ${businessInfo.name}
Tipo: ${businessType}
Direccion: ${businessInfo.address || 'No especificada'}
Ciudad: ${businessInfo.city || 'Merida'}
Horario: Lunes a Viernes 9:00-18:00, Sabado 9:00-14:00

RESPUESTAS DEL ONBOARDING:
${JSON.stringify(answers, null, 2)}

REGLAS PARA EL PROMPT:
1. Inserta los precios EXACTOS del negocio
2. Inserta nombres de doctores/staff EXACTOS
3. Usa "usted" siempre
4. Espanol mexicano natural
5. Manten TODOS los guardrails del template
6. Maximo 3-4 oraciones por respuesta`,
      messages: [],
      maxTokens: 4000,
      temperature: 0.3,
    });

    // 4. CREAR KNOWLEDGE BASE (ANTI-ALUCINACION)
    const chunks: { content: string; category: string }[] = [];

    // Servicios y precios
    if (answers.services_prices) {
      chunks.push({
        content: `SERVICIOS Y PRECIOS de ${businessInfo.name}:\n${answers.services_prices}`,
        category: 'servicios',
      });
      // Cada servicio como chunk individual tambien
      const lines = String(answers.services_prices).split('\n');
      for (const line of lines) {
        if (line.trim()) {
          chunks.push({ content: line.trim(), category: 'precios' });
        }
      }
    }

    // Menu (restaurantes)
    if (answers.menu) {
      chunks.push({
        content: `MENU COMPLETO de ${businessInfo.name}:\n${answers.menu}`,
        category: 'menu',
      });
    }

    // Staff/Doctores
    if (answers.doctors || answers.stylists) {
      chunks.push({
        content: `EQUIPO de ${businessInfo.name}:\n${answers.doctors || answers.stylists}`,
        category: 'staff',
      });
    }

    // Horario y ubicacion
    chunks.push({
      content: `UBICACION: ${businessInfo.address || 'No especificada'}, ${businessInfo.city || 'Merida'}.\nHORARIO: Lunes a Viernes 9:00-18:00, Sabado 9:00-14:00.\nTELEFONO: ${businessInfo.phone || 'No especificado'}.\nESTACIONAMIENTO: ${answers.parking || 'No especificado'}.`,
      category: 'ubicacion',
    });

    // Formas de pago
    if (answers.payment_methods) {
      chunks.push({
        content: `FORMAS DE PAGO: ${Array.isArray(answers.payment_methods) ? answers.payment_methods.join(', ') : answers.payment_methods}`,
        category: 'faq',
      });
    }

    // Seguros
    if (answers.insurances) {
      chunks.push({
        content: `SEGUROS ACEPTADOS: ${answers.insurances}`,
        category: 'faq',
      });
    }

    // Politica cancelacion
    if (answers.cancellation) {
      chunks.push({
        content: `POLITICA DE CANCELACION: ${answers.cancellation}`,
        category: 'politicas',
      });
    }

    // Primera visita
    if (answers.first_visit) {
      chunks.push({
        content: `PRIMERA CITA - QUE TRAER: ${answers.first_visit}`,
        category: 'faq',
      });
    }

    // Delivery (restaurantes)
    if (answers.delivery !== undefined) {
      chunks.push({
        content: `DELIVERY: ${answers.delivery ? 'Si disponible' : 'No disponible'}. ${answers.delivery_detail || ''}`,
        category: 'faq',
      });
    }

    // Ingestar todos los chunks en pgvector
    if (chunks.length > 0) {
      await ingestKnowledgeBatch(tenant.id, chunks, 'onboarding');
    }

    // 5. ACTUALIZAR TENANT CON PROMPT
    await supabaseAdmin.from('tenants').update({
      chat_system_prompt: promptResult.text,
      welcome_message: `Hola! Bienvenido(a) a ${businessInfo.name}. Soy su asistente virtual, disponible 24/7. En que le puedo ayudar?`,
    }).eq('id', tenant.id);

    // 6. CREAR VOICE AGENT (si aplica)
    if (agentType === 'voice' || agentType === 'both') {
      const voiceTemplate = getVoiceTemplate(businessType);
      const voicePrompt = voiceTemplate
        .replace(/\{\{NOMBRE_NEGOCIO\}\}/g, businessInfo.name)
        .replace(/\{\{DIRECCION\}\}/g, businessInfo.address || '');

      const retellAgent = await createRetellAgent({
        name: businessInfo.name,
        voice_system_prompt: voicePrompt,
        elevenlabs_voice_id: undefined,
        config: { human_phone: businessInfo.phone },
      });

      await supabaseAdmin.from('tenants').update({
        voice_system_prompt: voicePrompt,
        retell_agent_id: retellAgent.agent_id,
      }).eq('id', tenant.id);
    }

    // 7. INSERTAR DASHBOARD CONFIG (si no existe)
    // Los dashboard configs se pre-insertan via SQL seed

    // 8. ENVIAR EMAIL DE BIENVENIDA
    try {
      const { sendEmail } = await import('@/lib/email/send');
      const { welcomeEmail } = await import('@/lib/email/templates');
      if (businessInfo.email) {
        const { subject, html } = welcomeEmail(businessInfo.name, businessInfo.ownerName || '');
        await sendEmail({ to: businessInfo.email, subject, html });
      }
    } catch (emailErr) {
      // Non-blocking — agent creation should succeed even if email fails
      console.error('Welcome email failed:', emailErr);
    }

    return NextResponse.json({ success: true, tenantId: tenant.id });

  } catch (error: unknown) {
    console.error('Error creando agente:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
