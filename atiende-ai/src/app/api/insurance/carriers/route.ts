import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedTenant } from '@/lib/insurance/auth'
import { logInsuranceError } from '@/lib/insurance/logger'

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await getAuthenticatedTenant()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const page = parseInt(req.nextUrl.searchParams.get('page') ?? '1')
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '20'), 100)
    const from = (page - 1) * limit

    const { data: carriers, error, count } = await supabase
      .from('ins_carriers')
      .select('*', { count: 'exact' })
      .eq('is_active', true)
      .order('market_share_auto', { ascending: false })
      .range(from, from + limit - 1)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data: carriers, page, limit, total: count })
  } catch (err) {
    logInsuranceError(err, { route: 'carriers.GET' })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
