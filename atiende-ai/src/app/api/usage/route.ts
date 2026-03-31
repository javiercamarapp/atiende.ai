import { NextRequest, NextResponse } from 'next/server';
import { getMonthlyUsage } from '@/lib/analytics/roi';

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId');
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
  }

  try {
    const count = await getMonthlyUsage(tenantId);
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch usage' }, { status: 500 });
  }
}
