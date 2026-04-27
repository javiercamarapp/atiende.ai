// ═════════════════════════════════════════════════════════════════════════════
// POST /api/billing/staff/checkout
//
// El doctor inicia su propio checkout para pagar su suscripción individual.
// Si ya tiene suscripción activa, devuelve la billing portal URL para
// que la gestione (cambio plan, cancelar, ver facturas).
//
// Auth: el doctor logueado (no el owner — cada uno paga lo suyo).
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  requireCurrentStaff,
  UnauthorizedError,
} from '@/lib/auth/current-staff';
import {
  createDoctorCheckout,
  BillingConfigError,
  type DoctorPlan,
} from '@/lib/billing/per-doctor';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 15;

const Body = z.object({
  plan: z.enum(['esencial', 'pro', 'ultimate']),
});

export async function POST(req: NextRequest) {
  try {
    const me = await requireCurrentStaff();

    if (!me.isBillable) {
      return NextResponse.json(
        {
          error:
            'Tu rol (' + me.role + ') no requiere suscripción individual. Solo doctores tienen billing per-seat.',
        },
        { status: 403 },
      );
    }

    if (!me.email) {
      return NextResponse.json(
        { error: 'Tu cuenta no tiene email asociado. Actualizalo desde tu perfil.' },
        { status: 400 },
      );
    }

    const raw = await req.json().catch(() => null);
    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Plan inválido' }, { status: 400 });
    }
    const plan = parsed.data.plan as DoctorPlan;

    const result = await createDoctorCheckout({
      staffId: me.staffId,
      email: me.email,
      name: me.name,
      tenantId: me.tenantId,
      plan,
    });

    return NextResponse.json({
      url: result.url,
      mode: result.mode, // 'checkout' o 'portal' (si ya tiene sub activa)
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Necesitas iniciar sesión' }, { status: 401 });
    }
    if (err instanceof BillingConfigError) {
      // Error de configuración del SISTEMA (no del user) — log error, no
      // exponer detalles al cliente.
      logger.error('[billing/checkout] config error', err, {});
      return NextResponse.json(
        {
          error:
            'El sistema de pagos está en mantenimiento. Por favor avisá a soporte.',
        },
        { status: 503 },
      );
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error('[billing/checkout] unhandled', err instanceof Error ? err : undefined, {
      err: errMsg.slice(0, 300),
    });
    return NextResponse.json(
      { error: 'Error procesando el checkout. Intentá de nuevo.' },
      { status: 500 },
    );
  }
}
