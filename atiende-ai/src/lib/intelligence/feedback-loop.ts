import { supabaseAdmin } from '@/lib/supabase/admin';

// ═══════════════════════════════════════════════════════════
// INTENT CLASSIFIER FEEDBACK LOOP
// Logs misclassifications so the classifier improves over time.
// Tracks confidence drift and suggests retraining triggers.
// ═══════════════════════════════════════════════════════════

export interface ClassificationFeedback {
  messageId: string;
  tenantId: string;
  originalIntent: string;
  correctedIntent: string | null;
  confidence: number;
  timestamp: Date;
  /** Which model variant produced the classification (for A/B testing) */
  modelVariant?: string;
}

interface ConfidenceBucket {
  range: string;
  total: number;
  accurate: number;
  accuracy: number;
}

export interface ClassifierHealthReport {
  total: number;
  accurate: number;
  accuracy: number;
  confidenceBuckets: ConfidenceBucket[];
  lowConfidenceRate: number;
  driftDetected: boolean;
  retrainingSuggested: boolean;
}

// ── CORE LOGGING ──────────────────────────────────────────

/**
 * Log a classification result (correct or corrected) for future analysis.
 * Uses webhook_logs table with provider='intent_feedback' to avoid new migrations.
 */
export async function logClassification(feedback: ClassificationFeedback): Promise<void> {
  try {
    await supabaseAdmin.from('webhook_logs').insert({
      tenant_id: feedback.tenantId,
      provider: 'intent_feedback',
      event_type: feedback.correctedIntent ? 'misclassification' : 'correct',
      direction: 'inbound',
      payload: {
        message_id: feedback.messageId,
        original_intent: feedback.originalIntent,
        corrected_intent: feedback.correctedIntent,
        confidence: feedback.confidence,
        was_correct: !feedback.correctedIntent,
        model_variant: feedback.modelVariant || 'default',
      },
    });
  } catch {
    // Feedback logging should never break the message pipeline
  }
}

// ── ACCURACY METRICS ──────────────────────────────────────

/**
 * Calculate classification accuracy over a time window.
 * Useful for dashboards and monitoring intent classifier quality.
 */
export async function getClassificationAccuracy(
  tenantId?: string,
  days = 30
): Promise<{ total: number; accurate: number; accuracy: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  let query = supabaseAdmin
    .from('webhook_logs')
    .select('event_type', { count: 'exact' })
    .eq('provider', 'intent_feedback')
    .gte('created_at', cutoff.toISOString());

  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  const { count: total } = await query;

  let accurateQuery = supabaseAdmin
    .from('webhook_logs')
    .select('event_type', { count: 'exact' })
    .eq('provider', 'intent_feedback')
    .eq('event_type', 'correct')
    .gte('created_at', cutoff.toISOString());

  if (tenantId) {
    accurateQuery = accurateQuery.eq('tenant_id', tenantId);
  }

  const { count: accurate } = await accurateQuery;

  const totalN = total ?? 0;
  const accurateN = accurate ?? 0;

  return {
    total: totalN,
    accurate: accurateN,
    accuracy: totalN > 0 ? Math.round((accurateN / totalN) * 10000) / 100 : 100,
  };
}

// ── MISCLASSIFICATION ANALYSIS ────────────────────────────

/**
 * Get the most commonly misclassified intents for a tenant.
 * Returns pairs of (original -> corrected) with frequency count.
 */
export async function getTopMisclassifications(
  tenantId: string,
  limit = 10
): Promise<{ originalIntent: string; correctedIntent: string; count: number }[]> {
  const { data } = await supabaseAdmin
    .from('webhook_logs')
    .select('payload')
    .eq('provider', 'intent_feedback')
    .eq('event_type', 'misclassification')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (!data?.length) return [];

  const counts = new Map<string, number>();
  for (const row of data) {
    const p = row.payload as Record<string, unknown>;
    const key = `${p.original_intent}→${p.corrected_intent}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([key, count]) => {
      const [originalIntent, correctedIntent] = key.split('→');
      return { originalIntent, correctedIntent, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ── CLASSIFIER HEALTH REPORT ──────────────────────────────

/**
 * Generate a comprehensive health report for the intent classifier.
 * Analyzes confidence distribution, detects accuracy drift, and
 * flags when retraining is advisable.
 *
 * Drift detection: compares accuracy in the last 7 days vs the
 * previous 23 days. A drop of >=5pp triggers the flag.
 */
export async function getClassifierHealth(
  tenantId?: string,
  days = 30
): Promise<ClassifierHealthReport> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // Fetch raw feedback rows (capped at 2000 for performance)
  let query = supabaseAdmin
    .from('webhook_logs')
    .select('payload, event_type, created_at')
    .eq('provider', 'intent_feedback')
    .gte('created_at', cutoff.toISOString())
    .order('created_at', { ascending: false })
    .limit(2000);

  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  const { data } = await query;
  const rows = data ?? [];

  if (!rows.length) {
    return {
      total: 0,
      accurate: 0,
      accuracy: 100,
      confidenceBuckets: [],
      lowConfidenceRate: 0,
      driftDetected: false,
      retrainingSuggested: false,
    };
  }

  // ── Confidence bucket analysis ──
  const bucketDefs = [
    { range: '0.0-0.3', min: 0, max: 0.3 },
    { range: '0.3-0.6', min: 0.3, max: 0.6 },
    { range: '0.6-0.8', min: 0.6, max: 0.8 },
    { range: '0.8-1.0', min: 0.8, max: 1.01 },
  ];

  const buckets = bucketDefs.map(def => ({
    ...def,
    total: 0,
    accurate: 0,
  }));

  let recentCorrect = 0;
  let recentTotal = 0;
  let olderCorrect = 0;
  let olderTotal = 0;

  const recentCutoff = new Date();
  recentCutoff.setDate(recentCutoff.getDate() - 7);

  for (const row of rows) {
    const p = row.payload as Record<string, unknown>;
    const conf = (p.confidence as number) ?? 0;
    const isCorrect = row.event_type === 'correct';
    const createdAt = new Date(row.created_at as string);

    // Bucket assignment
    for (const b of buckets) {
      if (conf >= b.min && conf < b.max) {
        b.total++;
        if (isCorrect) b.accurate++;
        break;
      }
    }

    // Drift window split
    if (createdAt >= recentCutoff) {
      recentTotal++;
      if (isCorrect) recentCorrect++;
    } else {
      olderTotal++;
      if (isCorrect) olderCorrect++;
    }
  }

  const total = rows.length;
  const accurate = rows.filter(r => r.event_type === 'correct').length;
  const accuracy = total > 0 ? Math.round((accurate / total) * 10000) / 100 : 100;

  const confidenceBuckets: ConfidenceBucket[] = buckets
    .filter(b => b.total > 0)
    .map(b => ({
      range: b.range,
      total: b.total,
      accurate: b.accurate,
      accuracy: Math.round((b.accurate / b.total) * 10000) / 100,
    }));

  // Low confidence = below 0.6
  const lowConfCount = buckets[0].total + buckets[1].total;
  const lowConfidenceRate = total > 0 ? Math.round((lowConfCount / total) * 10000) / 100 : 0;

  // Drift detection: 5 percentage-point drop in the recent window
  const recentAccuracy = recentTotal > 0 ? (recentCorrect / recentTotal) * 100 : 100;
  const olderAccuracy = olderTotal > 0 ? (olderCorrect / olderTotal) * 100 : 100;
  const driftDetected = olderTotal >= 20 && recentTotal >= 10 && (olderAccuracy - recentAccuracy) >= 5;

  // Suggest retraining when drift is detected OR low-confidence rate is high
  const retrainingSuggested = driftDetected || lowConfidenceRate > 25 || accuracy < 85;

  return {
    total,
    accurate,
    accuracy,
    confidenceBuckets,
    lowConfidenceRate,
    driftDetected,
    retrainingSuggested,
  };
}

// ── A/B MODEL COMPARISON ──────────────────────────────────

/**
 * Compare accuracy between two model variants over a time window.
 * Useful for evaluating whether a new classifier model performs better.
 */
export async function compareModelVariants(
  variantA: string,
  variantB: string,
  tenantId?: string,
  days = 14
): Promise<{
  variantA: { name: string; total: number; accuracy: number; avgConfidence: number };
  variantB: { name: string; total: number; accuracy: number; avgConfidence: number };
  winner: string | null;
  significant: boolean;
}> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  let query = supabaseAdmin
    .from('webhook_logs')
    .select('payload, event_type')
    .eq('provider', 'intent_feedback')
    .gte('created_at', cutoff.toISOString())
    .limit(5000);

  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  const { data } = await query;
  const rows = data ?? [];

  const statsA = { total: 0, correct: 0, confSum: 0 };
  const statsB = { total: 0, correct: 0, confSum: 0 };

  for (const row of rows) {
    const p = row.payload as Record<string, unknown>;
    const variant = (p.model_variant as string) || 'default';
    const conf = (p.confidence as number) ?? 0;
    const isCorrect = row.event_type === 'correct';

    if (variant === variantA) {
      statsA.total++;
      if (isCorrect) statsA.correct++;
      statsA.confSum += conf;
    } else if (variant === variantB) {
      statsB.total++;
      if (isCorrect) statsB.correct++;
      statsB.confSum += conf;
    }
  }

  const accA = statsA.total > 0 ? Math.round((statsA.correct / statsA.total) * 10000) / 100 : 0;
  const accB = statsB.total > 0 ? Math.round((statsB.correct / statsB.total) * 10000) / 100 : 0;
  const avgConfA = statsA.total > 0 ? Math.round((statsA.confSum / statsA.total) * 100) / 100 : 0;
  const avgConfB = statsB.total > 0 ? Math.round((statsB.confSum / statsB.total) * 100) / 100 : 0;

  // Simple significance heuristic: both need 30+ samples and 3+pp difference
  const minSamples = 30;
  const significant =
    statsA.total >= minSamples && statsB.total >= minSamples && Math.abs(accA - accB) >= 3;

  let winner: string | null = null;
  if (significant) {
    winner = accA > accB ? variantA : variantB;
  }

  return {
    variantA: { name: variantA, total: statsA.total, accuracy: accA, avgConfidence: avgConfA },
    variantB: { name: variantB, total: statsB.total, accuracy: accB, avgConfidence: avgConfB },
    winner,
    significant,
  };
}

// ── RETRAINING DATA EXPORT ────────────────────────────────

/**
 * Export misclassified examples as training data for classifier improvement.
 * Returns (input_intent, correct_intent) pairs suitable for fine-tuning.
 */
export async function exportTrainingData(
  tenantId?: string,
  days = 90
): Promise<{ originalIntent: string; correctedIntent: string; messageId: string }[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  let query = supabaseAdmin
    .from('webhook_logs')
    .select('payload')
    .eq('provider', 'intent_feedback')
    .eq('event_type', 'misclassification')
    .gte('created_at', cutoff.toISOString())
    .order('created_at', { ascending: false })
    .limit(1000);

  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  const { data } = await query;
  if (!data?.length) return [];

  return data.map(row => {
    const p = row.payload as Record<string, unknown>;
    return {
      originalIntent: p.original_intent as string,
      correctedIntent: p.corrected_intent as string,
      messageId: p.message_id as string,
    };
  });
}
