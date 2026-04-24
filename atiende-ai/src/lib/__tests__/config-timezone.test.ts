import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveTenantTimezone, DEFAULT_TIMEZONE } from '../config';

describe('resolveTenantTimezone', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('returns tenant.timezone when set to valid IANA string', () => {
    expect(resolveTenantTimezone({ timezone: 'America/Mexico_City' })).toBe('America/Mexico_City');
    expect(resolveTenantTimezone({ timezone: 'America/Merida' })).toBe('America/Merida');
    expect(resolveTenantTimezone({ timezone: 'America/Hermosillo' })).toBe('America/Hermosillo');
  });

  it('returns default when timezone missing', () => {
    expect(resolveTenantTimezone({})).toBe(DEFAULT_TIMEZONE);
  });

  it('returns default when timezone is undefined', () => {
    expect(resolveTenantTimezone({ timezone: undefined })).toBe(DEFAULT_TIMEZONE);
  });

  it('returns default when timezone is null', () => {
    expect(resolveTenantTimezone({ timezone: null as unknown as string })).toBe(DEFAULT_TIMEZONE);
  });

  it('returns default when timezone is empty string', () => {
    expect(resolveTenantTimezone({ timezone: '' })).toBe(DEFAULT_TIMEZONE);
  });

  it('returns default when timezone is whitespace only', () => {
    expect(resolveTenantTimezone({ timezone: '   ' })).toBe(DEFAULT_TIMEZONE);
  });

  it('returns default when timezone is not a string', () => {
    expect(resolveTenantTimezone({ timezone: 42 as unknown as string })).toBe(DEFAULT_TIMEZONE);
    expect(resolveTenantTimezone({ timezone: {} as unknown as string })).toBe(DEFAULT_TIMEZONE);
  });

  it('warns when falling back to default (in dev)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    resolveTenantTimezone({});
    expect(warnSpy).toHaveBeenCalled();
    const call = warnSpy.mock.calls[0];
    expect(String(call[0])).toContain('timezone');
  });

  it('does not warn when falling back in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    resolveTenantTimezone({});
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn when timezone is configured (in dev)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    resolveTenantTimezone({ timezone: 'America/Mexico_City' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('DEFAULT_TIMEZONE is a valid IANA string accepted by Intl API', () => {
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: DEFAULT_TIMEZONE }).format(new Date())).not.toThrow();
  });
});
