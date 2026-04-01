import { supabaseAdmin } from '@/lib/supabase/admin';

export async function calculateBotScore(tenantId: string): Promise<{
  score: number;
  breakdown: { knowledge: number; intents: number; responseTime: number; resolution: number };
}> {
  // Knowledge completeness (0-25)
  const { count: chunks } = await supabaseAdmin
    .from('knowledge_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  const knowledge = Math.min(25, (chunks || 0) * 2.5); // 10 chunks = 25 points

  // Intent coverage (0-25)
  const { data: intents } = await supabaseAdmin
    .from('messages')
    .select('intent')
    .eq('tenant_id', tenantId)
    .not('intent', 'is', null)
    .limit(500);
  const uniqueIntents = new Set((intents || []).map(m => m.intent)).size;
  const intentScore = Math.min(25, (uniqueIntents / 20) * 25); // 20 intents = 25 points

  // Response time (0-25)
  const { data: analytics } = await supabaseAdmin
    .from('daily_analytics')
    .select('avg_response_ms')
    .eq('tenant_id', tenantId)
    .not('avg_response_ms', 'is', null)
    .order('date', { ascending: false })
    .limit(7);
  const avgMs = analytics?.length
    ? analytics.reduce((s, a) => s + (a.avg_response_ms || 5000), 0) / analytics.length
    : 5000;
  const responseTime = avgMs < 1000 ? 25 : avgMs < 2000 ? 20 : avgMs < 3000 ? 15 : avgMs < 5000 ? 10 : 5;

  // AI Resolution rate (0-25)
  const { data: resData } = await supabaseAdmin
    .from('daily_analytics')
    .select('ai_resolution_rate')
    .eq('tenant_id', tenantId)
    .not('ai_resolution_rate', 'is', null)
    .order('date', { ascending: false })
    .limit(7);
  const avgRate = resData?.length
    ? resData.reduce((s, a) => s + Number(a.ai_resolution_rate || 0), 0) / resData.length
    : 0;
  const resolution = Math.min(25, (avgRate / 100) * 25);

  const score = Math.round(knowledge + intentScore + responseTime + resolution);

  return {
    score,
    breakdown: {
      knowledge: Math.round(knowledge),
      intents: Math.round(intentScore),
      responseTime: Math.round(responseTime),
      resolution: Math.round(resolution),
    },
  };
}
