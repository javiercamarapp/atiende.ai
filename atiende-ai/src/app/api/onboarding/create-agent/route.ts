import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';
import { ingestKnowledgeBatchWithMetadata } from '@/lib/rag/search';
import { getChatTemplate } from '@/lib/templates/chat/index';
import { getVoiceTemplate } from '@/lib/templates/voice/index';
import { getQuestions } from '@/lib/onboarding/questions';
import { ZONES, zoneForQuestionKey } from '@/lib/knowledge/zone-map';

function answerToText(answer: unknown): string {
  if (answer === null || answer === undefined) return '';
  if (typeof answer === 'string') return answer.trim();
  if (typeof answer === 'number' || typeof answer === 'boolean') return String(answer);
  if (Array.isArray(answer)) return answer.map((a) => answerToText(a)).filter(Boolean).join(', ');
  if (typeof answer === 'object') {
    const obj = answer as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text.trim();
    if ('value' in obj) return answerToText(obj.value);
    return JSON.stringify(obj);
  }
  return '';
}

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
    // One chunk per answer, tagged with metadata.question_key so the
    // knowledge editor (POST /api/knowledge/save-answer) can DELETE+INSERT
    // a single answer without disturbing the rest. Plus one untagged
    // "profile" chunk for location/phone data coming from businessInfo.
    const questionLabelByKey = new Map<string, string>();
    for (const q of getQuestions(businessType)) {
      questionLabelByKey.set(q.key, q.label);
    }

    const chunks: { content: string; category: string; metadata: Record<string, unknown> }[] = [];

    for (const [key, rawValue] of Object.entries(answers as Record<string, unknown>)) {
      const text = answerToText(rawValue);
      if (!text) continue;
      const zoneId = zoneForQuestionKey(key);
      const zone = ZONES.find((z) => z.id === zoneId)!;
      const label = questionLabelByKey.get(key);
      const content = label ? `${label.toUpperCase()}: ${text}` : text;
      chunks.push({
        content,
        category: zone.category,
        metadata: {
          question_key: key,
          zone: zoneId,
          question_label: label ?? null,
        },
      });
    }

    // Location + hours composite — derived from businessInfo, not from a
    // quiz answer, so tagged with kind='profile' (no question_key) so
    // save-answer never tries to replace it.
    chunks.push({
      content: `UBICACION: ${businessInfo.address || 'No especificada'}, ${businessInfo.city || 'Merida'}.\nHORARIO: Lunes a Viernes 9:00-18:00, Sabado 9:00-14:00.\nTELEFONO: ${businessInfo.phone || 'No especificado'}.`,
      category: 'ubicacion',
      metadata: { kind: 'profile', zone: 'location' },
    });

    if (chunks.length > 0) {
      await ingestKnowledgeBatchWithMetadata(tenant.id, chunks, 'onboarding');
    }

    // 5. ACTUALIZAR TENANT CON PROMPT
    await supabaseAdmin.from('tenants').update({
      chat_system_prompt: promptResult.text,
      welcome_message: `Hola! Bienvenido(a) a ${businessInfo.name}. Soy su asistente virtual, disponible 24/7. En que le puedo ayudar?`,
    }).eq('id', tenant.id);

    // 5b. PROVISION RETELL VOICE AGENT (best-effort)
    if (tenant.has_voice_agent) {
      try {
        const { createRetellAgent } = await import('@/lib/voice/retell');
        const voicePrompt = getVoiceTemplate(businessType)
          .replace('{{NOMBRE_NEGOCIO}}', businessInfo.name);
        const agent = await createRetellAgent({
          name: businessInfo.name,
          voice_system_prompt: voicePrompt,
        });
        await supabaseAdmin.from('tenants').update({
          retell_agent_id: agent.agent_id,
          voice_system_prompt: voicePrompt,
        }).eq('id', tenant.id);
      } catch (voiceErr) {
        console.error('[create-agent] Retell provisioning failed:', voiceErr);
      }
    }

    // 6. GENERAR SYSTEM PROMPTS POR AGENTE (fire-and-forget)
    // Corre async para no bloquear el response al cliente. Los prompts
    // personalizados quedarán en tenant_prompts en ~30-60s. Mientras tanto
    // los agentes usan el prompt base de src/lib/agents/<agent>/prompt.ts.
    (async () => {
      try {
        const { generateAndSaveAllAgentPrompts } = await import(
          '@/lib/agents/internal/onboarding-prompt-generator'
        );

        // Parse business_hours de answers si está; si no, default 9-18 L-V, 9-14 sab
        const hoursFromAnswers = typeof answers.business_hours === 'object'
          ? (answers.business_hours as Record<string, { open: string; close: string }>)
          : {
              mon: { open: '09:00', close: '18:00' },
              tue: { open: '09:00', close: '18:00' },
              wed: { open: '09:00', close: '18:00' },
              thu: { open: '09:00', close: '18:00' },
              fri: { open: '09:00', close: '18:00' },
              sat: { open: '09:00', close: '14:00' },
            };

        // Parse services
        const services: Array<{ name: string; price: number; duration: number }> = [];
        if (typeof answers.services_prices === 'string') {
          for (const line of answers.services_prices.split('\n')) {
            const m = line.match(/(.+?)\s*[-:$]\s*\$?(\d+)/);
            if (m) services.push({ name: m[1].trim(), price: Number(m[2]), duration: 30 });
          }
        }

        // Tono desde answers
        const toneRaw = String(answers.tone || 'friendly').toLowerCase();
        const tone: 'formal' | 'casual' | 'friendly' =
          toneRaw === 'formal' ? 'formal' :
          toneRaw === 'casual' || toneRaw === 'cercano' ? 'casual' :
          'friendly';

        // FAQs relevantes
        const faqs: Record<string, string> = {};
        if (answers.cancellation) faqs['Política de cancelación'] = String(answers.cancellation);
        if (answers.payment_methods) faqs['Formas de pago'] = Array.isArray(answers.payment_methods)
          ? answers.payment_methods.join(', ')
          : String(answers.payment_methods);
        if (answers.insurances) faqs['Seguros aceptados'] = String(answers.insurances);
        if (answers.parking) faqs['Estacionamiento'] = String(answers.parking);
        if (answers.first_visit) faqs['Primera cita'] = String(answers.first_visit);

        await generateAndSaveAllAgentPrompts({
          tenantId: tenant.id,
          business_name: businessInfo.name,
          business_type: businessType,
          city: businessInfo.city || 'Merida',
          doctor_name: String(answers.doctor_name || answers.doctors || ''),
          services,
          business_hours: hoursFromAnswers,
          tone,
          faqs,
        });
      } catch (err) {
        console.error('[create-agent] generateAndSaveAllAgentPrompts background failed:', err);
      }
    })().catch(console.error);

    // 8. INSERTAR DASHBOARD CONFIG (si no existe)
    // Los dashboard configs se pre-insertan via SQL seed

    // 9. ENVIAR EMAIL DE BIENVENIDA
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
