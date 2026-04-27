// ═════════════════════════════════════════════════════════════════════════════
// /api/staff/invitations/[id]
//
// DELETE → cancela una invitación pendiente (la borra de la tabla).
// Solo owner/admin del tenant pueden hacerlo.
//
// Para "reenviar" no creamos endpoint nuevo: el owner puede cancelar y
// volver a invitar al mismo email — el endpoint /api/staff/invite ya
// genera un token nuevo y manda el email de cero.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import {
  requireCurrentStaff,
  canManageTeam,
  UnauthorizedError,
} from '@/lib/auth/current-staff';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id || id.length < 10) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
    }

    const me = await requireCurrentStaff();
    if (!canManageTeam(me)) {
      return NextResponse.json(
        { error: 'Solo el owner o admin puede cancelar invitaciones.' },
        { status: 403 },
      );
    }

    // Verificar que la invitación pertenece al tenant del caller (defensa
    // contra IDOR — un owner del tenant A no puede borrar invites del tenant B).
    const { data: invite } = await supabaseAdmin
      .from('staff_invitations')
      .select('id, tenant_id, accepted_at')
      .eq('id', id)
      .maybeSingle();

    if (!invite) {
      return NextResponse.json({ error: 'Invitación no encontrada' }, { status: 404 });
    }
    if (invite.tenant_id !== me.tenantId) {
      // No revelar al atacante que el ID existe en otro tenant.
      return NextResponse.json({ error: 'Invitación no encontrada' }, { status: 404 });
    }
    if (invite.accepted_at) {
      return NextResponse.json(
        { error: 'No se puede cancelar una invitación ya aceptada.' },
        { status: 400 },
      );
    }

    const { error } = await supabaseAdmin
      .from('staff_invitations')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error('[staff/invitations] delete failed', error as Error, {
        invitation_id: id,
        tenant_id: me.tenantId,
      });
      return NextResponse.json({ error: 'Error cancelando invitación' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Necesitas iniciar sesión' }, { status: 401 });
    }
    logger.error('[staff/invitations] unhandled', err instanceof Error ? err : undefined, {});
    return NextResponse.json({ error: 'Error inesperado' }, { status: 500 });
  }
}
