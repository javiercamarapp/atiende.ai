// POST /api/onboarding/upload
// Accepts a PDF or image file during the onboarding conversation and
// extracts structured content (e.g. a menu, price list, service catalog)
// using a multimodal LLM. Returns a plain-text payload that the
// OnboardingChat component treats as if the user had typed it.
//
// Why this exists: users don't want to paste their whole menu into a
// chat box. They want to drop a PDF and have the AI "read" it.

import { NextRequest, NextResponse } from 'next/server';
import { openrouter, MODELS } from '@/lib/llm/openrouter';
import { logger } from '@/lib/logger';
import {
  ensureTenant,
  getAuthUserId,
  saveKnowledgeChunk,
} from '@/lib/onboarding/persistence';

// Max 10 MB per file — prevents abuse + keeps LLM context sane.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

const EXTRACTION_PROMPT = `Eres el asistente de onboarding de atiende.ai.
El usuario subio un documento (PDF o imagen) relacionado con la pregunta que le esta haciendo el bot: "{question}".

Extrae TODO el contenido relevante del documento en texto plano estructurado:
- Si es un menu o lista de precios: lista cada item con su precio exacto en MXN, uno por linea (ej. "Taco al pastor — $25").
- Si es un catalogo de servicios: lista cada servicio con duracion y precio.
- Si es un horario: devuelve los dias y horas en texto claro.
- Si es cualquier otro documento: resume los datos concretos en bullets.

Reglas:
- NUNCA inventes precios, horarios o productos que no esten en el documento.
- Si el documento no tiene datos utiles para la pregunta, responde exactamente: "NO_DATA".
- Usa espanol de Mexico. Maximo 600 palabras.
- No agregues introducciones ni despedidas. Solo los datos.`;

type MultimodalContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthUserId();
    if (!userId) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const question = (formData.get('question') as string | null) ?? 'informacion del negocio';

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No se recibio archivo' }, { status: 400 });
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `Archivo demasiado grande (max ${MAX_FILE_BYTES / (1024 * 1024)}MB)` },
        { status: 413 },
      );
    }

    const mime = file.type || 'application/octet-stream';
    if (!ALLOWED_MIME.has(mime)) {
      return NextResponse.json(
        { error: 'Tipo de archivo no soportado. Solo PDF, PNG, JPG o WEBP.' },
        { status: 415 },
      );
    }

    // Encode file as base64 data URL for multimodal input
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mime};base64,${base64}`;

    // Build multimodal content: PDF uses the "file" content type,
    // images use "image_url". Gemini 2.5 Flash supports both via OpenRouter.
    const userContent: MultimodalContent[] = [
      { type: 'text', text: `Extrae el contenido relevante para: "${question}"` },
    ];

    if (mime === 'application/pdf') {
      userContent.push({
        type: 'file',
        file: {
          filename: file.name || 'document.pdf',
          file_data: dataUrl,
        },
      });
    } else {
      userContent.push({
        type: 'image_url',
        image_url: { url: dataUrl },
      });
    }

    const response = await openrouter.chat.completions.create({
      model: MODELS.BALANCED, // Gemini 2.5 Flash — native PDF + vision support
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT.replace('{question}', question) },
        // OpenRouter SDK types don't know about the `file` content type yet,
        // but the API accepts it. Narrow cast is intentional.
        { role: 'user', content: userContent as unknown as string },
      ],
      max_tokens: 1500,
      temperature: 0.1,
    });

    const extracted = response.choices[0]?.message?.content?.trim() || '';

    if (!extracted || extracted === 'NO_DATA') {
      return NextResponse.json({
        success: false,
        error: 'No pude leer datos utiles del archivo. ¿Puedes escribir la respuesta directamente?',
      });
    }

    logger.info('Onboarding upload processed', {
      filename: file.name,
      mime,
      sizeBytes: file.size,
      extractedChars: extracted.length,
    });

    // Persist the extracted content as a knowledge chunk under the user's
    // tenant. This is immediately searchable by RAG later and doesn't wait
    // for the final /generate step. Failures are logged but don't block.
    try {
      const tenantId = await ensureTenant(userId);
      await saveKnowledgeChunk(tenantId, extracted, 'onboarding_upload', file.name);
    } catch (persistErr) {
      logger.error(
        'Onboarding upload persistence failed',
        persistErr instanceof Error ? persistErr : new Error(String(persistErr)),
      );
    }

    return NextResponse.json({
      success: true,
      extractedText: extracted,
      filename: file.name,
    });
  } catch (err) {
    logger.error(
      'Onboarding upload failed',
      err instanceof Error ? err : new Error(String(err)),
    );
    return NextResponse.json(
      { error: 'No pude procesar el archivo. Intenta de nuevo o escribe la respuesta.' },
      { status: 500 },
    );
  }
}
