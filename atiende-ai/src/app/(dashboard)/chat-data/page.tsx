'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import {
  Sparkles, Database, FileText, Send, Plus, Search, Clock,
  BarChart3, Users, TrendingUp, Calendar, Mail, Megaphone,
  MessageSquare, Image as ImageIcon, Hash, LayoutGrid,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';

const GATED_PLANS = new Set(['free_trial', 'starter']);

type Mode = 'datos' | 'contenido';

interface Turn {
  id: string;
  mode: Mode;
  question: string;
  answer?: string;
  sql?: string | null;
  rows?: Array<Record<string, unknown>>;
  row_count?: number;
  error?: string;
  loading?: boolean;
}

interface Template {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  prompt: string;
  category: string;
}

const DATOS_TEMPLATES: Template[] = [
  { icon: Users, title: 'Pacientes nuevos', prompt: '¿Cuántos pacientes nuevos tuve este mes?', category: 'Clientes' },
  { icon: TrendingUp, title: 'Día más rentable', prompt: '¿Cuál es mi día más rentable?', category: 'Ingresos' },
  { icon: BarChart3, title: 'Top 10 pacientes', prompt: '¿Quiénes son mis 10 pacientes más valiosos?', category: 'Clientes' },
  { icon: Calendar, title: 'No-shows semana', prompt: '¿Cuántos no-shows tuve esta semana?', category: 'Operaciones' },
  { icon: Clock, title: 'Hora pico', prompt: '¿A qué hora del día tengo más citas?', category: 'Operaciones' },
  { icon: Database, title: 'Ingresos mes', prompt: '¿Cuánto facturé este mes vs el mes pasado?', category: 'Ingresos' },
];

const CONTENIDO_TEMPLATES: Template[] = [
  { icon: MessageSquare, title: 'Post Instagram', prompt: 'Escribe un post de Instagram para promocionar limpieza dental con 20% de descuento este mes.', category: 'Redes' },
  { icon: Mail, title: 'Correo recordatorio', prompt: 'Redacta un correo breve para recordar a pacientes su cita del día siguiente.', category: 'Email' },
  { icon: Megaphone, title: 'Campaña WhatsApp', prompt: 'Crea un mensaje de WhatsApp para reactivar pacientes que no han venido en 6 meses.', category: 'WhatsApp' },
  { icon: Hash, title: 'Hashtags clínica', prompt: 'Dame 15 hashtags relevantes para una clínica dental en Monterrey.', category: 'Redes' },
  { icon: FileText, title: 'Blog post', prompt: 'Escribe un artículo corto sobre la importancia de la limpieza dental cada 6 meses.', category: 'Blog' },
  { icon: ImageIcon, title: 'Copy promoción', prompt: 'Genera 3 variantes de copy para una promoción de blanqueamiento dental.', category: 'Marketing' },
];

export default function ChatDataPage() {
  const [mode, setMode] = useState<Mode>('datos');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [plan, setPlan] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/tenant/plan');
        const data = await r.json().catch(() => ({}));
        if (!cancelled) setPlan(typeof data.plan === 'string' ? data.plan : 'free_trial');
      } catch {
        if (!cancelled) setPlan('free_trial');
      } finally {
        if (!cancelled) setPlanLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length]);

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    const turnId = crypto.randomUUID();
    setTurns((prev) => [...prev, { id: turnId, question, mode, loading: true }]);
    setInput('');
    setLoading(true);

    try {
      const endpoint = mode === 'datos' ? '/api/chat-data' : '/api/generate-content';
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, prompt: question }),
      });
      const data = await r.json().catch(() => ({}));
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                loading: false,
                answer: data.answer || data.content || (r.ok ? 'Sin respuesta' : undefined),
                sql: data.sql ?? null,
                rows: data.rows || [],
                row_count: data.row_count,
                error: r.ok ? undefined : data.error || `HTTP ${r.status}`,
              }
            : t,
        ),
      );
    } catch (err) {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? { ...t, loading: false, answer: 'Error de red', error: err instanceof Error ? err.message : String(err) }
            : t,
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  const templates = mode === 'datos' ? DATOS_TEMPLATES : CONTENIDO_TEMPLATES;
  const filteredTemplates = templateSearch
    ? templates.filter((t) =>
        t.title.toLowerCase().includes(templateSearch.toLowerCase()) ||
        t.category.toLowerCase().includes(templateSearch.toLowerCase()),
      )
    : templates;

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask(input);
    }
  }

  if (planLoading) {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse" />
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse [animation-delay:300ms]" />
        </div>
      </div>
    );
  }

  if (plan && GATED_PLANS.has(plan)) {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center animate-element">
          <div className="mx-auto w-32 h-32 md:w-40 md:h-40 relative animate-float">
            <Image
              src="/Untitled design (7).png"
              alt=""
              fill
              sizes="160px"
              priority
              className="object-contain drop-shadow-xl"
            />
          </div>
          <h1 className="mt-6 text-2xl md:text-3xl font-semibold tracking-tight text-zinc-900">
            Personal AI
          </h1>
          <p className="mt-3 text-sm md:text-[15px] text-zinc-500 leading-relaxed">
            Pregúntale a tu negocio en lenguaje natural y genera contenido al instante. Disponible desde el plan Profesional.
          </p>
          <Link
            href="/settings/billing?plan=pro"
            className="mt-7 inline-flex items-center justify-center gap-2 h-11 px-6 rounded-full bg-[hsl(var(--brand-blue))] text-white text-sm font-medium hover:opacity-90 transition shadow-md shadow-[hsl(var(--brand-blue))]/20"
          >
            <Sparkles className="w-4 h-4" />
            Subir a Pro
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100dvh-10rem)] md:h-[calc(100vh-8rem)] flex flex-col md:flex-row gap-3 md:gap-4">
      {/* ─────────────── MOBILE TOP BAR ─────────────── */}
      <div className="md:hidden flex items-center gap-2">
        <div className="flex-1 flex gap-1 p-1 rounded-full bg-zinc-100">
          <button
            onClick={() => setMode('datos')}
            className={cn(
              'flex-1 h-9 rounded-full text-[13px] font-medium flex items-center justify-center gap-1.5 transition',
              mode === 'datos' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500',
            )}
          >
            <Database className="w-3.5 h-3.5" /> Datos
          </button>
          <button
            onClick={() => setMode('contenido')}
            className={cn(
              'flex-1 h-9 rounded-full text-[13px] font-medium flex items-center justify-center gap-1.5 transition',
              mode === 'contenido' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500',
            )}
          >
            <Sparkles className="w-3.5 h-3.5" /> Contenido
          </button>
        </div>
        <button
          onClick={() => setShowTemplates(true)}
          aria-label="Plantillas"
          className="h-9 w-9 rounded-full bg-white border border-zinc-200 flex items-center justify-center text-zinc-600 hover:text-zinc-900 transition shrink-0"
        >
          <LayoutGrid className="w-4 h-4" />
        </button>
      </div>

      {/* ─────────────── MOBILE TEMPLATES SHEET ─────────────── */}
      <Sheet open={showTemplates} onOpenChange={setShowTemplates}>
        <SheetContent side="bottom" className="h-[75dvh] p-0 flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-zinc-100">
            <SheetTitle>Plantillas</SheetTitle>
          </SheetHeader>
          <div className="px-5 py-3 border-b border-zinc-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
              <input
                type="search"
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
                placeholder="Buscar plantilla"
                className="w-full pl-9 pr-3 h-9 text-[13px] rounded-full bg-zinc-50 border border-zinc-200 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
              />
            </div>
          </div>
          <ul className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            {filteredTemplates.map((t) => {
              const Icon = t.icon;
              return (
                <li key={t.title}>
                  <button
                    onClick={() => { ask(t.prompt); setShowTemplates(false); }}
                    className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left hover:bg-zinc-50 transition group"
                  >
                    <div className="w-9 h-9 rounded-lg bg-zinc-100 group-hover:bg-[hsl(var(--brand-blue-soft))] text-zinc-600 group-hover:text-[hsl(var(--brand-blue))] flex items-center justify-center shrink-0 transition">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-zinc-900 truncate">{t.title}</p>
                      <p className="text-[11.5px] text-zinc-500 line-clamp-2 mt-0.5">{t.prompt}</p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>

      {/* ─────────────── LEFT RAIL ─────────────── */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col glass-card p-4 gap-4 animate-element">
        {/* Mode selector */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium mb-2">Modo</p>
          <div className="space-y-1.5">
            <button
              onClick={() => setMode('datos')}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition text-left',
                mode === 'datos'
                  ? 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]'
                  : 'text-zinc-600 hover:bg-zinc-50',
              )}
            >
              <Database className="w-4 h-4 shrink-0" />
              Preguntar a tus datos
            </button>
            <button
              onClick={() => setMode('contenido')}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition text-left',
                mode === 'contenido'
                  ? 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]'
                  : 'text-zinc-600 hover:bg-zinc-50',
              )}
            >
              <Sparkles className="w-4 h-4 shrink-0" />
              Generador de contenido
            </button>
          </div>
        </div>

        {/* Template search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <input
            type="search"
            value={templateSearch}
            onChange={(e) => setTemplateSearch(e.target.value)}
            placeholder="Buscar plantilla"
            className="w-full pl-9 pr-3 h-8 text-[12.5px] rounded-full bg-zinc-50 border border-zinc-200 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
          />
        </div>

        {/* Templates */}
        <div className="flex-1 min-h-0 flex flex-col">
          <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium mb-2">Plantillas</p>
          <ul className="flex-1 overflow-y-auto space-y-1 pr-1">
            {filteredTemplates.map((t) => {
              const Icon = t.icon;
              return (
                <li key={t.title}>
                  <button
                    onClick={() => ask(t.prompt)}
                    className="w-full flex items-start gap-2 px-2.5 py-2 rounded-lg text-left hover:bg-zinc-50 transition group"
                  >
                    <div className="w-7 h-7 rounded-md bg-zinc-100 group-hover:bg-[hsl(var(--brand-blue-soft))] text-zinc-600 group-hover:text-[hsl(var(--brand-blue))] flex items-center justify-center shrink-0 transition">
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-medium text-zinc-900 truncate">{t.title}</p>
                      <p className="text-[10.5px] text-zinc-500 truncate">{t.category}</p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* New chat */}
        <button
          onClick={() => setTurns([])}
          className="flex items-center justify-center gap-1.5 h-9 rounded-full bg-[hsl(var(--brand-blue))] text-white text-[12.5px] font-medium hover:opacity-90 transition"
        >
          <Plus className="w-3.5 h-3.5" />
          Nueva conversación
        </button>
      </aside>

      {/* ─────────────── MAIN CHAT ─────────────── */}
      <section className="flex-1 min-w-0 min-h-0 glass-card flex flex-col animate-element animate-delay-100 overflow-hidden">
        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0 px-4 md:px-10 py-4 md:py-6">
          {turns.length === 0 ? (
            <EmptyState mode={mode} templates={templates.slice(0, 6)} onPick={ask} />
          ) : (
            <div className="max-w-3xl mx-auto space-y-4">
              {turns.map((t) => (
                <TurnBlock key={t.id} turn={t} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="px-3 md:px-10 pb-3 md:pb-5 pt-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="max-w-3xl mx-auto"
          >
            <div className="relative rounded-2xl border border-zinc-200 bg-white shadow-sm focus-within:border-[hsl(var(--brand-blue))] focus-within:ring-2 focus-within:ring-[hsl(var(--brand-blue-soft))] transition">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder={
                  mode === 'datos'
                    ? 'Pregunta sobre tus datos…'
                    : 'Describe el contenido que quieres…'
                }
                disabled={loading}
                className="w-full resize-none bg-transparent outline-none px-4 pt-3 pb-10 text-[14px] text-zinc-900 placeholder:text-zinc-400 max-h-40"
              />
              <div className="absolute left-3 bottom-2 flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-zinc-50 border border-zinc-200 text-[10.5px] text-zinc-500 font-medium">
                  {mode === 'datos' ? <Database className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                  {mode === 'datos' ? 'Datos' : 'Contenido'}
                </span>
                <span className="hidden md:inline text-[10.5px] text-zinc-400">Enter · Shift+Enter para salto</span>
              </div>
              <button
                type="submit"
                disabled={loading || !input.trim()}
                aria-label="Enviar"
                className="absolute right-2 bottom-2 w-8 h-8 rounded-full bg-[hsl(var(--brand-blue))] text-white flex items-center justify-center hover:opacity-90 transition disabled:opacity-30"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ mode, templates, onPick }: { mode: Mode; templates: Template[]; onPick: (p: string) => void }) {
  return (
    <div className="min-h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto py-4">
      <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(235_84%_68%)] flex items-center justify-center shadow-lg shadow-[hsl(var(--brand-blue))]/20">
        {mode === 'datos' ? (
          <Database className="w-5 h-5 md:w-6 md:h-6 text-white" />
        ) : (
          <Sparkles className="w-5 h-5 md:w-6 md:h-6 text-white" />
        )}
      </div>
      <h2 className="mt-4 md:mt-5 text-xl md:text-3xl font-semibold tracking-tight text-zinc-900 px-2">
        {mode === 'datos' ? '¿Qué quieres saber?' : '¿Qué quieres crear?'}
      </h2>
      <p className="mt-1.5 md:mt-2 text-[13px] md:text-sm text-zinc-500 max-w-md px-2">
        {mode === 'datos'
          ? 'Pregúntale a tu negocio en español natural.'
          : 'Genera posts, correos y campañas con la voz de tu marca.'}
      </p>

      <div className="mt-5 md:mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-2.5 w-full">
        {templates.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.title}
              onClick={() => onPick(t.prompt)}
              className="group flex items-start gap-2.5 px-3 py-2.5 md:px-4 md:py-3 rounded-xl bg-white border border-zinc-200 text-left hover:border-[hsl(var(--brand-blue))] hover:bg-[hsl(var(--brand-blue-soft))]/40 transition"
            >
              <div className="w-8 h-8 rounded-lg bg-zinc-100 group-hover:bg-white text-zinc-600 group-hover:text-[hsl(var(--brand-blue))] flex items-center justify-center shrink-0 transition">
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-zinc-900 truncate">{t.title}</p>
                <p className="text-[11.5px] text-zinc-500 line-clamp-2 mt-0.5">{t.prompt}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function TurnBlock({ turn }: { turn: Turn }) {
  const [showRows, setShowRows] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!turn.answer) return;
    try {
      await navigator.clipboard.writeText(turn.answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <article className="stagger-item space-y-3">
      {/* Pregunta */}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-[hsl(var(--brand-blue-soft))] border border-[hsl(var(--brand-blue))]/10 px-4 py-2.5 text-[13.5px] text-zinc-900 leading-relaxed">
          {turn.question}
        </div>
      </div>

      {/* Respuesta */}
      {turn.loading && (
        <div className="flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(235_84%_68%)] flex items-center justify-center shrink-0">
            {turn.mode === 'datos' ? <Database className="w-3.5 h-3.5 text-white" /> : <Sparkles className="w-3.5 h-3.5 text-white" />}
          </div>
          <div className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl rounded-tl-sm bg-zinc-50 border border-zinc-200">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse [animation-delay:300ms]" />
          </div>
        </div>
      )}

      {(turn.answer || turn.error) && (
        <div className="flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(235_84%_68%)] flex items-center justify-center shrink-0 mt-0.5">
            {turn.mode === 'datos' ? <Database className="w-3.5 h-3.5 text-white" /> : <Sparkles className="w-3.5 h-3.5 text-white" />}
          </div>
          <div className="flex-1 min-w-0 rounded-2xl rounded-tl-sm bg-white border border-zinc-200 px-4 py-3">
            {turn.error && (
              <p className="text-xs text-rose-600 mb-2 font-medium">Error: {turn.error}</p>
            )}
            <p className="text-[13.5px] text-zinc-900 leading-relaxed whitespace-pre-wrap">{turn.answer}</p>

            {turn.rows && turn.rows.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowRows((s) => !s)}
                  className="text-[11.5px] text-zinc-500 hover:text-zinc-900 transition"
                >
                  {showRows ? 'Ocultar' : 'Ver'} tabla ({turn.row_count} fila{turn.row_count === 1 ? '' : 's'})
                </button>
                {showRows && <DataTable rows={turn.rows} />}
              </div>
            )}

            <div className="mt-3 flex items-center gap-3">
              {turn.answer && (
                <button onClick={copy} className="text-[11.5px] text-zinc-500 hover:text-zinc-900 transition">
                  {copied ? '✓ Copiado' : 'Copiar'}
                </button>
              )}
              {turn.sql && (
                <button
                  onClick={() => setShowSql((s) => !s)}
                  className="text-[11.5px] text-zinc-400 hover:text-zinc-700 transition"
                >
                  {showSql ? 'Ocultar SQL' : 'Ver SQL'}
                </button>
              )}
            </div>

            {turn.sql && showSql && (
              <pre className="mt-2 p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-100 overflow-auto max-h-60 font-mono">
                {turn.sql}
              </pre>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function DataTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (rows.length === 0) return null;
  const headers = Object.keys(rows[0]);
  return (
    <div className="mt-3 rounded-lg border border-zinc-200 overflow-auto max-h-80">
      <table className="w-full text-xs">
        <thead className="bg-zinc-50 sticky top-0">
          <tr>
            {headers.map((h) => (
              <th key={h} className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r, i) => (
            <tr key={i} className="border-t border-zinc-100">
              {headers.map((h) => (
                <td key={h} className="px-3 py-2 text-zinc-800 tabular-nums">
                  {formatCell(r[h])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 50 && (
        <p className="text-center text-[10px] text-zinc-400 py-2 border-t border-zinc-100">
          … {rows.length - 50} filas adicionales no mostradas
        </p>
      )}
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return v.toLocaleString('es-MX');
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
      return new Date(v).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
    }
    return v.length > 60 ? v.slice(0, 60) + '…' : v;
  }
  return JSON.stringify(v);
}
