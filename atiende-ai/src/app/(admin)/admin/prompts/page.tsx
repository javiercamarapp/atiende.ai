// ─────────────────────────────────────────────────────────────────────────────
// Admin Prompts — prompt_approval_queue WHERE status='pending_review'
// Diff visual en 2 columnas con highlight de líneas cambiadas.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from '@/lib/supabase/admin';
import { PromptActions } from '@/components/admin/prompt-actions';

export const dynamic = 'force-dynamic';

interface QueueRow {
  id: string;
  tenant_id: string;
  agent_name: string;
  current_prompt: string;
  proposed_prompt: string;
  changes_summary: string | null;
  created_at: string;
}

/** Diff muy simple línea por línea: marca removed/added/same. */
function diffLines(a: string, b: string): Array<{ kind: 'same' | 'removed' | 'added'; text: string }> {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const aSet = new Set(aLines);
  const bSet = new Set(bLines);
  const out: Array<{ kind: 'same' | 'removed' | 'added'; text: string }> = [];
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    const left = aLines[i];
    const right = bLines[i];
    if (left === right && left !== undefined) {
      out.push({ kind: 'same', text: left });
    } else {
      if (left !== undefined && !bSet.has(left)) out.push({ kind: 'removed', text: left });
      if (right !== undefined && !aSet.has(right)) out.push({ kind: 'added', text: right });
      if (left !== undefined && bSet.has(left) && right !== undefined && aSet.has(right) && left !== right) {
        // misalignment — muestra ambas lado a lado
      }
    }
  }
  return out;
}

export default async function AdminPromptsPage() {
  const [{ data: queue }, { data: tenants }] = await Promise.all([
    supabaseAdmin
      .from('prompt_approval_queue')
      .select('id, tenant_id, agent_name, current_prompt, proposed_prompt, changes_summary, created_at')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: false })
      .limit(50),
    supabaseAdmin.from('tenants').select('id, name'),
  ]);

  const tenantNameMap = new Map<string, string>();
  for (const t of (tenants as Array<{ id: string; name: string }> | null) || []) {
    tenantNameMap.set(t.id, t.name);
  }

  const rows = (queue as QueueRow[] | null) || [];

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Plataforma</p>
        <h1 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight text-white">
          Prompts en revisión
        </h1>
        <p className="mt-1.5 text-sm text-white/50">
          {rows.length} propuestas pendientes del pipeline de fine-tuning.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="glass-card p-10 text-center text-sm text-white/50">
          No hay prompts en cola. El pipeline de fine-tuning corre los domingos 11pm UTC.
        </div>
      ) : (
        <ul className="space-y-5">
          {rows.map((r, idx) => {
            const diff = diffLines(r.current_prompt, r.proposed_prompt);
            const removedCount = diff.filter((d) => d.kind === 'removed').length;
            const addedCount = diff.filter((d) => d.kind === 'added').length;
            return (
              <li
                key={r.id}
                className="stagger-item glass-card p-6"
                style={{ animationDelay: `${60 + idx * 40}ms` }}
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-xs font-mono text-white/50">
                      {tenantNameMap.get(r.tenant_id) || r.tenant_id.slice(0, 8)}
                      <span className="mx-1.5 text-white/20">·</span>
                      <span className="text-white/80">agente {r.agent_name}</span>
                    </p>
                    {r.changes_summary && (
                      <p className="mt-1.5 text-sm text-white/80">{r.changes_summary}</p>
                    )}
                    <p className="mt-1 text-[11px] text-white/40">
                      {new Date(r.created_at).toLocaleString('es-MX')}
                      <span className="mx-1.5 text-white/20">·</span>
                      <span className="text-emerald-300">+{addedCount}</span>
                      <span className="mx-1 text-white/20">/</span>
                      <span className="text-red-300">-{removedCount}</span>
                    </p>
                  </div>
                  <PromptActions promptId={r.id} />
                </div>

                {/* Diff: 2 columnas */}
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
                  <DiffColumn title="Actual" content={r.current_prompt} highlight={(line) => diff.some((d) => d.kind === 'removed' && d.text === line)} color="red" />
                  <DiffColumn title="Propuesto" content={r.proposed_prompt} highlight={(line) => diff.some((d) => d.kind === 'added' && d.text === line)} color="emerald" />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DiffColumn({
  title, content, highlight, color,
}: {
  title: string;
  content: string;
  highlight: (line: string) => boolean;
  color: 'red' | 'emerald';
}) {
  const lines = content.split('\n');
  const bg = color === 'red' ? 'bg-red-400/10' : 'bg-emerald-400/10';
  const text = color === 'red' ? 'text-red-200' : 'text-emerald-200';
  return (
    <div className="rounded-lg bg-black/40 border border-white/5 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-white/5 text-[10px] uppercase tracking-wider text-white/45">
        {title}
      </div>
      <pre className="p-3 max-h-96 overflow-auto">
        {lines.map((line, i) => {
          const hit = highlight(line);
          return (
            <div
              key={i}
              className={hit ? `${bg} ${text} px-1 -mx-1 rounded` : 'text-white/65 px-1 -mx-1'}
            >
              {line || '\u00A0'}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
