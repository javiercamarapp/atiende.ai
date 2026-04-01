import { NextResponse } from 'next/server'
import { getAuthenticatedTenant } from '@/lib/insurance/auth'
import { logInsuranceError } from '@/lib/insurance/logger'

export async function GET() {
  try {
    const { supabase, user } = await getAuthenticatedTenant()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: carriers, error } = await supabase
      .from('ins_carriers')
      .select('*')
      .eq('is_active', true)
      .order('market_share_auto', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(carriers)
  } catch (err) {
    logInsuranceError(err, { route: 'carriers.GET' })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
