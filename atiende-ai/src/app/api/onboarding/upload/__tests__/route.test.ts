import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExtractFromImage = vi.fn();

vi.mock('@/lib/onboarding/extract-upload', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/onboarding/extract-upload')
  >('@/lib/onboarding/extract-upload');
  return {
    ...actual,
    extractFromImage: (...args: unknown[]) => mockExtractFromImage(...args),
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
  });

  it('rejects unsupported MIME types with 400 and UNSUPPORTED_TYPE', async () => {
    const buf = new Uint8Array(100);
    const pdf = new File([buf], 'doc.pdf', { type: 'application/pdf' });
    const res = await POST(makeMultipartRequest(pdf));
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
