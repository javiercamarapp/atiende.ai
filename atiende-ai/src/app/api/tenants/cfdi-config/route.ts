// ═════════════════════════════════════════════════════════════════════════════
// CFDI fiscal config — GET/PATCH (Phase 2.D.2)
//
// Permite que el dueño configure su Facturapi API key + datos fiscales
// (RFC, razón social, régimen) desde el dashboard. La API key NUNCA se
// devuelve al frontend — sólo el flag `has_api_key` para UI.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchSchema = z.object({
  facturapi_api_key:    z.string().min(20).max(200).optional(),
  legal_business_name:  z.string().min(2).max(200).nullable().optional(),
  legal_rfc:            z.string().min(12).max(13).nullable().optional(),
  legal_tax_regime:     z.string().min(3).max(10).nullable().optional(),
  legal_address:        z.string().max(500).nullable().optional(),
  legal_postal_code:    z.string().min(5).max(5).nullable().optional(),
  cfdi_default_use:     z.enum(['G01', 'G02', 'G03', 'D01', 'P01', 'CN01', 'S01']).optional(),
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
    .select('facturapi_api_key, legal_business_name, legal_rfc, legal_tax_regime, legal_address, legal_postal_code, cfdi_default_use')
    .eq('id', auth.tenantId)
    .single();

  if (error || !data) return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });

  // Nunca devolvemos la API key — solo flag booleano
  const apiKey = data.facturapi_api_key as string | null;
  return NextResponse.json({
    has_api_key: !!apiKey,
    api_key_preview: apiKey ? `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}` : null,
    legal_business_name: data.legal_business_name,
    legal_rfc: data.legal_rfc,
    legal_tax_regime: data.legal_tax_regime,
    legal_address: data.legal_address,
    legal_postal_code: data.legal_postal_code,
    cfdi_default_use: data.cfdi_default_use ?? 'G03',
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

  // RFC normalization: uppercase
  const updates: Record<string, unknown> = { ...parsed.data };
  if (typeof updates.legal_rfc === 'string') updates.legal_rfc = updates.legal_rfc.toUpperCase();
  // Si la API key es la cadena vacía, lo tratamos como "borrar credencial"
  if (updates.facturapi_api_key === '') updates.facturapi_api_key = null;

  const { error } = await supabaseAdmin
    .from('tenants')
    .update(updates)
    .eq('id', auth.tenantId);

  if (error) return NextResponse.json({ error: 'update_failed', detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
