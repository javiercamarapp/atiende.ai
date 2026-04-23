'use client';

import { useState } from 'react';
import { BookOpen, FileText, Plug, MessageSquareText, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  KnowledgeAdvancedBase,
  type Chunk,
} from '@/components/dashboard/knowledge-advanced-base';
import { KnowledgeAdvancedDocs } from '@/components/dashboard/knowledge-advanced-docs';
import { KnowledgeAdvancedApis } from '@/components/dashboard/knowledge-advanced-apis';
import { KnowledgeAdvancedPrompt } from '@/components/dashboard/knowledge-advanced-prompt';

type TabKey = 'base' | 'docs' | 'apis' | 'prompt';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'base',   label: 'Fragmentos',   icon: BookOpen },
  { key: 'docs',   label: 'Documentos',   icon: FileText },
  { key: 'apis',   label: 'Integraciones', icon: Plug },
  { key: 'prompt', label: 'Prompt',       icon: MessageSquareText },
];

export interface KnowledgeAdvancedProps {
  tenantId: string;
  chunks: Chunk[];
  categories: string[];
  initialPrompt: string;
  initialWelcome: string;
}

// Collapsable "Opciones avanzadas" section. Rendered below the zone grid on
// /knowledge so power users still have access to fragments, doc uploads,
// integrations, and the system prompt — but the default view is the 10
// zones. Kept lazy: sub-panels aren't mounted until the drawer opens.
export function KnowledgeAdvanced(props: KnowledgeAdvancedProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>('base');

  return (
    <div className="rounded-2xl bg-white/80 backdrop-blur-xl border border-zinc-200/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden animate-element animate-delay-300">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50/60 transition-colors"
        aria-expanded={open}
      >
        <span className="inline-flex w-8 h-8 rounded-full items-center justify-center bg-zinc-100 text-zinc-500 shrink-0">
          <BookOpen className="w-3.5 h-3.5" strokeWidth={1.75} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-zinc-700">Opciones avanzadas</p>
          <p className="text-[11px] text-zinc-400 leading-tight">
            Fragmentos, documentos, integraciones y prompt.
          </p>
        </div>
        <ChevronDown className={cn('w-4 h-4 text-zinc-400 transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="border-t border-zinc-100">
          <div className="flex flex-wrap items-center gap-1 border-b border-zinc-100 px-3 py-2">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg transition',
                    active
                      ? 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] font-medium'
                      : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900',
                  )}
                >
                  <t.icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="p-6">
            {tab === 'base'   && <KnowledgeAdvancedBase chunks={props.chunks} categories={props.categories} />}
            {tab === 'docs'   && <KnowledgeAdvancedDocs tenantId={props.tenantId} />}
            {tab === 'apis'   && <KnowledgeAdvancedApis />}
            {tab === 'prompt' && (
              <KnowledgeAdvancedPrompt
                initialPrompt={props.initialPrompt}
                initialWelcome={props.initialWelcome}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
