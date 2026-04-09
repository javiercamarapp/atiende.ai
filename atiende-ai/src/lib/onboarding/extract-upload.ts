// Image-to-markdown extraction for onboarding uploads.
// Users paste menus, price lists, cedulas, logos, or photos of their business
// docs. We send the image inline to Gemini 2.5 Flash (multimodal) and get back
// clean markdown listing every business-relevant datum the model can read —
// which then feeds the conversational agent just like the Jina Reader scrape.

import { getOpenRouter, MODELS, calculateCost } from '@/lib/llm/openrouter';

export type UploadKind = 'image';

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

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB — under Vercel hobby body cap.

export class UploadError extends Error {
  constructor(
    public readonly code:
      | 'UNSUPPORTED_TYPE'
      | 'TOO_LARGE'
      | 'EMPTY'
      | 'EXTRACTION_FAILED',
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
 * Validate an incoming upload before calling the vision model.
 * Throws `UploadError` on any validation failure.
 */
export function validateUpload(file: {
  type: string;
  size: number;
}): void {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as typeof ACCEPTED_IMAGE_TYPES[number])) {
    throw new UploadError(
      'UNSUPPORTED_TYPE',
      `Tipo no soportado: ${file.type}. Sube una imagen PNG, JPG o WebP.`,
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
