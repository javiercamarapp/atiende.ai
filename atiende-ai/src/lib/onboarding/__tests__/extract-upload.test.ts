import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockExtractText = vi.fn();
const mockGetDocumentProxy = vi.fn();

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

vi.mock('unpdf', () => ({
  extractText: (...args: unknown[]) => mockExtractText(...args),
  getDocumentProxy: (...args: unknown[]) => mockGetDocumentProxy(...args),
}));

import {
  validateUpload,
  extractFromImage,
  extractFromPdf,
  isPdfMimeType,
  UploadError,
  MAX_UPLOAD_BYTES,
  ACCEPTED_IMAGE_TYPES,
  ACCEPTED_PDF_TYPES,
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

  it('accepts PDF', () => {
    expect(() =>
      validateUpload({ type: 'application/pdf', size: 500_000 }),
    ).not.toThrow();
  });

  it('rejects random binary types as UNSUPPORTED_TYPE', () => {
    expect(() =>
      validateUpload({ type: 'application/zip', size: 100_000 }),
    ).toThrow(UploadError);
    try {
      validateUpload({ type: 'application/zip', size: 100_000 });
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

  it('exposes ACCEPTED_PDF_TYPES', () => {
    expect(ACCEPTED_PDF_TYPES).toContain('application/pdf');
  });

  it('isPdfMimeType recognizes application/pdf only', () => {
    expect(isPdfMimeType('application/pdf')).toBe(true);
    expect(isPdfMimeType('image/png')).toBe(false);
    expect(isPdfMimeType('text/plain')).toBe(false);
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

describe('extractFromPdf', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockExtractText.mockReset();
    mockGetDocumentProxy.mockReset();
  });

  it('extracts text from a PDF and feeds it to Gemini', async () => {
    mockGetDocumentProxy.mockResolvedValueOnce({ /* fake doc */ });
    mockExtractText.mockResolvedValueOnce({
      text: '# Menú\n\nTacos al pastor $50\nQuesadillas $60\nAgua fresca $25',
      totalPages: 1,
    });
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: { content: '# Menú\n- Tacos al pastor: $50\n- Quesadillas: $60' },
        },
      ],
      usage: { prompt_tokens: 300, completion_tokens: 80 },
    });

    const result = await extractFromPdf({
      filename: 'menu.pdf',
      buffer: new Uint8Array([1, 2, 3, 4]),
      sizeBytes: 1024,
    });

    expect(result.kind).toBe('pdf');
    expect(result.mimeType).toBe('application/pdf');
    expect(result.filename).toBe('menu.pdf');
    expect(result.markdown).toContain('Tacos al pastor');
    expect(result.cost).toBeGreaterThan(0);

    // Verify unpdf was called with mergePages:true
    expect(mockExtractText).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mergePages: true }),
    );

    // Verify the LLM call included the extracted text
    const call = mockCreate.mock.calls[0][0];
    const userContent = call.messages[1].content;
    expect(typeof userContent).toBe('string');
    expect(userContent).toContain('menu.pdf');
    expect(userContent).toContain('Tacos al pastor');
  });

  it('throws PDF_NO_TEXT when the PDF has no legible text', async () => {
    mockGetDocumentProxy.mockResolvedValueOnce({});
    mockExtractText.mockResolvedValueOnce({ text: '   ', totalPages: 1 });

    await expect(
      extractFromPdf({
        filename: 'scanned.pdf',
        buffer: new Uint8Array([0, 0, 0]),
        sizeBytes: 2000,
      }),
    ).rejects.toMatchObject({
      name: 'UploadError',
      code: 'PDF_NO_TEXT',
    });
  });

  it('throws EXTRACTION_FAILED when unpdf itself throws', async () => {
    mockGetDocumentProxy.mockRejectedValueOnce(new Error('corrupt pdf'));

    await expect(
      extractFromPdf({
        filename: 'broken.pdf',
        buffer: new Uint8Array([0, 0]),
        sizeBytes: 10,
      }),
    ).rejects.toMatchObject({
      name: 'UploadError',
      code: 'EXTRACTION_FAILED',
    });
  });

  it('truncates long PDF text before sending to the model', async () => {
    const hugeText = 'x'.repeat(50_000);
    mockGetDocumentProxy.mockResolvedValueOnce({});
    mockExtractText.mockResolvedValueOnce({ text: hugeText, totalPages: 1 });
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '# result' } }],
      usage: { prompt_tokens: 1000, completion_tokens: 20 },
    });

    await extractFromPdf({
      filename: 'huge.pdf',
      buffer: new Uint8Array([1]),
      sizeBytes: 100,
    });

    const call = mockCreate.mock.calls[0][0];
    const userContent = call.messages[1].content as string;
    expect(userContent.length).toBeLessThan(50_000);
    expect(userContent).toContain('truncado');
  });

  it('throws EXTRACTION_FAILED when the model returns empty content', async () => {
    mockGetDocumentProxy.mockResolvedValueOnce({});
    mockExtractText.mockResolvedValueOnce({
      text: 'This is some readable text that should pass the length check.',
      totalPages: 1,
    });
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '' } }],
      usage: { prompt_tokens: 100, completion_tokens: 0 },
    });

    await expect(
      extractFromPdf({
        filename: 'empty-out.pdf',
        buffer: new Uint8Array([1]),
        sizeBytes: 10,
      }),
    ).rejects.toMatchObject({
      name: 'UploadError',
      code: 'EXTRACTION_FAILED',
    });
  });
});
