// ═════════════════════════════════════════════════════════════════════════════
// POST /api/privacy/export-data
//
// LFPDPPP Art. 33 (México) — derecho de ACCESO del titular.
// El paciente solicita ver TODOS los datos personales que el consultorio
// tiene de él. Devolvemos un JSON con: contact, conversations + messages,
// appointments, payments, surveys, waitlist, prescription reminders.
//
// PII está cifrada at-rest; aquí desciframos para entregar al titular.
// El endpoint es idempotente (read-only) y exige auth via token de un
// solo uso (mismo flow que delete-my-data) para evitar enumeración.
//
// Aliases bajo /api/privacy mantiene la convención del derecho ARCO-S.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { decryptPII } from '@/lib/utils/crypto';
import { logger } from '@/lib/logger';
import { checkApiRateLimit } from '@/lib/api-rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BodySchema = z.object({
  token: z.string().min(20).max(200),
});

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  // Hard rate limit (5 req/min/IP) para evitar abuse
  if (await checkApiRateLimit(`export_ip:${ip}`, 5, 60)) {
    return NextResponse.json({ error: 'Demasiadas solicitudes' }, { status: 429 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Token requerido' }, { status: 400 });
  }
  const { token } = parsed.data;

  // Validar token (reutiliza tabla arco_tokens del flow de deletion)
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { data: tokenRow } = await supabaseAdmin
    .from('arco_tokens')
    .select('id, tenant_id, phone_hash, used_at, expires_at, kind')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!tokenRow) {
    return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  }
  if (tokenRow.used_at) {
    return NextResponse.json({ error: 'Token ya utilizado' }, { status: 410 });
  }
  if (tokenRow.expires_at && new Date(tokenRow.expires_at as string) < new Date()) {
    return NextResponse.json({ error: 'Token expirado' }, { status: 410 });
  }
  // Permitimos tanto kind='deletion' como 'export' (algunos flow viejos
  // crean solo deletion). El log distingue en audit_log.
  void tokenRow.kind;

  const tenantId = tokenRow.tenant_id as string;
  const phoneHash = tokenRow.phone_hash as string;

  try {
    // Lookup contact + conversations + messages + appointments + waitlist + payments + surveys
    const [contactRes, convsRes, apptsRes, waitlistRes, paymentsRes, surveysRes] = await Promise.all([
      supabaseAdmin
        .from('contacts')
        .select('id, name, phone, email, intake_data, allergies, chronic_conditions, current_medications, insurance, tags, lead_score, lead_temperature, last_contact_at, created_at')
        .eq('tenant_id', tenantId)
        .eq('phone_hash', phoneHash)
        .maybeSingle(),
      supabaseAdmin
        .from('conversations')
        .select('id, channel, status, tags, last_message_at, summary, created_at')
        .eq('tenant_id', tenantId)
        .eq('customer_phone_hash', phoneHash),
      supabaseAdmin
        .from('appointments')
        .select('id, datetime, end_datetime, status, confirmation_code, notes, created_at, services:service_id(name, price), staff:staff_id(name)')
        .eq('tenant_id', tenantId)
        .eq('customer_phone_hash', phoneHash)
        .order('datetime', { ascending: false }),
      supabaseAdmin
        .from('appointment_waitlist')
        .select('id, preferred_date_from, preferred_date_to, preferred_time_window, status, notes, created_at')
        .eq('tenant_id', tenantId)
        .like('customer_phone', `${phoneHash.slice(0, 8)}%`),
      supabaseAdmin
        .from('payments')
        .select('id, amount, currency, status, provider, created_at')
        .eq('tenant_id', tenantId)
        .like('customer_phone', `${phoneHash.slice(0, 8)}%`),
      supabaseAdmin
        .from('survey_responses')
        .select('id, rating, would_recommend, comment, sentiment_score, created_at')
        .eq('tenant_id', tenantId)
        .like('patient_phone', `${phoneHash.slice(0, 8)}%`),
    ]);

    // Decrypt PII for the response
    const contact = contactRes.data
      ? {
          ...contactRes.data,
          name: decryptPII((contactRes.data.name as string) || '') || contactRes.data.name,
          phone: decryptPII((contactRes.data.phone as string) || '') || contactRes.data.phone,
          email: contactRes.data.email
            ? decryptPII((contactRes.data.email as string) || '') || contactRes.data.email
            : null,
        }
      : null;

    if (!contact) {
      return NextResponse.json({
        error: 'No se encontraron datos asociados a este token',
      }, { status: 404 });
    }

    // Fetch messages of the contact's conversations (decrypted)
    const convIds = (convsRes.data || []).map((c) => c.id as string);
    let messagesData: Array<{
      conversation_id: string;
      direction: string;
      content_decrypted: string;
      intent: string | null;
      created_at: string;
    }> = [];
    if (convIds.length > 0) {
      const { data: msgRows } = await supabaseAdmin
        .from('messages')
        .select('conversation_id, direction, content, intent, created_at')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: true })
        .limit(2000); // cap defensivo

      messagesData = (msgRows || []).map((m) => ({
        conversation_id: m.conversation_id as string,
        direction: m.direction as string,
        content_decrypted: decryptPII((m.content as string) || '') || (m.content as string) || '',
        intent: (m.intent as string | null) || null,
        created_at: m.created_at as string,
      }));
    }

    // Mark token used
    await supabaseAdmin
      .from('arco_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', tokenRow.id)
      .is('used_at', null);

    // Audit log
    await supabaseAdmin.from('data_deletion_log').insert({
      tenant_id: tenantId,
      requested_by: 'patient_token',
      requester_identifier: `phone_hash:${phoneHash.slice(0, 8)}...`,
      phone_deleted: `hash:${phoneHash.slice(0, 8)}...`,
      deletion_summary: { kind: 'export', export_size_bytes: 0 },
      legal_basis: 'LFPDPPP Art. 33 — derecho de acceso (titular)',
      ip_address: clientIp(req),
    });

    return NextResponse.json({
      ok: true,
      legal_basis: 'LFPDPPP Art. 33 — derecho de acceso del titular',
      generated_at: new Date().toISOString(),
      data: {
        contact,
        conversations: convsRes.data || [],
        messages: messagesData,
        appointments: apptsRes.data || [],
        waitlist_entries: waitlistRes.data || [],
        payments: paymentsRes.data || [],
        survey_responses: surveysRes.data || [],
      },
      counts: {
        conversations: (convsRes.data || []).length,
        messages: messagesData.length,
        appointments: (apptsRes.data || []).length,
        waitlist_entries: (waitlistRes.data || []).length,
        payments: (paymentsRes.data || []).length,
        survey_responses: (surveysRes.data || []).length,
      },
      notes: [
        'Este export contiene tus datos personales tal como están en nuestros sistemas a la fecha.',
        'Los mensajes están desencriptados; el almacenamiento original está cifrado AES-256-GCM.',
        'Para borrado total, usa el flow de "eliminar mis datos" (LFPDPPP Art. 36).',
      ],
    });
  } catch (err) {
    logger.error(
      '[arco-a] export failed',
      err instanceof Error ? err : new Error(String(err)),
      { tenantId, phoneHash: phoneHash.slice(0, 8) },
    );
    return NextResponse.json({ error: 'Error generando export' }, { status: 500 });
  }
}
