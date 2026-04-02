import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedTenant } from '@/lib/insurance/auth'
import { fanOutQuoteToCarriers } from '@/lib/insurance/fan-out'
import { quoteRequestSchema, formatZodErrors } from '@/lib/insurance/validation'
import { checkInsuranceRateLimit } from '@/lib/insurance/rate-limit'
import { logInsuranceEvent, logInsuranceError } from '@/lib/insurance/logger'

export async function POST(req: NextRequest) {
  try {
    const { supabase, user, tenantId } = await getAuthenticatedTenant()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!tenantId) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Rate limit: 10 requests per minute per user
    const allowed = await checkInsuranceRateLimit(`quote:${user.id}`, 10, 60_000)
    if (!allowed) {
      logInsuranceEvent('rate_limit_exceeded', { route: 'quote', user_id: user.id })
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = await req.json()
    const parsed = quoteRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: formatZodErrors(parsed.error) },
        { status: 400 }
      )
    }

    const input = parsed.data

    // Idempotency: check for duplicate request within last 60 seconds
    const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString()
    const { data: existingReq } = await supabase
      .from('ins_quote_requests')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('insurance_line', input.insurance_line)
      .eq('client_name', input.client.name)
      .eq('client_zip_code', input.client.zip_code)
      .gte('started_at', sixtySecondsAgo)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingReq) {
      logInsuranceEvent('quote_request_deduplicated', {
        existing_request_id: existingReq.id,
        user_id: user.id,
      })
      return NextResponse.json({
        request_id: existingReq.id,
        deduplicated: true,
        status: 'quoting',
        stream_url: `/api/insurance/stream?id=${existingReq.id}`,
      })
    }

    // 1. Create quote request
    const { data: quoteReq, error: qrErr } = await supabase
      .from('ins_quote_requests')
      .insert({
        tenant_id: tenantId,
        contact_id: input.contact_id || null,
        conversation_id: input.conversation_id || null,
        insurance_line: input.insurance_line,
        client_name: input.client.name,
        client_phone: input.client.phone || null,
        client_email: input.client.email || null,
        client_rfc: input.client.rfc || null,
        client_birthdate: input.client.birthdate || null,
        client_gender: input.client.gender || null,
        client_zip_code: input.client.zip_code,
        vehicle_brand: input.vehicle?.brand || null,
        vehicle_model: input.vehicle?.model || null,
        vehicle_year: input.vehicle?.year || null,
        vehicle_version: input.vehicle?.version || null,
        vehicle_use: input.vehicle?.use || 'particular',
        coverage_type: input.coverage_type || 'amplia',
        status: 'quoting',
        source: input.source,
        raw_input: input.raw_input || null,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (qrErr) {
      logInsuranceError(qrErr, { route: 'quote.POST', step: 'create_request', user_id: user.id })
      return NextResponse.json({ error: qrErr.message }, { status: 500 })
    }

    const requestId = quoteReq.id

    logInsuranceEvent('quote_request_created', {
      request_id: requestId,
      insurance_line: input.insurance_line,
      user_id: user.id,
    })

    // 2. Fan-out to carriers via shared helper
    const { carriersTargeted } = await fanOutQuoteToCarriers({
      requestId,
      tenantId,
      insuranceLine: input.insurance_line,
      clientData: input.client,
      vehicleData: input.vehicle,
      coverageType: input.coverage_type,
      supabase,
    })

    return NextResponse.json({
      request_id: requestId,
      carriers_targeted: carriersTargeted,
      status: 'quoting',
      stream_url: `/api/insurance/stream?id=${requestId}`,
    })
  } catch (err) {
    logInsuranceError(err, { route: 'quote.POST' })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
