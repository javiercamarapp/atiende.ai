import { NextResponse } from 'next/server';
import {
  extractFromImage,
  extractFromPdf,
  validateUpload,
  isPdfMimeType,
  UploadError,
  MAX_UPLOAD_BYTES,
  ACCEPTED_UPLOAD_TYPES,
} from '@/lib/onboarding/extract-upload';
import { logger } from '@/lib/logger';
import { createServerSupabase } from '@/lib/supabase/server';
import { checkApiRateLimit } from '@/lib/api-rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/onboarding/upload
 * Accepts a single multipart/form-data file under the `file` field, validates
 * type (PNG/JPG/WebP) and size (≤4MB), runs it through Gemini 2.5 Flash for
 * business-info extraction, and returns the extracted markdown the client
 * will forward to /api/onboarding/chat on the next turn.
 *
 * Does NOT persist the file — this is extract-and-discard. No Supabase Storage
 * bucket, no retention.
 */
export async function POST(request: Request) {
  // AUDIT R18: auth + rate limit defense in depth. Middleware redirects
  // non-auth requests a /login, pero un user autenticado sigue poder abusar
  // (Gemini costs $). 10 uploads/min por usuario basta para onboarding real.
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const limited = await checkApiRateLimit(`${user.id}:onboarding_upload`, 10, 60);
  if (limited) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Expected multipart/form-data body' },
      { status: 400 },
    );
  }

  // Duck-type: `formData.get()` can return string | File | null depending on
  // the runtime. We check for the File/Blob shape rather than `instanceof File`
  // because the vitest/jsdom test environment uses a different `File` class
  // than Node's native one, which would make `instanceof` flake.
  const rawFile = formData.get('file');
  if (
    !rawFile ||
    typeof rawFile === 'string' ||
    typeof (rawFile as Blob).arrayBuffer !== 'function'
  ) {
    return NextResponse.json(
      { error: 'Missing `file` field (expected File)' },
      { status: 400 },
    );
  }

  const file = rawFile as Blob & { name?: string };
  const filename = file.name || 'upload';

  // Validate upload (throws UploadError on failure)
  try {
    validateUpload({ type: file.type, size: file.size });
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 400 },
      );
    }
    throw err;
  }

  // Read file bytes
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Dispatch to the right extractor based on MIME type.
  try {
    const result = isPdfMimeType(file.type)
      ? await extractFromPdf({
          filename,
          buffer: new Uint8Array(arrayBuffer),
          sizeBytes: file.size,
        })
      : await extractFromImage({
          filename,
          mimeType: file.type,
          base64: buffer.toString('base64'),
          sizeBytes: file.size,
        });

    logger.info('onboarding_upload_extracted', {
      filename: result.filename,
      mimeType: result.mimeType,
      sizeBytes: result.sizeBytes,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      cost: result.cost,
      markdownLength: result.markdown.length,
    });

    return NextResponse.json({
      filename: result.filename,
      kind: result.kind,
      mimeType: result.mimeType,
      sizeBytes: result.sizeBytes,
      markdown: result.markdown,
    });
  } catch (err) {
    if (err instanceof UploadError) {
      logger.warn('onboarding_upload_extract_failed', {
        code: err.code,
        filename,
      });
      // PDF_NO_TEXT is a user-fixable error (retry as image), not 500.
      const status = err.code === 'PDF_NO_TEXT' ? 400 : 500;
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status },
      );
    }
    logger.error('onboarding_upload unexpected error', err as Error, { filename });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Expose constraints to the client (used by ChatInput for validation).
export async function GET() {
  return NextResponse.json({
    maxBytes: MAX_UPLOAD_BYTES,
    acceptedTypes: ACCEPTED_UPLOAD_TYPES,
  });
}
