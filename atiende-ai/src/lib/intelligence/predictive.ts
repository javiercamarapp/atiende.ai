import { supabaseAdmin } from '@/lib/supabase/admin';
import { analyzeSentiment } from '@/lib/intelligence/sentiment';
import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════
// PREDICTIVE ANALYTICS ENGINE
// Churn prediction, revenue forecasting, peak-hour analysis,
// seasonal demand patterns, cohort retention, and next-best-
// action recommendations based on conversation/transaction data.
// ═══════════════════════════════════════════════════════════

// ── CHURN PREDICTION ─────────────────────────────────────

interface AtRiskContact {
  contactId: string;
  phone: string;
  riskScore: number;
  lastActivity: Date;
  reason: string;
}

interface ChurnPrediction {
  atRiskContacts: AtRiskContact[];
  churnRate30d: number;
  recommendations: string[];
}

/**
 * Predict which contacts are likely to churn based on recency,
 * frequency, sentiment, and engagement decay patterns.
 *
 * Risk scoring (0-100):
 *  - Recency weight: 40 pts (days since last contact)
 *  - Frequency decay: 25 pts (message frequency trend)
 *  - Sentiment: 20 pts (negative conversations)
 *  - Appointment follow-through: 15 pts (no-shows / cancels)
 */
export async function predictChurn(tenantId: string): Promise<ChurnPrediction> {
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

  // Fetch contacts with activity info
  const { data: contacts } = await supabaseAdmin
    .from('contacts')
    .select('id, phone, name, last_contact_at, metadata')
    .eq('tenant_id', tenantId)
    .not('last_contact_at', 'is', null);

  if (!contacts?.length) {
    return { atRiskContacts: [], churnRate30d: 0, recommendations: [] };
  }

  // Fetch recent messages for sentiment analysis (last 90 days)
  const { data: recentMessages } = await supabaseAdmin
    .from('messages')
    .select('conversation_id, content, direction, created_at')
    .eq('tenant_id', tenantId)
    .eq('direction', 'inbound')
    .gte('created_at', ninetyDaysAgo)
    .order('created_at', { ascending: false })
    .limit(2000);

  // Fetch appointment outcomes per contact
  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select('contact_id, status')
    .eq('tenant_id', tenantId)
    .gte('created_at', ninetyDaysAgo);

  // Build contact-level appointment stats
  const aptStats = new Map<string, { total: number; noShow: number; cancelled: number }>();
  for (const apt of appointments || []) {
    if (!apt.contact_id) continue;
    const s = aptStats.get(apt.contact_id) || { total: 0, noShow: 0, cancelled: 0 };
    s.total++;
    if (apt.status === 'no_show') s.noShow++;
    if (apt.status === 'cancelled') s.cancelled++;
    aptStats.set(apt.contact_id, s);
  }

  // Build per-conversation sentiment map
  const convSentiments = new Map<string, number[]>();
  for (const msg of recentMessages || []) {
    if (!msg.content) continue;
    const { score } = analyzeSentiment(msg.content);
    const existing = convSentiments.get(msg.conversation_id) || [];
    existing.push(score);
    convSentiments.set(msg.conversation_id, existing);
  }

  // Get conversations linked to contacts
  const { data: conversations } = await supabaseAdmin
    .from('conversations')
    .select('id, contact_id, last_message_at')
    .eq('tenant_id', tenantId)
    .not('contact_id', 'is', null);

  const contactSentiments = new Map<string, number>();
  for (const conv of conversations || []) {
    if (!conv.contact_id) continue;
    const scores = convSentiments.get(conv.id);
    if (scores?.length) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const existing = contactSentiments.get(conv.contact_id);
      contactSentiments.set(conv.contact_id, existing !== undefined ? (existing + avg) / 2 : avg);
    }
  }

  // Score each contact
  const atRiskContacts: AtRiskContact[] = [];
  let churned30d = 0;

  for (const contact of contacts) {
    const lastActivity = new Date(contact.last_contact_at);
    const daysSinceContact = Math.floor((now.getTime() - lastActivity.getTime()) / 86400000);

    // Track 30-day churn rate
    if (daysSinceContact > 30) churned30d++;

    // ── Recency score (0-40) ──
    let recencyScore = 0;
    if (daysSinceContact > 90) recencyScore = 40;
    else if (daysSinceContact > 60) recencyScore = 30;
    else if (daysSinceContact > 30) recencyScore = 20;
    else if (daysSinceContact > 14) recencyScore = 10;

    // ── Frequency decay score (0-25) ──
    // Contacts that used to be active but stopped
    let frequencyScore = 0;
    if (daysSinceContact > 30) {
      // They had activity before but dropped off
      const meta = contact.metadata as Record<string, unknown> | null;
      const totalInteractions = (meta?.total_messages as number) || 0;
      if (totalInteractions > 5 && daysSinceContact > 30) frequencyScore = 25;
      else if (totalInteractions > 2 && daysSinceContact > 45) frequencyScore = 15;
      else if (daysSinceContact > 60) frequencyScore = 10;
    }

    // ── Sentiment score (0-20) ──
    let sentimentScore = 0;
    const avgSentiment = contactSentiments.get(contact.id);
    if (avgSentiment !== undefined) {
      if (avgSentiment < -2) sentimentScore = 20;
      else if (avgSentiment < -1) sentimentScore = 15;
      else if (avgSentiment < 0) sentimentScore = 10;
    }

    // ── Appointment reliability score (0-15) ──
    let aptScore = 0;
    const stats = aptStats.get(contact.id);
    if (stats && stats.total > 0) {
      const failRate = (stats.noShow + stats.cancelled) / stats.total;
      if (failRate > 0.5) aptScore = 15;
      else if (failRate > 0.3) aptScore = 10;
      else if (failRate > 0.15) aptScore = 5;
    }

    const riskScore = recencyScore + frequencyScore + sentimentScore + aptScore;

    // Build reason string
    const reasons: string[] = [];
    if (recencyScore >= 20) reasons.push(`sin contacto hace ${daysSinceContact} dias`);
    if (sentimentScore >= 10) reasons.push('sentimiento negativo reciente');
    if (aptScore >= 10) reasons.push('citas canceladas o no-shows');
    if (frequencyScore >= 15) reasons.push('disminucion de frecuencia');

    if (riskScore >= 30) {
      atRiskContacts.push({
        contactId: contact.id,
        phone: contact.phone,
        riskScore,
        lastActivity,
        reason: reasons.join('; ') || 'inactividad prolongada',
      });
    }
  }

  // Sort by risk (highest first)
  atRiskContacts.sort((a, b) => b.riskScore - a.riskScore);

  const churnRate30d = contacts.length > 0
    ? Math.round((churned30d / contacts.length) * 10000) / 100
    : 0;

  // Generate recommendations
  const recommendations: string[] = [];
  if (churnRate30d > 30) {
    recommendations.push('Tasa de abandono alta. Considere activar el agente de reactivacion automatica.');
  }
  if (atRiskContacts.some(c => c.reason.includes('sentimiento negativo'))) {
    recommendations.push('Clientes con sentimiento negativo detectados. Revise quejas recientes y contacte personalmente.');
  }
  if (atRiskContacts.some(c => c.reason.includes('no-shows'))) {
    recommendations.push('Active recordatorios de cita automaticos (24h y 1h antes) para reducir no-shows.');
  }
  if (atRiskContacts.length > contacts.length * 0.2) {
    recommendations.push('Mas del 20% de sus clientes estan en riesgo. Envie una promocion o encuesta de satisfaccion.');
  }
  if (churnRate30d < 10 && atRiskContacts.length < 5) {
    recommendations.push('Excelente retencion. Considere un programa de referidos para crecer su base de clientes.');
  }

  logger.info('predictive.churn', { tenantId, atRisk: atRiskContacts.length, churnRate30d });

  return { atRiskContacts: atRiskContacts.slice(0, 50), churnRate30d, recommendations };
}

// ── REVENUE FORECASTING ──────────────────────────────────

interface RevenueBreakdown {
  source: string;
  amount: number;
}

interface RevenueForecast {
  projectedRevenue: number;
  confidence: number;
  breakdown: RevenueBreakdown[];
  trend: 'growing' | 'stable' | 'declining';
}

/**
 * Forecast revenue based on historical appointment and order trends.
 * Uses weighted moving average with recency bias to project future revenue.
 *
 * Sources:
 *  - Appointment-based revenue (services booked)
 *  - Order revenue (food, products)
 *  - Lead pipeline value (weighted by temperature)
 */
export async function forecastRevenue(
  tenantId: string,
  daysAhead: number
): Promise<RevenueForecast> {
  const now = new Date();
  // Look back 90 days for trend analysis
  const lookbackDays = 90;
  const lookbackDate = new Date(now.getTime() - lookbackDays * 86400000).toISOString();

  // Fetch daily analytics for historical data
  const { data: analytics } = await supabaseAdmin
    .from('daily_analytics')
    .select('date, orders_revenue, appointments_booked, appointments_completed, orders_total, avg_order_value')
    .eq('tenant_id', tenantId)
    .gte('date', lookbackDate.split('T')[0])
    .order('date', { ascending: true });

  if (!analytics?.length) {
    return { projectedRevenue: 0, confidence: 0, breakdown: [], trend: 'stable' };
  }

  // Fetch service prices for appointment revenue estimation
  const { data: services } = await supabaseAdmin
    .from('services')
    .select('price')
    .eq('tenant_id', tenantId)
    .eq('active', true);

  const avgServicePrice = services?.length
    ? services.reduce((sum, s) => sum + (Number(s.price) || 0), 0) / services.length
    : 500; // Default MXN if no services configured

  // Calculate weekly revenue buckets for trend analysis
  const weeklyRevenue: number[] = [];
  const weekSize = 7;
  for (let i = 0; i < analytics.length; i += weekSize) {
    const week = analytics.slice(i, i + weekSize);
    const orderRev = week.reduce((s, d) => s + (Number(d.orders_revenue) || 0), 0);
    const aptRev = week.reduce((s, d) => s + ((d.appointments_completed || 0) * avgServicePrice), 0);
    weeklyRevenue.push(orderRev + aptRev);
  }

  // Weighted moving average with recency bias
  let weightedSum = 0;
  let weightTotal = 0;
  for (let i = 0; i < weeklyRevenue.length; i++) {
    const weight = i + 1; // More recent weeks get higher weight
    weightedSum += weeklyRevenue[i] * weight;
    weightTotal += weight;
  }

  const avgWeeklyRevenue = weightTotal > 0 ? weightedSum / weightTotal : 0;
  const projectedWeeks = daysAhead / 7;
  const projectedRevenue = Math.round(avgWeeklyRevenue * projectedWeeks);

  // Trend detection: compare first half vs second half
  const halfIdx = Math.floor(weeklyRevenue.length / 2);
  const firstHalfAvg = weeklyRevenue.length > 1
    ? weeklyRevenue.slice(0, halfIdx).reduce((a, b) => a + b, 0) / Math.max(halfIdx, 1)
    : 0;
  const secondHalfAvg = weeklyRevenue.length > 1
    ? weeklyRevenue.slice(halfIdx).reduce((a, b) => a + b, 0) / Math.max(weeklyRevenue.length - halfIdx, 1)
    : 0;

  let trend: 'growing' | 'stable' | 'declining' = 'stable';
  if (firstHalfAvg > 0) {
    const change = (secondHalfAvg - firstHalfAvg) / firstHalfAvg;
    if (change > 0.1) trend = 'growing';
    else if (change < -0.1) trend = 'declining';
  }

  // Confidence based on data volume and variance
  const dataWeeks = weeklyRevenue.length;
  const variance = weeklyRevenue.length > 1
    ? weeklyRevenue.reduce((s, v) => s + Math.pow(v - avgWeeklyRevenue, 2), 0) / weeklyRevenue.length
    : 0;
  const coeffOfVariation = avgWeeklyRevenue > 0 ? Math.sqrt(variance) / avgWeeklyRevenue : 1;

  let confidence = Math.min(95, Math.max(10,
    // More data = more confidence (up to 50 pts)
    Math.min(50, dataWeeks * 5) +
    // Low variance = more confidence (up to 45 pts)
    Math.max(0, 45 - coeffOfVariation * 30)
  ));
  confidence = Math.round(confidence);

  // Revenue breakdown
  const totalOrderRevenue = analytics.reduce((s, d) => s + (Number(d.orders_revenue) || 0), 0);
  const totalAptRevenue = analytics.reduce((s, d) => s + ((d.appointments_completed || 0) * avgServicePrice), 0);
  const totalRevenue = totalOrderRevenue + totalAptRevenue;

  const breakdown: RevenueBreakdown[] = [];
  if (totalAptRevenue > 0) {
    const aptShare = totalRevenue > 0 ? totalAptRevenue / totalRevenue : 0.5;
    breakdown.push({
      source: 'Citas/Servicios',
      amount: Math.round(projectedRevenue * aptShare),
    });
  }
  if (totalOrderRevenue > 0) {
    const orderShare = totalRevenue > 0 ? totalOrderRevenue / totalRevenue : 0.5;
    breakdown.push({
      source: 'Pedidos',
      amount: Math.round(projectedRevenue * orderShare),
    });
  }

  // Add lead pipeline estimate if applicable
  const { data: hotLeads } = await supabaseAdmin
    .from('leads')
    .select('score, temperature')
    .eq('tenant_id', tenantId)
    .eq('status', 'new')
    .in('temperature', ['hot', 'warm']);

  if (hotLeads?.length) {
    const pipelineValue = hotLeads.reduce((sum, lead) => {
      const weight = lead.temperature === 'hot' ? 0.6 : 0.25;
      return sum + avgServicePrice * weight;
    }, 0);
    if (pipelineValue > 0) {
      breakdown.push({
        source: 'Pipeline de leads',
        amount: Math.round(pipelineValue),
      });
    }
  }

  return { projectedRevenue, confidence, breakdown, trend };
}

// ── PEAK HOURS ANALYSIS ──────────────────────────────────

interface HourlyDistribution {
  hour: number;
  messageCount: number;
  appointmentCount: number;
}

interface PeakHoursAnalysis {
  hourlyDistribution: HourlyDistribution[];
  peakHours: number[];
  recommendation: string;
}

/**
 * Analyze message and appointment patterns by hour-of-day to identify
 * peak activity windows. Useful for staffing decisions and bot
 * escalation scheduling.
 */
export async function analyzePeakHours(tenantId: string): Promise<PeakHoursAnalysis> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  // Fetch raw message timestamps
  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('created_at')
    .eq('tenant_id', tenantId)
    .eq('direction', 'inbound')
    .gte('created_at', thirtyDaysAgo)
    .limit(5000);

  // Fetch appointment times
  const { data: appointments } = await supabaseAdmin
    .from('appointments')
    .select('datetime')
    .eq('tenant_id', tenantId)
    .gte('datetime', thirtyDaysAgo)
    .limit(2000);

  // Initialize 24-hour buckets
  const hourly: HourlyDistribution[] = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    messageCount: 0,
    appointmentCount: 0,
  }));

  // Count messages per hour
  for (const msg of messages || []) {
    const hour = new Date(msg.created_at).getHours();
    hourly[hour].messageCount++;
  }

  // Count appointments per hour
  for (const apt of appointments || []) {
    const hour = new Date(apt.datetime).getHours();
    hourly[hour].appointmentCount++;
  }

  // Identify peak hours (top 3 by combined activity)
  const scored = hourly
    .map(h => ({
      hour: h.hour,
      score: h.messageCount + h.appointmentCount * 2, // Appointments weighted higher
    }))
    .sort((a, b) => b.score - a.score);

  const peakHours = scored
    .slice(0, 3)
    .map(s => s.hour)
    .sort((a, b) => a - b);

  // After-hours activity detection
  const afterHoursMessages = hourly
    .filter(h => h.hour < 8 || h.hour >= 20)
    .reduce((sum, h) => sum + h.messageCount, 0);
  const totalMessages = hourly.reduce((sum, h) => sum + h.messageCount, 0);
  const afterHoursPercent = totalMessages > 0
    ? Math.round((afterHoursMessages / totalMessages) * 100)
    : 0;

  // Build recommendation
  const peakRange = peakHours.length > 0
    ? `${peakHours[0]}:00 - ${(peakHours[peakHours.length - 1] + 1)}:00`
    : '09:00 - 18:00';

  const parts: string[] = [];
  parts.push(`Horas pico de actividad: ${peakRange}.`);

  if (afterHoursPercent > 20) {
    parts.push(`${afterHoursPercent}% de mensajes llegan fuera de horario. Considere extender horas de atencion o configurar respuestas automaticas mas robustas.`);
  }

  if (peakHours.includes(12) || peakHours.includes(13)) {
    parts.push('Alta actividad a la hora de comida. Asegure cobertura en ese horario.');
  }

  if (peakHours.some(h => h >= 18)) {
    parts.push('Actividad significativa en la tarde-noche. El bot esta cubriendo esta demanda automaticamente.');
  }

  return {
    hourlyDistribution: hourly,
    peakHours,
    recommendation: parts.join(' '),
  };
}

// ── SEASONAL DEMAND PATTERNS ─────────────────────────────

interface SeasonalPattern {
  dayOfWeek: number;
  dayName: string;
  avgMessages: number;
  avgAppointments: number;
  avgOrders: number;
}

interface SeasonalDemandResult {
  weeklyPatterns: SeasonalPattern[];
  busiestDay: string;
  slowestDay: string;
  monthOverMonth: { month: string; revenue: number; conversations: number }[];
  seasonalTrend: string;
}

/**
 * Analyze seasonal demand across days-of-week and months to identify
 * recurring patterns. Helps businesses plan staffing, inventory, and
 * promotional campaigns around predictable demand cycles.
 */
export async function analyzeSeasonalDemand(tenantId: string): Promise<SeasonalDemandResult> {
  const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString();

  const { data: analytics } = await supabaseAdmin
    .from('daily_analytics')
    .select('date, messages_inbound, appointments_booked, orders_total, orders_revenue')
    .eq('tenant_id', tenantId)
    .gte('date', sixMonthsAgo.split('T')[0])
    .order('date', { ascending: true });

  const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

  // Aggregate by day-of-week
  const dayBuckets = Array.from({ length: 7 }, () => ({
    messages: 0,
    appointments: 0,
    orders: 0,
    count: 0,
  }));

  // Aggregate by month
  const monthBuckets = new Map<string, { revenue: number; conversations: number }>();

  for (const row of analytics || []) {
    const d = new Date(row.date + 'T12:00:00Z');
    const dow = d.getUTCDay();
    dayBuckets[dow].messages += row.messages_inbound || 0;
    dayBuckets[dow].appointments += row.appointments_booked || 0;
    dayBuckets[dow].orders += row.orders_total || 0;
    dayBuckets[dow].count++;

    const monthKey = row.date.slice(0, 7); // YYYY-MM
    const m = monthBuckets.get(monthKey) || { revenue: 0, conversations: 0 };
    m.revenue += Number(row.orders_revenue) || 0;
    m.conversations += row.messages_inbound || 0;
    monthBuckets.set(monthKey, m);
  }

  const weeklyPatterns: SeasonalPattern[] = dayBuckets.map((b, i) => ({
    dayOfWeek: i,
    dayName: dayNames[i],
    avgMessages: b.count > 0 ? Math.round(b.messages / b.count) : 0,
    avgAppointments: b.count > 0 ? Math.round((b.appointments / b.count) * 10) / 10 : 0,
    avgOrders: b.count > 0 ? Math.round((b.orders / b.count) * 10) / 10 : 0,
  }));

  const totalActivity = weeklyPatterns.map(p => p.avgMessages + p.avgAppointments * 5 + p.avgOrders * 3);
  const busiestIdx = totalActivity.indexOf(Math.max(...totalActivity));
  const slowestIdx = totalActivity.indexOf(Math.min(...totalActivity));

  const monthOverMonth = Array.from(monthBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      revenue: Math.round(data.revenue),
      conversations: data.conversations,
    }));

  // Detect seasonal trend narrative
  const months = monthOverMonth;
  let seasonalTrend = 'Datos insuficientes para detectar tendencia estacional.';
  if (months.length >= 3) {
    const lastThree = months.slice(-3);
    const firstThree = months.slice(0, 3);
    const recentAvg = lastThree.reduce((s, m) => s + m.revenue, 0) / lastThree.length;
    const olderAvg = firstThree.reduce((s, m) => s + m.revenue, 0) / firstThree.length;
    if (olderAvg > 0) {
      const change = ((recentAvg - olderAvg) / olderAvg) * 100;
      if (change > 15) {
        seasonalTrend = `Tendencia al alza: ingresos crecieron ${Math.round(change)}% en los ultimos 3 meses vs los 3 anteriores.`;
      } else if (change < -15) {
        seasonalTrend = `Tendencia a la baja: ingresos disminuyeron ${Math.round(Math.abs(change))}%. Considere campanas de reactivacion.`;
      } else {
        seasonalTrend = 'Ingresos estables en el periodo analizado.';
      }
    }
  }

  logger.info('predictive.seasonal', { tenantId, busiestDay: dayNames[busiestIdx], monthsAnalyzed: months.length });

  return {
    weeklyPatterns,
    busiestDay: dayNames[busiestIdx],
    slowestDay: dayNames[slowestIdx],
    monthOverMonth,
    seasonalTrend,
  };
}

// ── COHORT RETENTION ANALYSIS ────────────────────────────

interface CohortRow {
  cohort: string; // YYYY-MM of first contact
  size: number;
  retainedMonth1: number;
  retainedMonth2: number;
  retainedMonth3: number;
  retentionRate: number; // month 3 / size
}

interface CohortAnalysisResult {
  cohorts: CohortRow[];
  avgRetention30d: number;
  avgRetention90d: number;
  bestCohort: string | null;
  insight: string;
}

/**
 * Cohort retention analysis: groups contacts by their first-contact month
 * and measures how many remain active at 30, 60, and 90 days.
 * Reveals whether onboarding improvements are working over time.
 */
export async function analyzeCohortRetention(tenantId: string): Promise<CohortAnalysisResult> {
  const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString();

  const { data: contacts } = await supabaseAdmin
    .from('contacts')
    .select('id, created_at, last_contact_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', sixMonthsAgo)
    .not('last_contact_at', 'is', null);

  if (!contacts?.length) {
    return { cohorts: [], avgRetention30d: 0, avgRetention90d: 0, bestCohort: null, insight: 'Sin datos suficientes.' };
  }

  // Group by month of creation
  const cohortMap = new Map<string, { size: number; ret1: number; ret2: number; ret3: number }>();

  for (const c of contacts) {
    const cohortKey = (c.created_at as string).slice(0, 7);
    const created = new Date(c.created_at as string);
    const lastActive = new Date(c.last_contact_at as string);
    const activeDays = Math.floor((lastActive.getTime() - created.getTime()) / 86400000);

    const bucket = cohortMap.get(cohortKey) || { size: 0, ret1: 0, ret2: 0, ret3: 0 };
    bucket.size++;
    if (activeDays >= 30) bucket.ret1++;
    if (activeDays >= 60) bucket.ret2++;
    if (activeDays >= 90) bucket.ret3++;
    cohortMap.set(cohortKey, bucket);
  }

  const cohorts: CohortRow[] = Array.from(cohortMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cohort, data]) => ({
      cohort,
      size: data.size,
      retainedMonth1: data.ret1,
      retainedMonth2: data.ret2,
      retainedMonth3: data.ret3,
      retentionRate: data.size > 0 ? Math.round((data.ret3 / data.size) * 10000) / 100 : 0,
    }));

  const totalSize = cohorts.reduce((s, c) => s + c.size, 0);
  const totalRet1 = cohorts.reduce((s, c) => s + c.retainedMonth1, 0);
  const totalRet3 = cohorts.reduce((s, c) => s + c.retainedMonth3, 0);

  const avgRetention30d = totalSize > 0 ? Math.round((totalRet1 / totalSize) * 10000) / 100 : 0;
  const avgRetention90d = totalSize > 0 ? Math.round((totalRet3 / totalSize) * 10000) / 100 : 0;

  const bestCohort = cohorts.length > 0
    ? cohorts.reduce((best, c) => c.retentionRate > best.retentionRate ? c : best).cohort
    : null;

  // Compare recent vs older cohorts for insight
  let insight = 'Retencion estable entre cohortes.';
  if (cohorts.length >= 4) {
    const recentCohorts = cohorts.slice(-2);
    const olderCohorts = cohorts.slice(0, -2);
    const recentAvg = recentCohorts.reduce((s, c) => s + c.retentionRate, 0) / recentCohorts.length;
    const olderAvg = olderCohorts.reduce((s, c) => s + c.retentionRate, 0) / olderCohorts.length;
    if (recentAvg > olderAvg + 5) {
      insight = 'La retencion esta mejorando en cohortes recientes. Las mejoras en atencion estan funcionando.';
    } else if (recentAvg < olderAvg - 5) {
      insight = 'La retencion esta disminuyendo en cohortes recientes. Revise cambios en el servicio o en la experiencia del bot.';
    }
  }

  logger.info('predictive.cohort', { tenantId, cohortCount: cohorts.length, avgRetention90d });

  return { cohorts, avgRetention30d, avgRetention90d, bestCohort, insight };
}

// ── NEXT-BEST-ACTION RECOMMENDATION ─────────────────────

interface NextBestAction {
  contactId: string;
  phone: string;
  name: string;
  action: 'reactivation' | 'upsell' | 'followup' | 'nps_survey' | 'birthday_promo' | 'referral_ask';
  reason: string;
  priority: number; // 1-10
  suggestedMessage: string;
}

interface NextBestActionResult {
  actions: NextBestAction[];
  totalOpportunities: number;
  estimatedRevenueLift: number;
}

/**
 * Determine the best next action for each contact based on their lifecycle
 * stage, recent activity, and business context. Produces a prioritized
 * action list that agents or staff can execute.
 */
export async function getNextBestActions(tenantId: string): Promise<NextBestActionResult> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000).toISOString();

  const { data: contacts } = await supabaseAdmin
    .from('contacts')
    .select('id, phone, name, created_at, last_contact_at, metadata')
    .eq('tenant_id', tenantId)
    .not('last_contact_at', 'is', null)
    .limit(500);

  if (!contacts?.length) {
    return { actions: [], totalOpportunities: 0, estimatedRevenueLift: 0 };
  }

  // Fetch recent appointments for completed-service contacts
  const { data: recentApts } = await supabaseAdmin
    .from('appointments')
    .select('contact_id, status, updated_at')
    .eq('tenant_id', tenantId)
    .gte('updated_at', thirtyDaysAgo);

  const completedContacts = new Set<string>();
  for (const apt of recentApts || []) {
    if (apt.status === 'completed' && apt.contact_id) {
      completedContacts.add(apt.contact_id);
    }
  }

  // Fetch service avg price for revenue estimation
  const { data: services } = await supabaseAdmin
    .from('services')
    .select('price')
    .eq('tenant_id', tenantId)
    .eq('active', true);

  const avgPrice = services?.length
    ? services.reduce((s, svc) => s + (Number(svc.price) || 0), 0) / services.length
    : 500;

  // Fetch tenant info for message personalization
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .single();

  const tenantName = (tenant?.name as string) || 'nosotros';
  const actions: NextBestAction[] = [];

  for (const contact of contacts) {
    const lastActivity = new Date(contact.last_contact_at as string);
    const daysSince = Math.floor((now.getTime() - lastActivity.getTime()) / 86400000);
    const meta = contact.metadata as Record<string, unknown> | null;
    const contactName = contact.name || '';

    // Reactivation: 30-90 days inactive
    if (daysSince >= 30 && daysSince <= 90) {
      actions.push({
        contactId: contact.id,
        phone: contact.phone,
        name: contactName,
        action: 'reactivation',
        reason: `Sin contacto hace ${daysSince} dias`,
        priority: Math.min(10, Math.floor(daysSince / 10)),
        suggestedMessage: `Hola ${contactName}, le extrañamos en ${tenantName}. Tenemos novedades que le pueden interesar. ¿Le gustaria agendar una cita?`,
      });
      continue; // Only one action per contact
    }

    // Upsell: completed service in last 7 days
    if (completedContacts.has(contact.id) && daysSince <= 7) {
      actions.push({
        contactId: contact.id,
        phone: contact.phone,
        name: contactName,
        action: 'upsell',
        reason: 'Servicio completado recientemente',
        priority: 7,
        suggestedMessage: `Hola ${contactName}, esperamos que todo haya salido perfecto. Tenemos servicios complementarios que podrian interesarle. ¿Le gustaria saber mas?`,
      });
      continue;
    }

    // NPS survey: active 30+ days, no survey sent recently
    const totalInteractions = (meta?.total_messages as number) || 0;
    if (totalInteractions > 5 && daysSince <= 14) {
      const lastSurvey = meta?.last_nps_at as string | undefined;
      const surveyDaysAgo = lastSurvey
        ? Math.floor((now.getTime() - new Date(lastSurvey).getTime()) / 86400000)
        : 999;

      if (surveyDaysAgo > 60) {
        actions.push({
          contactId: contact.id,
          phone: contact.phone,
          name: contactName,
          action: 'nps_survey',
          reason: 'Cliente activo sin encuesta reciente',
          priority: 4,
          suggestedMessage: `Hola ${contactName}, su opinion es muy importante para ${tenantName}. En una escala del 1 al 10, ¿que tan probable es que nos recomiende?`,
        });
        continue;
      }
    }

    // Birthday promo check
    if (meta?.birthday) {
      const bday = meta.birthday as string;
      const today = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      // Check if birthday is within the next 7 days
      for (let d = 0; d <= 7; d++) {
        const checkDate = new Date(now.getTime() + d * 86400000);
        const checkMmDd = `${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
        if (bday.endsWith(checkMmDd)) {
          actions.push({
            contactId: contact.id,
            phone: contact.phone,
            name: contactName,
            action: 'birthday_promo',
            reason: d === 0 ? 'Cumpleaños hoy' : `Cumpleaños en ${d} dias`,
            priority: d === 0 ? 9 : 6,
            suggestedMessage: d === 0
              ? `¡Feliz cumpleaños ${contactName}! En ${tenantName} tenemos un regalo especial para usted.`
              : `Hola ${contactName}, su cumpleaños se acerca. Queremos celebrarlo con un detalle especial de ${tenantName}.`,
          });
          break;
        }
      }
    }

    // Referral ask: loyal contacts (10+ interactions, recent activity)
    if (totalInteractions > 10 && daysSince <= 7) {
      actions.push({
        contactId: contact.id,
        phone: contact.phone,
        name: contactName,
        action: 'referral_ask',
        reason: 'Cliente leal con actividad reciente',
        priority: 3,
        suggestedMessage: `Hola ${contactName}, gracias por confiar en ${tenantName}. Si nos recomienda con alguien, ambos reciben un beneficio especial.`,
      });
    }
  }

  // Sort by priority descending
  actions.sort((a, b) => b.priority - a.priority);
  const capped = actions.slice(0, 100);

  // Rough revenue lift estimate
  const upsells = capped.filter(a => a.action === 'upsell').length;
  const reactivations = capped.filter(a => a.action === 'reactivation').length;
  const estimatedRevenueLift = Math.round(
    upsells * avgPrice * 0.15 + // 15% conversion on upsell
    reactivations * avgPrice * 0.08 // 8% conversion on reactivation
  );

  logger.info('predictive.nextBestAction', { tenantId, actions: capped.length, estimatedRevenueLift });

  return {
    actions: capped,
    totalOpportunities: capped.length,
    estimatedRevenueLift,
  };
}
