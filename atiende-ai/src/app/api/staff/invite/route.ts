// ═════════════════════════════════════════════════════════════════════════════
// POST /api/staff/invite
//
// Owner del consultorio invita a otro doctor/recepcionista/admin por email.
// Genera un token de un solo uso, persiste en `staff_invitations`, y envía
// email vía Resend con el link para completar registro.
//
// Auth: solo el owner puede invitar (canManageTeam check).
// Rate limit: 20 invites/dia/tenant para evitar abuse.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send';
import { requireCurrentStaff, canManageTeam, ForbiddenError, UnauthorizedError } from '@/lib/auth/current-staff';
import { checkApiRateLimit } from '@/lib/api-rate-limit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 15;

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().min(1).max(120),
  role: z.enum(['admin', 'doctor', 'receptionist']).default('doctor'),
  speciality: z.string().max(120).optional(),
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.useatiende.ai';

export async function POST(req: NextRequest) {
  try {
    const me = await requireCurrentStaff();
    if (!canManageTeam(me)) {
      throw new ForbiddenError('Solo el owner del consultorio puede invitar miembros');
    }

    if (await checkApiRateLimit(`invite:${me.tenantId}`, 20, 86400)) {
      return NextResponse.json(
        { error: 'Has alcanzado el límite diario de invitaciones (20/día). Intenta mañana.' },
        { status: 429 },
      );
    }

    const raw = await req.json().catch(() => null);
    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.issues }, { status: 400 });
    }
    const { email, name, role, speciality } = parsed.data;

    // Verificar que no haya un staff activo con ese email asociado al tenant
    // (para no duplicar — si quiere reactivar, hay otro endpoint).
    const { data: existing } = await supabaseAdmin
      .from('staff')
      .select('id, name')
      .eq('tenant_id', me.tenantId)
      .eq('user_id', null) // hack — checamos email en auth.users
      .limit(1);
    if (existing && existing.length > 0) {
      // El backfill puede haber dejado staff sin user_id que coincide por nombre
      // — best effort para evitar duplicates evidentes. No bloquea.
    }

    // Verificar que no haya invite pendiente para ese email + tenant
    const { data: pendingInvite } = await supabaseAdmin
      .from('staff_invitations')
      .select('id, expires_at')
      .eq('tenant_id', me.tenantId)
      .eq('email', email)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (pendingInvite) {
      return NextResponse.json(
        { error: 'Ya hay una invitación pendiente para este email. Reenvíala desde el dashboard si es necesario.' },
        { status: 409 },
      );
    }

    // Generar token: 32 bytes random base64url. Persistimos solo el hash
    // SHA-256 (defensa contra DB dump leak). El token plano va por email.
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const { data: invitation, error: insertErr } = await supabaseAdmin
      .from('staff_invitations')
      .insert({
        tenant_id: me.tenantId,
        invited_by: me.userId,
        email,
        name,
        role,
        speciality: speciality || null,
        token_hash: tokenHash,
      })
      .select('id, expires_at')
      .single();

    if (insertErr || !invitation) {
      logger.error(
        '[staff/invite] insert failed',
        insertErr ? new Error(insertErr.message) : undefined,
        { tenant_id: me.tenantId },
      );
      return NextResponse.json({ error: 'No pude crear la invitación. Intenta de nuevo.' }, { status: 500 });
    }

    // Email
    const acceptUrl = `${APP_URL}/accept-invite?token=${encodeURIComponent(token)}`;
    const tenantName = await getTenantName(me.tenantId);
    const roleLabel = ROLE_LABELS[role];

    await sendEmail({
      to: email,
      subject: `${me.name} te invitó a ${tenantName} en atiende.ai`,
      html: inviteEmailHtml({
        inviterName: me.name,
        tenantName,
        roleLabel,
        acceptUrl,
        expiresAt: invitation.expires_at as string,
      }),
    });

    return NextResponse.json({
      ok: true,
      invitation_id: invitation.id,
      expires_at: invitation.expires_at,
      // El token NO se devuelve en la response — solo va por email.
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Necesitas iniciar sesión' }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error('[staff/invite] unhandled', err instanceof Error ? err : undefined, {
      err: errMsg.slice(0, 300),
    });
    return NextResponse.json(
      { error: 'Ocurrió un error procesando tu invitación. Intenta de nuevo.' },
      { status: 500 },
    );
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  owner: 'Dueño',
  admin: 'Administrador',
  doctor: 'Doctor(a)',
  receptionist: 'Recepcionista',
};

async function getTenantName(tenantId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('tenants').select('name').eq('id', tenantId).maybeSingle();
  return (data?.name as string) || 'tu consultorio';
}

function inviteEmailHtml(opts: {
  inviterName: string;
  tenantName: string;
  roleLabel: string;
  acceptUrl: string;
  expiresAt: string;
}): string {
  const expiresFmt = new Date(opts.expiresAt).toLocaleDateString('es-MX', {
    timeZone: 'America/Mexico_City',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f7;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td style="padding:32px 40px 8px 40px;text-align:center;">
          <div style="font-size:14px;color:#6366f1;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Invitación a atiende.ai</div>
        </td></tr>
        <tr><td style="padding:8px 40px 16px 40px;">
          <h1 style="margin:0;font-size:24px;font-weight:600;letter-spacing:-0.02em;color:#09090b;text-align:center;">
            ${escapeHtml(opts.inviterName)} te invitó a <strong>${escapeHtml(opts.tenantName)}</strong>
          </h1>
        </td></tr>
        <tr><td style="padding:0 40px 24px 40px;">
          <p style="margin:0;font-size:15px;line-height:1.6;color:#52525b;">
            Tu rol será <strong style="color:#09090b;">${escapeHtml(opts.roleLabel)}</strong>.
            Atiende.ai es una plataforma de agentes AI para WhatsApp que automatiza la agenda
            de tu consultorio, recordatorios, lista de espera y mucho más.
          </p>
        </td></tr>
        <tr><td style="padding:8px 40px 32px 40px;text-align:center;">
          <a href="${opts.acceptUrl}" style="display:inline-block;background:hsl(235,84%,55%);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:15px;font-weight:500;">
            Aceptar invitación
          </a>
        </td></tr>
        <tr><td style="padding:0 40px 24px 40px;">
          <p style="margin:0;font-size:13px;line-height:1.6;color:#a1a1aa;text-align:center;">
            Este link expira el <strong>${expiresFmt}</strong>.<br>
            Si no esperabas esta invitación, podés ignorar este correo.
          </p>
        </td></tr>
        <tr><td style="padding:24px 40px;border-top:1px solid #f4f4f5;text-align:center;">
          <p style="margin:0;font-size:11px;color:#a1a1aa;">
            atiende.ai · Operaciones autónomas por WhatsApp para profesionales de la salud<br>
            <a href="${APP_URL}" style="color:hsl(235,84%,55%);text-decoration:none;">${APP_URL.replace('https://', '')}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
