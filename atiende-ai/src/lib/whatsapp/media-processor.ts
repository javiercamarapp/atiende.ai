// ═════════════════════════════════════════════════════════════════════════════
// MEDIA PROCESSOR — multimedia inbound de WhatsApp (MISIÓN 2)
//
// Capacidades:
//   - Audio: Whisper large-v3-turbo vía OpenRouter
//   - Imagen: Gemini 2.0 Flash (vision)
//   - PDF nativo: pdf-parse (cero costo)
//   - PDF escaneado: Gemini 2.0 Flash fallback
//
// Rate limiting per-tenant para evitar abuso (Whisper cuesta ~$0.006/minuto).
//
// IMPORTANTE: todos los handlers descargan el binario de Meta usando el token
// del sistema. La descarga tiene timeout de 15s — si Meta se cuelga, fallamos
// rápido y dejamos que el bot responda algo razonable al paciente.
// ═════════════════════════════════════════════════════════════════════════════

import axios from 'axios';
import { Redis } from '@upstash/redis';
import { getOpenRouter, MODELS } from '@/lib/llm/openrouter';

const WA_API = 'https://graph.facebook.com/v21.0';
const DOWNLOAD_TIMEOUT_MS = 15_000;

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

// Whisper large-v3-turbo en OpenRouter — más rápido y barato que el modelo full
const WHISPER_MODEL = 'openai/whisper-large-v3-turbo';
// Gemini 2.0 Flash con visión (imágenes y PDFs escaneados)
const VISION_MODEL = 'google/gemini-2.0-flash-001';

// ─── Tipos ─────────────────────────────────────────────────────────────────

export interface MediaResult {
  ok: boolean;
  text?: string;
  mediaType: 'audio' | 'image' | 'document' | 'video';
  errorCode?:
    | 'RATE_LIMITED'
    | 'DOWNLOAD_FAILED'
    | 'TRANSCRIBE_FAILED'
    | 'VISION_FAILED'
    | 'PDF_PARSE_FAILED'
    | 'UNSUPPORTED';
  errorMessage?: string;
}

// ─── Rate limiting ─────────────────────────────────────────────────────────

const HOUR_S = 3600;
const LIMITS = {
  audio: 20,
  image: 30,
  document: 10,
  video: 5,
} as const;

export async function checkMediaRateLimit(
  tenantId: string,
  mediaType: keyof typeof LIMITS,
): Promise<{ allowed: boolean; remaining: number }> {
  const limit = LIMITS[mediaType] ?? 10;
  const redis = getRedis();
  if (!redis) return { allowed: true, remaining: limit }; // fail-open en CI/dev
  const hourKey = new Date().toISOString().slice(0, 13);
  const key = `rl:media:${mediaType}:${tenantId}:${hourKey}`;
  try {
    const current = await redis.incr(key);
    if (current === 1) await redis.expire(key, HOUR_S);
    return { allowed: current <= limit, remaining: Math.max(0, limit - current) };
  } catch {
    return { allowed: true, remaining: limit };
  }
}

// ─── Download desde Meta ───────────────────────────────────────────────────

interface MediaUrlResponse {
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
  id: string;
}

export async function downloadWhatsAppMedia(
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    // 1) Resolver URL temporal del binario
    const meta = await axios.get<MediaUrlResponse>(
      `${WA_API}/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${process.env.WA_SYSTEM_TOKEN}` },
        timeout: DOWNLOAD_TIMEOUT_MS,
      },
    );
    if (!meta.data?.url) return null;

    // 2) Descargar el binario (mismo bearer token)
    const bin = await axios.get<ArrayBuffer>(meta.data.url, {
      headers: { Authorization: `Bearer ${process.env.WA_SYSTEM_TOKEN}` },
      responseType: 'arraybuffer',
      timeout: DOWNLOAD_TIMEOUT_MS,
      maxContentLength: 25 * 1024 * 1024, // 25MB hard cap
    });

    return {
      buffer: Buffer.from(bin.data),
      mimeType: meta.data.mime_type || 'application/octet-stream',
    };
  } catch (err) {
    console.warn('[media] download failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── Audio: Whisper transcription ─────────────────────────────────────────

export async function transcribeAudio(
  mediaId: string,
  tenantId: string,
): Promise<MediaResult> {
  const rl = await checkMediaRateLimit(tenantId, 'audio');
  if (!rl.allowed) {
    return { ok: false, mediaType: 'audio', errorCode: 'RATE_LIMITED', errorMessage: 'Demasiadas notas de voz esta hora.' };
  }

  const dl = await downloadWhatsAppMedia(mediaId);
  if (!dl) return { ok: false, mediaType: 'audio', errorCode: 'DOWNLOAD_FAILED' };

  try {
    const base64 = dl.buffer.toString('base64');
    const dataUrl = `data:${dl.mimeType};base64,${base64}`;
    // OpenRouter expone Whisper vía chat.completions con un mensaje
    // multimodal de tipo "input_audio". Pedimos transcripción literal.
    const resp = await getOpenRouter().chat.completions.create({
      model: WHISPER_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Transcribe el audio en español. Devuelve solo el texto, sin descripciones.' },
            // OpenRouter SDK acepta una entrada `input_audio` o un data URL
            // dentro de un text-part. Mantenemos data URL para compatibilidad.
            { type: 'text', text: dataUrl } as { type: 'text'; text: string },
          ] as never,
        },
      ],
      max_tokens: 1000,
      temperature: 0,
    });
    const text = resp.choices[0]?.message?.content?.toString().trim() || '';
    if (!text) return { ok: false, mediaType: 'audio', errorCode: 'TRANSCRIBE_FAILED' };
    return { ok: true, mediaType: 'audio', text };
  } catch (err) {
    return {
      ok: false,
      mediaType: 'audio',
      errorCode: 'TRANSCRIBE_FAILED',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Image: Gemini Vision describe ─────────────────────────────────────────

export async function describeImage(
  mediaId: string,
  tenantId: string,
  caption?: string,
): Promise<MediaResult> {
  const rl = await checkMediaRateLimit(tenantId, 'image');
  if (!rl.allowed) {
    return { ok: false, mediaType: 'image', errorCode: 'RATE_LIMITED' };
  }

  const dl = await downloadWhatsAppMedia(mediaId);
  if (!dl) return { ok: false, mediaType: 'image', errorCode: 'DOWNLOAD_FAILED' };

  try {
    const base64 = dl.buffer.toString('base64');
    const dataUrl = `data:${dl.mimeType};base64,${base64}`;
    const userText = caption
      ? `El paciente envió esta imagen con el mensaje: "${caption}". Descríbela brevemente en español: qué muestra, si hay texto léelo, si parece un documento médico (receta, estudio, identificación) menciónalo.`
      : 'Describe la imagen brevemente en español: qué muestra, lee cualquier texto visible, y si parece un documento médico (receta, estudio, identificación) menciónalo.';

    const resp = await getOpenRouter().chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: dataUrl } },
          ] as never,
        },
      ],
      max_tokens: 400,
      temperature: 0.2,
    });
    const text = resp.choices[0]?.message?.content?.toString().trim() || '';
    if (!text) return { ok: false, mediaType: 'image', errorCode: 'VISION_FAILED' };
    return { ok: true, mediaType: 'image', text };
  } catch (err) {
    return {
      ok: false,
      mediaType: 'image',
      errorCode: 'VISION_FAILED',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── PDF: pdf-parse (cero costo) con fallback Gemini si <50 chars ────────

export async function extractPdfText(
  mediaId: string,
  tenantId: string,
  filename?: string,
): Promise<MediaResult> {
  const rl = await checkMediaRateLimit(tenantId, 'document');
  if (!rl.allowed) {
    return { ok: false, mediaType: 'document', errorCode: 'RATE_LIMITED' };
  }

  const dl = await downloadWhatsAppMedia(mediaId);
  if (!dl) return { ok: false, mediaType: 'document', errorCode: 'DOWNLOAD_FAILED' };

  // 1) Intento nativo con pdf-parse (dynamic import — solo lo cargamos si
  //    está instalado; si no, vamos directo al fallback Gemini).
  //
  // AUDIT-R6 ALTO: pdf-parse es SÍNCRONO y CPU-bound — un PDF denso de
  // ~200 páginas puede bloquear el event loop. Mitigaciones:
  //   (a) si el buffer es >5MB, saltamos pdf-parse directo a Gemini Vision
  //       (que procesa en su backend, no aquí);
  //   (b) envolvemos la llamada en Promise.race con timeout de 5s;
  //   (c) el handler downstream (processor.ts) ya tiene timeout global
  //       de EXTRACT_CONTENT_TIMEOUT_MS=25s como red de seguridad.
  const PDF_PARSE_MAX_BYTES = 5 * 1024 * 1024; // 5MB
  const PDF_PARSE_TIMEOUT_MS = 5_000;

  let nativeText = '';
  if (dl.buffer.length <= PDF_PARSE_MAX_BYTES) {
    try {
      // dynamic + tipado laxo — pdf-parse es opcional (no listamos como dep
      // dura para no inflar el bundle si el tenant no usa PDFs).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await (new Function('return import("pdf-parse")')() as Promise<unknown>).catch(() => null);
      const fn = mod?.default ?? mod;
      if (typeof fn === 'function') {
        const result = await Promise.race([
          fn(dl.buffer),
          new Promise<never>((_, rej) =>
            setTimeout(
              () => rej(new Error(`pdf-parse timeout after ${PDF_PARSE_TIMEOUT_MS}ms`)),
              PDF_PARSE_TIMEOUT_MS,
            ),
          ),
        ]);
        nativeText = ((result as { text?: string })?.text || '').trim();
      }
    } catch (err) {
      console.warn('[media] pdf-parse failed/timeout:', err instanceof Error ? err.message : err);
    }
  } else {
    console.warn(`[media] PDF too large for native parse (${dl.buffer.length} bytes) — skipping to Gemini Vision`);
  }

  // Si pdf-parse devolvió texto razonable, lo usamos.
  if (nativeText.length >= 50) {
    return {
      ok: true,
      mediaType: 'document',
      text: filename ? `[PDF "${filename}"]\n${nativeText.slice(0, 6000)}` : nativeText.slice(0, 6000),
    };
  }

  // 2) Fallback: PDF probablemente escaneado → Gemini Vision
  try {
    const base64 = dl.buffer.toString('base64');
    const dataUrl = `data:${dl.mimeType || 'application/pdf'};base64,${base64}`;
    const resp = await getOpenRouter().chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Extrae el texto del documento. Si parece una receta médica, estudio clínico o identificación, organiza la información (paciente, fecha, médico, medicamentos, dosis). Responde en español.${filename ? ` Nombre del archivo: ${filename}.` : ''}`,
            },
            { type: 'image_url', image_url: { url: dataUrl } },
          ] as never,
        },
      ],
      max_tokens: 800,
      temperature: 0.1,
    });
    const text = resp.choices[0]?.message?.content?.toString().trim() || '';
    if (!text) return { ok: false, mediaType: 'document', errorCode: 'PDF_PARSE_FAILED' };
    return { ok: true, mediaType: 'document', text: `[PDF escaneado]\n${text}` };
  } catch (err) {
    return {
      ok: false,
      mediaType: 'document',
      errorCode: 'PDF_PARSE_FAILED',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

// Export del MODELS por si los callers necesitan log/tracing del modelo usado
export { MODELS };
