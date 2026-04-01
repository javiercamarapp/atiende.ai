// ═══════════════════════════════════════════════════════════
// INSURANCE FAN-OUT — Shared carrier eligibility + QStash dispatch
// Used by: quote/route.ts (web) and insurance-handlers.ts (WhatsApp)
// ═══════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin'
import { Client } from '@upstash/qstash'
import { isCircuitOpen } from '@/lib/insurance/circuit-breaker'
import { logInsuranceEvent } from '@/lib/insurance/logger'
import type { WorkerQuotePayload } from '@/lib/insurance/types'

function getQStash() {
  return new Client({ token: process.env.QSTASH_TOKEN! })
}

export interface FanOutParams {
  requestId: string
  tenantId: string
  insuranceLine: string
  clientData: Record<string, unknown>
  vehicleData?: Record<string, unknown>
  coverageType?: string
  /** Pass a Supabase client to use RLS-scoped queries; defaults to admin client */
  supabase?: typeof supabaseAdmin
}

export async function fanOutQuoteToCarriers(params: FanOutParams): Promise<{ carriersTargeted: number }> {
  const {
    requestId,
    tenantId,
    insuranceLine,
    clientData,
    vehicleData,
    coverageType,
    supabase: db = supabaseAdmin,
  } = params

  // 1. Get carriers with active credentials for this insurance line
  const { data: creds } = await db
    .from('ins_carrier_credentials')
    .select('*, ins_carriers(*)')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)

  type CredRow = NonNullable<typeof creds>[number]
  const eligibleCarriers = (creds ?? []).filter((c: CredRow) => {
    const carrier = (c as Record<string, unknown>).ins_carriers as Record<string, unknown>
    return (
      carrier?.is_active &&
      (carrier.supported_lines as string[])?.includes(insuranceLine) &&
      carrier.health_status !== 'down'
    )
  })

  // 2. Create individual quote records
  if (eligibleCarriers.length > 0) {
    await db.from('ins_quotes').insert(
      eligibleCarriers.map((c: CredRow) => ({
        quote_request_id: requestId,
        tenant_id: tenantId,
        carrier_id: c.carrier_id,
        status: 'pending' as const,
      }))
    )
  }

  await db
    .from('ins_quote_requests')
    .update({ carriers_targeted: eligibleCarriers.length })
    .eq('id', requestId)

  // 3. Fan-out via QStash
  const workerUrl = process.env.INSURANCE_WORKER_URL
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  if (workerUrl && eligibleCarriers.length > 0) {
    await Promise.allSettled(
      eligibleCarriers.map(async (cred: CredRow) => {
        const carrier = (cred as Record<string, unknown>).ins_carriers as Record<string, unknown>

        if (await isCircuitOpen(carrier.slug as string)) {
          await db.from('ins_quotes').update({
            status: 'skipped',
            error_message: 'Circuit breaker open',
            error_type: 'circuit_open',
            completed_at: new Date().toISOString(),
          }).eq('quote_request_id', requestId).eq('carrier_id', cred.carrier_id)

          logInsuranceEvent('carrier_skipped_circuit_open', {
            request_id: requestId,
            carrier_slug: carrier.slug,
          })
          return
        }

        const payload: WorkerQuotePayload = {
          request_id: requestId,
          tenant_id: tenantId,
          carrier_slug: carrier.slug as string,
          carrier_portal_url: carrier.portal_url as string,
          carrier_portal_type: carrier.portal_type as WorkerQuotePayload['carrier_portal_type'],
          insurance_line: insuranceLine as WorkerQuotePayload['insurance_line'],
          client_data: clientData as WorkerQuotePayload['client_data'],
          vehicle_data: vehicleData as WorkerQuotePayload['vehicle_data'],
          coverage_type: coverageType as WorkerQuotePayload['coverage_type'],
          credentials: {
            username: cred.encrypted_username,
            password: cred.encrypted_password,
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

  return { carriersTargeted: eligibleCarriers.length }
}
