import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExtractFromImage = vi.fn();
const mockExtractFromPdf = vi.fn();

vi.mock('@/lib/onboarding/extract-upload', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/onboarding/extract-upload')
  >('@/lib/onboarding/extract-upload');
  return {
    ...actual,
    extractFromImage: (...args: unknown[]) => mockExtractFromImage(...args),
    extractFromPdf: (...args: unknown[]) => mockExtractFromPdf(...args),
  };
});

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-test' } } }),
    },
  }),
}));

vi.mock('@/lib/api-rate-limit', () => ({
  checkApiRateLimit: vi.fn().mockResolvedValue(false),
}));

import { POST } from '../route';

function makeMultipartRequest(file: File): Request {
  const fd = new FormData();
  fd.append('file', file);
  return new Request('http://localhost/api/onboarding/upload', {
    method: 'POST',
    body: fd,
  });
}

function fakePng(sizeBytes: number, name = 'test.png'): File {
  const buf = new Uint8Array(sizeBytes);
  return new File([buf], name, { type: 'image/png' });
}

describe('POST /api/onboarding/upload', () => {
  beforeEach(() => {
    mockExtractFromImage.mockReset();
    mockExtractFromPdf.mockReset();
  });

  it('extracts markdown from a valid image and returns it', async () => {
    mockExtractFromImage.mockResolvedValueOnce({
      filename: 'menu.png',
      kind: 'image',
      mimeType: 'image/png',
      markdown: '# Menú\n- Tacos: $50',
      sizeBytes: 1024,
      cost: 0.0001,
      tokensIn: 500,
      tokensOut: 50,
    });

    const res = await POST(makeMultipartRequest(fakePng(1024, 'menu.png')));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.filename).toBe('menu.png');
    expect(json.kind).toBe('image');
    expect(json.markdown).toContain('Tacos: $50');
    expect(mockExtractFromImage).toHaveBeenCalledTimes(1);
    expect(mockExtractFromPdf).not.toHaveBeenCalled();
  });

  it('routes PDF uploads to extractFromPdf', async () => {
    mockExtractFromPdf.mockResolvedValueOnce({
      filename: 'menu.pdf',
      kind: 'pdf',
      mimeType: 'application/pdf',
      markdown: '# Menú extraído del PDF\n- Tacos: $50',
      sizeBytes: 2048,
      cost: 0.0002,
      tokensIn: 600,
      tokensOut: 80,
    });

    const buf = new Uint8Array(2048);
    const pdf = new File([buf], 'menu.pdf', { type: 'application/pdf' });
    const res = await POST(makeMultipartRequest(pdf));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.kind).toBe('pdf');
    expect(json.markdown).toContain('extraído del PDF');
    expect(mockExtractFromPdf).toHaveBeenCalledTimes(1);
    expect(mockExtractFromImage).not.toHaveBeenCalled();
  });

  it('returns 400 with PDF_NO_TEXT when the PDF is scanned/image-only', async () => {
    const { UploadError } = await import('@/lib/onboarding/extract-upload');
    mockExtractFromPdf.mockRejectedValueOnce(
      new UploadError('PDF_NO_TEXT', 'El PDF no contiene texto legible.'),
    );
    const buf = new Uint8Array(1024);
    const pdf = new File([buf], 'scanned.pdf', { type: 'application/pdf' });
    const res = await POST(makeMultipartRequest(pdf));
    expect(res.status).toBe(400); // user-fixable, not 500
    const json = await res.json();
    expect(json.error).toBe('PDF_NO_TEXT');
  });

  it('rejects unsupported MIME types with 400 and UNSUPPORTED_TYPE', async () => {
    const buf = new Uint8Array(100);
    // zip is neither image nor PDF — should be rejected.
    const zip = new File([buf], 'archive.zip', { type: 'application/zip' });
    const res = await POST(makeMultipartRequest(zip));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('UNSUPPORTED_TYPE');
  });

  // Note: TOO_LARGE and EMPTY edge cases are covered at the unit level in
  // extract-upload.test.ts's `validateUpload` suite. Exercising them through
  // a full HTTP round-trip here is brittle — undici's FormData serialization
  // mangles 0-byte and multi-megabyte parts in the vitest/jsdom environment.

  it('returns 400 when no file field present', async () => {
    const fd = new FormData();
    // intentionally no "file" field
    fd.append('other', 'thing');
    const req = new Request('http://localhost/api/onboarding/upload', {
      method: 'POST',
      body: fd,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Missing');
  });

  it('returns 500 when extraction fails', async () => {
    const { UploadError } = await import('@/lib/onboarding/extract-upload');
    mockExtractFromImage.mockRejectedValueOnce(
      new UploadError('EXTRACTION_FAILED', 'model timeout'),
    );
    const res = await POST(makeMultipartRequest(fakePng(1024)));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('EXTRACTION_FAILED');
  });
});
