// ═════════════════════════════════════════════════════════════════════════════
// DELETE MY DATA — derecho de cancelación LFPDPPP (FIX 12 / ARCO)
//
// El paciente puede solicitar la eliminación total de sus datos personales.
// Esta ruta es invocada desde un link en la respuesta del bot (después de
// "BAJA"/"STOP") o desde el dashboard del tenant si quiere borrar a un
// paciente.
//
// Flujo:
//   1. Auth: el solicitante debe ser dueño del tenant (o el paciente vía
//      token firmado, no implementado aún — se delega al support@atiende.ai).
//   2. Recibe { phone: string }
//   3. Borra: messages, appointments, contacts, conversations.
//   4. Retorna conteos.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  phone: z.string().min(6).max(20),
});

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('user_id', user.id)
    .single();
  if (!tenant) return NextResponse.json({ error: 'no_tenant' }, { status: 403 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_body', details: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const phone = body.phone.replace(/[^\d+]/g, '');
  const summary: Record<string, unknown> = {};

  try {
    // 1. Mensajes (vía conversación)
    const { data: convs } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('customer_phone', phone);
    const convIds = (convs || []).map((c) => c.id as string);
    if (convIds.length > 0) {
      const { count } = await supabaseAdmin
        .from('messages')
        .delete({ count: 'exact' })
        .in('conversation_id', convIds);
      summary.messages_deleted = count ?? 0;
    }

    // 2. Citas
    const { count: aptCount } = await supabaseAdmin
      .from('appointments')
      .delete({ count: 'exact' })
      .eq('tenant_id', tenant.id)
      .eq('customer_phone', phone);
    summary.appointments_deleted = aptCount ?? 0;

    // 3. Conversaciones
    if (convIds.length > 0) {
      const { count } = await supabaseAdmin
        .from('conversations')
        .delete({ count: 'exact' })
        .in('id', convIds);
      summary.conversations_deleted = count ?? 0;
    }

    // 4. Contacts
    const { count: contactCount } = await supabaseAdmin
      .from('contacts')
      .delete({ count: 'exact' })
      .eq('tenant_id', tenant.id)
      .eq('phone', phone);
    summary.contacts_deleted = contactCount ?? 0;

    return NextResponse.json({ status: 'ok', phone, summary });
  } catch (err) {
    return NextResponse.json(
      { error: 'delete_failed', message: err instanceof Error ? err.message : String(err), summary },
      { status: 500 },
    );
  }
}
