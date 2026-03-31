import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { conversationsToCSV } from '@/lib/export/csv';

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: tenant } = await supabase.from('tenants').select('id').eq('user_id', user.id).single();
  if (!tenant) return NextResponse.json({ error: 'No tenant' }, { status: 403 });

  const { data: conversations } = await supabase
    .from('conversations')
    .select('customer_name, customer_phone, status, created_at, last_message_at, tags')
    .eq('tenant_id', tenant.id)
    .order('last_message_at', { ascending: false });

  const csv = conversationsToCSV(conversations || []);

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="conversaciones-${new Date().toISOString().split('T')[0]}.csv"`,
    },
  });
}
