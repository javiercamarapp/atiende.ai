import { describe, it, expect } from 'vitest';
import { buildLocalIso } from '@/lib/actions/appointment-helpers';

// Verificación de la corrección de BUG-NS-CRIT-1:
// Antes, get_appointments_tomorrow usaba new Date().getTimezoneOffset() del
// server (Vercel = UTC = 0) lo que hacía que el rango de query no cubriera
// correctamente el día completo en timezone del tenant.
// Ahora usa buildLocalIso que consulta Intl.DateTimeFormat con la TZ correcta.

describe('buildLocalIso — Mérida (America/Merida, UTC-6, sin DST)', () => {
  it('00:00 del 2026-04-15 en Mérida = 2026-04-15 06:00 UTC', () => {
    const iso = buildLocalIso('2026-04-15', '00:00', 'America/Merida');
    expect(iso).toBe('2026-04-15T00:00:00-06:00');
    // Convertir a UTC para confirmar
    const utc = new Date(iso).toISOString();
    expect(utc).toBe('2026-04-15T06:00:00.000Z');
  });

  it('rango de un día completo cubre 24h reales', () => {
    const dayStartUtc = new Date(buildLocalIso('2026-04-15', '00:00', 'America/Merida'));
    const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60_000);
    const diffMs = dayEndUtc.getTime() - dayStartUtc.getTime();
    expect(diffMs).toBe(86_400_000);
    // Verifica que el fin del día cubre citas de 11pm Mérida del día 15
    expect(dayEndUtc.toISOString()).toBe('2026-04-16T06:00:00.000Z');
  });

  it('cita 11pm Mérida del 15 CAE dentro del rango del día 15', () => {
    const dayStartUtc = new Date(buildLocalIso('2026-04-15', '00:00', 'America/Merida'));
    const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60_000);
    // Cita las 23:00 Mérida del 15 = 2026-04-16 05:00 UTC
    const lateNight = new Date('2026-04-16T05:00:00Z');
    expect(lateNight.getTime()).toBeGreaterThanOrEqual(dayStartUtc.getTime());
    expect(lateNight.getTime()).toBeLessThan(dayEndUtc.getTime());
  });

  it('cita 11pm Mérida del 14 NO cae en el rango del día 15 (evita falsos positivos)', () => {
    const dayStartUtc = new Date(buildLocalIso('2026-04-15', '00:00', 'America/Merida'));
    // Cita las 23:00 Mérida del 14 = 2026-04-15 05:00 UTC
    const prevNight = new Date('2026-04-15T05:00:00Z');
    expect(prevNight.getTime()).toBeLessThan(dayStartUtc.getTime());
  });

  it('cálculo anterior (buggy) usaba UTC de forma incorrecta', () => {
    // Demostración del bug que se corrigió:
    // el código viejo hacía: new Date(`${date}T00:00:00`) interpretado como
    // local time del server (UTC), resultando en 2026-04-15 00:00 UTC
    // que es 2026-04-14 18:00 Mérida → miss 6h de citas del 15.
    const buggyDayStart = new Date('2026-04-15T00:00:00').toISOString();
    const correctDayStart = new Date(buildLocalIso('2026-04-15', '00:00', 'America/Merida')).toISOString();
    // Nota: este test corre en cualquier TZ; en UTC (CI) el buggy sería:
    //   '2026-04-15T00:00:00.000Z'
    // mientras el correcto es:
    //   '2026-04-15T06:00:00.000Z'
    expect(correctDayStart).toBe('2026-04-15T06:00:00.000Z');
    expect(correctDayStart).not.toBe(buggyDayStart);
  });
});
