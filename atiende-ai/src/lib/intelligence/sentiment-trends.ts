import { supabaseAdmin } from '@/lib/supabase/admin';
import { analyzeSentiment } from '@/lib/intelligence/sentiment';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';
import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════
// SENTIMENT TREND ANALYSIS
// Tracks customer sentiment over time, identifies complaint
// topics via LLM clustering, calculates NPS-like satisfaction
// scores, and detects sentiment drift for proactive alerts.
// ═══════════════════════════════════════════════════════════

interface DailyScore {
  date: string;
  score: number;
  volume: number;
}

interface ComplaintTopic {
  topic: string;
  count: number;
  avgSentiment: number;
}

interface SentimentTrendResult {
  overall: number; // -1 to 1 (normalized)
  trend: 'improving' | 'stable' | 'declining';
  dailyScores: DailyScore[];
  topComplaints: ComplaintTopic[];
  satisfactionScore: number; // 0-100 NPS-like
}

/**
 * Analyze sentiment trends across a tenant's conversations over a given
 * time window. Combines rule-based sentiment scoring with LLM-powered
 * complaint topic extraction.
 *
 * The satisfaction score (0-100) is computed similarly to NPS:
 *  - Promoters (score > 0): count as positive
 *  - Detractors (score < 0): count as negative
 *  - Score = ((promoters - detractors) / total) * 50 + 50
 *
 * @param tenantId - Tenant UUID
 * @param days - Number of days to look back (default 30)
 */
export async function getSentimentTrends(
  tenantId: string,
  days = 30,
): Promise<SentimentTrendResult> {
  const log = logger.child({ tenantId, module: 'sentiment_trends' });
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  // Fetch inbound messages for sentiment analysis
  const { data: messages } = await supabaseAdmin
    .from('messages')
    .select('content, created_at')
    .eq('tenant_id', tenantId)
    .eq('direction', 'inbound')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(5000);

  if (!messages?.length) {
    return {
      overall: 0,
      trend: 'stable',
      dailyScores: [],
      topComplaints: [],
      satisfactionScore: 50,
    };
  }

  // ── Compute daily sentiment scores ─────────────────────

  const dailyBuckets = new Map<string, { scores: number[]; negativeMessages: string[] }>();

  for (const msg of messages) {
    if (!msg.content || msg.content.length < 3) continue;

    const dateKey = (msg.created_at as string).slice(0, 10); // YYYY-MM-DD
    const { score } = analyzeSentiment(msg.content);

    const bucket = dailyBuckets.get(dateKey) || { scores: [], negativeMessages: [] };
    bucket.scores.push(score);

    // Collect negative messages for complaint topic analysis
    if (score < 0) {
      bucket.negativeMessages.push(msg.content);
    }

    dailyBuckets.set(dateKey, bucket);
  }

  const dailyScores: DailyScore[] = [];
  let totalScore = 0;
  let totalVolume = 0;
  let promoters = 0;
  let detractors = 0;

  for (const [date, bucket] of Array.from(dailyBuckets.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const dayAvg = bucket.scores.reduce((a, b) => a + b, 0) / bucket.scores.length;
    // Normalize to -1..1 range (raw scores can exceed this range with many matches)
    const normalizedAvg = Math.max(-1, Math.min(1, dayAvg / 3));

    dailyScores.push({
      date,
      score: Math.round(normalizedAvg * 1000) / 1000,
      volume: bucket.scores.length,
    });

    totalScore += dayAvg;
    totalVolume += bucket.scores.length;

    // Count promoters/detractors for NPS-like score
    for (const s of bucket.scores) {
      if (s > 0) promoters++;
      else if (s < 0) detractors++;
    }
  }

  // ── Overall sentiment (normalized -1 to 1) ────────────

  const rawOverall = totalVolume > 0 ? totalScore / totalVolume : 0;
  const overall = Math.round(Math.max(-1, Math.min(1, rawOverall / 3)) * 1000) / 1000;

  // ── Trend detection (first half vs second half) ────────

  const halfIdx = Math.floor(dailyScores.length / 2);
  let trend: 'improving' | 'stable' | 'declining' = 'stable';

  if (dailyScores.length >= 4) {
    const firstHalf = dailyScores.slice(0, halfIdx);
    const secondHalf = dailyScores.slice(halfIdx);

    const avgFirst = firstHalf.reduce((s, d) => s + d.score, 0) / Math.max(firstHalf.length, 1);
    const avgSecond = secondHalf.reduce((s, d) => s + d.score, 0) / Math.max(secondHalf.length, 1);

    const diff = avgSecond - avgFirst;
    if (diff > 0.05) trend = 'improving';
    else if (diff < -0.05) trend = 'declining';
  }

  // ── Satisfaction score (NPS-like 0-100) ────────────────

  const satisfactionScore = totalVolume > 0
    ? Math.round(((promoters - detractors) / totalVolume) * 50 + 50)
    : 50;

  // ── Complaint topic extraction via LLM ─────────────────

  const allNegativeMessages: string[] = [];
  for (const bucket of dailyBuckets.values()) {
    allNegativeMessages.push(...bucket.negativeMessages);
  }

  const topComplaints = await extractComplaintTopics(allNegativeMessages, log);

  log.info('Sentiment trends computed', {
    days,
    messageCount: messages.length,
    overall,
    trend,
    satisfactionScore,
    complaintTopics: topComplaints.length,
  });

  return { overall, trend, dailyScores, topComplaints, satisfactionScore };
}

// ── COMPLAINT TOPIC EXTRACTION ───────────────────────────

/**
 * Uses LLM to cluster negative messages into complaint topics.
 * Falls back to keyword-based grouping if LLM call fails.
 */
async function extractComplaintTopics(
  negativeMessages: string[],
  log: ReturnType<typeof logger.child>,
): Promise<ComplaintTopic[]> {
  if (!negativeMessages.length) return [];

  // Deduplicate and cap to avoid excessive token usage
  const uniqueMessages = [...new Set(negativeMessages)].slice(0, 50);

  try {
    const response = await generateResponse({
      model: MODELS.STANDARD,
      system: `Analiza estos mensajes negativos de clientes y agrupa por tema de queja. Responde SOLO con un JSON array: [{"topic":"tema corto","messages":[0,2,5]}] donde los numeros son indices de los mensajes. Maximo 8 temas. Temas en español. Solo JSON, sin explicaciones.`,
      messages: [{
        role: 'user',
        content: uniqueMessages.map((m, i) => `[${i}] ${m}`).join('\n'),
      }],
      temperature: 0.1,
      maxTokens: 500,
    });

    const topics = JSON.parse(response.text) as Array<{ topic: string; messages: number[] }>;

    return topics
      .map(t => {
        const relevantScores = t.messages
          .filter(i => i < uniqueMessages.length)
          .map(i => analyzeSentiment(uniqueMessages[i]).score);

        return {
          topic: t.topic,
          count: t.messages.length,
          avgSentiment: relevantScores.length > 0
            ? Math.round((relevantScores.reduce((a, b) => a + b, 0) / relevantScores.length) * 100) / 100
            : -1,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  } catch {
    log.warn('LLM complaint extraction failed, falling back to keyword grouping');
    return keywordBasedTopics(negativeMessages);
  }
}

/**
 * Fallback: group negative messages by common complaint keywords
 * when LLM extraction is unavailable.
 */
function keywordBasedTopics(messages: string[]): ComplaintTopic[] {
  const topicKeywords: Record<string, string[]> = {
    'Tiempo de espera': ['espera', 'esperar', 'tardo', 'tardó', 'demora', 'lento', 'rapido', 'rápido'],
    'Atencion al cliente': ['atencion', 'atención', 'servicio', 'amabilidad', 'grosero', 'ignorar'],
    'Precios altos': ['caro', 'costoso', 'precio', 'cobro', 'cobrar', 'estafa'],
    'Calidad': ['malo', 'pésimo', 'terrible', 'horrible', 'peor', 'deficiente', 'calidad'],
    'Disponibilidad': ['disponible', 'disponibilidad', 'cerrado', 'lleno', 'sin espacio'],
    'Cancelaciones': ['cancelar', 'cancelaron', 'cancelado', 'no me avisaron'],
    'Comunicacion': ['no contestan', 'no responden', 'no me contestaron', 'sin respuesta'],
  };

  const topicCounts = new Map<string, { count: number; scores: number[] }>();

  for (const msg of messages) {
    const lower = msg.toLowerCase();
    const { score } = analyzeSentiment(msg);

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(kw => lower.includes(kw))) {
        const entry = topicCounts.get(topic) || { count: 0, scores: [] };
        entry.count++;
        entry.scores.push(score);
        topicCounts.set(topic, entry);
        break; // Assign each message to only one topic
      }
    }
  }

  return Array.from(topicCounts.entries())
    .map(([topic, data]) => ({
      topic,
      count: data.count,
      avgSentiment: data.scores.length > 0
        ? Math.round((data.scores.reduce((a, b) => a + b, 0) / data.scores.length) * 100) / 100
        : -1,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

// ── SENTIMENT ALERTS ─────────────────────────────────────

interface SentimentAlert {
  type: 'spike_negative' | 'declining_trend' | 'complaint_surge';
  severity: 'warning' | 'critical';
  message: string;
  data: Record<string, unknown>;
}

/**
 * Check for sentiment anomalies that warrant alerts.
 * Compares today's sentiment against the trailing 7-day average
 * and flags significant negative spikes.
 */
export async function checkSentimentAlerts(tenantId: string): Promise<SentimentAlert[]> {
  const log = logger.child({ tenantId, module: 'sentiment_alerts' });
  const alerts: SentimentAlert[] = [];

  const trends = await getSentimentTrends(tenantId, 14);

  if (trends.dailyScores.length < 3) return alerts;

  // Check for negative spike today vs trailing average
  const today = trends.dailyScores[trends.dailyScores.length - 1];
  const trailing = trends.dailyScores.slice(0, -1);
  const trailingAvg = trailing.reduce((s, d) => s + d.score, 0) / trailing.length;

  if (today && today.score < trailingAvg - 0.3 && today.volume >= 5) {
    alerts.push({
      type: 'spike_negative',
      severity: today.score < trailingAvg - 0.5 ? 'critical' : 'warning',
      message: `Sentimiento negativo inusual hoy (${today.score.toFixed(2)}) vs promedio (${trailingAvg.toFixed(2)}).`,
      data: { todayScore: today.score, trailingAvg, todayVolume: today.volume },
    });
  }

  // Check for sustained declining trend
  if (trends.trend === 'declining' && trends.satisfactionScore < 40) {
    alerts.push({
      type: 'declining_trend',
      severity: 'critical',
      message: `Tendencia de sentimiento declinando. Satisfaccion en ${trends.satisfactionScore}/100.`,
      data: { satisfactionScore: trends.satisfactionScore, trend: trends.trend },
    });
  }

  // Check for complaint surges
  for (const complaint of trends.topComplaints) {
    if (complaint.count >= 10 && complaint.avgSentiment < -1.5) {
      alerts.push({
        type: 'complaint_surge',
        severity: complaint.count >= 20 ? 'critical' : 'warning',
        message: `Alta frecuencia de quejas sobre "${complaint.topic}" (${complaint.count} menciones).`,
        data: { topic: complaint.topic, count: complaint.count, avgSentiment: complaint.avgSentiment },
      });
    }
  }

  if (alerts.length > 0) {
    log.warn('Sentiment alerts detected', { alertCount: alerts.length });
  }

  return alerts;
}

// ── COMPARATIVE SENTIMENT ────────────────────────────────

interface PeriodComparison {
  current: { score: number; volume: number; satisfactionScore: number };
  previous: { score: number; volume: number; satisfactionScore: number };
  change: number; // percentage change in satisfaction
  insight: string;
}

/**
 * Compare sentiment between the current period and the immediately
 * preceding period of the same length. Useful for weekly/monthly reports.
 */
export async function compareSentimentPeriods(
  tenantId: string,
  days = 7,
): Promise<PeriodComparison> {
  const currentTrends = await getSentimentTrends(tenantId, days);

  // For previous period, we need to fetch older data
  const previousCutoffStart = new Date(Date.now() - days * 2 * 86400000).toISOString();
  const previousCutoffEnd = new Date(Date.now() - days * 86400000).toISOString();

  const { data: prevMessages } = await supabaseAdmin
    .from('messages')
    .select('content')
    .eq('tenant_id', tenantId)
    .eq('direction', 'inbound')
    .gte('created_at', previousCutoffStart)
    .lt('created_at', previousCutoffEnd)
    .limit(5000);

  // Compute previous period metrics
  let prevTotal = 0;
  let prevPositive = 0;
  let prevNegative = 0;
  let prevScoreSum = 0;

  for (const msg of prevMessages || []) {
    if (!msg.content || msg.content.length < 3) continue;
    const { score } = analyzeSentiment(msg.content);
    prevTotal++;
    prevScoreSum += score;
    if (score > 0) prevPositive++;
    else if (score < 0) prevNegative++;
  }

  const prevOverall = prevTotal > 0
    ? Math.max(-1, Math.min(1, (prevScoreSum / prevTotal) / 3))
    : 0;

  const prevSatisfaction = prevTotal > 0
    ? Math.round(((prevPositive - prevNegative) / prevTotal) * 50 + 50)
    : 50;

  const change = prevSatisfaction > 0
    ? Math.round(((currentTrends.satisfactionScore - prevSatisfaction) / prevSatisfaction) * 10000) / 100
    : 0;

  let insight: string;
  if (change > 10) {
    insight = `Satisfaccion mejoro ${change}% vs el periodo anterior. Siga asi.`;
  } else if (change < -10) {
    insight = `Satisfaccion bajo ${Math.abs(change)}% vs el periodo anterior. Revise quejas recientes.`;
  } else {
    insight = 'Satisfaccion estable respecto al periodo anterior.';
  }

  return {
    current: {
      score: currentTrends.overall,
      volume: currentTrends.dailyScores.reduce((s, d) => s + d.volume, 0),
      satisfactionScore: currentTrends.satisfactionScore,
    },
    previous: {
      score: Math.round(prevOverall * 1000) / 1000,
      volume: prevTotal,
      satisfactionScore: prevSatisfaction,
    },
    change,
    insight,
  };
}
