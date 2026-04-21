import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { logger } from '@/lib/logger';
import { searchKnowledgeChunks } from '@/lib/rag/search';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';
import { ZONES, type ZoneId } from '@/lib/knowledge/zone-map';

// LLM call + vector search. 30s covers worst case; typical <2s.
export const maxDuration = 30;

const BodySchema = z.object({
  message: z.string().min(1).max(500),
});

// Legacy category → zone fallback, used when a chunk predates the
// metadata column. Keeps chips accurate for chunks ingested via the old
// `ingestKnowledgeBatch` path.
const CATEGORY_TO_ZONE: Record<string, ZoneId> = {
  horario: 'schedule',
  servicios: 'services',
  precios: 'services',
  menu: 'services',
  staff: 'team',
  ubicacion: 'location',
  pagos: 'payments',
  politicas: 'policies',
  especial: 'special',
  faq: 'experience',
  marca: 'brand',
  logistica: 'logistics',
};

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Daily-ish budget: 50/day/tenant ≈ 50/24h window. Kept per-minute at
    // 10 to still allow a burst of testing.
    if (await checkApiRateLimit(`${user.id}:kb_preview_minute`, 10, 60)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
    if (await checkApiRateLimit(`${user.id}:kb_preview_day`, 50, 86400)) {
      return NextResponse.json({ error: 'Daily preview limit reached' }, { status: 429 });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid body', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { message } = parsed.data;

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, name, business_type, bot_name, chat_system_prompt')
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

    const log = logger.child({ route: 'kb_preview_chat', tenant_id: tenant.id });

    // 1. Pull top chunks with metadata — used for both context and chips
    const chunks = await searchKnowledgeChunks(tenant.id, message, 5);

    const context = chunks.length
      ? chunks.map((c) => `[${c.category ?? 'info'}] ${c.content}`).join('\n---\n')
      : 'No hay información específica disponible para esta consulta.';

    const systemPrompt = tenant.chat_system_prompt ||
      `Eres el asistente virtual de ${tenant.name}. Responde en español mexicano, directo y cordial. Usa "usted". Máximo 3-4 oraciones.`;

    // 2. Generate reply grounded in the chunks
    let reply = '';
    try {
      const completion = await generateResponse({
        model: MODELS.STANDARD,
        system: `${systemPrompt}\n\nINFORMACIÓN VERIFICADA DEL NEGOCIO (úsala como única fuente de verdad):\n${context}\n\nSi la pregunta pide información que NO está arriba, di "Permítame verificar esa información y le confirmo enseguida".`,
        messages: [{ role: 'user', content: message }],
        maxTokens: 300,
        temperature: 0.4,
      });
      reply = completion.text;
    } catch (err) {
      log.error('LLM call failed', err instanceof Error ? err : new Error(String(err)));
      reply = 'Permítame verificar esa información y le confirmo enseguida.';
    }

    // 3. Map chunks back to zones (dedupe by zoneId, preserve top-match order)
    const sources: Array<{ zoneId: ZoneId; zoneTitle: string; zoneIcon: string; questionKey?: string }> = [];
    const seen = new Set<ZoneId>();
    for (const chunk of chunks) {
      const fromMeta = (chunk.metadata?.zone as ZoneId | undefined);
      const fromCategory = chunk.category ? CATEGORY_TO_ZONE[chunk.category] : undefined;
      const zoneId = fromMeta ?? fromCategory;
      if (!zoneId || seen.has(zoneId)) continue;
      const zone = ZONES.find((z) => z.id === zoneId);
      if (!zone) continue;
      seen.add(zoneId);
      sources.push({
        zoneId,
        zoneTitle: zone.title,
        zoneIcon: zone.icon,
        questionKey: typeof chunk.metadata?.question_key === 'string'
          ? chunk.metadata.question_key
          : undefined,
      });
    }

    return NextResponse.json({
      reply,
      sources,
      botName: tenant.bot_name || 'Asistente',
      businessName: tenant.name,
    });
  } catch (err) {
    logger.error('[kb/preview-chat] unhandled', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
