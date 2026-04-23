// ═══════════════════════════════════════════════════════════════════════════
// ARCO-S: Patient-initiated data deletion request
//
// LFPDPPP Art. 36 requires the "titular" (patient/data subject) to be able
// to request erasure of their personal data directly — not just the tenant
// owner. This endpoint:
//
//   1. Receives { phone, tenant_id } from a link in the bot's response
//      (e.g., after the patient sends "BAJA" or "BORRAR MIS DATOS")
//   2. Generates a time-limited signed token
//   3. Sends the token to the patient's WhatsApp as a confirmation link
//   4. The patient clicks the link → /api/privacy/confirm-deletion?token=X
//      which actually executes the deletion
//
// This two-step flow prevents accidental/malicious deletions — the patient
// must have access to the phone to confirm.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTextMessage } from '@/lib/whatsapp/send';
import { hashForBlindIndex } from '@/lib/utils/crypto';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  phone: z.string().min(6).max(20),
  tenant_id: z.string().uuid(),
});

const TOKEN_EXPIRY_HOURS = 24;

export async function POST(req: NextRequest) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const phone = body.phone.replace(/[^\d+]/g, '');
  const phoneHash = hashForBlindIndex(phone);

  // Verify the tenant exists and has a WA phone number
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('id, wa_phone_number_id, name')
    .eq('id', body.tenant_id)
    .single();

  if (!tenant?.wa_phone_number_id) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }

  // Generate a cryptographically secure token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  // Store the hashed token (never the raw token)
  const { error: insertErr } = await supabaseAdmin
    .from('arco_tokens')
    .insert({
      tenant_id: tenant.id,
      phone_hash: phoneHash,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
    });

  if (insertErr) {
    return NextResponse.json(
      { error: 'token_creation_failed', message: insertErr.message },
      { status: 500 },
    );
  }

  // Build the confirmation URL
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';
  const confirmUrl = `${baseUrl}/api/privacy/confirm-deletion?token=${rawToken}`;

  // Send WhatsApp message with the confirmation link
  const tenantName = (tenant.name as string) || 'el negocio';
  await sendTextMessage(
    tenant.wa_phone_number_id as string,
    phone,
    `🔒 Solicitud de eliminación de datos\n\n` +
    `Has solicitado borrar tus datos personales de ${tenantName}. ` +
    `Para confirmar, haz clic en el siguiente enlace (válido por ${TOKEN_EXPIRY_HOURS} horas):\n\n` +
    `${confirmUrl}\n\n` +
    `Si no solicitaste esto, ignora este mensaje. Tus datos no serán modificados.\n\n` +
    `Fundamento legal: LFPDPPP Art. 36 — Derecho de cancelación.`,
  );

  return NextResponse.json({
    status: 'confirmation_sent',
    expires_at: expiresAt.toISOString(),
  });
}
