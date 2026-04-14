// ─────────────────────────────────────────────────────────────────────────────
// Admin FAQ Gaps — lee último cron_runs del job faq-gaps, renderiza sugerencias
// agrupadas por tenant con botón "Agregar al KB".
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from '@/lib/supabase/admin';
import { FaqPromote } from '@/components/admin/faq-promote';

export const dynamic = 'force-dynamic';

interface PerTenantSummary {
  tenant_id: string;
  questions?: number;
  clusters?: number;
  suggestions?: Array<{ question: string; suggested_answer: string; frequency: number }>;
}

interface FaqRunDetails {
  summaries?: PerTenantSummary[];
  date_from?: string;
}

export default async function AdminFaqGapsPage() {
  const [{ data: runs }, { data: tenants }] = await Promise.all([
    supabaseAdmin
      .from('cron_runs')
      .select('started_at, completed_at, details, tenants_processed, tenants_succeeded')
      .eq('job_name', 'faq-gaps')
      .order('started_at', { ascending: false })
      .limit(1),
    supabaseAdmin.from('tenants').select('id, name'),
  ]);

  const lastRun = (runs as Array<{ started_at: string; completed_at: string | null; details: FaqRunDetails; tenants_processed: number; tenants_succeeded: number }> | null)?.[0];

  const tenantMap = new Map<string, string>();
  for (const t of (tenants as Array<{ id: string; name: string }> | null) || []) {
    tenantMap.set(t.id, t.name);
  }

  const summaries = lastRun?.details?.summaries ?? [];
  // Filtrar tenants que sí tienen sugerencias
  const tenantsWithSuggestions = summaries.filter(
    (s) => Array.isArray(s.suggestions) && s.suggestions.length > 0,
  );

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Plataforma</p>
        <h1 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight text-white">FAQ Gaps</h1>
        {lastRun ? (
          <p className="mt-1.5 text-sm text-white/50">
            Última corrida: {new Date(lastRun.started_at).toLocaleString('es-MX')} ·{' '}
            {lastRun.tenants_succeeded}/{lastRun.tenants_processed} tenants OK.
          </p>
        ) : (
          <p className="mt-1.5 text-sm text-white/50">El job corre los lunes 6am UTC.</p>
        )}
      </header>

      {tenantsWithSuggestions.length === 0 ? (
        <div className="glass-card p-10 text-center text-sm text-white/50">
          Sin sugerencias por promover. Se generan cuando hay ≥3 preguntas repetidas sin respuesta.
        </div>
      ) : (
        <ul className="space-y-5">
          {tenantsWithSuggestions.map((t, idx) => {
            const tenantName = tenantMap.get(t.tenant_id) || t.tenant_id.slice(0, 8);
            return (
              <li
                key={t.tenant_id}
                className="stagger-item glass-card p-6"
                style={{ animationDelay: `${60 + idx * 40}ms` }}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="text-sm font-medium text-white">{tenantName}</h3>
                  <span className="text-[11px] uppercase tracking-wider text-white/40">
                    {t.questions ?? 0} preguntas · {t.clusters ?? 0} clusters
                  </span>
                </div>

                <ul className="mt-4 space-y-4">
                  {(t.suggestions || []).map((s, i) => (
                    <li
                      key={i}
                      className="rounded-lg border border-white/5 bg-white/[0.015] p-4"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-white/45">
                            Preguntada {s.frequency} {s.frequency === 1 ? 'vez' : 'veces'}
                          </p>
                          <p className="mt-1 text-sm font-medium text-white">{s.question}</p>
                          <p className="mt-2 text-sm text-white/70 leading-relaxed">
                            {s.suggested_answer}
                          </p>
                        </div>
                        <FaqPromote
                          tenantId={t.tenant_id}
                          question={s.question}
                          answer={s.suggested_answer}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
