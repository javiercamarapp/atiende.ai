import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { conversationsToCSV, messagesToCSV } from '@/lib/export/csv';
import { logger } from '@/lib/logger';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
  type: z.enum(['conversations', 'messages', 'appointments']),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});

const MAX_ROWS = 10_000;

// GET /api/analytics/export?format=csv|json&type=conversations|messages|appointments&from=2026-01-01&to=2026-03-31
export async function GET(request: NextRequest) {
  const log = logger.child({ module: 'api/analytics/export' });

  try {
    // --- Auth ---
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!tenant) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 403 });
    }

    const tenantId = tenant.id;

    // --- Validate query params ---
    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      format: searchParams.get('format') || undefined,
      type: searchParams.get('type'),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { format, type, from, to } = parsed.data;
    const fromISO = `${from}T00:00:00`;
    const toISO = `${to}T23:59:59`;

    log.info('Export request', { tenantId, format, type, from, to });

    // --- Fetch data based on type ---
    if (type === 'conversations') {
      const { data, error } = await supabaseAdmin
        .from('conversations')
        .select('customer_name, customer_phone, status, created_at, last_message_at, tags')
        .eq('tenant_id', tenantId)
        .gte('created_at', fromISO)
        .lte('created_at', toISO)
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS);

      if (error) {
        log.error('Export conversations query failed', new Error(error.message));
        return NextResponse.json({ error: 'Query failed' }, { status: 500 });
      }

      const rows = data || [];

      if (format === 'json') {
        return NextResponse.json({ type, from, to, count: rows.length, data: rows });
      }

      const csv = conversationsToCSV(rows);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="conversaciones-${from}-${to}.csv"`,
        },
      });
    }

    if (type === 'messages') {
      const { data, error } = await supabaseAdmin
        .from('messages')
        .select('direction, sender_type, content, intent, model_used, created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', fromISO)
        .lte('created_at', toISO)
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS);

      if (error) {
        log.error('Export messages query failed', new Error(error.message));
        return NextResponse.json({ error: 'Query failed' }, { status: 500 });
      }

      const rows = data || [];

      if (format === 'json') {
        return NextResponse.json({ type, from, to, count: rows.length, data: rows });
      }

      const csv = messagesToCSV(rows);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="mensajes-${from}-${to}.csv"`,
        },
      });
    }

    if (type === 'appointments') {
      const { data, error } = await supabaseAdmin
        .from('appointments')
        .select('customer_name, customer_phone, datetime, status, service_id, notes, created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', fromISO)
        .lte('created_at', toISO)
        .order('datetime', { ascending: false })
        .limit(MAX_ROWS);

      if (error) {
        log.error('Export appointments query failed', new Error(error.message));
        return NextResponse.json({ error: 'Query failed' }, { status: 500 });
      }

      const rows = data || [];

      if (format === 'json') {
        return NextResponse.json({ type, from, to, count: rows.length, data: rows });
      }

      const csv = appointmentsToCSV(rows);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="citas-${from}-${to}.csv"`,
        },
      });
    }

    return NextResponse.json({ error: 'Invalid export type' }, { status: 400 });
  } catch (err) {
    log.error('Export API error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// CSV helper for appointments (not in shared csv.ts yet)
// ---------------------------------------------------------------------------

function appointmentsToCSV(appointments: Array<{
  customer_name: string;
  customer_phone: string;
  datetime: string;
  status: string;
  service_id: string;
  notes: string;
  created_at: string;
}>): string {
  const headers = 'Nombre,Teléfono,Fecha/Hora,Estado,Servicio,Notas,Creado\n';
  const rows = appointments
    .map(
      a =>
        `"${a.customer_name || ''}","${a.customer_phone || ''}","${a.datetime}","${a.status}","${a.service_id || ''}","${(a.notes || '').replace(/"/g, '""')}","${a.created_at}"`,
    )
    .join('\n');
  return headers + rows;
}
