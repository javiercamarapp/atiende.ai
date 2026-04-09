// Upload extraction for onboarding.
// Users paste menus, price lists, cedulas, logos, business docs — as images
// (PNG/JPG/WebP) or as PDFs. We run each through a dedicated extractor and
// hand the resulting markdown to the conversational agent so it can fill in
// schema fields without asking the user to retype anything.
//
// Images: sent inline (base64 data URL) to Gemini 2.5 Flash (multimodal).
// PDFs:   text extracted server-side with `unpdf` (zero runtime deps, works
//         in Node serverless), then fed to Gemini as a plain-text prompt
//         using the same extraction system prompt as images. Scanned /
//         image-only PDFs won't yield text; the user gets an error and is
//         asked to either retype or upload as an image.

import { getOpenRouter, MODELS, calculateCost } from '@/lib/llm/openrouter';

export type UploadKind = 'image' | 'pdf';

export interface ExtractedUpload {
  filename: string;
  kind: UploadKind;
  mimeType: string;
  markdown: string;
  sizeBytes: number;
  cost: number;
  tokensIn: number;
  tokensOut: number;
}

export const ACCEPTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
] as const;

export const ACCEPTED_PDF_TYPES = ['application/pdf'] as const;

export const ACCEPTED_UPLOAD_TYPES = [
  ...ACCEPTED_IMAGE_TYPES,
  ...ACCEPTED_PDF_TYPES,
] as const;

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB — under Vercel hobby body cap.

export class UploadError extends Error {
  constructor(
    public readonly code:
      | 'UNSUPPORTED_TYPE'
      | 'TOO_LARGE'
      | 'EMPTY'
      | 'EXTRACTION_FAILED'
      | 'PDF_NO_TEXT',
    message: string,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

const EXTRACTION_SYSTEM_PROMPT = `Eres un extractor de información de negocios. Recibes una imagen que subió el dueño de un negocio (típicamente un menú, lista de precios, cédula profesional, foto del local, logo, carta, o cualquier documento relevante).

Tu trabajo: extraer TODA la información útil en español y devolverla en markdown limpio y estructurado. Incluye:
- Nombre del negocio / titular
- Precios (platillos, servicios, tratamientos — con moneda si se ve)
- Horarios, direcciones, teléfonos, redes sociales
- Especialidades, títulos profesionales, cédulas, universidades
- Métodos de pago, promociones, políticas visibles
- Cualquier otro texto legible que sea útil para configurar un chatbot de atención al cliente

Reglas:
1. NO inventes datos. Si algo no se lee bien, dilo ("texto ilegible") o omítelo.
2. Usa headings y listas markdown para que el contenido sea fácil de parsear.
3. Preserva precios exactos (no redondees).
4. Si la imagen no contiene texto legible útil (ej: foto del logo solo, paisaje), responde con una descripción breve de qué ves en la imagen.
5. Responde SOLO con el markdown extraído, sin preámbulo ni explicaciones.`;

/**
 * Validate an incoming upload before routing to an extractor.
 * Throws `UploadError` on any validation failure.
 */
export function validateUpload(file: {
  type: string;
  size: number;
}): void {
  if (!ACCEPTED_UPLOAD_TYPES.includes(file.type as typeof ACCEPTED_UPLOAD_TYPES[number])) {
    throw new UploadError(
      'UNSUPPORTED_TYPE',
      `Tipo no soportado: ${file.type}. Sube una imagen (PNG, JPG, WebP) o un PDF.`,
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError(
      'TOO_LARGE',
      `Archivo demasiado grande (${Math.round(file.size / 1024 / 1024)}MB). Máximo 4MB.`,
    );
  }
  if (file.size === 0) {
    throw new UploadError('EMPTY', 'Archivo vacío.');
  }
}

/** True iff the given MIME type is a PDF. */
export function isPdfMimeType(type: string): boolean {
  return ACCEPTED_PDF_TYPES.includes(type as typeof ACCEPTED_PDF_TYPES[number]);
}

/**
 * Extract business-relevant content from an image upload using Gemini 2.5 Flash.
 * Returns markdown suitable for injection into the chat agent's context.
 */
export async function extractFromImage(params: {
  filename: string;
  mimeType: string;
  base64: string;
  sizeBytes: number;
}): Promise<ExtractedUpload> {
  const { filename, mimeType, base64, sizeBytes } = params;

  try {
    const response = await getOpenRouter().chat.completions.create({
      model: MODELS.BALANCED, // google/gemini-2.5-flash — multimodal
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Extrae toda la información útil de esta imagen. Nombre del archivo: ${filename}`,
            },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
          ],
        },
      ],
      max_tokens: 1500,
      temperature: 0.1,
    });

    const markdown = response.choices[0]?.message?.content?.trim() || '';
    if (!markdown) {
      throw new UploadError(
        'EXTRACTION_FAILED',
        'El modelo no devolvió contenido extraído.',
      );
    }

    const tokensIn = response.usage?.prompt_tokens || 0;
    const tokensOut = response.usage?.completion_tokens || 0;

    return {
      filename,
      kind: 'image',
      mimeType,
      markdown,
      sizeBytes,
      tokensIn,
      tokensOut,
      cost: calculateCost(MODELS.BALANCED, tokensIn, tokensOut),
    };
  } catch (err) {
    if (err instanceof UploadError) throw err;
    throw new UploadError(
      'EXTRACTION_FAILED',
      `Falló la extracción: ${(err as Error).message}`,
    );
  }
}

/**
 * Extract raw text from a PDF buffer using `unpdf` and then run the same
 * Gemini extraction prompt over the plain text to get structured markdown.
 *
 * Text-based PDFs (most menus, price lists, brochures) work well.
 * Scanned/image-only PDFs produce no text and throw `PDF_NO_TEXT` — the
 * caller should then ask the user to upload as an image instead.
 */
export async function extractFromPdf(params: {
  filename: string;
  buffer: Uint8Array;
  sizeBytes: number;
}): Promise<ExtractedUpload> {
  const { filename, buffer, sizeBytes } = params;

  // Dynamic import — unpdf is ESM and we don't want it loading on every
  // cold start, only when an actual PDF arrives.
  let rawText: string;
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(buffer);
    // `mergePages: true` returns `text` as a single concatenated string
    // across all pages — simplest for the downstream prompt.
    const { text } = await extractText(doc, { mergePages: true });
    rawText = text ?? '';
  } catch (err) {
    throw new UploadError(
      'EXTRACTION_FAILED',
      `No pude leer el PDF: ${(err as Error).message}`,
    );
  }

  const trimmed = rawText.trim();
  if (trimmed.length < 20) {
    throw new UploadError(
      'PDF_NO_TEXT',
      'El PDF no contiene texto legible. ¿Es un PDF escaneado? Intenta subirlo como imagen (PNG/JPG).',
    );
  }

  // Truncate to bound token usage — realistic business docs rarely exceed this.
  const MAX_PDF_TEXT_CHARS = 30_000;
  const truncatedText =
    trimmed.length > MAX_PDF_TEXT_CHARS
      ? trimmed.slice(0, MAX_PDF_TEXT_CHARS) + '\n\n[…truncado…]'
      : trimmed;

  try {
    const response = await getOpenRouter().chat.completions.create({
      model: MODELS.BALANCED, // google/gemini-2.5-flash — solid at Spanish text processing
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Este es el texto extraído del PDF "${filename}". Organiza toda la información útil en markdown limpio siguiendo las reglas del sistema.\n\n--- TEXTO DEL PDF ---\n${truncatedText}\n--- FIN DEL TEXTO ---`,
        },
      ],
      max_tokens: 1500,
      temperature: 0.1,
    });

    const markdown = response.choices[0]?.message?.content?.trim() || '';
    if (!markdown) {
      throw new UploadError(
        'EXTRACTION_FAILED',
        'El modelo no devolvió contenido extraído del PDF.',
      );
    }

    const tokensIn = response.usage?.prompt_tokens || 0;
    const tokensOut = response.usage?.completion_tokens || 0;

    return {
      filename,
      kind: 'pdf',
      mimeType: 'application/pdf',
      markdown,
      sizeBytes,
      tokensIn,
      tokensOut,
      cost: calculateCost(MODELS.BALANCED, tokensIn, tokensOut),
    };
  } catch (err) {
    if (err instanceof UploadError) throw err;
    throw new UploadError(
      'EXTRACTION_FAILED',
      `Falló la extracción del PDF: ${(err as Error).message}`,
    );
  }
}
