import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { syncMenuToRAG } from '@/lib/integrations/softrestaurant';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Verify authorization header for cron security
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Buscar tenants de tipo restaurante con SoftRestaurant configurado
  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id, business_type, config')
    .in('business_type', ['restaurant', 'taqueria', 'cafe'])
    .eq('status', 'active');

  let synced = 0;
  for (const t of tenants || []) {
    if (t.config?.softrestaurant_enabled) {
      const count = await syncMenuToRAG(t.id);
      if (count) synced++;
    }
  }

  return NextResponse.json({ synced });
}
