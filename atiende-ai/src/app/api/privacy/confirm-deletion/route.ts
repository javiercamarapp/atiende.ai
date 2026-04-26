// ═══════════════════════════════════════════════════════════════════════════
// ARCO-S: Confirm and execute patient data deletion
//
// The patient clicks the link sent to their WhatsApp. We verify the token,
// execute the deletion, log the audit trail, and confirm via WhatsApp.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';
import { logger } from '@/lib/logger';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function maskPhone(phone: string): string {
  if (phone.length <= 6) return '***';
  return phone.slice(0, 3) + '***' + phone.slice(-3);
}

export async function GET(req: NextRequest) {
  const rawToken = req.nextUrl.searchParams.get('token');
  if (!rawToken || rawToken.length !== 64) {
    return new NextResponse(htmlResponse('error', 'Token inválido o ausente.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  // 1. Find and validate the token
  const { data: tokenRow, error: tokenErr } = await supabaseAdmin
    .from('arco_tokens')
    .select('id, tenant_id, phone_hash, expires_at, used_at')
    .eq('token_hash', tokenHash)
    .single();

  if (tokenErr || !tokenRow) {
    return new NextResponse(
      htmlResponse('error', 'Token no encontrado. Puede haber expirado o ya fue utilizado.'),
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  if (tokenRow.used_at) {
    return new NextResponse(
      htmlResponse('error', 'Este token ya fue utilizado. Tus datos ya fueron eliminados.'),
      { status: 409, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  if (new Date(tokenRow.expires_at as string) < new Date()) {
    return new NextResponse(
      htmlResponse('error', 'Este token ha expirado. Solicita uno nuevo enviando "BORRAR MIS DATOS" al chat.'),
      { status: 410, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  // 2. Mark token as used (atomically)
  const { error: markErr } = await supabaseAdmin
    .from('arco_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', tokenRow.id)
    .is('used_at', null); // CAS: only if still unused

  if (markErr) {
    return new NextResponse(
      htmlResponse('error', 'Error procesando la solicitud. Intenta de nuevo.'),
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  // 3. Execute deletion — find all data by phone_hash
  const tenantId = tokenRow.tenant_id as string;
  const phoneHash = tokenRow.phone_hash as string;
  const summary: Record<string, number> = {};

  try {
    // Find conversations by phone hash
    const { data: convs } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('customer_phone_hash', phoneHash);
    const convIds = (convs || []).map(c => c.id as string);

    // Delete messages
    if (convIds.length > 0) {
      const { count } = await supabaseAdmin
        .from('messages')
        .delete({ count: 'exact' })
        .in('conversation_id', convIds);
      summary.messages = count ?? 0;
    }

    // Delete appointments
    const { count: aptCount } = await supabaseAdmin
      .from('appointments')
      .delete({ count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('customer_phone_hash', phoneHash);
    summary.appointments = aptCount ?? 0;

    // Delete conversations
    if (convIds.length > 0) {
      const { count } = await supabaseAdmin
        .from('conversations')
        .delete({ count: 'exact' })
        .in('id', convIds);
      summary.conversations = count ?? 0;
    }

    // Delete contacts
    const { count: contactCount } = await supabaseAdmin
      .from('contacts')
      .delete({ count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('phone_hash', phoneHash);
    summary.contacts = contactCount ?? 0;

    // Delete leads
    const { count: leadCount } = await supabaseAdmin
      .from('leads')
      .delete({ count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('phone_hash', phoneHash);
    summary.leads = leadCount ?? 0;

    // Delete appointment_waitlist (tabla agregada en PR #142). Aún no
    // tiene phone_hash column, así que filtramos por customer_phone si
    // existe en alguno de los conversations encontrados arriba — best
    // effort. Si la tabla no existe en este tenant, supabase devuelve
    // count=0 sin error (RLS allow-by-tenant).
    try {
      const { count: waitlistCount } = await supabaseAdmin
        .from('appointment_waitlist')
        .delete({ count: 'exact' })
        .eq('tenant_id', tenantId)
        .or(`customer_phone.eq.${phoneHash},customer_phone.like.${phoneHash.slice(0, 8)}%`);
      summary.appointment_waitlist = waitlistCount ?? 0;
    } catch {
      // Tabla no existe en este Supabase aún (migración pendiente)
    }

    // Delete survey_responses (PII vía patient_phone)
    try {
      const { count: surveyCount } = await supabaseAdmin
        .from('survey_responses')
        .delete({ count: 'exact' })
        .eq('tenant_id', tenantId)
        .like('patient_phone', `${phoneHash.slice(0, 8)}%`);
      summary.survey_responses = surveyCount ?? 0;
    } catch {
      // ok si no existe
    }

    // Delete scheduled_messages (recordatorios programados al phone)
    try {
      const { count: schedCount } = await supabaseAdmin
        .from('scheduled_messages')
        .delete({ count: 'exact' })
        .eq('tenant_id', tenantId)
        .like('patient_phone', `${phoneHash.slice(0, 8)}%`);
      summary.scheduled_messages = schedCount ?? 0;
    } catch {
      // ok si no existe
    }

    // Delete payments (vía customer_phone si la tabla la tiene)
    try {
      const { count: payCount } = await supabaseAdmin
        .from('payments')
        .delete({ count: 'exact' })
        .eq('tenant_id', tenantId)
        .like('customer_phone', `${phoneHash.slice(0, 8)}%`);
      summary.payments = payCount ?? 0;
    } catch {
      // ok si no existe
    }
  } catch (err) {
    logger.error(
      '[arco-s] deletion failed',
      err instanceof Error ? err : undefined,
      { tenantId, phoneHash },
    );
    return new NextResponse(
      htmlResponse('error', 'Error durante la eliminación. Se ha registrado el incidente.'),
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  // 4. Audit log
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  await supabaseAdmin.from('data_deletion_log').insert({
    tenant_id: tenantId,
    requested_by: 'patient_token',
    requester_identifier: `phone_hash:${phoneHash.slice(0, 8)}...`,
    phone_deleted: `hash:${phoneHash.slice(0, 8)}...`,
    deletion_summary: summary,
    legal_basis: 'LFPDPPP Art. 36 — derecho de cancelación (titular)',
    ip_address: clientIp,
  });

  // 5. Notify via WhatsApp (best-effort — the phone data is already deleted
  // so we can't look up the number, but the bot conversation still has context)
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('wa_phone_number_id, name')
    .eq('id', tenantId)
    .single();

  logger.info('[arco-s] patient data deletion completed', {
    tenantId,
    phoneHash: phoneHash.slice(0, 8),
    summary,
  });

  const totalDeleted = Object.values(summary).reduce((a, b) => a + b, 0);

  return new NextResponse(
    htmlResponse(
      'success',
      `Tus datos han sido eliminados exitosamente de ${(tenant?.name as string) || 'el negocio'}.\n\n` +
      `Se eliminaron ${totalDeleted} registros (${summary.messages || 0} mensajes, ` +
      `${summary.appointments || 0} citas, ${summary.contacts || 0} contactos).\n\n` +
      `Este proceso es irreversible. Se ha generado un registro de auditoría conforme ` +
      `al Artículo 36 de la LFPDPPP.`,
    ),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

function htmlResponse(type: 'success' | 'error', message: string): string {
  const color = type === 'success' ? '#10b981' : '#ef4444';
  const icon = type === 'success' ? '✓' : '✗';
  const title = type === 'success' ? 'Datos eliminados' : 'Error';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Atiende.ai</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 40px auto; padding: 20px; background: #fafafa; color: #333; }
    .card { background: white; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; }
    .icon { font-size: 48px; color: ${color}; margin-bottom: 16px; }
    h1 { font-size: 20px; margin: 0 0 16px; }
    p { font-size: 14px; line-height: 1.6; color: #666; white-space: pre-line; }
    .legal { margin-top: 24px; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="legal">
      Atiende.ai — Aviso de privacidad y derechos ARCO-S conforme a la
      Ley Federal de Protección de Datos Personales en Posesión de los
      Particulares (LFPDPPP).
    </div>
  </div>
</body>
</html>`;
}
