import { Redis } from '@upstash/redis';
import { logger } from '@/lib/logger';

// ─── Redis client (best-effort; falls back to in-memory) ───────────────────

let redis: Redis | null = null;
try {
  if (process.env.UPSTASH_REDIS_URL && process.env.UPSTASH_REDIS_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_URL,
      token: process.env.UPSTASH_REDIS_TOKEN,
    });
  }
} catch {
  logger.warn('monitoring: Redis unavailable, using in-memory metrics');
}

// ─── In-memory fallback ────────────────────────────────────────────────────

const memMetrics = new Map<string, number>();

function incrMem(key: string, amount = 1): void {
  memMetrics.set(key, (memMetrics.get(key) ?? 0) + amount);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const METRICS_PREFIX = 'metrics:';
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

async function incr(key: string, amount = 1): Promise<void> {
  const fullKey = `${METRICS_PREFIX}${key}`;
  if (redis) {
    try {
      const pipeline = redis.pipeline();
      pipeline.incrbyfloat(fullKey, amount);
      pipeline.expire(fullKey, TTL_SECONDS);
      await pipeline.exec();
    } catch {
      incrMem(fullKey, amount);
    }
  } else {
    incrMem(fullKey, amount);
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Track an LLM API call with its latency and estimated cost.
 */
export function trackLLMCall(
  model: string,
  durationMs: number,
  costUsd: number,
  tenantId: string,
): void {
  // Fire-and-forget — never block the caller
  void Promise.all([
    incr(`llm:calls:${model}`, 1),
    incr(`llm:duration_ms:${model}`, durationMs),
    incr(`llm:cost_usd:${model}`, costUsd),
    incr(`llm:cost_usd:tenant:${tenantId}`, costUsd),
    incr('llm:calls:total', 1),
    incr('llm:cost_usd:total', costUsd),
  ]);

  logger.debug('LLM call tracked', { model, durationMs, costUsd, tenantId });
}

/**
 * Track webhook processing time and outcome.
 */
export function trackWebhook(
  provider: string,
  durationMs: number,
  success: boolean,
): void {
  const status = success ? 'ok' : 'fail';
  void Promise.all([
    incr(`webhook:${provider}:${status}`, 1),
    incr(`webhook:${provider}:duration_ms`, durationMs),
    incr('webhook:total', 1),
  ]);

  logger.debug('Webhook tracked', { provider, durationMs, success });
}

/**
 * Track agent execution success/failure and duration.
 */
export function trackAgentExecution(
  agentSlug: string,
  tenantId: string,
  success: boolean,
  durationMs: number,
): void {
  const status = success ? 'ok' : 'fail';
  void Promise.all([
    incr(`agent:${agentSlug}:${status}`, 1),
    incr(`agent:${agentSlug}:duration_ms`, durationMs),
    incr(`agent:tenant:${tenantId}:${status}`, 1),
    incr('agent:total', 1),
  ]);

  logger.debug('Agent execution tracked', { agentSlug, tenantId, success, durationMs });
}

/**
 * Track errors by type for alerting dashboards.
 */
export function trackError(errorType: string): void {
  void incr(`errors:${errorType}`, 1);
  void incr('errors:total', 1);
}

// ─── Metrics summary ──────────────────────────────────────────────────────

export interface MetricsSummary {
  llm: {
    totalCalls: number;
    totalCostUsd: number;
  };
  webhooks: {
    total: number;
  };
  agents: {
    total: number;
  };
  errors: {
    total: number;
  };
  source: 'redis' | 'memory';
}

/**
 * Retrieve a summary of current metrics.
 */
export async function getMetrics(): Promise<MetricsSummary> {
  if (redis) {
    try {
      const [llmCalls, llmCost, webhookTotal, agentTotal, errorsTotal] = await Promise.all([
        redis.get<number>(`${METRICS_PREFIX}llm:calls:total`),
        redis.get<number>(`${METRICS_PREFIX}llm:cost_usd:total`),
        redis.get<number>(`${METRICS_PREFIX}webhook:total`),
        redis.get<number>(`${METRICS_PREFIX}agent:total`),
        redis.get<number>(`${METRICS_PREFIX}errors:total`),
      ]);

      return {
        llm: { totalCalls: llmCalls ?? 0, totalCostUsd: llmCost ?? 0 },
        webhooks: { total: webhookTotal ?? 0 },
        agents: { total: agentTotal ?? 0 },
        errors: { total: errorsTotal ?? 0 },
        source: 'redis',
      };
    } catch {
      // fall through to memory
    }
  }

  return {
    llm: {
      totalCalls: memMetrics.get(`${METRICS_PREFIX}llm:calls:total`) ?? 0,
      totalCostUsd: memMetrics.get(`${METRICS_PREFIX}llm:cost_usd:total`) ?? 0,
    },
    webhooks: { total: memMetrics.get(`${METRICS_PREFIX}webhook:total`) ?? 0 },
    agents: { total: memMetrics.get(`${METRICS_PREFIX}agent:total`) ?? 0 },
    errors: { total: memMetrics.get(`${METRICS_PREFIX}errors:total`) ?? 0 },
    source: 'memory',
  };
}

/**
 * Check Redis connectivity (used by health endpoint).
 */
export async function pingRedis(): Promise<boolean> {
  if (!redis) return false;
  try {
    const res = await redis.ping();
    return res === 'PONG';
  } catch {
    return false;
  }
}
