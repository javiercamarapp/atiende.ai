import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();

vi.mock('@/lib/llm/openrouter', async () => {
  const actual = await vi.importActual<typeof import('@/lib/llm/openrouter')>(
    '@/lib/llm/openrouter',
  );
  return {
    ...actual,
    getOpenRouter: () => ({
      chat: {
        completions: {
          create: (...args: unknown[]) => mockCreate(...args),
        },
      },
    }),
  };
});

import {
  validateUpload,
  extractFromImage,
  UploadError,
  MAX_UPLOAD_BYTES,
  ACCEPTED_IMAGE_TYPES,
} from '../extract-upload';

describe('validateUpload', () => {
  it('accepts PNG under the size limit', () => {
    expect(() => validateUpload({ type: 'image/png', size: 500_000 })).not.toThrow();
  });

  it('accepts JPEG', () => {
    expect(() => validateUpload({ type: 'image/jpeg', size: 1_000_000 })).not.toThrow();
  });

  it('accepts WebP', () => {
    expect(() => validateUpload({ type: 'image/webp', size: 500_000 })).not.toThrow();
  });

  it('rejects PDF as UNSUPPORTED_TYPE', () => {
    expect(() =>
      validateUpload({ type: 'application/pdf', size: 100_000 }),
    ).toThrow(UploadError);
    try {
      validateUpload({ type: 'application/pdf', size: 100_000 });
    } catch (err) {
      expect((err as UploadError).code).toBe('UNSUPPORTED_TYPE');
    }
  });

  it('rejects files over the size cap', () => {
    expect(() =>
      validateUpload({ type: 'image/png', size: MAX_UPLOAD_BYTES + 1 }),
    ).toThrow();
    try {
      validateUpload({ type: 'image/png', size: MAX_UPLOAD_BYTES + 1 });
    } catch (err) {
      expect((err as UploadError).code).toBe('TOO_LARGE');
    }
  });

  it('rejects empty files', () => {
    expect(() => validateUpload({ type: 'image/png', size: 0 })).toThrow();
    try {
      validateUpload({ type: 'image/png', size: 0 });
    } catch (err) {
      expect((err as UploadError).code).toBe('EMPTY');
    }
  });

  it('exposes ACCEPTED_IMAGE_TYPES with expected members', () => {
    expect(ACCEPTED_IMAGE_TYPES).toContain('image/png');
    expect(ACCEPTED_IMAGE_TYPES).toContain('image/jpeg');
    expect(ACCEPTED_IMAGE_TYPES).toContain('image/webp');
  });
});

describe('extractFromImage', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('calls the vision model with image_url content part', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '# Menú\n\n- Tacos: $50\n- Quesadillas: $60' } }],
      usage: { prompt_tokens: 800, completion_tokens: 100 },
    });

    const result = await extractFromImage({
      filename: 'menu.png',
      mimeType: 'image/png',
      base64: 'iVBORw0KGgo=',
      sizeBytes: 12345,
    });

    expect(result.kind).toBe('image');
    expect(result.filename).toBe('menu.png');
    expect(result.markdown).toContain('Tacos: $50');
    expect(result.sizeBytes).toBe(12345);
    expect(result.tokensIn).toBe(800);
    expect(result.tokensOut).toBe(100);
    expect(result.cost).toBeGreaterThan(0);

    const call = mockCreate.mock.calls[0][0];
    const userMessage = call.messages[1];
    expect(userMessage.role).toBe('user');
    expect(Array.isArray(userMessage.content)).toBe(true);
    const imagePart = userMessage.content.find(
      (p: { type: string }) => p.type === 'image_url',
    );
    expect(imagePart).toBeDefined();
    expect(imagePart.image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it('throws EXTRACTION_FAILED on empty model response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '' } }],
      usage: { prompt_tokens: 500, completion_tokens: 0 },
    });

    await expect(
      extractFromImage({
        filename: 'x.png',
        mimeType: 'image/png',
        base64: 'x',
        sizeBytes: 10,
      }),
    ).rejects.toMatchObject({
      name: 'UploadError',
      code: 'EXTRACTION_FAILED',
    });
  });

  it('wraps underlying errors as EXTRACTION_FAILED', async () => {
    mockCreate.mockRejectedValueOnce(new Error('openrouter 503'));

    await expect(
      extractFromImage({
        filename: 'x.jpg',
        mimeType: 'image/jpeg',
        base64: 'x',
        sizeBytes: 10,
      }),
    ).rejects.toMatchObject({
      name: 'UploadError',
      code: 'EXTRACTION_FAILED',
    });
  });

  it('passes filename into the user prompt text part', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '# OK' } }],
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    });
    await extractFromImage({
      filename: 'cedula-profesional.jpg',
      mimeType: 'image/jpeg',
      base64: 'x',
      sizeBytes: 10,
    });
    const call = mockCreate.mock.calls[0][0];
    const userMessage = call.messages[1];
    const textPart = userMessage.content.find(
      (p: { type: string }) => p.type === 'text',
    );
    expect(textPart.text).toContain('cedula-profesional.jpg');
  });
});
