'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Chat con tus datos — UI
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from 'react';

interface Turn {
  id: string;
  question: string;
  answer?: string;
  sql?: string | null;
  rows?: Array<Record<string, unknown>>;
  row_count?: number;
  error?: string;
}

const EXAMPLES = [
  '¿Cuántos pacientes nuevos tuve este mes?',
  '¿Cuál es mi día más rentable?',
  '¿Quiénes son mis 10 pacientes más valiosos?',
  '¿Cuántos no-shows tuve esta semana?',
];

export default function ChatDataPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length]);

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    const turnId = crypto.randomUUID();
    setTurns((prev) => [...prev, { id: turnId, question }]);
    setInput('');
    setLoading(true);

    try {
      const r = await fetch('/api/chat-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await r.json();

      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                answer: data.answer || 'Sin respuesta',
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
            ? { ...t, answer: 'Error de red', error: err instanceof Error ? err.message : String(err) }
            : t,
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-400">Inteligencia</p>
        <h1 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight text-zinc-900">
          Pregunta a tus datos
        </h1>
        <p className="mt-1.5 text-sm text-zinc-500">
          Pregúntale a tu consultorio lo que quieras en español natural.
        </p>
      </header>

      {/* Sugerencias */}
      {turns.length === 0 && (
        <div className="glass-card p-6">
          <p className="text-xs uppercase tracking-wider text-zinc-500 mb-3">Ejemplos</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => ask(ex)}
                className="text-left text-sm px-3 py-2.5 rounded-lg bg-white/[0.02] border border-zinc-200 text-zinc-700 hover:bg-white/[0.04] hover:border-zinc-300 hover:text-zinc-900 transition"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Historial */}
      {turns.length > 0 && (
        <div className="space-y-4">
          {turns.map((t) => (
            <TurnBlock key={t.id} turn={t} />
          ))}
          {loading && (
            <div className="glass-card p-4 text-sm text-zinc-500">
              <span className="inline-block animate-pulse">Pensando…</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="glass-card p-3 flex items-center gap-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pregunta sobre tus citas, pacientes, pagos…"
          disabled={loading}
          className="flex-1 bg-transparent outline-none px-2 text-sm text-zinc-900 placeholder:text-zinc-400"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium disabled:opacity-30 hover:bg-white/90 transition"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function TurnBlock({ turn }: { turn: Turn }) {
  const [showRows, setShowRows] = useState(false);
  const [showSql, setShowSql] = useState(false);

  return (
    <article className="stagger-item space-y-3">
      {/* Pregunta */}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-zinc-100 border border-zinc-200 px-4 py-2.5 text-sm text-zinc-900">
          {turn.question}
        </div>
      </div>

      {/* Respuesta */}
      {(turn.answer || turn.error) && (
        <div className="glass-card p-4">
          {turn.error && (
            <p className="text-xs text-red-600 mb-2">Error: {turn.error}</p>
          )}
          <p className="text-sm text-zinc-900 leading-relaxed">{turn.answer}</p>

          {turn.rows && turn.rows.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowRows((s) => !s)}
                className="mt-3 text-xs text-zinc-500 hover:text-zinc-800 transition"
              >
                {showRows ? 'Ocultar' : 'Ver'} tabla ({turn.row_count} fila{turn.row_count === 1 ? '' : 's'})
              </button>
              {showRows && <DataTable rows={turn.rows} />}
            </>
          )}

          {turn.sql && (
            <>
              <button
                type="button"
                onClick={() => setShowSql((s) => !s)}
                className="mt-2 ml-3 text-xs text-zinc-400 hover:text-zinc-700 transition"
              >
                {showSql ? 'Ocultar SQL' : 'Ver SQL'}
              </button>
              {showSql && (
                <pre className="mt-2 p-3 rounded-lg bg-black/40 border border-zinc-100 text-[11px] text-zinc-700 overflow-auto max-h-60 font-mono">
                  {turn.sql}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}

function DataTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (rows.length === 0) return null;
  const headers = Object.keys(rows[0]);
  return (
    <div className="mt-3 rounded-lg border border-zinc-100 overflow-auto max-h-80">
      <table className="w-full text-xs">
        <thead className="bg-white/[0.02] sticky top-0">
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
