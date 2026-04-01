import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getInsuranceRedis } from '@/lib/insurance/redis'
import { recordSuccess, recordFailure } from '@/lib/insurance/circuit-breaker'
import { sendTextMessage } from '@/lib/whatsapp/send'
import type { QuoteResult, QuoteProgress } from '@/lib/insurance/types'
import { QUOTE_EXPIRY_HOURS, REDIS_PROGRESS_TTL_SECONDS } from '@/lib/insurance/constants'
import { callbackResultSchema, formatZodErrors } from '@/lib/insurance/validation'
import { logInsuranceEvent, logInsuranceError } from '@/lib/insurance/logger'

async function handler(req: NextRequest) {
  try {
    const body = await req.json()
    const raw = body.body ?? body

    // Validate callback payload with Zod
    const parsed = callbackResultSchema.safeParse(raw)
    if (!parsed.success) {
      logInsuranceEvent('callback_validation_failed', { errors: formatZodErrors(parsed.error) })
      return NextResponse.json(
        { error: 'Validation failed', details: formatZodErrors(parsed.error) },
        { status: 400 }
      )
    }

    const result: QuoteResult = parsed.data as unknown as QuoteResult
    const requestId = result.request_id ?? body.request_id
    if (!requestId) {
      return NextResponse.json({ error: 'Missing request_id' }, { status: 400 })
    }

    // SECURITY: Validate that the quote_request exists before any updates
    const { data: quoteRequest } = await supabaseAdmin
      .from('ins_quote_requests')
      .select('id, tenant_id')
      .eq('id', requestId)
      .single()

    if (!quoteRequest) {
      return NextResponse.json({ error: 'Quote request not found' }, { status: 404 })
    }

    const { data: carrier } = await supabaseAdmin
      .from('ins_carriers')
      .select('id')
      .eq('slug', result.carrier_slug)
      .single()

    if (!carrier) {
      return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    }

    // Update individual quote
    const quoteStatus = result.status === 'success' ? 'success'
      : result.status === 'timeout' ? 'timeout'
      : result.status === 'declined' ? 'declined'
      : 'error'

    await supabaseAdmin
      .from('ins_quotes')
      .update({
        status: quoteStatus,
        annual_premium: result.annual_premium ?? null,
        monthly_premium: result.monthly_premium ?? null,
        deductible_amount: result.deductible_amount ?? null,
        deductible_percentage: result.deductible_percentage ?? null,
        coverages: result.coverages ?? null,
        quote_number: result.quote_number ?? null,
        valid_until: result.valid_until ?? null,
        pdf_url: result.pdf_url ?? null,
        screenshot_url: result.screenshot_url ?? null,
        duration_ms: result.duration_ms ?? null,
        error_message: result.error_message ?? null,
        error_type: result.error_type ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq('quote_request_id', requestId)
      .eq('carrier_id', carrier.id)

    // Update circuit breaker (declined is NOT a carrier failure)
    if (result.status === 'success' || result.status === 'declined') {
      await recordSuccess(result.carrier_slug)
    } else {
      await recordFailure(result.carrier_slug)
    }

    // Check if all carriers done
    const { data: allQuotes } = await supabaseAdmin
      .from('ins_quotes')
      .select('status, annual_premium, carrier_id, ins_carriers(name, slug)')
      .eq('quote_request_id', requestId)

    const quotes = allQuotes ?? []
    const pending = quotes.filter(q => q.status === 'pending' || q.status === 'running')
    const succeeded = quotes.filter(q => q.status === 'success')
    const failed = quotes.filter(q =>
      ['error', 'timeout', 'skipped', 'declined'].includes(q.status)
    )

    // Publish progress to Redis for SSE
    const progress: QuoteProgress = {
      request_id: requestId,
      total: quotes.length,
      completed: succeeded.length,
      failed: failed.length,
      status: pending.length === 0 ? 'complete' : 'partial',
      results: succeeded
        .map(q => {
          const carrierData = q.ins_carriers as unknown as { name: string; slug: string } | null
          return {
            carrier_name: carrierData?.name ?? '',
            carrier_slug: carrierData?.slug ?? '',
            annual_premium: q.annual_premium,
          }
        })
        .sort((a, b) => (a.annual_premium ?? Infinity) - (b.annual_premium ?? Infinity)),
      best_price: succeeded.length > 0
        ? Math.min(...succeeded.map(q => q.annual_premium ?? Infinity))
        : null,
    }

    await getInsuranceRedis().set(`ins:progress:${requestId}`, JSON.stringify(progress), { ex: REDIS_PROGRESS_TTL_SECONDS })

    // If all done → finalize
    if (pending.length === 0) {
      const ranked = succeeded
        .sort((a, b) => (a.annual_premium ?? Infinity) - (b.annual_premium ?? Infinity))

      for (let i = 0; i < ranked.length; i++) {
        await supabaseAdmin.from('ins_quotes').update({
          rank_position: i + 1,
        }).eq('quote_request_id', requestId).eq('carrier_id', ranked[i].carrier_id)
      }

      await supabaseAdmin.from('ins_quote_requests').update({
        status: 'complete',
        carriers_succeeded: succeeded.length,
        carriers_failed: failed.length,
        completed_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + QUOTE_EXPIRY_HOURS * 60 * 60 * 1000).toISOString(),
      }).eq('id', requestId)

      // Send WhatsApp comparison message to the customer
      try {
        const { data: qr } = await supabaseAdmin
          .from('ins_quote_requests')
          .select('client_phone, tenant_id')
          .eq('id', requestId)
          .single()

        if (qr?.client_phone && qr?.tenant_id) {
          const { data: tenant } = await supabaseAdmin
            .from('tenants')
            .select('wa_phone_number_id')
            .eq('id', qr.tenant_id)
            .single()

          if (tenant?.wa_phone_number_id) {
            if (ranked.length > 0) {
              let msg = `✅ *Tu comparativa de seguros está lista*\n\n📊 ${ranked.length} aseguradora${ranked.length > 1 ? 's' : ''} respondieron:\n\n`

              ranked.slice(0, 5).forEach((q, i) => {
                const carrierData = q.ins_carriers as unknown as { name: string; slug: string } | null
                msg += `${i + 1}. *${carrierData?.name || 'Aseguradora'}*\n`
                msg += `   💰 $${Number(q.annual_premium).toLocaleString('es-MX')} MXN/año\n\n`
              })

              msg += '_Responde con el número de la aseguradora para ver más detalles._'

              await sendTextMessage(tenant.wa_phone_number_id, qr.client_phone, msg)
            } else {
              await sendTextMessage(
                tenant.wa_phone_number_id,
                qr.client_phone,
                '⚠️ Lamentablemente ninguna aseguradora pudo generar una cotización en este momento. ¿Te gustaría intentar de nuevo o con datos diferentes?'
              )
            }
          }
        }
      } catch (deliveryErr) {
        // WhatsApp delivery is best-effort — do not fail the callback
        logInsuranceError(deliveryErr, { route: 'callback.whatsapp_delivery', requestId })
      }
    } else {
      await supabaseAdmin.from('ins_quote_requests').update({
        status: 'partial',
        carriers_succeeded: succeeded.length,
        carriers_failed: failed.length,
      }).eq('id', requestId)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    logInsuranceError(err, { route: 'callback.handler' })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // SECURITY: Verify worker secret header (defense-in-depth)
  const workerSecret = req.headers.get('x-worker-secret')
  const expectedSecret = process.env.INSURANCE_WORKER_SECRET
  if (!expectedSecret) {
    return NextResponse.json({ error: 'Server misconfigured: missing worker secret' }, { status: 500 })
  }

  // SECURITY: In production, verify QStash signature (cryptographic proof of origin)
  if (process.env.QSTASH_CURRENT_SIGNING_KEY) {
    const { verifySignatureAppRouter } = await import('@upstash/qstash/nextjs')
    const verified = verifySignatureAppRouter(handler)
    return verified(req)
  }

  // In dev: verify worker secret as minimum auth
  if (workerSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Invalid worker secret' }, { status: 403 })
  }

  return handler(req)
}
