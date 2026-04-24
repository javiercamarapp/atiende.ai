// ═════════════════════════════════════════════════════════════════════════════
// Locations CRUD (Phase 2.B.3)
//
// Autenticado con Supabase session. RLS 'tenant_data' escopa rows; siempre
// filtramos manualmente por tenant_id como defense-in-depth dado que usamos
// supabaseAdmin para writes.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UpsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2).max(200),
  address: z.string().max(500).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  postal_code: z.string().max(20).nullable().optional(),
  country: z.string().max(10).nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  google_place_id: z.string().max(200).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  timezone: z.string().max(100).nullable().optional(),
  business_hours: z.record(z.string(), z.string()).optional(),
  is_primary: z.boolean().optional(),
  active: z.boolean().optional(),
  // staff_ids asignados a esta location (replace semantics, simplifica UI)
  staff_ids: z.array(z.string().uuid()).optional(),
});

async function requireTenant(): Promise<{ tenantId: string } | NextResponse> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: tenant } = await supabase
    .from('tenants').select('id').eq('user_id', user.id).single();
  if (!tenant) return NextResponse.json({ error: 'no_tenant' }, { status: 403 });
  return { tenantId: tenant.id as string };
}

export async function GET(): Promise<NextResponse> {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;

  const { data: locations, error } = await supabaseAdmin
    .from('locations')
    .select('*')
    .eq('tenant_id', auth.tenantId)
    .order('is_primary', { ascending: false })
    .order('name');

  if (error) return NextResponse.json({ error: 'list_failed' }, { status: 500 });

  // staff_locations para construir el mapping location → staff_ids
  const ids = (locations || []).map((l) => l.id as string);
  const { data: staffLocs } = ids.length
    ? await supabaseAdmin.from('staff_locations').select('staff_id, location_id').in('location_id', ids)
    : { data: [] };
  const byLocation: Record<string, string[]> = {};
  for (const sl of staffLocs || []) {
    const lid = sl.location_id as string;
    if (!byLocation[lid]) byLocation[lid] = [];
    byLocation[lid].push(sl.staff_id as string);
  }

  return NextResponse.json({
    locations: (locations || []).map((l) => ({ ...l, staff_ids: byLocation[l.id as string] || [] })),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = UpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_params', issues: parsed.error.issues.slice(0, 3) }, { status: 400 });
  }
  const input = parsed.data;

  const { staff_ids, ...locationFields } = input;
  const upsertFields: Record<string, unknown> = { ...locationFields, updated_at: new Date().toISOString() };
  // Strip `id` del payload de fields si estamos updating
  if ('id' in upsertFields) delete upsertFields.id;

  let savedLocationId: string;
  if (input.id) {
    // Update — si is_primary=true, unset previous primary de este tenant.
    if (input.is_primary) {
      await supabaseAdmin.from('locations')
        .update({ is_primary: false })
        .eq('tenant_id', auth.tenantId)
        .neq('id', input.id);
    }
    const { data, error } = await supabaseAdmin
      .from('locations')
      .update(upsertFields)
      .eq('id', input.id)
      .eq('tenant_id', auth.tenantId)
      .select('id').single();
    if (error || !data) return NextResponse.json({ error: 'update_failed', detail: error?.message }, { status: 500 });
    savedLocationId = data.id as string;
  } else {
    if (input.is_primary) {
      await supabaseAdmin.from('locations')
        .update({ is_primary: false })
        .eq('tenant_id', auth.tenantId);
    }
    const { data, error } = await supabaseAdmin
      .from('locations')
      .insert({ ...upsertFields, tenant_id: auth.tenantId })
      .select('id').single();
    if (error || !data) return NextResponse.json({ error: 'insert_failed', detail: error?.message }, { status: 500 });
    savedLocationId = data.id as string;
  }

  // Replace semantics para staff_ids — si el caller provee el array,
  // reemplazamos todas las asignaciones. Si NO viene staff_ids, no tocamos.
  if (staff_ids !== undefined) {
    // Validar que todos los staff pertenecen al tenant
    const { data: ownStaff } = await supabaseAdmin
      .from('staff').select('id').eq('tenant_id', auth.tenantId).in('id', staff_ids);
    const validIds = new Set((ownStaff || []).map((s) => s.id as string));
    const filtered = staff_ids.filter((id) => validIds.has(id));

    await supabaseAdmin.from('staff_locations').delete().eq('location_id', savedLocationId);
    if (filtered.length > 0) {
      await supabaseAdmin.from('staff_locations').insert(
        filtered.map((staff_id) => ({ staff_id, location_id: savedLocationId })),
      );
    }
  }

  return NextResponse.json({ id: savedLocationId });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  // staff_locations cascadean por FK; appointments.location_id pasa a NULL.
  const { error } = await supabaseAdmin
    .from('locations').delete().eq('id', id).eq('tenant_id', auth.tenantId);
  if (error) return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
