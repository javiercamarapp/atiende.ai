import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { Client } from '@upstash/qstash'
import { decryptCredential } from '@/lib/insurance/credential-vault'
import { isCircuitOpen } from '@/lib/insurance/circuit-breaker'
import type { QuoteRequestInput, WorkerQuotePayload } from '@/lib/insurance/types'

function getQStash() {
  return new Client({ token: process.env.QSTASH_TOKEN! })
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const input: QuoteRequestInput = await req.json()

    const { data: userRow } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const tenantId = userRow.tenant_id

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

    if (qrErr) return NextResponse.json({ error: qrErr.message }, { status: 500 })

    const requestId = quoteReq.id

    // 2. Get carriers with active credentials for this insurance line
    const { data: creds } = await supabase
      .from('ins_carrier_credentials')
      .select('*, ins_carriers(*)')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)

    type CredRow = NonNullable<typeof creds>[number]
    const eligibleCarriers = (creds ?? []).filter((c: CredRow) =>
      (c as Record<string, unknown>).ins_carriers &&
      ((c as Record<string, unknown>).ins_carriers as Record<string, unknown>).is_active &&
      (((c as Record<string, unknown>).ins_carriers as Record<string, unknown>).supported_lines as string[]).includes(input.insurance_line) &&
      ((c as Record<string, unknown>).ins_carriers as Record<string, unknown>).health_status !== 'down'
    )

    // 3. Create individual quote records
    if (eligibleCarriers.length > 0) {
      await supabase.from('ins_quotes').insert(
        eligibleCarriers.map((c: CredRow) => ({
          quote_request_id: requestId,
          tenant_id: tenantId,
          carrier_id: c.carrier_id,
          status: 'pending' as const,
        }))
      )
    }

    await supabase
      .from('ins_quote_requests')
      .update({ carriers_targeted: eligibleCarriers.length })
      .eq('id', requestId)

    // 4. Fan-out via QStash
    const workerUrl = process.env.INSURANCE_WORKER_URL
    const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

    if (workerUrl) {
      await Promise.allSettled(
        eligibleCarriers.map(async (cred: CredRow) => {
          const carrier = (cred as Record<string, unknown>).ins_carriers as Record<string, unknown>

          if (await isCircuitOpen(carrier.slug as string)) {
            await supabase.from('ins_quotes').update({
              status: 'skipped',
              error_message: 'Circuit breaker open',
              error_type: 'circuit_open',
              completed_at: new Date().toISOString(),
            }).eq('quote_request_id', requestId).eq('carrier_id', cred.carrier_id)
            return
          }

          const payload: WorkerQuotePayload = {
            request_id: requestId,
            tenant_id: tenantId,
            carrier_slug: carrier.slug as string,
            carrier_portal_url: carrier.portal_url as string,
            carrier_portal_type: carrier.portal_type as WorkerQuotePayload['carrier_portal_type'],
            insurance_line: input.insurance_line,
            client_data: input.client,
            vehicle_data: input.vehicle,
            coverage_type: input.coverage_type,
            credentials: {
              username: decryptCredential(cred.encrypted_username),
              password: decryptCredential(cred.encrypted_password),
              agent_number: cred.agent_number ?? undefined,
            },
          }

          return getQStash().publishJSON({
            url: `${workerUrl}/quote`,
            body: payload,
            retries: 2,
            callback: `${appUrl}/api/insurance/callback`,
            failureCallback: `${appUrl}/api/insurance/callback`,
            headers: {
              'x-worker-secret': process.env.INSURANCE_WORKER_SECRET!,
            },
          })
        })
      )
    }

    return NextResponse.json({
      request_id: requestId,
      carriers_targeted: eligibleCarriers.length,
      status: 'quoting',
      stream_url: `/api/insurance/stream?id=${requestId}`,
    })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
