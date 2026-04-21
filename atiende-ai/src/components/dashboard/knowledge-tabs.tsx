'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  BookOpen, FileText, Plug, MessageSquareText, Sparkles,
  Upload, Loader2, Check, Plus, Pencil, Save, X, ExternalLink, Globe,
  Calendar as CalIcon, CreditCard, Mail,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { KnowledgeDelete } from '@/components/dashboard/knowledge-delete';
import type { Question } from '@/lib/onboarding/questions';

type TabKey = 'base' | 'rubro' | 'docs' | 'apis' | 'prompt' | 'ideas';

type Chunk = { id: string; content: string; category: string; source: string; created_at: string };

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'base',   label: 'Base',          icon: BookOpen },
  { key: 'rubro',  label: 'Por rubro',     icon: Sparkles },
  { key: 'docs',   label: 'Documentos',    icon: FileText },
  { key: 'apis',   label: 'Integraciones', icon: Plug },
  { key: 'prompt', label: 'Prompt',        icon: MessageSquareText },
  { key: 'ideas',  label: 'Sugerencias',   icon: Sparkles },
];

export function KnowledgeTabs(props: {
  tenantId: string;
  tenantName: string;
  businessType: string;
  chunks: Chunk[];
  categories: string[];
  questions: Question[];
  responses: Record<string, unknown>;
  initialPrompt: string;
  initialWelcome: string;
  website: string;
}) {
  const [tab, setTab] = useState<TabKey>('base');

  return (
    <div className="glass-card overflow-hidden animate-element animate-delay-200">
      {/* Tab nav */}
      <div className="flex flex-wrap items-center gap-1 border-b border-zinc-100 px-3 py-2">
        {TABS.map(t => {
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

      {/* Panels */}
      <div className="p-6">
        {tab === 'base' && <BaseKnowledgePanel chunks={props.chunks} categories={props.categories} />}
        {tab === 'rubro' && (
          <RubroPanel
            tenantId={props.tenantId}
            questions={props.questions}
            responses={props.responses}
            businessType={props.businessType}
          />
        )}
        {tab === 'docs' && <DocsPanel tenantId={props.tenantId} />}
        {tab === 'apis' && <ApisPanel />}
        {tab === 'prompt' && (
          <PromptPanel
            initialPrompt={props.initialPrompt}
            initialWelcome={props.initialWelcome}
          />
        )}
        {tab === 'ideas' && <IdeasPanel website={props.website} />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Panel 1 — Base (current chunks)
// ─────────────────────────────────────────────────────────────────────
function BaseKnowledgePanel({ chunks, categories }: { chunks: Chunk[]; categories: string[] }) {
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const filtered = chunks
    .filter(c => filter === 'all' || c.category === filter)
    .filter(c => !search || c.content.toLowerCase().includes(search.toLowerCase()));

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
          {categories.map(c => (
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
              {c} · {chunks.filter(x => x.category === c).length}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar conocimiento…"
          className="text-sm px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))] w-full sm:w-64"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <BookOpen className="w-10 h-10 text-zinc-300 mx-auto" />
          <p className="mt-3 text-sm text-zinc-500">Sin fragmentos. Sube documentos o responde preguntas del rubro.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.slice(0, 60).map(c => (
            <div key={c.id} className="rounded-xl border border-zinc-100 bg-white p-4 flex items-start gap-3 hover:border-zinc-200 transition">
              <div className="flex-1 min-w-0">
                <span className="inline-block text-[10.5px] uppercase tracking-wider text-zinc-500 bg-zinc-50 border border-zinc-100 rounded-full px-2 py-0.5">
                  {c.category}
                </span>
                <p className="mt-2 text-[13px] leading-relaxed text-zinc-800">
                  {c.content.substring(0, 240)}{c.content.length > 240 ? '…' : ''}
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

// ─────────────────────────────────────────────────────────────────────
// Panel 2 — Por rubro (onboarding responses, editable)
// ─────────────────────────────────────────────────────────────────────
function answerAsString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.join(', ');
  return JSON.stringify(v, null, 2);
}

function RubroPanel({
  tenantId, questions, responses, businessType,
}: { tenantId: string; questions: Question[]; responses: Record<string, unknown>; businessType: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [localResp, setLocalResp] = useState(responses);

  const save = async (qkey: string) => {
    setSaving(true);
    try {
      const res = await fetch('/api/knowledge/reingest-services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, questionKey: qkey, answer: draft }),
      });
      if (!res.ok) throw new Error('Error');
      setLocalResp({ ...localResp, [qkey]: draft });
      toast.success('Guardado. El agente ya usa la nueva respuesta.');
      setEditing(null);
    } catch {
      toast.error('No se pudo guardar. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  const filled = questions.filter(q => localResp[q.key] !== undefined && localResp[q.key] !== '').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-700">
            <span className="font-medium capitalize">{businessType.replace('_', ' ')}</span> — preguntas del rubro
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {filled} de {questions.length} respondidas. Cada respuesta entrena al agente.
          </p>
        </div>
        <div className="w-32 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
          <div
            className="h-full bg-[hsl(var(--brand-blue))] transition-all"
            style={{ width: `${(filled / Math.max(questions.length, 1)) * 100}%` }}
          />
        </div>
      </div>

      <div className="space-y-3">
        {questions.map(q => {
          const value = localResp[q.key];
          const hasAnswer = value !== undefined && value !== '' && value !== null;
          const isEditing = editing === q.key;
          return (
            <div key={q.key} className="rounded-xl border border-zinc-100 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-zinc-900">{q.label}</p>
                    {q.required && !hasAnswer && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">Requerido</span>
                    )}
                    {hasAnswer && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                        <Check className="w-3 h-3" />
                        Respondida
                      </span>
                    )}
                  </div>
                  {q.help && !isEditing && (
                    <p className="text-[11.5px] text-zinc-500 mt-1">{q.help}</p>
                  )}
                </div>
                {!isEditing && (
                  <button
                    onClick={() => {
                      setDraft(answerAsString(value));
                      setEditing(q.key);
                    }}
                    className="text-xs inline-flex items-center gap-1 text-[hsl(var(--brand-blue))] hover:opacity-80"
                  >
                    <Pencil className="w-3 h-3" />
                    {hasAnswer ? 'Editar' : 'Responder'}
                  </button>
                )}
              </div>

              {isEditing ? (
                <div className="mt-3 space-y-2">
                  {q.type === 'textarea' || q.type === 'list' ? (
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={4}
                      placeholder={q.placeholder}
                      className="w-full text-sm rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
                    />
                  ) : (
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={q.placeholder}
                      className="w-full text-sm rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => save(q.key)}
                      disabled={saving}
                      className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-[hsl(var(--brand-blue))] text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      Guardar
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                    >
                      <X className="w-3 h-3" />
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : hasAnswer ? (
                <pre className="mt-2 text-[13px] text-zinc-800 leading-relaxed whitespace-pre-wrap font-sans">
                  {answerAsString(value)}
                </pre>
              ) : (
                <p className="mt-1 text-xs text-zinc-400 italic">Sin respuesta aún.</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Panel 3 — Documentos (upload UI)
// ─────────────────────────────────────────────────────────────────────
function DocsPanel({ tenantId }: { tenantId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const onUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('tenantId', tenantId);
      const res = await fetch('/api/knowledge/upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error('Fallo la subida');
      toast.success(`${file.name} procesado. Refresca para ver fragmentos.`);
      setFile(null);
    } catch {
      toast.error('Error al subir. Intenta otro archivo.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-5">
      <label className="block border-2 border-dashed border-zinc-200 rounded-2xl p-8 text-center hover:border-[hsl(var(--brand-blue))] transition cursor-pointer bg-zinc-50/50">
        <input
          type="file"
          accept=".pdf,.doc,.docx,.txt,.md,.csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
        <Upload className="w-10 h-10 text-zinc-400 mx-auto" />
        <p className="mt-3 text-sm font-medium text-zinc-900">
          {file ? file.name : 'Arrastra un archivo o haz click para seleccionar'}
        </p>
        <p className="text-xs text-zinc-500 mt-1">PDF, Word, TXT, CSV — hasta 10 MB</p>
      </label>

      {file && (
        <div className="flex items-center gap-2">
          <button
            onClick={onUpload}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-[hsl(var(--brand-blue))] text-white hover:opacity-90 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Subir y procesar
          </button>
          <button
            onClick={() => setFile(null)}
            className="text-sm text-zinc-600 hover:text-zinc-900 px-3 py-2"
          >
            Cancelar
          </button>
        </div>
      )}

      <div className="rounded-2xl bg-[hsl(var(--brand-blue-soft))] p-5">
        <p className="text-[11px] uppercase tracking-wider text-[hsl(var(--brand-blue))] font-semibold">Tips</p>
        <ul className="mt-2 space-y-1.5 text-xs text-zinc-700">
          <li>• Menús, listas de precios y FAQs son ideales para el agente.</li>
          <li>• Catálogos extensos: divide por categoría para mejor búsqueda.</li>
          <li>• Protocolos clínicos en PDF se extraen como texto y se chunk-ean automáticamente.</li>
        </ul>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Panel 4 — Integraciones (API connections)
// ─────────────────────────────────────────────────────────────────────
type Integration = {
  key: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  connected: boolean;
};

function ApisPanel() {
  const integrations: Integration[] = [
    { key: 'google-calendar', name: 'Google Calendar', description: 'Sincroniza citas con el calendario del equipo.', icon: CalIcon, accent: 'bg-blue-50 text-blue-600', connected: false },
    { key: 'stripe', name: 'Stripe', description: 'Cobra anticipos con link de pago automático.', icon: CreditCard, accent: 'bg-violet-50 text-violet-600', connected: false },
    { key: 'gmail', name: 'Gmail', description: 'Procesa correos entrantes como tickets del bot.', icon: Mail, accent: 'bg-rose-50 text-rose-600', connected: false },
    { key: 'google-places', name: 'Google Places', description: 'Importa reseñas y horarios de tu ficha.', icon: Globe, accent: 'bg-emerald-50 text-emerald-600', connected: true },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">
        Conecta tus herramientas para que el agente tenga contexto en tiempo real.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {integrations.map(i => (
          <div key={i.key} className="rounded-xl border border-zinc-100 bg-white p-4 flex items-center gap-3">
            <span className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${i.accent}`}>
              <i.icon className="w-5 h-5" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-zinc-900">{i.name}</p>
                {i.connected && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                    <Check className="w-3 h-3" />
                    Conectado
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-0.5 truncate">{i.description}</p>
            </div>
            <button
              onClick={() => toast.info(`${i.name}: integración en camino`)}
              className={cn(
                'text-xs font-medium px-3 py-1.5 rounded-lg transition shrink-0',
                i.connected
                  ? 'bg-zinc-50 border border-zinc-200 text-zinc-700 hover:bg-zinc-100'
                  : 'bg-[hsl(var(--brand-blue))] text-white hover:opacity-90',
              )}
            >
              {i.connected ? 'Configurar' : 'Conectar'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Panel 5 — Prompt editor
// ─────────────────────────────────────────────────────────────────────
function PromptPanel({ initialPrompt, initialWelcome }: { initialPrompt: string; initialWelcome: string }) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [welcome, setWelcome] = useState(initialWelcome);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_system_prompt: prompt, welcome_message: welcome }),
      });
      if (!res.ok) throw new Error();
      toast.success('Prompt actualizado');
    } catch {
      toast.error('Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
          Mensaje de bienvenida
        </label>
        <input
          value={welcome}
          onChange={(e) => setWelcome(e.target.value)}
          className="mt-1.5 w-full text-sm rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2.5 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
        />
      </div>

      <div>
        <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
          Prompt del sistema (personalidad del agente)
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={12}
          placeholder="Eres el asistente virtual de una clínica dental. Tu tono es cercano pero profesional…"
          className="mt-1.5 w-full text-sm rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2.5 font-mono leading-relaxed focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
        />
        <p className="text-[11px] text-zinc-500 mt-1.5">
          Se concatena con las respuestas del rubro y los documentos en cada mensaje.
        </p>
      </div>

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-[hsl(var(--brand-blue))] text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Guardar cambios
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Panel 6 — Sugerencias
// ─────────────────────────────────────────────────────────────────────
function IdeasPanel({ website }: { website: string }) {
  const suggestions = [
    {
      title: 'Importa tu sitio web',
      description: 'Extraemos textos, servicios y FAQs de tu página para enriquecer al agente.',
      action: website ? 'Re-indexar sitio' : 'Conectar sitio',
      icon: Globe,
      href: website || '#',
    },
    {
      title: 'Preguntas frecuentes de pacientes',
      description: 'Añade una lista de preguntas recurrentes y sus respuestas oficiales.',
      action: 'Añadir FAQ',
      icon: Plus,
      href: '#',
    },
    {
      title: 'Conecta tu calendario',
      description: 'Deja que el agente proponga horarios reales basados en tu disponibilidad.',
      action: 'Conectar',
      icon: CalIcon,
      href: '#',
    },
    {
      title: 'Sube protocolos clínicos',
      description: 'PDFs internos que el agente referenciará con citas exactas.',
      action: 'Subir archivos',
      icon: FileText,
      href: '#',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {suggestions.map(s => (
        <div key={s.title} className="rounded-xl border border-zinc-100 bg-gradient-to-br from-white to-zinc-50 p-5">
          <span className="inline-flex w-10 h-10 rounded-full bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] items-center justify-center">
            <s.icon className="w-4 h-4" />
          </span>
          <p className="mt-3 text-sm font-semibold text-zinc-900">{s.title}</p>
          <p className="mt-1 text-xs text-zinc-500 leading-relaxed">{s.description}</p>
          <button
            onClick={() => toast.info(`${s.title}: disponible pronto`)}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--brand-blue))] hover:opacity-80"
          >
            {s.action}
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
