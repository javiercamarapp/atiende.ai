// ═══════════════════════════════════════════════════════════
// INSURANCE AGENTIC HANDLERS — WhatsApp → Multi-Carrier Quoting
// Handles: INSURANCE_QUOTE, INSURANCE_STATUS, INSURANCE_POLICY, INSURANCE_RENEWAL
// ═══════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendTextMessage } from '@/lib/whatsapp/send'
import { generateResponse, MODELS } from '@/lib/llm/openrouter'
import { INSURANCE_LINE_LABELS, COVERAGE_LABELS } from '@/lib/insurance/constants'

interface ActionContext {
  tenantId: string
  phoneNumberId: string
  customerPhone: string
  customerName: string
  contactId: string
  conversationId: string
  intent: string
  content: string
  businessType: string
  tenant: Record<string, unknown>
}

interface ActionResult {
  actionTaken: boolean
  actionType?: string
  details?: Record<string, unknown>
  followUpMessage?: string
}

// ═══ INSURANCE QUOTE — Extract data & trigger multi-carrier quoting ═══
export async function handleInsuranceQuote(ctx: ActionContext): Promise<ActionResult> {
  // Step 1: Use AI to extract insurance data from the message
  const extraction = await generateResponse({
    model: MODELS.CLASSIFIER,
    system: `Extrae datos de cotización de seguro del mensaje. Devuelve SOLO JSON:
{
  "insurance_line": "auto|vida|gastos_medicos|hogar|negocio",
  "complete": true/false,
  "missing": ["campo1", "campo2"],
  "client": {"name": "nombre o null", "birthdate": "YYYY-MM-DD o null", "gender": "M/F o null", "zip_code": "CP o null", "rfc": "RFC o null"},
  "vehicle": {"brand": "marca o null", "model": "modelo o null", "year": 2024, "version": "version o null", "use": "particular/comercial"},
  "coverage_type": "amplia|limitada|rc_obligatoria|null"
}
Si no se puede determinar la línea de seguro, usa "auto" por defecto.
Si faltan datos críticos, pon "complete": false y lista los campos faltantes en "missing".
Datos críticos para auto: nombre, marca, modelo, año, código postal.
Datos críticos para vida: nombre, fecha nacimiento, género.`,
    messages: [{ role: 'user', content: ctx.content }],
    temperature: 0.1,
  })

  let data: Record<string, unknown>
  try {
    const cleaned = extraction.text.replace(/```json\n?|\n?```/g, '').trim()
    data = JSON.parse(cleaned)
  } catch {
    await sendTextMessage(
      ctx.phoneNumberId,
      ctx.customerPhone,
      '¡Claro! Te ayudo a cotizar tu seguro. ¿Qué tipo de seguro necesitas?\n\n' +
      '1️⃣ Seguro de Auto\n2️⃣ Seguro de Vida\n3️⃣ Gastos Médicos\n4️⃣ Seguro de Hogar\n5️⃣ Seguro de Negocio'
    )
    return {
      actionTaken: true,
      actionType: 'insurance_quote_start',
      followUpMessage: 'Solicitó cotización de seguro — pidiendo datos',
    }
  }

  // Step 2: If data is incomplete, ask for missing fields
  if (!data.complete) {
    const missing = (data.missing as string[]) || []
    const line = (data.insurance_line as string) || 'auto'
    const lineLabel = INSURANCE_LINE_LABELS[line] || 'Seguro'

    let askMsg = `¡Perfecto! Para cotizar tu *${lineLabel}* necesito algunos datos más:\n\n`
    const fieldLabels: Record<string, string> = {
      name: '👤 Tu nombre completo',
      brand: '🚗 Marca del vehículo',
      model: '🚗 Modelo del vehículo',
      year: '📅 Año del vehículo',
      zip_code: '📍 Código postal',
      birthdate: '🎂 Fecha de nacimiento',
      gender: '⚧ Género (M/F)',
      coverage_type: '🛡️ Tipo de cobertura (Amplia/Limitada/RC)',
    }

    missing.forEach((field, i) => {
      askMsg += `${i + 1}. ${fieldLabels[field] || field}\n`
    })

    await sendTextMessage(ctx.phoneNumberId, ctx.customerPhone, askMsg)

    return {
      actionTaken: true,
      actionType: 'insurance_quote_collecting',
      details: { insurance_line: line, missing, extracted: data },
      followUpMessage: `Recopilando datos para ${lineLabel}`,
    }
  }

  // Step 3: Data is complete — check carrier credentials and start quoting
  const { count: credCount } = await supabaseAdmin
    .from('ins_carrier_credentials')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenantId)
    .eq('is_active', true)

  if (!credCount || credCount === 0) {
    await sendTextMessage(
      ctx.phoneNumberId,
      ctx.customerPhone,
      '⚠️ Aún no hay aseguradoras conectadas. El agente necesita configurar sus credenciales en el dashboard de atiende.ai para activar el multicotizador.'
    )
    return {
      actionTaken: true,
      actionType: 'insurance_quote_no_carriers',
      followUpMessage: 'Sin aseguradoras conectadas',
    }
  }

  // Step 4: Create quote request and notify
  const clientData = data.client as Record<string, unknown> || {}
  const vehicleData = data.vehicle as Record<string, unknown> || {}
  const line = (data.insurance_line as string) || 'auto'
  const lineLabel = INSURANCE_LINE_LABELS[line] || 'Seguro'

  const { data: quoteReq } = await supabaseAdmin
    .from('ins_quote_requests')
    .insert({
      tenant_id: ctx.tenantId,
      contact_id: ctx.contactId || null,
      conversation_id: ctx.conversationId || null,
      insurance_line: line,
      client_name: (clientData.name as string) || ctx.customerName,
      client_phone: ctx.customerPhone,
      client_birthdate: clientData.birthdate || null,
      client_gender: clientData.gender || null,
      client_zip_code: (clientData.zip_code as string) || '',
      client_rfc: clientData.rfc || null,
      vehicle_brand: vehicleData.brand || null,
      vehicle_model: vehicleData.model || null,
      vehicle_year: vehicleData.year || null,
      vehicle_version: vehicleData.version || null,
      vehicle_use: vehicleData.use || 'particular',
      coverage_type: (data.coverage_type as string) || 'amplia',
      status: 'pending',
      source: 'whatsapp',
      raw_input: ctx.content,
      extracted_data: data,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  const coverageLabel = COVERAGE_LABELS[(data.coverage_type as string) || 'amplia'] || 'Cobertura Amplia'
  const vehicleInfo = vehicleData.brand
    ? `${vehicleData.brand} ${vehicleData.model} ${vehicleData.year}`
    : ''

  await sendTextMessage(
    ctx.phoneNumberId,
    ctx.customerPhone,
    `⏳ *Cotizando tu ${lineLabel}*${vehicleInfo ? ` para ${vehicleInfo}` : ''}\n\n` +
    `🛡️ Cobertura: ${coverageLabel}\n` +
    `🏢 Consultando ${credCount} aseguradoras simultáneamente...\n\n` +
    `Te enviaré los resultados conforme lleguen. ¡En menos de 90 segundos tendrás tu comparativa!`
  )

  return {
    actionTaken: true,
    actionType: 'insurance_quote_started',
    details: {
      quote_request_id: quoteReq?.id,
      insurance_line: line,
      carriers_count: credCount,
    },
    followUpMessage: `Cotización iniciada: ${lineLabel} con ${credCount} aseguradoras`,
  }
}

// ═══ INSURANCE STATUS — Check quote progress ═══
export async function handleInsuranceStatus(ctx: ActionContext): Promise<ActionResult> {
  const { data: latest } = await supabaseAdmin
    .from('ins_quote_requests')
    .select('*, ins_quotes(*, ins_carriers(name))')
    .eq('tenant_id', ctx.tenantId)
    .eq('client_phone', ctx.customerPhone)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!latest) {
    await sendTextMessage(
      ctx.phoneNumberId,
      ctx.customerPhone,
      'No encontré cotizaciones recientes asociadas a tu número. ¿Quieres que cotice un seguro nuevo?'
    )
    return { actionTaken: true, actionType: 'insurance_status_not_found' }
  }

  const allQuotes = (latest.ins_quotes ?? []) as Array<Record<string, unknown>>
  const succeeded = allQuotes.filter(q => q.status === 'success')

  if (latest.status === 'complete' && succeeded.length > 0) {
    const sorted = succeeded.sort(
      (a, b) => ((a.annual_premium as number) || Infinity) - ((b.annual_premium as number) || Infinity)
    )
    let msg = `✅ *Tu cotización está lista*\n\n📊 ${succeeded.length} aseguradoras respondieron:\n\n`

    sorted.slice(0, 5).forEach((q, i) => {
      const carrier = q.ins_carriers as Record<string, string> | null
      msg += `${i + 1}. *${carrier?.name || 'Aseguradora'}*\n`
      msg += `   💰 $${Number(q.annual_premium).toLocaleString('es-MX')} MXN/año\n`
      if (q.deductible_amount) msg += `   📋 Deducible: $${Number(q.deductible_amount).toLocaleString('es-MX')}\n`
      msg += '\n'
    })

    msg += '_Responde con el número de la aseguradora para más detalles._'
    await sendTextMessage(ctx.phoneNumberId, ctx.customerPhone, msg)
  } else if (latest.status === 'quoting' || latest.status === 'partial') {
    await sendTextMessage(
      ctx.phoneNumberId,
      ctx.customerPhone,
      `⏳ Tu cotización aún está en proceso...\n\n` +
      `✅ ${latest.carriers_succeeded} de ${latest.carriers_targeted} aseguradoras han respondido.\n` +
      `Te notificaré cuando estén todas listas.`
    )
  } else {
    await sendTextMessage(
      ctx.phoneNumberId,
      ctx.customerPhone,
      `Tu última cotización tiene estado: ${latest.status}. ¿Quieres que intente de nuevo?`
    )
  }

  return {
    actionTaken: true,
    actionType: 'insurance_status_checked',
    details: { status: latest.status, quote_request_id: latest.id },
  }
}

// ═══ INSURANCE POLICY — Check policies ═══
export async function handleInsurancePolicy(ctx: ActionContext): Promise<ActionResult> {
  const { data: policies } = await supabaseAdmin
    .from('ins_policies')
    .select('*, ins_carriers(name)')
    .eq('tenant_id', ctx.tenantId)
    .order('end_date', { ascending: true })
    .limit(5)

  if (!policies || policies.length === 0) {
    await sendTextMessage(
      ctx.phoneNumberId,
      ctx.customerPhone,
      'No encontré pólizas registradas. ¿Necesitas cotizar un seguro nuevo?'
    )
    return { actionTaken: true, actionType: 'insurance_policy_none' }
  }

  let msg = `📋 *Tus pólizas activas*\n\n`
  policies.forEach((p, i) => {
    const carrier = p.ins_carriers as Record<string, string> | null
    const daysLeft = Math.ceil((new Date(p.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    msg += `${i + 1}. *${carrier?.name}* — #${p.policy_number}\n`
    msg += `   Estado: ${p.status === 'active' ? '✅ Activa' : '⚠️ ' + p.status}\n`
    if (daysLeft <= 30 && daysLeft >= 0) msg += `   ⏰ Renueva en ${daysLeft} días\n`
    msg += '\n'
  })

  await sendTextMessage(ctx.phoneNumberId, ctx.customerPhone, msg)
  return { actionTaken: true, actionType: 'insurance_policy_list', details: { count: policies.length } }
}

// ═══ INSURANCE RENEWAL — Handle renewal inquiries ═══
export async function handleInsuranceRenewal(ctx: ActionContext): Promise<ActionResult> {
  const { data: nearRenewal } = await supabaseAdmin
    .from('ins_policies')
    .select('*, ins_carriers(name)')
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'active')
    .lte('end_date', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString())
    .gte('end_date', new Date().toISOString())
    .order('end_date', { ascending: true })

  if (!nearRenewal || nearRenewal.length === 0) {
    await sendTextMessage(
      ctx.phoneNumberId,
      ctx.customerPhone,
      '✅ No tienes pólizas próximas a vencer en los próximos 30 días. ¡Todo en orden!'
    )
    return { actionTaken: true, actionType: 'insurance_renewal_none' }
  }

  let msg = `⏰ *Pólizas próximas a renovar*\n\n`
  nearRenewal.forEach((p, i) => {
    const carrier = p.ins_carriers as Record<string, string> | null
    const daysLeft = Math.ceil((new Date(p.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    msg += `${i + 1}. *${carrier?.name}* — #${p.policy_number}\n`
    msg += `   📅 Vence en ${daysLeft} días\n`
    msg += `   💰 Prima: $${Number(p.total_premium).toLocaleString('es-MX')} MXN\n\n`
  })
  msg += '¿Quieres que re-cotice alguna para buscar mejor precio?'

  await sendTextMessage(ctx.phoneNumberId, ctx.customerPhone, msg)
  return {
    actionTaken: true,
    actionType: 'insurance_renewal_list',
    details: { count: nearRenewal.length },
  }
}
