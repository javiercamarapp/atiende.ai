// ═════════════════════════════════════════════════════════════════════════════
// CRON: data-retention-anonymize
//
// LFPDPPP Art. 13 (México) y NOM-024 establecen que datos personales NO
// deben conservarse más allá del tiempo necesario para el fin que fueron
// recabados. Para consultorios médicos, citas pasadas + datos de pacientes
// inactivos típicamente se conservan 5 años (estándar mexicano).
//
// Este cron corre semanalmente y anonimiza:
//   - contacts: pacientes sin actividad >5 años → name='Anonimizado',
//     phone hasheado, email/intake_data nulls. Mantiene id/tenant_id/
//     created_at para preservar relaciones e integridad referencial.
//   - messages: contenido cifrado se reemplaza por '[anonimizado]', se
//     mantiene metadata (intent, model, cost) para analytics agregadas.
//   - appointments: customer_name/phone anonimizados; mantiene fecha,
//     servicio, status para reporting.
//
// NO borra rows (eso es derecho de cancelación, otra figura LFPDPPP).
// Esto es retention/minimization automática — los datos identificables
// se reducen al mínimo necesario para auditorías + reporting.
//
// Schedule sugerido: domingos 04:00 UTC (vercel.json).
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/agents/internal/cron-helpers';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 300;

const RETENTION_YEARS_DEFAULT = 5;
const BATCH_SIZE = 200; // procesar en chunks para no saturar la DB

function phoneHash(phone: string): string {
  return 'anon:' + createHash('sha256').update(phone).digest('hex').slice(0, 16);
}

export async function GET(req: NextRequest) {
  const auth = requireCronAuth(req);
  if (auth) return auth;

  const retentionYears = Number(process.env.PHI_RETENTION_YEARS || RETENTION_YEARS_DEFAULT);
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - retentionYears);
  const cutoffIso = cutoff.toISOString();

  let totalContactsAnon = 0;
  let totalMsgsAnon = 0;
  let totalApptsAnon = 0;
  const errors: string[] = [];

  try {
    // Buscar contacts inactivos (sin last_contact_at o >5 años) que aún
    // no estén anonimizados (name != 'Anonimizado').
    const { data: stale } = await supabaseAdmin
      .from('contacts')
      .select('id, tenant_id, phone')
      .or(`last_contact_at.is.null,last_contact_at.lt.${cutoffIso}`)
      .lt('created_at', cutoffIso)
      .neq('name', 'Anonimizado')
      .limit(BATCH_SIZE);

    if (!stale || stale.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, retention_years: retentionYears });
    }

    for (const c of stale) {
      try {
        const id = c.id as string;
        const tenantId = c.tenant_id as string;
        const phoneRaw = (c.phone as string) || '';
        const hashedPhone = phoneRaw ? phoneHash(phoneRaw) : 'anon:unknown';

        // 1. Anonimizar contact — mantener id/tenant para integridad referencial
        await supabaseAdmin
          .from('contacts')
          .update({
            name: 'Anonimizado',
            phone: hashedPhone,
            email: null,
            intake_data: null,
            allergies: null,
            chronic_conditions: null,
            current_medications: null,
            insurance: null,
            tags: null,
            metadata: { anonymized_at: new Date().toISOString(), retention_years: retentionYears },
          })
          .eq('id', id)
          .eq('tenant_id', tenantId);
        totalContactsAnon++;

        // 2. Anonimizar messages del contacto. Mantenemos intent + model_used
        //    + costo para analytics agregadas (no PII).
        const { data: convs } = await supabaseAdmin
          .from('conversations')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('contact_id', id);
        const convIds = (convs || []).map((cv) => cv.id as string);

        if (convIds.length > 0) {
          const { count: msgCount } = await supabaseAdmin
            .from('messages')
            .update({
              content: '[anonimizado]',
              media_transcription: null,
              media_description: null,
            }, { count: 'exact' })
            .in('conversation_id', convIds);
          totalMsgsAnon += msgCount ?? 0;

          // Conversations: limpiar customer_name + customer_phone
          await supabaseAdmin
            .from('conversations')
            .update({ customer_name: null, customer_phone: hashedPhone })
            .in('id', convIds);
        }

        // 3. Anonimizar appointments — mantener fecha/servicio/status para
        //    reporting agregado. Quitar nombre y reemplazar phone con hash.
        const { count: aptCount } = await supabaseAdmin
          .from('appointments')
          .update({
            customer_name: 'Anonimizado',
            customer_phone: hashedPhone,
            notes: null,
          }, { count: 'exact' })
          .eq('tenant_id', tenantId)
          .eq('contact_id', id);
        totalApptsAnon += aptCount ?? 0;

        // 4. Audit log de la operación
        await supabaseAdmin.from('audit_log').insert({
          tenant_id: tenantId,
          action: 'data_retention.anonymized',
          entity_type: 'contact',
          entity_id: id,
          details: {
            retention_years: retentionYears,
            messages_anonymized: convIds.length,
            phone_hash: hashedPhone,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${c.id}: ${msg.slice(0, 200)}`);
        logger.warn('[data-retention] contact anon failed', {
          contact_id: c.id,
          err: msg.slice(0, 200),
        });
      }
    }

    logger.info('[data-retention] batch completed', {
      contacts_anon: totalContactsAnon,
      messages_anon: totalMsgsAnon,
      appointments_anon: totalApptsAnon,
      retention_years: retentionYears,
    });

    return NextResponse.json({
      ok: true,
      contacts_anonymized: totalContactsAnon,
      messages_anonymized: totalMsgsAnon,
      appointments_anonymized: totalApptsAnon,
      retention_years: retentionYears,
      cutoff: cutoffIso,
      errors: errors.slice(0, 10),
    });
  } catch (err) {
    logger.error(
      '[data-retention] unhandled',
      err instanceof Error ? err : new Error(String(err)),
    );
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
