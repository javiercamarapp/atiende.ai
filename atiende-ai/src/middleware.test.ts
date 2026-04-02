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
const mockRedirectUrl = { pathname: '' };

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
      mockRedirectUrl.pathname = url.pathname;
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
    mockRedirectUrl.pathname = '';

    // Default: set env vars
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  });

  // ── Auth redirects ───────────────────────────────────

  describe('auth redirects for protected routes', () => {
    it('redirects unauthenticated users from /dashboard to /login', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const response = await middleware(makeRequest('/dashboard'));

      expect((response as any)._redirected).toBe(true);
      expect((response as any)._redirectUrl).toBe('/login');
    });

    it('redirects unauthenticated users from /settings to /login', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const response = await middleware(makeRequest('/settings'));

      expect((response as any)._redirected).toBe(true);
      expect((response as any)._redirectUrl).toBe('/login');
    });

    it('redirects unauthenticated users from /conversations to /login', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const response = await middleware(makeRequest('/conversations'));

      expect((response as any)._redirected).toBe(true);
      expect((response as any)._redirectUrl).toBe('/login');
    });

    it('redirects unauthenticated users from nested protected routes', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const response = await middleware(makeRequest('/analytics/reports'));

      expect((response as any)._redirected).toBe(true);
      expect((response as any)._redirectUrl).toBe('/login');
    });
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
  });

  // ── Authenticated user redirects ─────────────────────

  describe('authenticated user redirects', () => {
    const mockUser = { id: 'user-1', email: 'test@example.com' };

    it('redirects authenticated users from /login to /', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } });

      const response = await middleware(makeRequest('/login'));

      expect((response as any)._redirected).toBe(true);
      expect((response as any)._redirectUrl).toBe('/');
    });

    it('redirects authenticated users from /register to /', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } });

      const response = await middleware(makeRequest('/register'));

      expect((response as any)._redirected).toBe(true);
      expect((response as any)._redirectUrl).toBe('/');
    });

    it('allows authenticated users to access protected routes', async () => {
      mockGetUser.mockResolvedValue({ data: { user: mockUser } });

      const response = await middleware(makeRequest('/dashboard'));

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

    it('sets Content-Security-Policy', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: '1' } } });

      await middleware(makeRequest('/dashboard'));

      const csp = mockHeaders.get('Content-Security-Policy');
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain('supabase.co');
      expect(csp).toContain('openrouter.ai');
    });

    it('sets Strict-Transport-Security (HSTS)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: '1' } } });

      await middleware(makeRequest('/dashboard'));

      const hsts = mockHeaders.get('Strict-Transport-Security');
      expect(hsts).toContain('max-age=31536000');
      expect(hsts).toContain('includeSubDomains');
    });

    it('sets security headers even for public routes', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });

      await middleware(makeRequest('/'));

      expect(mockHeaders.get('X-Content-Type-Options')).toBe('nosniff');
      expect(mockHeaders.get('X-Frame-Options')).toBe('DENY');
    });

    it('sets all 7 OWASP security headers', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: '1' } } });

      await middleware(makeRequest('/dashboard'));

      const expectedHeaders = [
        'X-Content-Type-Options',
        'X-Frame-Options',
        'X-XSS-Protection',
        'Referrer-Policy',
        'Permissions-Policy',
        'Content-Security-Policy',
        'Strict-Transport-Security',
      ];

      for (const header of expectedHeaders) {
        expect(mockHeaders.has(header)).toBe(true);
      }
    });
  });
});
