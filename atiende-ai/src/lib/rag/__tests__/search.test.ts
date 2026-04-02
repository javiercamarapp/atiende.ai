/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock setup (hoisted) ───────────────────────────────────

const { mockEmbeddingsCreate, mockRpc, mockInsert } = vi.hoisted(() => ({
  mockEmbeddingsCreate: vi.fn(),
  mockRpc: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: { create: mockEmbeddingsCreate },
    })),
  };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    rpc: mockRpc,
    from: vi.fn(() => ({ insert: mockInsert })),
  },
}));

import { searchKnowledge, ingestKnowledge, ingestKnowledgeBatch } from '../search';

// ── Helpers ────────────────────────────────────────────────

function makeFakeEmbedding(dim = 1536): number[] {
  return Array.from({ length: dim }, (_, i) => i * 0.001);
}

// ── searchKnowledge ────────────────────────────────────────

describe('searchKnowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates embedding and returns formatted RAG context', async () => {
    const fakeEmb = makeFakeEmbedding();
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: fakeEmb }],
    });
    mockRpc.mockResolvedValue({
      data: [
        { content: 'Corte de cabello $200 MXN', category: 'precios', similarity: 0.92 },
        { content: 'Abierto lunes a viernes 9-18h', category: 'horarios', similarity: 0.85 },
      ],
      error: null,
    });

    const result = await searchKnowledge('tenant-1', 'cuanto cuesta un corte?');

    // Verify embedding was generated with correct model and input
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: 'cuanto cuesta un corte?',
    });

    // Verify RPC was called with the right parameters
    expect(mockRpc).toHaveBeenCalledWith('search_knowledge', {
      p_tenant: 'tenant-1',
      p_query: fakeEmb,
      p_threshold: 0.35,
      p_limit: 5,
    });

    // Verify formatted output
    expect(result).toContain('[precios] Corte de cabello $200 MXN');
    expect(result).toContain('[horarios] Abierto lunes a viernes 9-18h');
    expect(result).toContain('---');
  });

  it('returns fallback message when no results are found', async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: makeFakeEmbedding() }],
    });
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await searchKnowledge('tenant-1', 'algo random');

    expect(result).toContain('No hay informacion especifica');
  });

  it('returns fallback message when data is null', async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: makeFakeEmbedding() }],
    });
    mockRpc.mockResolvedValue({ data: null, error: null });

    const result = await searchKnowledge('tenant-1', 'algo');

    expect(result).toContain('No hay informacion especifica');
  });

  it('returns fallback message on RPC error', async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: makeFakeEmbedding() }],
    });
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Connection timeout' },
    });

    const result = await searchKnowledge('tenant-1', 'algo');

    expect(result).toContain('No hay informacion especifica');
  });

  it('handles single result correctly', async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: makeFakeEmbedding() }],
    });
    mockRpc.mockResolvedValue({
      data: [{ content: 'Solo un resultado', category: 'general', similarity: 0.5 }],
      error: null,
    });

    const result = await searchKnowledge('tenant-1', 'algo');

    expect(result).toBe('[general] Solo un resultado');
    // No separator for single result
    expect(result).not.toContain('---');
  });
});

// ── ingestKnowledge ────────────────────────────────────────

describe('ingestKnowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates embedding and inserts knowledge chunk', async () => {
    const fakeEmb = makeFakeEmbedding();
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: fakeEmb }],
    });

    await ingestKnowledge('tenant-1', 'Nuestro horario es 9-18h', 'horarios');

    expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: 'Nuestro horario es 9-18h',
    });

    expect(mockInsert).toHaveBeenCalledWith({
      tenant_id: 'tenant-1',
      content: 'Nuestro horario es 9-18h',
      embedding: fakeEmb,
      category: 'horarios',
      source: 'onboarding',
    });
  });

  it('uses custom source when provided', async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: makeFakeEmbedding() }],
    });

    await ingestKnowledge('tenant-1', 'content', 'faq', 'manual');

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'manual' })
    );
  });
});

// ── ingestKnowledgeBatch ───────────────────────────────────

describe('ingestKnowledgeBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates embeddings in batch and inserts all chunks', async () => {
    const chunks = [
      { content: 'Precio corte $200', category: 'precios' },
      { content: 'Horario 9-18h', category: 'horarios' },
      { content: 'Ubicacion centro', category: 'ubicacion' },
    ];

    const fakeEmbeddings = chunks.map((_, i) =>
      Array.from({ length: 1536 }, (__, j) => i * 0.01 + j * 0.001)
    );

    mockEmbeddingsCreate.mockResolvedValue({
      data: fakeEmbeddings.map(e => ({ embedding: e })),
    });

    await ingestKnowledgeBatch('tenant-1', chunks);

    // Should call embeddings.create once with all inputs
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['Precio corte $200', 'Horario 9-18h', 'Ubicacion centro'],
    });

    // Should insert all rows at once
    expect(mockInsert).toHaveBeenCalledWith([
      { tenant_id: 'tenant-1', content: 'Precio corte $200', embedding: fakeEmbeddings[0], category: 'precios', source: 'onboarding' },
      { tenant_id: 'tenant-1', content: 'Horario 9-18h', embedding: fakeEmbeddings[1], category: 'horarios', source: 'onboarding' },
      { tenant_id: 'tenant-1', content: 'Ubicacion centro', embedding: fakeEmbeddings[2], category: 'ubicacion', source: 'onboarding' },
    ]);
  });

  it('uses custom source when provided', async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: makeFakeEmbedding() }],
    });

    await ingestKnowledgeBatch(
      'tenant-1',
      [{ content: 'data', category: 'cat' }],
      'api_import'
    );

    expect(mockInsert).toHaveBeenCalledWith([
      expect.objectContaining({ source: 'api_import' }),
    ]);
  });
});
