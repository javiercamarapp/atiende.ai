// ═══════════════════════════════════════════════════════════
// INSURANCE AGENTIC HANDLERS — WhatsApp → Multi-Carrier Quoting
// Handles: INSURANCE_QUOTE, INSURANCE_STATUS, INSURANCE_POLICY, INSURANCE_RENEWAL
// ═══════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendTextMessage } from '@/lib/whatsapp/send'
import { generateResponse, MODELS } from '@/lib/llm/openrouter'
import { INSURANCE_LINE_LABELS, COVERAGE_LABELS } from '@/lib/insurance/constants'
import { fanOutQuoteToCarriers } from '@/lib/insurance/fan-out'
import { setConversationState, clearConversationState } from '@/lib/actions/state-machine'
import type { ActionContext, ActionResult } from '@/lib/actions/types'
import type { QuoteWithCarrier, PolicyWithCarrier, ExtractedInsuranceData, ExtractedClient, ExtractedVehicle } from '@/lib/insurance/database.types'

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

  let data: ExtractedInsuranceData
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
    const missing = data.missing || []
    const line = data.insurance_line || 'auto'
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

    // Save partial data so the next message can merge with it
    await setConversationState(ctx.conversationId, 'awaiting_insurance_data', {
      insurance_line: line,
      missing,
      extracted: data,
    })

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
  const clientData = (data.client ?? {}) as ExtractedClient
  const vehicleData = (data.vehicle ?? {}) as ExtractedVehicle
  const line = data.insurance_line || 'auto'
  const lineLabel = INSURANCE_LINE_LABELS[line] || 'Seguro'

  const { data: quoteReq } = await supabaseAdmin
    .from('ins_quote_requests')
    .insert({
      tenant_id: ctx.tenantId,
      contact_id: ctx.contactId || null,
      conversation_id: ctx.conversationId || null,
      insurance_line: line,
      client_name: clientData.name || ctx.customerName,
      client_phone: ctx.customerPhone,
      client_birthdate: clientData.birthdate || null,
      client_gender: clientData.gender || null,
      client_zip_code: clientData.zip_code || '',
      client_rfc: clientData.rfc || null,
      vehicle_brand: vehicleData.brand || null,
      vehicle_model: vehicleData.model || null,
      vehicle_year: vehicleData.year || null,
      vehicle_version: vehicleData.version || null,
      vehicle_use: vehicleData.use || 'particular',
      coverage_type: data.coverage_type || 'amplia',
      status: 'pending',
      source: 'whatsapp',
      raw_input: ctx.content,
      extracted_data: data,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  // Step 5: Trigger fan-out to carriers via shared helper
  if (quoteReq?.id && process.env.INSURANCE_WORKER_URL && process.env.QSTASH_TOKEN) {
    await fanOutQuoteToCarriers({
      requestId: quoteReq.id,
      tenantId: ctx.tenantId,
      insuranceLine: line,
      clientData,
      vehicleData,
      coverageType: data.coverage_type || 'amplia',
    })

    await supabaseAdmin.from('ins_quote_requests')
      .update({ status: 'quoting' })
      .eq('id', quoteReq.id)
  }

  const coverageLabel = COVERAGE_LABELS[data.coverage_type || 'amplia'] || 'Cobertura Amplia'
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

  const allQuotes = (latest.ins_quotes ?? []) as QuoteWithCarrier[]
  const succeeded = allQuotes.filter(q => q.status === 'success')

  if (latest.status === 'complete' && succeeded.length > 0) {
    const sorted = succeeded.sort(
      (a, b) => (a.annual_premium ?? Infinity) - (b.annual_premium ?? Infinity)
    )
    let msg = `✅ *Tu cotización está lista*\n\n📊 ${succeeded.length} aseguradoras respondieron:\n\n`

    sorted.slice(0, 5).forEach((q, i) => {
      const carrier = q.ins_carriers
      msg += `${i + 1}. *${carrier?.name || 'Aseguradora'}*\n`
      msg += `   💰 $${Number(q.annual_premium).toLocaleString('es-MX')} MXN/año\n`
      if (q.deductible_amount) msg += `   📋 Deducible: $${Number(q.deductible_amount).toLocaleString('es-MX')}\n`
      msg += '\n'
    })

    msg += '_Responde con el número de la aseguradora para más detalles._'
    await sendTextMessage(ctx.phoneNumberId, ctx.customerPhone, msg)

    // Set state so next message triggers carrier selection
    await setConversationState(ctx.conversationId, 'awaiting_insurance_selection', {
      quote_request_id: latest.id,
    })
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
  // Filter policies by contact_id if available, otherwise show tenant's policies
  let query = supabaseAdmin
    .from('ins_policies')
    .select('*, ins_carriers(name)')
    .eq('tenant_id', ctx.tenantId)
    .order('end_date', { ascending: true })
    .limit(5)

  if (ctx.contactId) {
    query = query.eq('contact_id', ctx.contactId)
  }

  const { data: policies } = await query

  if (!policies || policies.length === 0) {
    await sendTextMessage(
      ctx.phoneNumberId,
      ctx.customerPhone,
      'No encontré pólizas registradas. ¿Necesitas cotizar un seguro nuevo?'
    )
    return { actionTaken: true, actionType: 'insurance_policy_none' }
  }

  let msg = `📋 *Tus pólizas activas*\n\n`
  ;(policies as PolicyWithCarrier[]).forEach((p, i) => {
    const carrier = p.ins_carriers
    const daysLeft = Math.ceil((new Date(p.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    msg += `${i + 1}. *${carrier?.name}* — #${p.policy_number}\n`
    msg += `   Estado: ${p.status === 'active' ? '✅ Activa' : '⚠️ ' + p.status}\n`
    if (daysLeft <= 30 && daysLeft >= 0) msg += `   ⏰ Renueva en ${daysLeft} días\n`
    msg += '\n'
  })

  await sendTextMessage(ctx.phoneNumberId, ctx.customerPhone, msg)
  return { actionTaken: true, actionType: 'insurance_policy_list', details: { count: policies.length } }
}

// ═══ INSURANCE DATA CONTINUATION — Merge new data with previous partial extraction ═══
export async function handleInsuranceDataContinuation(ctx: ActionContext): Promise<ActionResult> {
  // Retrieve previously stored partial data from conversation state
  const { getConversationState } = await import('@/lib/actions/state-machine')
  const { context } = await getConversationState(ctx.conversationId)
  const previousData = (context.extracted as ExtractedInsuranceData | undefined) || {} as Partial<ExtractedInsuranceData>
  const previousLine = (context.insurance_line as string) || 'auto'

  // Clear the state now that we are consuming it
  await clearConversationState(ctx.conversationId)

  // Re-extract from the new message
  const extraction = await generateResponse({
    model: MODELS.CLASSIFIER,
    system: `Extrae datos de cotización de seguro del mensaje. Devuelve SOLO JSON:
{
  "insurance_line": "${previousLine}",
  "client": {"name": "nombre o null", "birthdate": "YYYY-MM-DD o null", "gender": "M/F o null", "zip_code": "CP o null", "rfc": "RFC o null"},
  "vehicle": {"brand": "marca o null", "model": "modelo o null", "year": 2024, "version": "version o null", "use": "particular/comercial"},
  "coverage_type": "amplia|limitada|rc_obligatoria|null"
}
Solo extrae los datos que el usuario proporciona. Deja null los campos no mencionados.`,
    messages: [{ role: 'user', content: ctx.content }],
    temperature: 0.1,
  })

  let newData: ExtractedInsuranceData
  try {
    const cleaned = extraction.text.replace(/```json\n?|\n?```/g, '').trim()
    newData = JSON.parse(cleaned)
  } catch {
    // If extraction fails, retry the full quote flow with combined context
    return handleInsuranceQuote({
      ...ctx,
      content: `${JSON.stringify(previousData)}\n${ctx.content}`,
    })
  }

  // Deep-merge: previous data as base, new data overwrites non-null fields
  const mergedClient: ExtractedClient = {
    ...({ name: null, birthdate: null, gender: null, zip_code: null, rfc: null }),
    ...(previousData.client || {}),
    ...filterNulls(newData.client || {}),
  }
  const mergedVehicle: ExtractedVehicle = {
    ...({ brand: null, model: null, year: null, version: null, use: null }),
    ...(previousData.vehicle || {}),
    ...filterNulls(newData.vehicle || {}),
  }
  const mergedCoverageType =
    newData.coverage_type || previousData.coverage_type || null

  const mergedData: ExtractedInsuranceData = {
    ...previousData,
    ...newData,
    insurance_line: previousLine,
    client: mergedClient,
    vehicle: mergedVehicle,
    coverage_type: mergedCoverageType,
  }

  // Check completeness of the merged data
  const missingFields = checkMissingFields(previousLine, mergedClient, mergedVehicle)

  if (missingFields.length > 0) {
    mergedData.complete = false
    mergedData.missing = missingFields
  } else {
    mergedData.complete = true
    mergedData.missing = []
  }

  // Feed the merged data back through handleInsuranceQuote with a synthetic context
  // We override content so the handler uses our merged data directly
  return handleInsuranceQuote({
    ...ctx,
    // Provide the merged JSON so the LLM extraction step picks it up cleanly
    content: JSON.stringify(mergedData),
  })
}

/** Remove null/undefined values from an object so they don't overwrite good data */
function filterNulls<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      result[key] = value
    }
  }
  return result as Partial<T>
}

/** Check which critical fields are still missing for a given insurance line */
function checkMissingFields(
  line: string,
  client: ExtractedClient,
  vehicle: ExtractedVehicle,
): string[] {
  const missing: string[] = []

  if (!client.name) missing.push('name')
  if (!client.zip_code) missing.push('zip_code')

  if (line === 'auto') {
    if (!vehicle.brand) missing.push('brand')
    if (!vehicle.model) missing.push('model')
    if (!vehicle.year) missing.push('year')
  } else if (line === 'vida' || line === 'gastos_medicos') {
    if (!client.birthdate) missing.push('birthdate')
    if (!client.gender) missing.push('gender')
  }

  return missing
}

// ═══ INSURANCE SELECTION — User picks a carrier from results ═══
export async function handleInsuranceSelection(ctx: ActionContext): Promise<ActionResult> {
  // The user is responding with a number to select a carrier from previous results
  const { getConversationState } = await import('@/lib/actions/state-machine')
  const { context } = await getConversationState(ctx.conversationId)
  const quoteRequestId = context.quote_request_id as string | undefined

  await clearConversationState(ctx.conversationId)

  if (!quoteRequestId) {
    // No stored quote request — fall back to status check
    return handleInsuranceStatus(ctx)
  }

  // Parse the selection number from the message
  const selectionMatch = ctx.content.match(/(\d+)/)
  const selectionIndex = selectionMatch ? parseInt(selectionMatch[1], 10) - 1 : -1

  // Fetch the ranked quotes
  const { data: quotes } = await supabaseAdmin
    .from('ins_quotes')
    .select('*, ins_carriers(name, slug)')
    .eq('quote_request_id', quoteRequestId)
    .eq('status', 'success')
    .order('rank_position', { ascending: true })

  if (!quotes || quotes.length === 0) {
    await sendTextMessage(
      ctx.phoneNumberId,
      ctx.customerPhone,
      'No encontré resultados para esa cotización. ¿Quieres que cotice de nuevo?'
    )
    return { actionTaken: true, actionType: 'insurance_selection_empty' }
  }

  const typedQuotes = quotes as QuoteWithCarrier[]
  const selected = typedQuotes[selectionIndex]
  if (!selected) {
    await sendTextMessage(
      ctx.phoneNumberId,
      ctx.customerPhone,
      `Por favor selecciona un número del 1 al ${typedQuotes.length}.`
    )
    // Re-set state so they can try again
    await setConversationState(ctx.conversationId, 'awaiting_insurance_selection', {
      quote_request_id: quoteRequestId,
    })
    return { actionTaken: true, actionType: 'insurance_selection_invalid' }
  }

  const carrier = selected.ins_carriers
  let msg = `📋 *Detalle — ${carrier?.name || 'Aseguradora'}*\n\n`
  msg += `💰 Prima anual: $${Number(selected.annual_premium).toLocaleString('es-MX')} MXN\n`
  if (selected.monthly_premium) {
    msg += `💳 Prima mensual: $${Number(selected.monthly_premium).toLocaleString('es-MX')} MXN\n`
  }
  if (selected.deductible_amount) {
    msg += `📋 Deducible: $${Number(selected.deductible_amount).toLocaleString('es-MX')} MXN\n`
  }
  if (selected.quote_number) {
    msg += `🔢 Cotización #${selected.quote_number}\n`
  }
  if (selected.pdf_url) {
    msg += `\n📄 Cotización PDF: ${selected.pdf_url}\n`
  }
  msg += '\n¿Te gustaría contratar este seguro o necesitas más información?'

  await sendTextMessage(ctx.phoneNumberId, ctx.customerPhone, msg)

  return {
    actionTaken: true,
    actionType: 'insurance_selection_detail',
    details: {
      quote_request_id: quoteRequestId,
      carrier_name: carrier?.name,
      annual_premium: selected.annual_premium,
    },
  }
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
  ;(nearRenewal as PolicyWithCarrier[]).forEach((p, i) => {
    const carrier = p.ins_carriers
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

// ═══ INSURANCE CLAIM — Report an incident / file a claim ═══
export async function handleInsuranceClaim(ctx: ActionContext): Promise<ActionResult> {
  // Step 1: Use AI to extract claim data from the message
  const extraction = await generateResponse({
    model: MODELS.CLASSIFIER,
    system: `Extrae datos de un reclamo/siniestro de seguro del mensaje. Devuelve SOLO JSON:
{
  "policy_number": "número de póliza o null",
  "claim_type": "collision|theft|damage|medical|null",
  "incident_date": "YYYY-MM-DD o null",
  "description": "descripción del incidente o null",
  "complete": true/false,
  "missing": ["campo1", "campo2"]
}
Datos críticos: policy_number, claim_type, incident_date, description.
Si faltan datos críticos, pon "complete": false y lista los campos faltantes en "missing".`,
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
      'Entiendo que necesitas reportar un siniestro. Para ayudarte necesito:\n\n' +
      '1️⃣ Número de póliza\n' +
      '2️⃣ Tipo de siniestro (colisión, robo, daño, médico)\n' +
      '3️⃣ Fecha del incidente\n' +
      '4️⃣ Descripción de lo ocurrido\n\n' +
      'Por favor envíame estos datos.'
    )
    await setConversationState(ctx.conversationId, 'awaiting_claim_details', {})
    return {
      actionTaken: true,
      actionType: 'insurance_claim_start',
      followUpMessage: 'Solicitó reportar siniestro — pidiendo datos',
    }
  }

  // Step 2: If data is incomplete, ask for missing fields
  if (!data.complete) {
    const missing = (data.missing as string[]) || []
    const fieldLabels: Record<string, string> = {
      policy_number: '📋 Número de póliza',
      claim_type: '🔍 Tipo de siniestro (colisión/robo/daño/médico)',
      incident_date: '📅 Fecha del incidente',
      description: '📝 Descripción de lo ocurrido',
    }

    let askMsg = 'Para completar tu reporte de siniestro necesito:\n\n'
    missing.forEach((field, i) => {
      askMsg += `${i + 1}. ${fieldLabels[field] || field}\n`
    })

    await sendTextMessage(ctx.phoneNumberId, ctx.customerPhone, askMsg)
    await setConversationState(ctx.conversationId, 'awaiting_claim_details', {
      extracted: data,
      missing,
    })

    return {
      actionTaken: true,
      actionType: 'insurance_claim_collecting',
      details: { missing, extracted: data },
      followUpMessage: 'Recopilando datos del siniestro',
    }
  }

  // Step 3: Verify the policy exists
  const policyNumber = data.policy_number as string
  const { data: policy } = await supabaseAdmin
    .from('ins_policies')
    .select('id, contact_id')
    .eq('tenant_id', ctx.tenantId)
    .eq('policy_number', policyNumber)
    .limit(1)
    .single()

  if (!policy) {
    await sendTextMessage(
      ctx.phoneNumberId,
      ctx.customerPhone,
      `⚠️ No encontré la póliza #${policyNumber}. Por favor verifica el número e intenta de nuevo.`
    )
    return { actionTaken: true, actionType: 'insurance_claim_policy_not_found' }
  }

  // Step 4: Create claim record
  const claimNumber = generateClaimNumber()
  const claimTypeLabels: Record<string, string> = {
    collision: 'Colisión',
    theft: 'Robo',
    damage: 'Daño',
    medical: 'Médico',
  }
  const claimType = (data.claim_type as string) || 'damage'

  const { data: claim, error } = await supabaseAdmin
    .from('ins_claims')
    .insert({
      tenant_id: ctx.tenantId,
      policy_id: policy.id,
      contact_id: ctx.contactId || policy.contact_id,
      conversation_id: ctx.conversationId,
      claim_number: claimNumber,
      claim_type: claimType,
      incident_date: data.incident_date as string,
      description: data.description as string,
      status: 'open',
      reported_via: 'whatsapp',
      reported_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error || !claim) {
    await sendTextMessage(
      ctx.phoneNumberId,
      ctx.customerPhone,
      '⚠️ Hubo un problema al registrar tu siniestro. Por favor intenta de nuevo o contacta a tu agente.'
    )
    return { actionTaken: true, actionType: 'insurance_claim_error' }
  }

  // Step 5: Send confirmation
  await sendTextMessage(
    ctx.phoneNumberId,
    ctx.customerPhone,
    `✅ *Siniestro registrado exitosamente*\n\n` +
    `🔢 Número de reclamo: *${claimNumber}*\n` +
    `📋 Póliza: #${policyNumber}\n` +
    `🔍 Tipo: ${claimTypeLabels[claimType] || claimType}\n` +
    `📅 Fecha del incidente: ${data.incident_date}\n\n` +
    `Tu reclamo está siendo procesado. Un ajustador se pondrá en contacto contigo pronto.`
  )

  // Step 6: Follow-up asking for photos/documents
  await sendTextMessage(
    ctx.phoneNumberId,
    ctx.customerPhone,
    `📸 Para agilizar tu reclamo *${claimNumber}*, por favor envíanos:\n\n` +
    `1. Fotos del daño o incidente\n` +
    `2. Acta de hechos o reporte policial (si aplica)\n` +
    `3. Identificación oficial\n` +
    `4. Cualquier otro documento relevante\n\n` +
    `Puedes enviar las fotos y documentos por este mismo chat.`
  )

  return {
    actionTaken: true,
    actionType: 'insurance_claim_created',
    details: {
      claim_id: claim.id,
      claim_number: claimNumber,
      policy_number: policyNumber,
      claim_type: claimType,
    },
    followUpMessage: `Siniestro registrado: ${claimNumber} — ${claimTypeLabels[claimType] || claimType}`,
  }
}

/** Generate a claim number: CLM-YYYYMMDD-XXXX */
function generateClaimNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `CLM-${date}-${rand}`
}

// ═══ INSURANCE BIND — Purchase/contract a selected insurance policy ═══
export async function handleInsuranceBind(ctx: ActionContext): Promise<ActionResult> {
  // Step 1: Extract which quote the user wants to bind
  const extraction = await generateResponse({
    model: MODELS.CLASSIFIER,
    system: `El usuario quiere contratar/comprar un seguro. Extrae del mensaje:
{
  "quote_number": "número de cotización o null",
  "carrier_name": "nombre de aseguradora o null",
  "selection_index": número (1-based) si el usuario dice "el primero", "opción 2", etc. o null
}
Devuelve SOLO JSON.`,
    messages: [{ role: 'user', content: ctx.content }],
    temperature: 0.1,
  })

  let selection: Record<string, unknown> = {}
  try {
    const cleaned = extraction.text.replace(/```json\n?|\n?```/g, '').trim()
    selection = JSON.parse(cleaned)
  } catch {
    // Continue with fallback — look up most recent quote
  }

  // Step 2: Find the selected quote
  let quote: QuoteWithCarrier | null = null

  if (selection.quote_number) {
    const { data } = await supabaseAdmin
      .from('ins_quotes')
      .select('*, ins_carriers(name, slug)')
      .eq('quote_number', selection.quote_number)
      .eq('status', 'success')
      .limit(1)
      .single()
    quote = data as QuoteWithCarrier | null
  }

  if (!quote) {
    // Fallback: find most recent successful quote for this customer
    const { data: recentRequest } = await supabaseAdmin
      .from('ins_quote_requests')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .eq('client_phone', ctx.customerPhone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (recentRequest) {
      const { data: quotes } = await supabaseAdmin
        .from('ins_quotes')
        .select('*, ins_carriers(name, slug)')
        .eq('quote_request_id', recentRequest.id)
        .eq('status', 'success')
        .order('rank_position', { ascending: true })

      if (quotes && quotes.length > 0) {
        const idx = (selection.selection_index as number) || 1
        quote = (quotes as QuoteWithCarrier[])[Math.min(idx - 1, quotes.length - 1)] || null
      }
    }
  }

  if (!quote) {
    await sendTextMessage(
      ctx.phoneNumberId,
      ctx.customerPhone,
      'No encontré una cotización para contratar. ¿Quieres que cotice un seguro primero?'
    )
    return { actionTaken: true, actionType: 'insurance_bind_no_quote' }
  }

  // Step 3: Create the policy record
  const policyNumber = `POL-${Date.now().toString(36).toUpperCase()}`
  const startDate = new Date()
  const endDate = new Date(startDate)
  endDate.setFullYear(endDate.getFullYear() + 1)

  const { data: policy, error: policyError } = await supabaseAdmin
    .from('ins_policies')
    .insert({
      tenant_id: ctx.tenantId,
      carrier_id: quote.carrier_id,
      contact_id: ctx.contactId || null,
      conversation_id: ctx.conversationId,
      quote_id: quote.id,
      policy_number: policyNumber,
      insurance_line: (quote as unknown as Record<string, unknown>).insurance_line as string || 'auto',
      total_premium: quote.annual_premium,
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      status: 'pending_payment',
    })
    .select('id')
    .single()

  if (policyError || !policy) {
    await sendTextMessage(
      ctx.phoneNumberId,
      ctx.customerPhone,
      '⚠️ Hubo un problema al generar tu póliza. Por favor intenta de nuevo o contacta a tu agente.'
    )
    return { actionTaken: true, actionType: 'insurance_bind_error' }
  }

  // Step 4: Create payment schedule (12 monthly payments)
  const monthlyPremium = quote.monthly_premium
    ? Number(quote.monthly_premium)
    : Math.ceil(Number(quote.annual_premium) / 12)

  const payments = []
  for (let i = 0; i < 12; i++) {
    const dueDate = new Date(startDate)
    dueDate.setMonth(dueDate.getMonth() + i)
    payments.push({
      tenant_id: ctx.tenantId,
      policy_id: policy.id,
      payment_number: i + 1,
      amount: monthlyPremium,
      due_date: dueDate.toISOString().split('T')[0],
      status: i === 0 ? 'pending' : 'scheduled',
    })
  }

  await supabaseAdmin.from('ins_policy_payments').insert(payments)

  // Step 5: Send WhatsApp confirmation with policy details
  const carrier = quote.ins_carriers
  await sendTextMessage(
    ctx.phoneNumberId,
    ctx.customerPhone,
    `🎉 *¡Póliza generada exitosamente!*\n\n` +
    `🏢 Aseguradora: *${carrier?.name || 'Aseguradora'}*\n` +
    `📋 Póliza: *${policyNumber}*\n` +
    `💰 Prima anual: $${Number(quote.annual_premium).toLocaleString('es-MX')} MXN\n` +
    `💳 Pago mensual: $${monthlyPremium.toLocaleString('es-MX')} MXN\n` +
    `📅 Vigencia: ${startDate.toLocaleDateString('es-MX')} — ${endDate.toLocaleDateString('es-MX')}\n` +
    `📌 Estado: *Pendiente de pago*\n\n` +
    `Para activar tu póliza, realiza tu primer pago de $${monthlyPremium.toLocaleString('es-MX')} MXN.\n\n` +
    `💳 *Métodos de pago disponibles:*\n` +
    `• Transferencia bancaria\n` +
    `• Tarjeta de crédito/débito\n` +
    `• Pago en OXXO/tienda de conveniencia\n\n` +
    `Responde "pagar" para recibir los datos de pago.`
  )

  return {
    actionTaken: true,
    actionType: 'insurance_bind_created',
    details: {
      policy_id: policy.id,
      policy_number: policyNumber,
      carrier_name: carrier?.name,
      annual_premium: quote.annual_premium,
      monthly_premium: monthlyPremium,
    },
    followUpMessage: `Póliza generada: ${policyNumber} — ${carrier?.name} — pendiente de pago`,
  }
}

// ═══ INSURANCE PAYMENT — Check payment status and info ═══
export async function handleInsurancePayment(ctx: ActionContext): Promise<ActionResult> {
  // Step 1: Find user's policies with payment schedules
  let policyQuery = supabaseAdmin
    .from('ins_policies')
    .select('id, policy_number, status, total_premium, ins_carriers(name)')
    .eq('tenant_id', ctx.tenantId)
    .in('status', ['active', 'pending_payment'])
    .order('created_at', { ascending: false })
    .limit(5)

  if (ctx.contactId) {
    policyQuery = policyQuery.eq('contact_id', ctx.contactId)
  }

  const { data: policies } = await policyQuery

  if (!policies || policies.length === 0) {
    await sendTextMessage(
      ctx.phoneNumberId,
      ctx.customerPhone,
      'No encontré pólizas con pagos pendientes asociadas a tu cuenta. ¿Necesitas ayuda con algo más?'
    )
    return { actionTaken: true, actionType: 'insurance_payment_no_policies' }
  }

  // Step 2: Get payment details for each policy
  let msg = '💳 *Estado de pagos de tus seguros*\n\n'

  for (const p of policies as unknown as PolicyWithCarrier[]) {
    const carrier = p.ins_carriers

    // Fetch overdue payments
    const { data: overduePayments } = await supabaseAdmin
      .from('ins_policy_payments')
      .select('payment_number, amount, due_date')
      .eq('policy_id', p.id)
      .eq('status', 'pending')
      .lt('due_date', new Date().toISOString().split('T')[0])
      .order('due_date', { ascending: true })

    // Fetch next upcoming payment
    const { data: upcomingPayments } = await supabaseAdmin
      .from('ins_policy_payments')
      .select('payment_number, amount, due_date, status')
      .eq('policy_id', p.id)
      .in('status', ['pending', 'scheduled'])
      .gte('due_date', new Date().toISOString().split('T')[0])
      .order('due_date', { ascending: true })
      .limit(1)

    msg += `📋 *${carrier?.name || 'Aseguradora'}* — #${p.policy_number}\n`
    msg += `   Estado: ${p.status === 'active' ? '✅ Activa' : '⏳ Pendiente de pago'}\n`

    if (overduePayments && overduePayments.length > 0) {
      msg += `   🔴 *${overduePayments.length} pago(s) vencido(s):*\n`
      for (const op of overduePayments) {
        const dueDate = new Date(op.due_date).toLocaleDateString('es-MX')
        msg += `      • Pago #${op.payment_number}: $${Number(op.amount).toLocaleString('es-MX')} MXN (venció ${dueDate})\n`
      }
    }

    if (upcomingPayments && upcomingPayments.length > 0) {
      const next = upcomingPayments[0]
      const dueDate = new Date(next.due_date).toLocaleDateString('es-MX')
      const daysUntil = Math.ceil((new Date(next.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      msg += `   📅 Próximo pago: $${Number(next.amount).toLocaleString('es-MX')} MXN — ${dueDate}`
      if (daysUntil <= 7) msg += ` ⚠️ (en ${daysUntil} días)`
      msg += '\n'
    }

    msg += '\n'
  }

  msg += '¿Necesitas realizar un pago o tienes alguna duda?'

  await sendTextMessage(ctx.phoneNumberId, ctx.customerPhone, msg)

  return {
    actionTaken: true,
    actionType: 'insurance_payment_status',
    details: { policies_count: policies.length },
    followUpMessage: `Mostró estado de pagos para ${policies.length} póliza(s)`,
  }
}
