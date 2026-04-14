// Web scraping for the onboarding URL shortcut.
//
// Two-tier strategy:
//   1. Primary: Jina Reader (https://r.jina.ai/<URL>) — JS-rendered markdown.
//      Handles most business websites well.
//   2. Fallback: Direct fetch with facebookexternalhit/1.1 User-Agent + parse
//      <meta property="og:*"> tags. Works on Facebook / Instagram / LinkedIn
//      public pages because those platforms serve OG metadata to enable link
//      previews on other sites — even when they reject generic scrapers.
//      Returns limited info (title + description + image URL) but it's
//      enough for Valeria to detect the vertical and ask better follow-up
//      questions.
//
// The fallback is tried for any URL when the primary (a) throws, or (b)
// returns suspiciously short content / a login wall. Social-media URLs are
// NO LONGER short-circuited — we let both tiers try.

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
  /** Which strategy produced this result. Useful for telemetry + debugging. */
  source: 'jina' | 'og_meta';
}

const MAX_MARKDOWN_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 8_000;

// Markers that indicate a login wall or anti-bot page. If Jina's output
// matches any of these, we discard it and try the OG meta fallback.
// We do NOT use length alone as a signal — many legitimate small-business
// sites have short content (a contact card, a single "about us" paragraph).
const LOGIN_WALL_MARKERS = [
  'You must log in',
  'Log in to Facebook',
  'Log into Facebook',
  'Iniciar sesión en Facebook',
  'Sign up for Facebook',
  'Create new account',
  "This content isn't available",
  'This content is not available',
  'Verify you are human',
  'please enable JavaScript',
  'Checking if the site connection is secure',
  'Attention Required! | Cloudflare',
];

// ─────────────────────────────────────────────────────────────────────────────
// URL validation (SSRF guard)
// ─────────────────────────────────────────────────────────────────────────────

function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new ScrapeError('INVALID_URL', 'Empty URL');

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

// ─────────────────────────────────────────────────────────────────────────────
// Primary: Jina Reader
// ─────────────────────────────────────────────────────────────────────────────

async function scrapeWithJina(target: URL): Promise<ScrapeResult> {
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
      throw new ScrapeError('TIMEOUT', `Jina timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw new ScrapeError('BAD_STATUS', `Jina fetch failed: ${(err as Error).message}`);
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
    throw new ScrapeError('EMPTY', 'Jina returned empty content');
  }

  const truncated = body.length > MAX_MARKDOWN_CHARS;
  const markdown = truncated ? body.slice(0, MAX_MARKDOWN_CHARS) : body;

  return {
    url: target.toString(),
    markdown,
    truncated,
    source: 'jina',
  };
}

/** True if Jina's output looks like a real page (not a login wall / captcha). */
function isUsefulJinaContent(markdown: string): boolean {
  // Completely empty is not useful.
  if (markdown.trim().length === 0) return false;
  // Explicit login-wall / anti-bot markers = not useful.
  for (const marker of LOGIN_WALL_MARKERS) {
    if (markdown.includes(marker)) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback: Open Graph meta tags via facebookexternalhit UA
// ─────────────────────────────────────────────────────────────────────────────

function decodeHTMLEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

interface MetaTags {
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  url?: string;
  type?: string;
}

function parseMetaTags(html: string): MetaTags {
  // Regex extracts a meta tag whose `property` (or `name`) equals `key`.
  // Tolerates attribute reorder and single/double quotes.
  const getMeta = (key: string): string | undefined => {
    const patterns = [
      new RegExp(
        `<meta[^>]*\\b(?:property|name)=["']${key}["'][^>]*\\bcontent=["']([^"']*)["']`,
        'i',
      ),
      new RegExp(
        `<meta[^>]*\\bcontent=["']([^"']*)["'][^>]*\\b(?:property|name)=["']${key}["']`,
        'i',
      ),
    ];
    for (const p of patterns) {
      const match = html.match(p);
      if (match && match[1]) {
        const value = decodeHTMLEntities(match[1]).trim();
        if (value.length > 0) return value;
      }
    }
    return undefined;
  };

  const titleTagMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const titleTag = titleTagMatch
    ? decodeHTMLEntities(titleTagMatch[1]).trim()
    : undefined;

  return {
    title: getMeta('og:title') || getMeta('twitter:title') || titleTag,
    description:
      getMeta('og:description') ||
      getMeta('twitter:description') ||
      getMeta('description'),
    siteName: getMeta('og:site_name') || getMeta('application-name'),
    image: getMeta('og:image') || getMeta('twitter:image'),
    url: getMeta('og:url'),
    type: getMeta('og:type'),
  };
}

async function scrapeWithOgMeta(target: URL): Promise<ScrapeResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(target.toString(), {
      method: 'GET',
      headers: {
        // Facebook's own link-preview crawler UA. Many sites — including
        // Facebook itself — serve OG metadata to this UA without an auth
        // wall, because they want their pages to have nice previews when
        // linked on other platforms.
        'User-Agent':
          'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const name = (err as Error)?.name;
    if (name === 'AbortError') {
      throw new ScrapeError('TIMEOUT', `OG fetch timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw new ScrapeError('BAD_STATUS', `OG fetch failed: ${(err as Error).message}`);
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new ScrapeError(
      'BAD_STATUS',
      `OG fetch returned HTTP ${response.status}`,
      response.status,
    );
  }

  const html = await response.text();
  // Read only the <head> portion for efficiency — OG tags always live there.
  const headEnd = html.indexOf('</head>');
  const head = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 100_000);

  const meta = parseMetaTags(head);

  if (!meta.title && !meta.description) {
    throw new ScrapeError('EMPTY', 'No OG metadata found on page');
  }

  // Render as markdown-ish for the LLM. Including the `source` note so the
  // agent knows this is partial info (profile card level) vs. full page.
  const parts: string[] = [];
  parts.push(
    `(Información extraída de las meta-etiquetas de la página — solo disponibles las siguientes.)`,
  );
  if (meta.title) parts.push(`# ${meta.title}`);
  if (meta.siteName) parts.push(`**Sitio:** ${meta.siteName}`);
  if (meta.type) parts.push(`**Tipo:** ${meta.type}`);
  if (meta.description) parts.push(meta.description);
  if (meta.url) parts.push(`**URL canónica:** ${meta.url}`);
  if (meta.image) parts.push(`**Imagen de perfil:** ${meta.image}`);

  const markdown = parts.join('\n\n');

  return {
    url: target.toString(),
    markdown,
    truncated: false,
    source: 'og_meta',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — tries Jina first, falls back to OG meta
// ─────────────────────────────────────────────────────────────────────────────

export async function scrapeUrl(rawUrl: string): Promise<ScrapeResult> {
  const target = normalizeUrl(rawUrl);

  // ── Tier 1: Jina Reader ──────────────────────────────────────────────────
  let jinaError: ScrapeError | null = null;
  try {
    const jinaResult = await scrapeWithJina(target);
    if (isUsefulJinaContent(jinaResult.markdown)) {
      return jinaResult;
    }
    // Jina returned a login wall or very short content — pretend it failed
    // so we fall through to the OG fallback below.
    jinaError = new ScrapeError(
      'EMPTY',
      'Jina returned a login wall or empty page; falling back to OG meta',
    );
  } catch (err) {
    jinaError = err instanceof ScrapeError ? err : new ScrapeError('BAD_STATUS', String(err));
  }

  // ── Tier 2: Open Graph meta tags ─────────────────────────────────────────
  try {
    return await scrapeWithOgMeta(target);
  } catch (ogError) {
    // Both failed — throw the most informative of the two errors.
    if (ogError instanceof ScrapeError) throw ogError;
    throw jinaError ?? new ScrapeError('BAD_STATUS', 'Both scraping tiers failed');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// URL extraction helper
// ─────────────────────────────────────────────────────────────────────────────

export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0] : null;
}
