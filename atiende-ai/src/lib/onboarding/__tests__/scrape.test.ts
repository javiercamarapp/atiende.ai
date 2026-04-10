import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scrapeUrl, extractFirstUrl, ScrapeError } from '../scrape';

describe('extractFirstUrl', () => {
  it('extracts https URL from free text', () => {
    expect(extractFirstUrl('mira mi sitio https://clinica.com gracias')).toBe(
      'https://clinica.com',
    );
  });

  it('extracts http URL', () => {
    expect(extractFirstUrl('http://example.org/foo bar')).toBe('http://example.org/foo');
  });

  it('returns null when no URL', () => {
    expect(extractFirstUrl('soy dentista en merida')).toBeNull();
  });
});

describe('scrapeUrl', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.JINA_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns markdown on success', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('# Clínica Dental\n\nHorario L-V 9-19', { status: 200 }),
    );
    const r = await scrapeUrl('https://clinica.com');
    expect(r.url).toBe('https://clinica.com/');
    expect(r.markdown).toContain('Clínica Dental');
    expect(r.truncated).toBe(false);
  });

  it('prepends https:// when scheme missing', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200 }),
    );
    await scrapeUrl('clinica.com');
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).toContain('https://clinica.com');
  });

  it('passes JINA_API_KEY as Bearer header when set', async () => {
    process.env.JINA_API_KEY = 'test-key';
    global.fetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200 }),
    );
    await scrapeUrl('https://clinica.com');
    const init = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Bearer test-key');
  });

  it('omits Authorization header when JINA_API_KEY unset', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('ok', { status: 200 }),
    );
    await scrapeUrl('https://clinica.com');
    const init = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('truncates at 20k chars', async () => {
    const huge = 'x'.repeat(25_000);
    global.fetch = vi.fn().mockResolvedValue(
      new Response(huge, { status: 200 }),
    );
    const r = await scrapeUrl('https://big.com');
    expect(r.markdown.length).toBe(20_000);
    expect(r.truncated).toBe(true);
  });

  it('throws BAD_STATUS on HTTP 404', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(scrapeUrl('https://missing.com')).rejects.toMatchObject({
      name: 'ScrapeError',
      code: 'BAD_STATUS',
      httpStatus: 404,
    });
  });

  it('throws EMPTY on blank response', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('   ', { status: 200 }));
    await expect(scrapeUrl('https://blank.com')).rejects.toMatchObject({
      code: 'EMPTY',
    });
  });

  it('throws TIMEOUT on AbortError', async () => {
    global.fetch = vi.fn().mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    await expect(scrapeUrl('https://slow.com')).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('throws BLOCKED for localhost', async () => {
    await expect(scrapeUrl('http://localhost:3000')).rejects.toMatchObject({
      code: 'BLOCKED',
    });
  });

  it('throws BLOCKED for 127.0.0.1', async () => {
    await expect(scrapeUrl('http://127.0.0.1/admin')).rejects.toMatchObject({
      code: 'BLOCKED',
    });
  });

  it('throws BLOCKED for AWS metadata endpoint 169.254.169.254', async () => {
    await expect(scrapeUrl('http://169.254.169.254/latest')).rejects.toMatchObject({
      code: 'BLOCKED',
    });
  });

  it('throws BLOCKED for 10.x private range', async () => {
    await expect(scrapeUrl('http://10.0.0.5')).rejects.toMatchObject({ code: 'BLOCKED' });
  });

  it('throws BLOCKED for 192.168.x private range', async () => {
    await expect(scrapeUrl('http://192.168.1.1')).rejects.toMatchObject({ code: 'BLOCKED' });
  });

  it('throws INVALID_URL for empty input', async () => {
    await expect(scrapeUrl('   ')).rejects.toMatchObject({ code: 'INVALID_URL' });
  });

  it('throws BLOCKED for non-http scheme', async () => {
    await expect(scrapeUrl('file:///etc/passwd')).rejects.toMatchObject({ code: 'BLOCKED' });
  });

  it('ScrapeError is instance of Error', () => {
    const err = new ScrapeError('TIMEOUT', 'test');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('TIMEOUT');
  });
});
