'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Marketing content generator — Instagram | Facebook | WhatsApp
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';

type PostType = 'instagram' | 'facebook' | 'whatsapp_broadcast';
type Tone = 'profesional' | 'cercano' | 'informativo' | 'urgente';

interface GeneratedPost {
  text: string;
  image_description: string;
  best_time: string;
}

export default function MarketingPage() {
  const [type, setType] = useState<PostType>('instagram');
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState<Tone>('cercano');
  const [loading, setLoading] = useState(false);
  const [posts, setPosts] = useState<GeneratedPost[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim() || loading) return;
    setLoading(true);
    setErr(null);
    setPosts([]);

    try {
      const r = await fetch('/api/marketing/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, topic, tone }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setPosts(data.posts || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-400">Marketing</p>
        <h1 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight text-zinc-900">
          Generador de contenido
        </h1>
        <p className="mt-1.5 text-sm text-zinc-500">
          3 opciones listas para copiar, con sugerencia de imagen y mejor horario.
        </p>
      </header>

      {/* Form */}
      <form onSubmit={generate} className="glass-card p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Canal">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as PostType)}
              className="w-full rounded-lg bg-white border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[hsl(var(--brand-blue))] transition"
            >
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="whatsapp_broadcast">WhatsApp broadcast</option>
            </select>
          </Field>
          <Field label="Tono">
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as Tone)}
              className="w-full rounded-lg bg-white border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[hsl(var(--brand-blue))] transition"
            >
              <option value="profesional">Profesional</option>
              <option value="cercano">Cercano</option>
              <option value="informativo">Informativo</option>
              <option value="urgente">Urgente</option>
            </select>
          </Field>
        </div>

        <Field label="Tema">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder='Ej: "Limpieza dental $299 esta semana"'
            className="w-full rounded-lg bg-white border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[hsl(var(--brand-blue))] transition placeholder:text-zinc-400"
          />
        </Field>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={loading || !topic.trim()}
            className="px-5 py-2.5 rounded-lg bg-[hsl(var(--brand-blue))] text-white text-sm font-medium disabled:opacity-30 hover:opacity-90 transition"
          >
            {loading ? 'Generando…' : 'Generar 3 opciones'}
          </button>
          {err && <span className="text-xs text-red-600">{err}</span>}
        </div>
      </form>

      {/* Resultados */}
      {posts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {posts.map((p, i) => (
            <PostCard key={i} post={p} index={i} />
          ))}
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-card p-5 space-y-3">
              <div className="shimmer-line h-3 rounded w-1/3" />
              <div className="shimmer-line h-2 rounded w-full" />
              <div className="shimmer-line h-2 rounded w-11/12" />
              <div className="shimmer-line h-2 rounded w-9/12" />
              <div className="shimmer-line h-2 rounded w-10/12" />
            </div>
          ))}
          <style jsx>{`
            .shimmer-line {
              background: linear-gradient(
                90deg,
                rgba(0, 0, 0, 0.04) 0%,
                rgba(0, 0, 0, 0.08) 50%,
                rgba(0, 0, 0, 0.04) 100%
              );
              background-size: 200% 100%;
              animation: shimmer 2s ease-in-out infinite;
            }
          `}</style>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function PostCard({ post, index }: { post: GeneratedPost; index: number }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(post.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  }

  return (
    <article
      className="stagger-item glass-card p-5 flex flex-col gap-4"
      style={{ animationDelay: `${80 + index * 80}ms` }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
          Opción {index + 1}
        </span>
        <button
          type="button"
          onClick={copy}
          className={
            copied
              ? 'text-xs px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-600'
              : 'text-xs px-2.5 py-1 rounded-md bg-zinc-50 border border-zinc-200 text-zinc-700 hover:text-zinc-900 hover:border-zinc-300 transition'
          }
        >
          {copied ? 'Copiado ✓' : 'Copiar'}
        </button>
      </div>

      <p className="text-sm text-zinc-900 whitespace-pre-wrap leading-relaxed flex-1">
        {post.text}
      </p>

      <div className="pt-4 border-t border-zinc-100 space-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Imagen sugerida</p>
          <p className="text-xs text-zinc-700 leading-relaxed">{post.image_description}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Mejor horario</p>
          <p className="text-xs text-sky-600 font-medium">{post.best_time}</p>
        </div>
      </div>
    </article>
  );
}
