// ═════════════════════════════════════════════════════════════════════════════
// CRON: refresh-model-prices (AUDIT R17 BUG-011)
//
// Descarga precios actuales de cada modelo que trackeamos desde la API
// pública de OpenRouter (`https://openrouter.ai/api/v1/models`) y los
// persiste en Redis como `model_prices:<model>` con TTL 30 días.
//
// El cache in-memory de `@/lib/llm/openrouter` se actualiza en el mismo run
// (el proceso que ejecuta el cron ve los nuevos precios inmediatamente;
// otros workers se hidratan de Redis en su próximo cold start).
//
// Alerta si detectamos un cambio de precio >20% entre runs (señal de que
// OpenRouter subió precios o nosotros nos equivocamos de modelo).
//
// Corre mensualmente (1er día del mes, UTC). Ver `vercel.json`.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import {
  getTrackedModels,
  updateModelPriceCache,
} from '@/lib/llm/openrouter';
import { requireCronAuth, logCronRun } from '@/lib/agents/internal/cron-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface OpenRouterModel {
  id: string;
  pricing?: {
    prompt?: string;  // USD por token (string decimal)
    completion?: string;
  };
}

interface OpenRouterModelsResponse {
  data?: OpenRouterModel[];
}

/** Parsea el pricing de OpenRouter a [input $/M, output $/M]. */
function parseRates(m: OpenRouterModel): [number, number] | null {
  if (!m.pricing || m.pricing.prompt === undefined || m.pricing.completion === undefined) {
    return null;
  }
  const inPerToken = Number(m.pricing.prompt);
  const outPerToken = Number(m.pricing.completion);
  if (!isFinite(inPerToken) || !isFinite(outPerToken)) return null;
  // OpenRouter reporta $/token; convertir a $/1M tokens.
  return [inPerToken * 1_000_000, outPerToken * 1_000_000];
}

export async function GET(req: NextRequest) {
  const startedAt = new Date();
  const authFail = requireCronAuth(req);
  if (authFail) return authFail;

  const tracked = new Set(getTrackedModels());

  let fetched: OpenRouterModel[] = [];
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      await logCronRun({
        jobName: 'refresh-model-prices',
        startedAt,
        tenantsProcessed: 0,
        tenantsSucceeded: 0,
        tenantsFailed: 0,
        details: { error: `OpenRouter HTTP ${res.status}` },
      });
      return NextResponse.json(
        { error: 'openrouter_fetch_failed', status: res.status },
        { status: 502 },
      );
    }
    const json = (await res.json()) as OpenRouterModelsResponse;
    fetched = json.data ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logCronRun({
      jobName: 'refresh-model-prices',
      startedAt,
      tenantsProcessed: 0,
      tenantsSucceeded: 0,
      tenantsFailed: 0,
      details: { error: msg },
    });
    return NextResponse.json({ error: 'fetch_error', message: msg }, { status: 502 });
  }

  // Redis opcional — si no está configurado, solo actualizamos cache in-memory.
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  const redis = url && token ? new Redis({ url, token }) : null;

  let updated = 0;
  let skipped = 0;
  const priceChanges: Array<{ model: string; from?: [number, number]; to: [number, number]; changePct: number }> = [];

  for (const m of fetched) {
    if (!tracked.has(m.id)) continue;
    const rates = parseRates(m);
    if (!rates) {
      skipped++;
      continue;
    }

    // Detectar cambio de precio respecto al snapshot anterior (para alertar)
    let prev: [number, number] | null = null;
    if (redis) {
      try {
        prev = await redis.get<[number, number]>(`model_prices:${m.id}`);
      } catch { /* best effort */ }
    }
    if (prev && Array.isArray(prev) && prev.length === 2) {
      const avgPrev = (prev[0] + prev[1]) / 2;
      const avgNew = (rates[0] + rates[1]) / 2;
      const pct = avgPrev > 0 ? Math.abs((avgNew - avgPrev) / avgPrev) * 100 : 0;
      if (pct >= 20) {
        priceChanges.push({ model: m.id, from: prev, to: rates, changePct: pct });
        console.warn(
          `[refresh-model-prices] ALERTA: ${m.id} cambió ${pct.toFixed(1)}% — ` +
          `from [${prev[0]}, ${prev[1]}] to [${rates[0]}, ${rates[1]}] $/M`,
        );
      }
    }

    // Actualizar cache in-memory del worker actual
    updateModelPriceCache(m.id, rates);

    // Persistir en Redis (30d TTL)
    if (redis) {
      try {
        await redis.set(`model_prices:${m.id}`, rates, { ex: 30 * 24 * 3600 });
      } catch { /* best effort */ }
    }
    updated++;
  }

  await logCronRun({
    jobName: 'refresh-model-prices',
    startedAt,
    tenantsProcessed: updated + skipped,
    tenantsSucceeded: updated,
    tenantsFailed: 0,
    details: {
      models_tracked: tracked.size,
      models_updated: updated,
      models_skipped_no_pricing: skipped,
      price_alerts: priceChanges.length,
      alerts: priceChanges.slice(0, 10), // primeros 10 para no saturar
    },
  });

  return NextResponse.json({
    status: 'ok',
    models_tracked: tracked.size,
    models_updated: updated,
    models_skipped: skipped,
    price_alerts: priceChanges.length,
    duration_ms: Date.now() - startedAt.getTime(),
  });
}
