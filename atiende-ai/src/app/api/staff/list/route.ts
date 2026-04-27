// ═════════════════════════════════════════════════════════════════════════════
// GET /api/staff/list
//
// Lista todos los staff del tenant del owner + invitaciones pendientes.
// Solo owner/admin pueden ver. Lo usa /settings/team para renderizar la
// tabla de equipo + lista de invites pendientes.
// ═════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import {
  requireCurrentStaff,
  canManageTeam,
  UnauthorizedError,
} from '@/lib/auth/current-staff';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const me = await requireCurrentStaff();
    if (!canManageTeam(me)) {
      return NextResponse.json(
        { error: 'Solo el owner o admin del consultorio puede ver el equipo.' },
        { status: 403 },
      );
    }

    const [staffRes, invitesRes] = await Promise.all([
      supabaseAdmin
        .from('staff')
        .select(
          'id, name, email, role, speciality, is_billable, plan, subscription_status, trial_ends_at, accepted_at, user_id',
        )
        .eq('tenant_id', me.tenantId)
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('staff_invitations')
        .select('id, email, name, role, speciality, expires_at, created_at')
        .eq('tenant_id', me.tenantId)
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }),
    ]);

    if (staffRes.error) {
      logger.error('[staff/list] staff query failed', staffRes.error as Error, {
        tenant_id: me.tenantId,
      });
      return NextResponse.json({ error: 'Error cargando equipo' }, { status: 500 });
    }
    if (invitesRes.error) {
      logger.error('[staff/list] invites query failed', invitesRes.error as Error, {
        tenant_id: me.tenantId,
      });
      return NextResponse.json({ error: 'Error cargando invitaciones' }, { status: 500 });
    }

    return NextResponse.json({
      staff: staffRes.data ?? [],
      pendingInvitations: invitesRes.data ?? [],
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Necesitas iniciar sesión' }, { status: 401 });
    }
    logger.error('[staff/list] unhandled', err instanceof Error ? err : undefined, {});
    return NextResponse.json({ error: 'Error inesperado' }, { status: 500 });
  }
}
