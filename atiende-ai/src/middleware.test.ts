/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock setup (hoisted) ───────────────────────────────────

const { mockGetUser } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

// Mock NextResponse
const mockHeaders = new Map<string, string>();

vi.mock('next/server', () => {
  class MockNextResponse {
    headers = {
      set: (key: string, value: string) => mockHeaders.set(key, value),
      get: (key: string) => mockHeaders.get(key),
    };
    cookies = {
      set: vi.fn(),
    };

    static next({ request }: any) {
      const res = new MockNextResponse();
      (res as any)._request = request;
      return res;
    }

    static redirect(url: any) {
      const res = new MockNextResponse();
      (res as any)._redirected = true;
      (res as any)._redirectUrl = url.pathname;
      return res;
    }
  }

  return { NextResponse: MockNextResponse };
});

import { middleware } from './middleware';

// ── Helpers ────────────────────────────────────────────────

function makeRequest(pathname: string): any {
  return {
    nextUrl: {
      pathname,
      clone() {
        return { pathname: this.pathname };
      },
    },
    cookies: {
      getAll: () => [],
      set: vi.fn(),
    },
  };
}

// ── Tests ──────────────────────────────────────────────────

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeaders.clear();

    // Default: set env vars
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  });

  // ── Public path bypass ───────────────────────────────

  describe('public path bypass', () => {
    it('allows unauthenticated access to /', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const response = await middleware(makeRequest('/'));

      expect((response as any)._redirected).toBeUndefined();
    });

    it('allows unauthenticated access to /login', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const response = await middleware(makeRequest('/login'));

      expect((response as any)._redirected).toBeUndefined();
    });

    it('allows unauthenticated access to /register', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const response = await middleware(makeRequest('/register'));

      expect((response as any)._redirected).toBeUndefined();
    });

    it('allows unauthenticated access to /api/webhook paths', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const response = await middleware(makeRequest('/api/webhook/whatsapp'));

      expect((response as any)._redirected).toBeUndefined();
    });

    it('allows unauthenticated access to /api/webhook (exact)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const response = await middleware(makeRequest('/api/webhook'));

      expect((response as any)._redirected).toBeUndefined();
    });

    it('redirects unauthenticated users from protected routes like /dashboard', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const response = await middleware(makeRequest('/dashboard'));

      expect((response as any)._redirected).toBe(true);
      expect((response as any)._redirectUrl).toBe('/login');
    });

    it('redirects unauthenticated users from /settings', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const response = await middleware(makeRequest('/settings'));

      expect((response as any)._redirected).toBe(true);
      expect((response as any)._redirectUrl).toBe('/login');
    });
  });

  // ── Authenticated user redirects ─────────────────────

  describe('authenticated user redirects', () => {
    const mockUser = { id: 'user-1', email: 'test@example.com' };

    it('redirects authenticated users from /login to /home', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } });

      const response = await middleware(makeRequest('/login'));

      expect((response as any)._redirected).toBe(true);
      expect((response as any)._redirectUrl).toBe('/home');
    });

    it('redirects authenticated users from /register to /home', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } });

      const response = await middleware(makeRequest('/register'));

      expect((response as any)._redirected).toBe(true);
      expect((response as any)._redirectUrl).toBe('/home');
    });

    it('does NOT redirect authenticated users from /dashboard', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } });

      const response = await middleware(makeRequest('/dashboard'));

      expect((response as any)._redirected).toBeUndefined();
    });

    it('redirects authenticated users from / to /home', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } });

      const response = await middleware(makeRequest('/'));

      expect((response as any)._redirected).toBe(true);
      expect((response as any)._redirectUrl).toBe('/home');
    });

    it('does NOT redirect authenticated users from /api/webhook', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } });

      const response = await middleware(makeRequest('/api/webhook/stripe'));

      expect((response as any)._redirected).toBeUndefined();
    });
  });

  // ── Security headers ─────────────────────────────────

  describe('security headers', () => {
    it('sets X-Content-Type-Options to nosniff', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: '1' } } });

      await middleware(makeRequest('/dashboard'));

      expect(mockHeaders.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('sets X-Frame-Options to DENY', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: '1' } } });

      await middleware(makeRequest('/dashboard'));

      expect(mockHeaders.get('X-Frame-Options')).toBe('DENY');
    });

    it('sets X-XSS-Protection', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: '1' } } });

      await middleware(makeRequest('/dashboard'));

      expect(mockHeaders.get('X-XSS-Protection')).toBe('1; mode=block');
    });

    it('sets Referrer-Policy', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: '1' } } });

      await middleware(makeRequest('/dashboard'));

      expect(mockHeaders.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    });

    it('sets Permissions-Policy to deny camera/mic/geo', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: '1' } } });

      await middleware(makeRequest('/dashboard'));

      const pp = mockHeaders.get('Permissions-Policy');
      expect(pp).toContain('camera=()');
      expect(pp).toContain('microphone=()');
      expect(pp).toContain('geolocation=()');
    });

    it('does not set CSP (Next.js inline scripts incompatible)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: '1' } } });

      await middleware(makeRequest('/dashboard'));

      // CSP intentionally removed because Next.js requires inline scripts
      expect(mockHeaders.has('Content-Security-Policy')).toBe(false);
    });

    it('does not set Strict-Transport-Security (handled by hosting layer)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: '1' } } });

      await middleware(makeRequest('/dashboard'));

      // HSTS is handled by the hosting layer, not the middleware
      expect(mockHeaders.has('Strict-Transport-Security')).toBe(false);
    });

    it('sets security headers even for public routes', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      await middleware(makeRequest('/'));

      expect(mockHeaders.get('X-Content-Type-Options')).toBe('nosniff');
      expect(mockHeaders.get('X-Frame-Options')).toBe('DENY');
      expect(mockHeaders.get('X-XSS-Protection')).toBe('1; mode=block');
    });

    it('sets all 5 OWASP security headers handled by middleware', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: '1' } } });

      await middleware(makeRequest('/dashboard'));

      const expectedHeaders = [
        'X-Content-Type-Options',
        'X-Frame-Options',
        'X-XSS-Protection',
        'Referrer-Policy',
        'Permissions-Policy',
      ];

      for (const header of expectedHeaders) {
        expect(mockHeaders.has(header)).toBe(true);
      }
    });

    it('does not set CSP unsafe-inline (no CSP set at middleware layer)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: '1' } } });

      await middleware(makeRequest('/'));

      expect(mockHeaders.has('Content-Security-Policy')).toBe(false);
    });
  });

  // ── Route matcher config ─────────────────────────────

  describe('matcher config', () => {
    it('exports a config with matcher array', async () => {
      const { config } = await import('./middleware');
      expect(config.matcher).toBeDefined();
      expect(Array.isArray(config.matcher)).toBe(true);
      expect(config.matcher.length).toBeGreaterThan(0);
    });

    it('matcher excludes _next/static and favicon', async () => {
      const { config } = await import('./middleware');
      const pattern = config.matcher[0];
      // The pattern uses negative lookahead to exclude static assets
      expect(pattern).toContain('_next/static');
      expect(pattern).toContain('favicon.ico');
    });
  });
});
