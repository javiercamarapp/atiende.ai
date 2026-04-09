// Web scraping for onboarding URL shortcut.
// Uses Jina Reader (https://r.jina.ai/<URL>) which returns LLM-ready markdown
// of a target URL. Handles JS-heavy sites reasonably and requires zero infra.

export type ScrapeErrorCode =
  | 'INVALID_URL'
  | 'BLOCKED'
  | 'TIMEOUT'
  | 'BAD_STATUS'
  | 'EMPTY';

export class ScrapeError extends Error {
  constructor(
    public readonly code: ScrapeErrorCode,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'ScrapeError';
  }
}

export interface ScrapeResult {
  url: string;
  markdown: string;
  truncated: boolean;
}

const MAX_MARKDOWN_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Normalize a raw user-provided URL:
 * - Trim whitespace
 * - Prepend `https://` if no scheme is present
 * - Reject non-http(s) schemes (SSRF guard)
 * - Reject localhost / RFC1918 private IPs (SSRF guard)
 */
function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new ScrapeError('INVALID_URL', 'Empty URL');

  // If the user supplied any scheme, it must be http(s). Otherwise reject
  // (prevents `file:`, `javascript:`, `gopher:`, etc. from sneaking through).
  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  if (schemeMatch && !/^https?$/i.test(schemeMatch[1])) {
    throw new ScrapeError('BLOCKED', `Scheme not allowed: ${schemeMatch[1]}`);
  }

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new ScrapeError('INVALID_URL', `Cannot parse URL: ${raw}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ScrapeError('BLOCKED', `Scheme not allowed: ${parsed.protocol}`);
  }

  const host = parsed.hostname.toLowerCase();
  // SSRF guard — block loopback, link-local, and private ranges.
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new ScrapeError('BLOCKED', `Private/loopback host blocked: ${host}`);
  }

  return parsed;
}

/**
 * Fetch the markdown rendering of a URL via Jina Reader.
 *
 * Throws `ScrapeError` with a machine-readable `code` on failure. Truncates
 * output to 20k chars if the page is huge (to keep LLM token budget bounded).
 * The optional `JINA_API_KEY` env var lifts free-tier rate limits when set.
 */
export async function scrapeUrl(rawUrl: string): Promise<ScrapeResult> {
  const target = normalizeUrl(rawUrl);
  const jinaUrl = `https://r.jina.ai/${target.toString()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const headers: Record<string, string> = {
    Accept: 'text/plain, text/markdown',
  };
  const apiKey = process.env.JINA_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response: Response;
  try {
    response = await fetch(jinaUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const name = (err as Error)?.name;
    if (name === 'AbortError') {
      throw new ScrapeError('TIMEOUT', `Scrape timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw new ScrapeError('BAD_STATUS', `Fetch failed: ${(err as Error).message}`);
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new ScrapeError(
      'BAD_STATUS',
      `Jina Reader returned HTTP ${response.status}`,
      response.status,
    );
  }

  const body = await response.text();
  if (!body.trim()) {
    throw new ScrapeError('EMPTY', 'Scraped content is empty');
  }

  const truncated = body.length > MAX_MARKDOWN_CHARS;
  const markdown = truncated ? body.slice(0, MAX_MARKDOWN_CHARS) : body;

  return {
    url: target.toString(),
    markdown,
    truncated,
  };
}

/**
 * Extract the first http(s) URL from a free-form user message.
 * Returns null if no URL is found.
 */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0] : null;
}
