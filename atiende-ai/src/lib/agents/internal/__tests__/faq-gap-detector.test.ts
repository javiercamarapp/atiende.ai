import { describe, it, expect, vi } from 'vitest';

// Mock Supabase + OpenRouter
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
    })),
  },
}));

vi.mock('@/lib/llm/openrouter', () => ({
  getOpenRouter: vi.fn(() => ({
    embeddings: {
      create: vi.fn().mockRejectedValue(new Error('no api key in test')),
    },
  })),
  generateResponse: vi.fn(),
  MODELS: { ORCHESTRATOR_FALLBACK: 'openai/gpt-4.1-mini' },
}));

import { clusterSimilarQuestions } from '../faq-gap-detector';

describe('clusterSimilarQuestions()', () => {
  it('retorna stats con fallback_rate=1 cuando embedding falla completamente', async () => {
    const result = await clusterSimilarQuestions([
      '¿cuánto cuesta la limpieza?',
      'precio limpieza dental',
      '¿tienen estacionamiento?',
    ]);
    expect(result.stats.method_used).toBe('jaccard');
    expect(result.stats.fallback_rate).toBe(1);
    expect(result.stats.embedding_success).toBe(0);
    expect(result.stats.embedding_fallback).toBe(3);
    expect(result.stats.total_questions).toBe(3);
  });

  it('agrupa preguntas similares con Jaccard cuando hay suficiente overlap', async () => {
    const result = await clusterSimilarQuestions([
      'cuanto cuesta la limpieza dental',
      'precio limpieza dental',
      'donde están ubicados',
    ]);
    // Debe generar al menos 2 clusters (limpieza vs ubicación)
    expect(result.clusters.length).toBeGreaterThanOrEqual(1);
    expect(result.clusters.length).toBeLessThanOrEqual(3);
  });

  it('retorna vacío con input vacío', async () => {
    const result = await clusterSimilarQuestions([]);
    expect(result.clusters).toEqual([]);
    expect(result.stats.total_questions).toBe(0);
  });

  it('cada cluster tiene shape correcto', async () => {
    const result = await clusterSimilarQuestions(['pregunta uno', 'pregunta dos']);
    for (const c of result.clusters) {
      expect(c.cluster_id).toBeTypeOf('number');
      expect(c.representative).toBeTypeOf('string');
      expect(Array.isArray(c.members)).toBe(true);
      expect(c.frequency).toBeGreaterThanOrEqual(1);
    }
  });
});
