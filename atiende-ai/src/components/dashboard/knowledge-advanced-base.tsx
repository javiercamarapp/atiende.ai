'use client';

import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KnowledgeDelete } from '@/components/dashboard/knowledge-delete';

export type Chunk = {
  id: string;
  content: string;
  category: string;
  source: string;
  created_at: string;
};

export function KnowledgeAdvancedBase({ chunks, categories }: { chunks: Chunk[]; categories: string[] }) {
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const filtered = chunks
    .filter((c) => filter === 'all' || c.category === filter)
    .filter((c) => !search || c.content.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={cn(
              'text-xs px-3 py-1.5 rounded-full border transition',
              filter === 'all'
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300',
            )}
          >
            Todos · {chunks.length}
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={cn(
                'text-xs px-3 py-1.5 rounded-full border transition capitalize',
                filter === c
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300',
              )}
            >
              {c} · {chunks.filter((x) => x.category === c).length}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar fragmentos…"
          className="text-sm px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))] w-full sm:w-64"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <BookOpen className="w-10 h-10 text-zinc-300 mx-auto" />
          <p className="mt-3 text-sm text-zinc-500">Sin fragmentos. Responde las zonas de arriba o sube documentos.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.slice(0, 60).map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-zinc-100 bg-white p-4 flex items-start gap-3 hover:border-zinc-200 transition"
            >
              <div className="flex-1 min-w-0">
                <span className="inline-block text-[10.5px] uppercase tracking-wider text-zinc-500 bg-zinc-50 border border-zinc-100 rounded-full px-2 py-0.5">
                  {c.category}
                </span>
                <p className="mt-2 text-[13px] leading-relaxed text-zinc-800">
                  {c.content.substring(0, 240)}
                  {c.content.length > 240 ? '…' : ''}
                </p>
              </div>
              <KnowledgeDelete chunkId={c.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
