// ═════════════════════════════════════════════════════════════════════════════
// GET/PATCH /api/tenants/telemed-config (Phase 2.C)
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchSchema = z.object({
  telemedicine_enabled:    z.boolean().optional(),
  telemedicine_provider:   z.enum(['jitsi', 'daily', 'custom_url']).optional(),
  telemedicine_custom_url: z.string().url().max(500).nullable().optional(),
}).strict();

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

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('telemedicine_enabled, telemedicine_provider, telemedicine_custom_url')
    .eq('id', auth.tenantId)
    .single();

  if (error || !data) return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  return NextResponse.json({
    telemedicine_enabled: data.telemedicine_enabled ?? false,
    telemedicine_provider: data.telemedicine_provider ?? 'jitsi',
    telemedicine_custom_url: data.telemedicine_custom_url ?? null,
  });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_params', issues: parsed.error.issues.slice(0, 3) }, { status: 400 });
  }

  // Si provider=custom_url, custom_url es REQUIRED
  if (parsed.data.telemedicine_provider === 'custom_url' && !parsed.data.telemedicine_custom_url) {
    return NextResponse.json({
      error: 'custom_url_required',
      message: 'Si elegís proveedor custom, debés pegar la URL de tu sala.',
    }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('tenants')
    .update(parsed.data)
    .eq('id', auth.tenantId);

  if (error) return NextResponse.json({ error: 'update_failed', detail: error.message }, { status: 500 });

  // Audit fix: invalidar cache 1hr.
  const { invalidateTenantCache } = await import('@/lib/cache');
  await invalidateTenantCache(auth.tenantId);

  return NextResponse.json({ ok: true });
}
