import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'crypto';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { logger } from '@/lib/logger';
import { generateStructured, MODELS } from '@/lib/llm/openrouter';
import { ZONES, zoneForQuestionKey } from '@/lib/knowledge/zone-map';

export const maxDuration = 30;

const BodySchema = z.object({
  questionKey: z.string().min(1).max(80),
  questionLabel: z.string().min(1).max(300),
  answer: z.string().min(1).max(2000),
});

// Shape the LLM must return. Kept tight so the UI can render without branches.
const InsightSchema = z.object({
  validation: z.string().min(1).max(280),     // "Tu precio está en línea con el promedio"
  benchmark: z.string().min(1).max(280),      // "Clínicas dentales en Mérida cobran entre…"
  nextAction: z.object({
    label: z.string().min(1).max(80),         // "Agregar doctores"
    zoneId: z.enum([
      'schedule', 'services', 'team', 'location', 'payments',
      'policies', 'special', 'experience', 'brand', 'logistics',
    ]).optional(),
  }).optional(),
});

type Insight = z.infer<typeof InsightSchema>;

const CACHE_TTL_DAYS = 7;

function makeCacheKey(businessType: string, questionKey: string, answer: string): string {
  const hash = createHash('sha256')
    .update(answer.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
  return `insight:v1:${businessType}:${questionKey}:${hash}`;
}

function fallbackInsight(questionKey: string): Insight {
  const zoneId = zoneForQuestionKey(questionKey);
  const zone = ZONES.find((z) => z.id === zoneId);
  return {
    validation: 'Gracias. El bot ya puede responder con este dato.',
    benchmark: 'Seguiremos enriqueciendo tu perfil con benchmarks del sector conforme respondas más preguntas.',
    nextAction: zone
      ? { label: `Completar ${zone.title.toLowerCase()}`, zoneId }
      : undefined,
  };
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (await checkApiRateLimit(`${user.id}:smart_insight`, 30, 60)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid body', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { questionKey, questionLabel, answer } = parsed.data;

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, name, business_type, city, sub_vertical')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const log = logger.child({ route: 'smart-insight', tenant_id: tenant.id, question_key: questionKey });
    const cacheKey = makeCacheKey(tenant.business_type, questionKey, answer);

    // 1. Cache lookup
    const { data: cached } = await supabaseAdmin
      .from('insight_cache')
      .select('payload, expires_at')
      .eq('cache_key', cacheKey)
      .maybeSingle();

    if (cached && new Date(cached.expires_at) > new Date()) {
      return NextResponse.json({
        insight: cached.payload as Insight,
        cached: true,
      });
    }

    // 2. LLM call
    const zoneId = zoneForQuestionKey(questionKey);
    const zone = ZONES.find((z) => z.id === zoneId);
    const subVertical = Array.isArray(tenant.sub_vertical) && tenant.sub_vertical.length > 0
      ? tenant.sub_vertical.join(', ')
      : 'no especificado';

    const system = `Eres un asesor de negocios para PyMEs mexicanas. Analizas una respuesta del dueño del negocio y devuelves un JSON breve con 3 campos:

1. validation: una frase corta (máx 2 oraciones) que valida o sugiere mejorar la respuesta comparándola con el sector. Español mexicano, tono cercano pero profesional.

2. benchmark: una frase con un dato concreto del sector (precio promedio, práctica común, política estándar). Si no conoces un dato específico, ofrece una guía útil.

3. nextAction (opcional): si detectas un siguiente paso natural, devuelve { label: "Verbo + sustantivo corto", zoneId: una de las 10 zonas }.

Las 10 zonas disponibles: schedule, services, team, location, payments, policies, special, experience, brand, logistics.

NO inventes precios exactos si no los conoces. NO des consejos fiscales/legales específicos. Nada de emojis. Máximo 280 caracteres por campo.`;

    const userMsg = `Negocio: ${tenant.name}
Tipo: ${tenant.business_type}
Sub-vertical: ${subVertical}
Ciudad: ${tenant.city ?? 'México'}
Zona actual del quiz: ${zone?.title ?? 'General'}
Pregunta: ${questionLabel}
Respuesta del dueño: ${answer}`;

    let insight: Insight;
    try {
      const result = await generateStructured({
        model: MODELS.STANDARD,
        fallbackModel: MODELS.BALANCED,
        system,
        messages: [{ role: 'user', content: userMsg }],
        schema: InsightSchema,
        jsonSchemaName: 'SmartInsight',
        maxTokens: 500,
        temperature: 0.4,
      });
      insight = result.data;
    } catch (err) {
      log.warn('LLM insight failed, using fallback', {
        error: err instanceof Error ? err.message : String(err),
      });
      insight = fallbackInsight(questionKey);
      // Not cached: retry freshly next time the user answers.
      return NextResponse.json({ insight, cached: false, degraded: true });
    }

    // 3. Cache upsert
    const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from('insight_cache')
      .upsert({
        cache_key: cacheKey,
        payload: insight,
        expires_at: expiresAt,
      }, { onConflict: 'cache_key' });

    return NextResponse.json({ insight, cached: false });
  } catch (err) {
    logger.error('[smart-insight] unhandled', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
