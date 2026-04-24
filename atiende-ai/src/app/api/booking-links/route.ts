// ═════════════════════════════════════════════════════════════════════════════
// Booking links CRUD — admin-side (Phase 2.A.4)
//
// Autenticado con Supabase session (cookies). RLS policy 'tenant_data' ya
// escopa los rows al tenant_id del user, pero siempre validamos user →
// tenant lookup explícito como defense-in-depth.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UpsertSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z.string().min(3).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase + guiones'),
  staff_id: z.string().uuid().nullable().optional(),
  enabled: z.boolean().optional(),
  monthly_bookings_cap: z.number().int().min(1).max(10000).optional(),
  link_expires_at: z.string().datetime().nullable().optional(),
  heading: z.string().max(200).nullable().optional(),
  subheading: z.string().max(400).nullable().optional(),
  brand_color_hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

async function requireTenant(): Promise<{ tenantId: string } | NextResponse> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('user_id', user.id)
    .single();
  if (!tenant) return NextResponse.json({ error: 'no_tenant' }, { status: 403 });
  return { tenantId: tenant.id as string };
}

export async function GET(): Promise<NextResponse> {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await supabaseAdmin
    .from('public_booking_links')
    .select('id, slug, staff_id, enabled, monthly_bookings_cap, link_expires_at, heading, subheading, brand_color_hex, created_at, last_booking_at')
    .eq('tenant_id', auth.tenantId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('[booking-links] list failed', undefined, { err: error.message, tenantId: auth.tenantId });
    return NextResponse.json({ error: 'list_failed' }, { status: 500 });
  }
  return NextResponse.json({ links: data || [] });
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

  // Slug colisions: Postgres UNIQUE(slug) garantiza unicidad global. Si un
  // tenant intenta un slug que otro tenant ya tiene, recibimos 23505 y
  // respondemos 409.
  if (input.id) {
    // Update (verifica ownership)
    const { data, error } = await supabaseAdmin
      .from('public_booking_links')
      .update({
        slug: input.slug,
        staff_id: input.staff_id ?? null,
        enabled: input.enabled,
        monthly_bookings_cap: input.monthly_bookings_cap,
        link_expires_at: input.link_expires_at ?? null,
        heading: input.heading ?? null,
        subheading: input.subheading ?? null,
        brand_color_hex: input.brand_color_hex ?? null,
      })
      .eq('id', input.id)
      .eq('tenant_id', auth.tenantId)
      .select('id, slug')
      .single();

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json({ error: 'slug_taken' }, { status: 409 });
      }
      return NextResponse.json({ error: 'update_failed', detail: error.message }, { status: 500 });
    }
    return NextResponse.json({ link: data });
  }

  // Insert
  const { data, error } = await supabaseAdmin
    .from('public_booking_links')
    .insert({
      tenant_id: auth.tenantId,
      slug: input.slug,
      staff_id: input.staff_id ?? null,
      enabled: input.enabled ?? true,
      monthly_bookings_cap: input.monthly_bookings_cap ?? 100,
      link_expires_at: input.link_expires_at ?? null,
      heading: input.heading ?? null,
      subheading: input.subheading ?? null,
      brand_color_hex: input.brand_color_hex ?? null,
    })
    .select('id, slug')
    .single();

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'slug_taken' }, { status: 409 });
    }
    return NextResponse.json({ error: 'insert_failed', detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ link: data });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('public_booking_links')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenantId);

  if (error) return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
