'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Sparkles, Megaphone, Send, Plus, Search, MessageSquare,
  Mail, Hash, FileText, Image as ImageIcon, Users, Calendar,
  Cake, Smile, RotateCcw, ClipboardCheck, LayoutGrid,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';

type Mode = 'contenido' | 'campanas';

interface Turn {
  id: string;
  mode: Mode;
  question: string;
  answer?: string;
  variants?: string[];
  error?: string;
  loading?: boolean;
}

interface Template {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  prompt: string;
  category: string;
}

const CONTENIDO_TEMPLATES: Template[] = [
  { icon: MessageSquare, title: 'Post Instagram', prompt: 'Escribe un post de Instagram para promocionar limpieza dental con 20% de descuento esta semana. Tono cercano.', category: 'Redes' },
  { icon: Mail, title: 'Correo recordatorio', prompt: 'Redacta un correo breve para recordar a pacientes su cita del día siguiente, con instrucciones para confirmar.', category: 'Email' },
  { icon: ImageIcon, title: 'Copy promoción', prompt: 'Genera 3 variantes de copy para una promoción de blanqueamiento dental de $1,500 este mes.', category: 'Ads' },
  { icon: Hash, title: 'Hashtags clínica', prompt: 'Dame 15 hashtags relevantes para una clínica dental en Monterrey, mezcla nicho y populares.', category: 'Redes' },
  { icon: FileText, title: 'Blog post', prompt: 'Escribe un artículo corto de blog sobre la importancia de la limpieza dental cada 6 meses, 300 palabras.', category: 'Blog' },
  { icon: Megaphone, title: 'Anuncio Facebook', prompt: 'Crea un anuncio de Facebook Ads para captar pacientes nuevos interesados en ortodoncia invisible.', category: 'Ads' },
];

const CAMPANAS_TEMPLATES: Template[] = [
  { icon: RotateCcw, title: 'Reactivar pacientes', prompt: 'Crea una campaña de WhatsApp para reactivar pacientes que no han venido en más de 6 meses, con oferta de limpieza a precio preferencial.', category: 'WhatsApp' },
  { icon: Calendar, title: 'Recordatorio mañana', prompt: 'Genera un broadcast de recordatorio para todos los pacientes con cita mañana. Incluye hora y opción de confirmar o reagendar.', category: 'WhatsApp' },
  { icon: Smile, title: 'Post-tratamiento', prompt: 'Escribe un mensaje de seguimiento para enviar 48 horas después de un tratamiento, preguntando cómo se siente el paciente.', category: 'Seguimiento' },
  { icon: ClipboardCheck, title: 'Encuesta NPS', prompt: 'Diseña una encuesta corta de satisfacción (NPS) para enviar tras la cita. Mensaje cálido y claro.', category: 'Encuestas' },
  { icon: Cake, title: 'Cumpleaños', prompt: 'Crea una plantilla de felicitación de cumpleaños para pacientes, con un regalo simbólico (ej. consulta o limpieza cortesía).', category: 'Fidelización' },
  { icon: Users, title: 'Referidos', prompt: 'Plantea una campaña de WhatsApp que invite a pacientes activos a referir amigos con beneficio mutuo.', category: 'Fidelización' },
];

export default function MarketingPage() {
  const [mode, setMode] = useState<Mode>('contenido');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
      const r = await fetch('/api/marketing/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, topic: question, type: mode === 'campanas' ? 'whatsapp_broadcast' : 'instagram', tone: 'cercano' }),
      });
      const data = await r.json().catch(() => ({}));
      const variants: string[] | undefined = Array.isArray(data.posts)
        ? data.posts.map((p: { text?: string } | string) =>
            typeof p === 'string' ? p : p?.text ?? '',
          ).filter(Boolean)
        : undefined;
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                loading: false,
                answer: data.answer || data.content || (variants?.[0] ?? (r.ok ? 'Sin respuesta' : undefined)),
                variants,
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

  const templates = mode === 'contenido' ? CONTENIDO_TEMPLATES : CAMPANAS_TEMPLATES;
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

  return (
    <div className="h-[calc(100dvh-10rem)] md:h-[calc(100vh-8rem)] flex flex-col md:flex-row gap-3 md:gap-4">
      {/* ─────────────── MOBILE TOP BAR ─────────────── */}
      <div className="md:hidden flex items-center gap-2">
        <div className="flex-1 flex gap-1 p-1 rounded-full bg-zinc-100">
          <button
            onClick={() => setMode('contenido')}
            className={cn(
              'flex-1 h-9 rounded-full text-[13px] font-medium flex items-center justify-center gap-1.5 transition',
              mode === 'contenido' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500',
            )}
          >
            <Sparkles className="w-3.5 h-3.5" /> Contenido
          </button>
          <button
            onClick={() => setMode('campanas')}
            className={cn(
              'flex-1 h-9 rounded-full text-[13px] font-medium flex items-center justify-center gap-1.5 transition',
              mode === 'campanas' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500',
            )}
          >
            <Megaphone className="w-3.5 h-3.5" /> Campañas
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
            <button
              onClick={() => setMode('campanas')}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition text-left',
                mode === 'campanas'
                  ? 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]'
                  : 'text-zinc-600 hover:bg-zinc-50',
              )}
            >
              <Megaphone className="w-4 h-4 shrink-0" />
              Campañas
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
          Nueva campaña
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
                  mode === 'contenido'
                    ? 'Describe el contenido que quieres…'
                    : 'Describe la campaña…'
                }
                disabled={loading}
                className="w-full resize-none bg-transparent outline-none px-4 pt-3 pb-10 text-[14px] text-zinc-900 placeholder:text-zinc-400 max-h-40"
              />
              <div className="absolute left-3 bottom-2 flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-zinc-50 border border-zinc-200 text-[10.5px] text-zinc-500 font-medium">
                  {mode === 'contenido' ? <Sparkles className="w-3 h-3" /> : <Megaphone className="w-3 h-3" />}
                  {mode === 'contenido' ? 'Contenido' : 'Campaña'}
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
        {mode === 'contenido' ? (
          <Sparkles className="w-5 h-5 md:w-6 md:h-6 text-white" />
        ) : (
          <Megaphone className="w-5 h-5 md:w-6 md:h-6 text-white" />
        )}
      </div>
      <h2 className="mt-4 md:mt-5 text-xl md:text-3xl font-semibold tracking-tight text-zinc-900 px-2">
        {mode === 'contenido' ? '¿Qué quieres crear?' : '¿Qué campaña lanzamos?'}
      </h2>
      <p className="mt-1.5 md:mt-2 text-[13px] md:text-sm text-zinc-500 max-w-md px-2">
        {mode === 'contenido'
          ? 'Posts, correos, anuncios con la voz de tu marca.'
          : 'Broadcasts, reactivación y recordatorios dirigidos.'}
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
  const [activeVariant, setActiveVariant] = useState(0);
  const [copied, setCopied] = useState(false);

  const variants = turn.variants && turn.variants.length > 0 ? turn.variants : turn.answer ? [turn.answer] : [];
  const current = variants[activeVariant];

  async function copy() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current);
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
            {turn.mode === 'contenido' ? <Sparkles className="w-3.5 h-3.5 text-white" /> : <Megaphone className="w-3.5 h-3.5 text-white" />}
          </div>
          <div className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl rounded-tl-sm bg-zinc-50 border border-zinc-200">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse [animation-delay:300ms]" />
          </div>
        </div>
      )}

      {(current || turn.error) && (
        <div className="flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(235_84%_68%)] flex items-center justify-center shrink-0 mt-0.5">
            {turn.mode === 'contenido' ? <Sparkles className="w-3.5 h-3.5 text-white" /> : <Megaphone className="w-3.5 h-3.5 text-white" />}
          </div>
          <div className="flex-1 min-w-0 rounded-2xl rounded-tl-sm bg-white border border-zinc-200 px-4 py-3">
            {turn.error && (
              <p className="text-xs text-rose-600 mb-2 font-medium">Error: {turn.error}</p>
            )}
            {current && (
              <p className="text-[13.5px] text-zinc-900 leading-relaxed whitespace-pre-wrap">{current}</p>
            )}

            {variants.length > 1 && (
              <div className="mt-3 flex items-center gap-1.5">
                {variants.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveVariant(i)}
                    className={cn(
                      'text-[10.5px] font-medium px-2.5 py-1 rounded-full transition',
                      i === activeVariant
                        ? 'bg-[hsl(var(--brand-blue))] text-white'
                        : 'bg-zinc-50 text-zinc-500 border border-zinc-200 hover:text-zinc-900',
                    )}
                  >
                    Opción {i + 1}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3 flex items-center gap-3">
              {current && (
                <button onClick={copy} className="text-[11.5px] text-zinc-500 hover:text-zinc-900 transition">
                  {copied ? '✓ Copiado' : 'Copiar'}
                </button>
              )}
              {turn.mode === 'campanas' && current && (
                <button className="text-[11.5px] text-[hsl(var(--brand-blue))] hover:opacity-80 transition font-medium">
                  Lanzar campaña
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
