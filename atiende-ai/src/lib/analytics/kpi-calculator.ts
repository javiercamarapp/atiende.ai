import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationKPIs {
  total: number;
  new: number;
  resolved: number;
  avgResponseTimeMs: number;
}

export interface MessageKPIs {
  total: number;
  inbound: number;
  outbound: number;
  avgPerConversation: number;
}

export interface AppointmentKPIs {
  booked: number;
  completed: number;
  cancelled: number;
  noShow: number;
  revenue: number;
}

export interface OrderKPIs {
  total: number;
  completed: number;
  revenue: number;
}

export interface LeadKPIs {
  new: number;
  qualified: number;
  converted: number;
  conversionRate: number;
}

export interface CostKPIs {
  llmCostUsd: number;
  totalMessages: number;
  costPerMessage: number;
}

export interface AgentKPIs {
  activeAgents: number;
  totalExecutions: number;
  successRate: number;
}

export interface SatisfactionKPIs {
  avgSentiment: number;
  npsScore: number;
}

export interface TopIntent {
  intent: string;
  count: number;
  percentage: number;
}

export interface DashboardKPIs {
  conversations: ConversationKPIs;
  messages: MessageKPIs;
  appointments: AppointmentKPIs;
  orders: OrderKPIs;
  leads: LeadKPIs;
  costs: CostKPIs;
  agents: AgentKPIs;
  satisfaction: SatisfactionKPIs;
  topIntents: TopIntent[];
}

export interface ROIMetrics {
  messagesSaved: number;
  minutesSaved: number;
  hoursSaved: number;
  staffSavingsMXN: number;
  afterHoursRevenueMXN: number;
  noShowSavingsMXN: number;
  totalSavingsMXN: number;
  monthlyCostMXN: number;
  roiPercent: number;
}

export interface AgentMetrics {
  agentSlug: string;
  agentName: string;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number;
  lastRunAt: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOURLY_RATES: Record<string, number> = {
  dental: 75, medical: 75, nutritionist: 70, psychologist: 80,
  restaurant: 55, taqueria: 50, cafe: 50, hotel: 80, real_estate: 100,
  salon: 60, barbershop: 55, spa: 65, gym: 55, veterinary: 65,
  pharmacy: 55, school: 65, insurance: 90, mechanic: 55, accountant: 85,
  florist: 50, optics: 60, other: 62.5,
};

const SERVICE_VALUES: Record<string, number> = {
  dental: 800, medical: 600, nutritionist: 700, psychologist: 800,
  restaurant: 350, taqueria: 150, cafe: 120, hotel: 2500, real_estate: 50000,
  salon: 450, barbershop: 200, spa: 900, gym: 400, veterinary: 500,
  pharmacy: 200, school: 3000, insurance: 5000, mechanic: 1500,
  accountant: 2000, florist: 500, optics: 1200, other: 500,
};

const PLAN_PRICES: Record<string, number> = {
  free_trial: 0, basic: 499, pro: 999, premium: 1499,
};

// ---------------------------------------------------------------------------
// calculateKPIs
// ---------------------------------------------------------------------------

export async function calculateKPIs(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<DashboardKPIs> {
  const log = logger.child({ tenantId, module: 'kpi-calculator' });
  const fromISO = from.toISOString();
  const toISO = to.toISOString();

  log.info('Calculating KPIs', { from: fromISO, to: toISO });

  // Run independent queries in parallel
  const [
    dailyResult,
    conversationsResult,
    messagesCountResult,
    appointmentsResult,
    ordersResult,
    leadsResult,
    agentExecutionsResult,
    activeAgentsResult,
    intentResult,
    npsResult,
  ] = await Promise.all([
    // 1. Daily analytics aggregates
    supabaseAdmin
      .from('daily_analytics')
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('date', from.toISOString().split('T')[0])
      .lte('date', to.toISOString().split('T')[0]),

    // 2. Conversations in period
    supabaseAdmin
      .from('conversations')
      .select('id, status, created_at', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .gte('created_at', fromISO)
      .lte('created_at', toISO),

    // 3. Message counts by direction
    supabaseAdmin
      .from('messages')
      .select('direction, cost_usd', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .gte('created_at', fromISO)
      .lte('created_at', toISO),

    // 4. Appointments in period
    supabaseAdmin
      .from('appointments')
      .select('status, service_id')
      .eq('tenant_id', tenantId)
      .gte('created_at', fromISO)
      .lte('created_at', toISO),

    // 5. Orders in period
    supabaseAdmin
      .from('orders')
      .select('status, total')
      .eq('tenant_id', tenantId)
      .gte('created_at', fromISO)
      .lte('created_at', toISO),

    // 6. Leads in period
    supabaseAdmin
      .from('leads')
      .select('status, temperature')
      .eq('tenant_id', tenantId)
      .gte('created_at', fromISO)
      .lte('created_at', toISO),

    // 7. Agent executions in period
    supabaseAdmin
      .from('agent_executions')
      .select('success')
      .eq('tenant_id', tenantId)
      .gte('created_at', fromISO)
      .lte('created_at', toISO),

    // 8. Active tenant agents
    supabaseAdmin
      .from('tenant_agents')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_active', true),

    // 9. Intents for top-intents
    supabaseAdmin
      .from('messages')
      .select('intent')
      .eq('tenant_id', tenantId)
      .eq('direction', 'inbound')
      .not('intent', 'is', null)
      .gte('created_at', fromISO)
      .lte('created_at', toISO),

    // 10. NPS scores from voice calls (sentiment)
    supabaseAdmin
      .from('voice_calls')
      .select('sentiment')
      .eq('tenant_id', tenantId)
      .not('sentiment', 'is', null)
      .gte('created_at', fromISO)
      .lte('created_at', toISO),
  ]);

  // --- Aggregate daily_analytics ---
  const daily = dailyResult.data || [];
  const sumDaily = (key: string) =>
    daily.reduce((s, d) => s + (Number(d[key]) || 0), 0);
  const avgDaily = (key: string) => {
    const vals = daily.filter(d => d[key] != null).map(d => Number(d[key]));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };

  // --- Conversations ---
  const conversations = conversationsResult.data || [];
  const totalConversations = conversationsResult.count || conversations.length;
  const newConversations = sumDaily('conversations_new');
  const resolvedConversations = conversations.filter(
    c => c.status === 'resolved' || c.status === 'closed',
  ).length;
  const avgResponseTimeMs = Math.round(avgDaily('avg_response_ms'));

  // --- Messages ---
  const allMessages = messagesCountResult.data || [];
  const totalMessages = messagesCountResult.count || allMessages.length;
  const inboundMessages = sumDaily('messages_inbound');
  const outboundMessages = sumDaily('messages_outbound');
  const avgPerConversation = totalConversations > 0
    ? Math.round((totalMessages / totalConversations) * 10) / 10
    : 0;

  // --- Appointments ---
  const appointments = appointmentsResult.data || [];
  const bookedAppointments = appointments.length;
  const completedAppointments = appointments.filter(a => a.status === 'completed').length;
  const cancelledAppointments = appointments.filter(a => a.status === 'cancelled').length;
  const noShowAppointments = appointments.filter(a => a.status === 'no_show').length;
  const appointmentRevenue = sumDaily('orders_revenue'); // appointment revenue tracked via orders_revenue for service businesses

  // --- Orders ---
  const orders = ordersResult.data || [];
  const totalOrders = orders.length;
  const completedOrders = orders.filter(o => o.status === 'completed' || o.status === 'delivered').length;
  const orderRevenue = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);

  // --- Leads ---
  const leads = leadsResult.data || [];
  const newLeads = leads.filter(l => l.status === 'new').length;
  const qualifiedLeads = leads.filter(l => l.temperature === 'warm' || l.temperature === 'hot').length;
  const convertedLeads = leads.filter(l => l.status === 'converted' || l.status === 'won').length;
  const conversionRate = leads.length > 0
    ? Math.round((convertedLeads / leads.length) * 10000) / 100
    : 0;

  // --- Costs ---
  const llmCostUsd = Math.round(sumDaily('llm_cost_usd') * 10000) / 10000;
  const totalMsgCount = inboundMessages + outboundMessages;
  const costPerMessage = totalMsgCount > 0
    ? Math.round((llmCostUsd / totalMsgCount) * 1000000) / 1000000
    : 0;

  // --- Agents ---
  const executions = agentExecutionsResult.data || [];
  const totalExecutions = executions.length;
  const successExecutions = executions.filter(e => e.success).length;
  const successRate = totalExecutions > 0
    ? Math.round((successExecutions / totalExecutions) * 10000) / 100
    : 0;
  const activeAgents = activeAgentsResult.count || 0;

  // --- Satisfaction ---
  const sentimentMap: Record<string, number> = {
    positive: 1, neutral: 0.5, negative: 0,
  };
  const npsData = npsResult.data || [];
  const avgSentiment = npsData.length > 0
    ? Math.round(
        (npsData.reduce((s, c) => s + (sentimentMap[c.sentiment] ?? 0.5), 0) / npsData.length) * 100,
      ) / 100
    : 0;
  const aiResRate = avgDaily('ai_resolution_rate');
  const npsScore = Math.round(aiResRate); // approximate NPS from AI resolution rate

  // --- Top Intents ---
  const intentMessages = intentResult.data || [];
  const intentCounts = new Map<string, number>();
  for (const m of intentMessages) {
    const intent = m.intent || 'OTHER';
    intentCounts.set(intent, (intentCounts.get(intent) || 0) + 1);
  }
  const totalIntentMessages = intentMessages.length;
  const topIntents: TopIntent[] = Array.from(intentCounts.entries())
    .map(([intent, count]) => ({
      intent,
      count,
      percentage: totalIntentMessages > 0
        ? Math.round((count / totalIntentMessages) * 10000) / 100
        : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  log.info('KPIs calculated', { totalConversations, totalMessages, totalOrders });

  return {
    conversations: {
      total: totalConversations,
      new: newConversations,
      resolved: resolvedConversations,
      avgResponseTimeMs,
    },
    messages: {
      total: totalMessages,
      inbound: inboundMessages,
      outbound: outboundMessages,
      avgPerConversation,
    },
    appointments: {
      booked: bookedAppointments,
      completed: completedAppointments,
      cancelled: cancelledAppointments,
      noShow: noShowAppointments,
      revenue: appointmentRevenue,
    },
    orders: {
      total: totalOrders,
      completed: completedOrders,
      revenue: Math.round(orderRevenue * 100) / 100,
    },
    leads: {
      new: newLeads,
      qualified: qualifiedLeads,
      converted: convertedLeads,
      conversionRate,
    },
    costs: {
      llmCostUsd,
      totalMessages: totalMsgCount,
      costPerMessage,
    },
    agents: {
      activeAgents,
      totalExecutions,
      successRate,
    },
    satisfaction: {
      avgSentiment,
      npsScore,
    },
    topIntents,
  };
}

// ---------------------------------------------------------------------------
// calculateROI
// ---------------------------------------------------------------------------

export async function calculateROI(
  tenantId: string,
  period: number,
): Promise<ROIMetrics> {
  const log = logger.child({ tenantId, module: 'kpi-calculator' });
  log.info('Calculating ROI', { period });

  const since = new Date(Date.now() - period * 86400000).toISOString().split('T')[0];

  const [tenantResult, analyticsResult] = await Promise.all([
    supabaseAdmin
      .from('tenants')
      .select('business_type, plan')
      .eq('id', tenantId)
      .single(),
    supabaseAdmin
      .from('daily_analytics')
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('date', since),
  ]);

  if (!tenantResult.data) {
    log.warn('Tenant not found for ROI calculation');
    return {
      messagesSaved: 0, minutesSaved: 0, hoursSaved: 0,
      staffSavingsMXN: 0, afterHoursRevenueMXN: 0, noShowSavingsMXN: 0,
      totalSavingsMXN: 0, monthlyCostMXN: 0, roiPercent: 0,
    };
  }

  const tenant = tenantResult.data;
  const analytics = analyticsResult.data || [];

  const msgSaved = analytics.reduce(
    (s, d) => s + (d.messages_inbound || 0) - (d.handoffs_human || 0), 0,
  );
  const minSaved = msgSaved * 2.5;
  const hrSaved = minSaved / 60;
  const hourlyRate = HOURLY_RATES[tenant.business_type] || 62.5;
  const staffSav = hrSaved * hourlyRate;

  const afterHrs = analytics.reduce(
    (s, d) => s + (d.appointments_after_hours || 0), 0,
  );
  const svcVal = SERVICE_VALUES[tenant.business_type] || 500;
  const afterRev = afterHrs * svcVal;

  const noShows = analytics.reduce(
    (s, d) => s + Math.max(0, (d.appointments_booked || 0) * 0.15 - (d.appointments_no_show || 0)),
    0,
  );
  const noShowSav = noShows * svcVal;

  const cost = PLAN_PRICES[tenant.plan] || 499;
  const total = staffSav + afterRev + noShowSav;
  const roi = cost > 0 ? ((total - cost) / cost) * 100 : 0;

  return {
    messagesSaved: msgSaved,
    minutesSaved: Math.round(minSaved),
    hoursSaved: Math.round(hrSaved * 10) / 10,
    staffSavingsMXN: Math.round(staffSav),
    afterHoursRevenueMXN: Math.round(afterRev),
    noShowSavingsMXN: Math.round(noShowSav),
    totalSavingsMXN: Math.round(total),
    monthlyCostMXN: cost,
    roiPercent: Math.round(roi),
  };
}

// ---------------------------------------------------------------------------
// getAgentPerformance
// ---------------------------------------------------------------------------

export async function getAgentPerformance(
  tenantId: string,
): Promise<AgentMetrics[]> {
  const log = logger.child({ tenantId, module: 'kpi-calculator' });
  log.info('Fetching agent performance');

  const [agentsResult, executionsResult] = await Promise.all([
    supabaseAdmin
      .from('tenant_agents')
      .select('agent_id, is_active, last_run_at, marketplace_agents(slug, name)')
      .eq('tenant_id', tenantId),
    supabaseAdmin
      .from('agent_executions')
      .select('agent_slug, success, duration_ms')
      .eq('tenant_id', tenantId),
  ]);

  const tenantAgents = agentsResult.data || [];
  const executions = executionsResult.data || [];

  // Group executions by agent_slug
  const execBySlug = new Map<string, { total: number; success: number; durations: number[] }>();
  for (const exec of executions) {
    const slug = exec.agent_slug;
    const entry = execBySlug.get(slug) || { total: 0, success: 0, durations: [] };
    entry.total++;
    if (exec.success) entry.success++;
    if (exec.duration_ms != null) entry.durations.push(exec.duration_ms);
    execBySlug.set(slug, entry);
  }

  const metrics: AgentMetrics[] = tenantAgents.map(ta => {
    const agent = ta.marketplace_agents as unknown as { slug: string; name: string } | null;
    const slug = agent?.slug || 'unknown';
    const name = agent?.name || slug;
    const stats = execBySlug.get(slug) || { total: 0, success: 0, durations: [] };
    const avgDuration = stats.durations.length > 0
      ? Math.round(stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length)
      : 0;

    return {
      agentSlug: slug,
      agentName: name,
      totalExecutions: stats.total,
      successCount: stats.success,
      failureCount: stats.total - stats.success,
      successRate: stats.total > 0
        ? Math.round((stats.success / stats.total) * 10000) / 100
        : 0,
      avgDurationMs: avgDuration,
      lastRunAt: ta.last_run_at || null,
    };
  });

  log.info('Agent performance calculated', { agentCount: metrics.length });
  return metrics.sort((a, b) => b.totalExecutions - a.totalExecutions);
}
