import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedTenant } from '@/lib/insurance/auth'
import { encryptCredential } from '@/lib/insurance/credential-vault'
import { credentialCreateSchema, formatZodErrors } from '@/lib/insurance/validation'
import { checkInsuranceRateLimit } from '@/lib/insurance/rate-limit'
import { logInsuranceEvent, logInsuranceError } from '@/lib/insurance/logger'

export async function POST(req: NextRequest) {
  try {
    const { supabase, user, tenantId } = await getAuthenticatedTenant()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!tenantId) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Rate limit: 20 requests per minute per user
    const allowed = await checkInsuranceRateLimit(`cred:${user.id}`, 20, 60_000)
    if (!allowed) {
      logInsuranceEvent('rate_limit_exceeded', { route: 'credentials', user_id: user.id })
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = await req.json()
    const parsed = credentialCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: formatZodErrors(parsed.error) },
        { status: 400 }
      )
    }

    const { carrier_id, username, password, agent_number } = parsed.data

    const encrypted_username = encryptCredential(username)
    const encrypted_password = encryptCredential(password)

    const { data, error } = await supabase
      .from('ins_carrier_credentials')
      .upsert({
        tenant_id: tenantId,
        carrier_id,
        encrypted_username,
        encrypted_password,
        agent_number: agent_number || null,
        is_active: true,
        login_failure_count: 0,
      }, { onConflict: 'tenant_id,carrier_id' })
      .select('id, carrier_id, agent_number, is_active')
      .single()

    if (error) {
      logInsuranceError(error, { route: 'credentials.POST', carrier_id, user_id: user.id })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    logInsuranceEvent('credential_saved', { carrier_id, user_id: user.id })
    return NextResponse.json(data)
  } catch (err) {
    logInsuranceError(err, { route: 'credentials.POST' })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const { supabase, user, tenantId } = await getAuthenticatedTenant()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!tenantId) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const page = parseInt(req.nextUrl.searchParams.get('page') ?? '1')
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '20'), 100)
    const from = (page - 1) * limit

    // Return credentials WITHOUT decrypted values
    const { data, error, count } = await supabase
      .from('ins_carrier_credentials')
      .select('id, carrier_id, agent_number, is_active, last_login_success, login_failure_count, ins_carriers(name, slug, logo_url)', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .range(from, from + limit - 1)

    if (error) {
      logInsuranceError(error, { route: 'credentials.GET', user_id: user.id })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ data, page, limit, total: count })
  } catch (err) {
    logInsuranceError(err, { route: 'credentials.GET' })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
