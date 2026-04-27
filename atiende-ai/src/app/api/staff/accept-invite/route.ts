// ═════════════════════════════════════════════════════════════════════════════
// POST /api/staff/accept-invite
//
// El invitado clickea el link del email → aterriza en /accept-invite con
// el token. La página le pide setear contraseña y nombre. Submit POST aquí.
//
// Flow:
//   1. Validar token (lookup por hash, verificar no usado, no expirado)
//   2. Crear auth.users vía supabase.auth.admin.createUser
//   3. Crear/actualizar staff row con user_id + role + tenant_id de la invite
//   4. Marcar invitation como aceptada
//   5. Devolver session para auto-login
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { checkApiRateLimit } from '@/lib/api-rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 15;

const Body = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8).max(200),
  // Optional: el invitee puede actualizar su nombre (ej. agregar título)
  name: z.string().min(1).max(120).optional(),
});

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    if (await checkApiRateLimit(`accept_invite:${ip}`, 10, 60)) {
      return NextResponse.json({ error: 'Demasiados intentos' }, { status: 429 });
    }

    const raw = await req.json().catch(() => null);
    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    }
    const { token, password, name: nameOverride } = parsed.data;

    const tokenHash = createHash('sha256').update(token).digest('hex');

    // 1. Validar token
    const { data: invite } = await supabaseAdmin
      .from('staff_invitations')
      .select('id, tenant_id, email, name, role, speciality, expires_at, accepted_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (!invite) {
      return NextResponse.json({ error: 'Invitación inválida o no encontrada' }, { status: 404 });
    }
    if (invite.accepted_at) {
      return NextResponse.json(
        { error: 'Esta invitación ya fue aceptada. Iniciá sesión normalmente.' },
        { status: 410 },
      );
    }
    if (new Date(invite.expires_at as string) < new Date()) {
      return NextResponse.json(
        { error: 'Esta invitación expiró. Pedile al admin del consultorio que te mande una nueva.' },
        { status: 410 },
      );
    }

    const tenantId = invite.tenant_id as string;
    const email = invite.email as string;
    const role = invite.role as string;
    const finalName = nameOverride || (invite.name as string);

    // 2. Crear auth.users vía admin API (auto-confirma email — el invitee ya
    //    demostró que tiene acceso al inbox al clickear el link)
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: finalName },
    });

    if (authErr || !authData.user) {
      // Si el user ya existe (raro pero posible — aceptó otra invite antes),
      // intentamos lookupearlo y linkearlo de todas formas.
      if (authErr?.message?.toLowerCase().includes('already')) {
        const { data: existingUser } = await supabaseAdmin.auth.admin.listUsers();
        const existing = existingUser?.users?.find((u) => u.email === email);
        if (!existing) {
          return NextResponse.json(
            { error: 'Este email ya está registrado pero no pudimos vincularlo. Intentá iniciar sesión.' },
            { status: 409 },
          );
        }
        return await linkStaffToUser({
          tenantId,
          userId: existing.id,
          email,
          name: finalName,
          role,
          speciality: invite.speciality as string | null,
          inviteId: invite.id as string,
        });
      }
      logger.error(
        '[accept-invite] auth createUser failed',
        authErr ? new Error(authErr.message) : undefined,
        { email, tenant_id: tenantId },
      );
      return NextResponse.json(
        { error: 'No pude crear tu cuenta. Intentá de nuevo o contactá soporte.' },
        { status: 500 },
      );
    }

    return await linkStaffToUser({
      tenantId,
      userId: authData.user.id,
      email,
      name: finalName,
      role,
      speciality: invite.speciality as string | null,
      inviteId: invite.id as string,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error('[accept-invite] unhandled', err instanceof Error ? err : undefined, {
      err: errMsg.slice(0, 300),
    });
    return NextResponse.json(
      { error: 'Ocurrió un error procesando tu invitación.' },
      { status: 500 },
    );
  }
}

async function linkStaffToUser(opts: {
  tenantId: string;
  userId: string;
  email: string;
  name: string;
  role: string;
  speciality: string | null;
  inviteId: string;
}): Promise<NextResponse> {
  // Buscar si ya existe un staff sin user_id que matchee el nombre — evita
  // crear duplicate cuando el owner pre-creó staff y luego invitó.
  const { data: candidateStaff } = await supabaseAdmin
    .from('staff')
    .select('id')
    .eq('tenant_id', opts.tenantId)
    .ilike('name', opts.name)
    .is('user_id', null)
    .limit(1);

  let staffId: string;

  if (candidateStaff && candidateStaff.length > 0) {
    // Linkear al staff pre-creado
    const { error } = await supabaseAdmin
      .from('staff')
      .update({
        user_id: opts.userId,
        role: opts.role,
        is_billable: opts.role === 'doctor',
        accepted_at: new Date().toISOString(),
      })
      .eq('id', candidateStaff[0].id);
    if (error) {
      logger.error('[accept-invite] staff link failed', new Error(error.message), {
        tenant_id: opts.tenantId,
      });
      return NextResponse.json({ error: 'Error vinculando tu cuenta' }, { status: 500 });
    }
    staffId = candidateStaff[0].id as string;
  } else {
    // Crear staff nuevo
    const { data: newStaff, error } = await supabaseAdmin
      .from('staff')
      .insert({
        tenant_id: opts.tenantId,
        user_id: opts.userId,
        name: opts.name,
        role: opts.role,
        speciality: opts.speciality,
        is_billable: opts.role === 'doctor',
        active: true,
        accepted_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error || !newStaff) {
      logger.error('[accept-invite] staff insert failed', error ? new Error(error.message) : undefined, {
        tenant_id: opts.tenantId,
      });
      return NextResponse.json({ error: 'Error creando tu perfil' }, { status: 500 });
    }
    staffId = newStaff.id as string;
  }

  // Marcar invitation aceptada
  await supabaseAdmin
    .from('staff_invitations')
    .update({ accepted_at: new Date().toISOString(), accepted_by: opts.userId })
    .eq('id', opts.inviteId);

  return NextResponse.json({
    ok: true,
    staff_id: staffId,
    tenant_id: opts.tenantId,
    role: opts.role,
    redirect_to: '/home',
  });
}
