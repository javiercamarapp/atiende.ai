// ═════════════════════════════════════════════════════════════════════════════
// POST /api/marketing/generate  { type, topic, tone }
// Genera 3 opciones de post (Instagram | Facebook | WhatsApp broadcast).
// Modelo: x-ai/grok-4.1-fast con JSON Schema enforced.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { generateStructured, MODELS } from '@/lib/llm/openrouter';
import { checkApiRateLimit } from '@/lib/api-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const Body = z.object({
  type: z.enum(['instagram', 'facebook', 'whatsapp_broadcast']),
  topic: z.string().min(3).max(300),
  tone: z.enum(['profesional', 'cercano', 'informativo', 'urgente']),
});

const PostSchema = z.object({
  text: z.string(),
  image_description: z.string(),
  best_time: z.string(),
});

const Output = z.object({
  posts: z.array(PostSchema).length(3),
});

const TYPE_LABEL: Record<string, string> = {
  instagram: 'Instagram feed',
  facebook: 'Facebook post',
  whatsapp_broadcast: 'WhatsApp broadcast',
};

const TONE_LABEL: Record<string, string> = {
  profesional: 'profesional y formal',
  cercano: 'cercano y humano',
  informativo: 'informativo y educativo',
  urgente: 'urgente con llamado a acción inmediato',
};

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (await checkApiRateLimit(`${user.id}:marketing_gen`, 10, 60)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, city, business_type, services')
    .eq('user_id', user.id)
    .single();
  if (!tenant) return NextResponse.json({ error: 'no_tenant' }, { status: 403 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: 'invalid_body', details: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  const system = `Eres experto en marketing digital para consultorios médicos y estéticos en México.

Generas contenido para ${TYPE_LABEL[body.type]} sobre "${body.topic}" con tono ${TONE_LABEL[body.tone]}.

Negocio: ${tenant.name} — ${tenant.business_type} en ${tenant.city || 'México'}.

REGULACIÓN MÉDICA (NOM-024-SSA3-2010 y NOM-039-SSA2-2014):
- Prohibido: promesas de cura ("te curo", "100% garantizado"), comparaciones con otros
  profesionales, afirmaciones que induzcan a autodiagnóstico o auto-medicación.
- Obligado: tono responsable; si es tratamiento médico mencionar "previa consulta".

FORMATO:
- Español mexicano natural (usar "tu", no "usted" salvo tono profesional).
- Emojis apropiados al canal (máx 3-4 por post).
- Hashtags relevantes al negocio y vertical (máx 5).
- Llamada a acción clara y concreta.
- Ajusta longitud al canal:
  * Instagram: 100-200 palabras, con line breaks.
  * Facebook: 80-150 palabras.
  * WhatsApp broadcast: 40-80 palabras, muy directo.

Genera 3 opciones DISTINTAS (no variaciones triviales — cambia ángulo/hook/estructura).

Para cada una:
  - text: el post listo para copiar.
  - image_description: descripción detallada (2-3 oraciones) para generar con DALL-E/Canva.
  - best_time: horario recomendado en zona horaria México (ej. "Martes 7pm" o "Lunes-Viernes 10am-12pm").`;

  const r = await generateStructured({
    model: MODELS.ORCHESTRATOR,
    system,
    messages: [{ role: 'user', content: `Genera los 3 posts para: ${body.topic}` }],
    schema: Output,
    jsonSchemaName: 'MarketingPosts',
    temperature: 0.8,
    maxTokens: 2000,
  });

  return NextResponse.json({ posts: r.data.posts });
}
