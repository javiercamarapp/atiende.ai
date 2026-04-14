// ─────────────────────────────────────────────────────────────────────────────
// Admin Fraud — fraud_alerts con acciones + historial
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from '@/lib/supabase/admin';
import { FraudActions } from '@/components/admin/fraud-actions';

export const dynamic = 'force-dynamic';

interface AlertRow {
  id: string;
  tenant_id: string;
  anomaly_type: string;
  evidence: string | null;
  status: string;
  created_at: string;
}

function anomalyColor(type: string): { tone: string; label: string } {
  if (type.startsWith('volume')) return { tone: 'text-amber-300', label: 'Volumen' };
  if (type === 'prompt_injection') return { tone: 'text-red-300', label: 'Prompt injection' };
  return { tone: 'text-white/70', label: type };
}

export default async function AdminFraudPage() {
  const [{ data: openAlerts }, { data: closedAlerts }, { data: tenants }] = await Promise.all([
    supabaseAdmin
      .from('fraud_alerts')
      .select('id, tenant_id, anomaly_type, evidence, status, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(50),
    supabaseAdmin
      .from('fraud_alerts')
      .select('id, tenant_id, anomaly_type, evidence, status, created_at')
      .in('status', ['resolved', 'false_positive'])
      .order('created_at', { ascending: false })
      .limit(20),
    supabaseAdmin.from('tenants').select('id, name'),
  ]);

  const tenantMap = new Map<string, string>();
  for (const t of (tenants as Array<{ id: string; name: string }> | null) || []) {
    tenantMap.set(t.id, t.name);
  }

  const open = (openAlerts as AlertRow[] | null) || [];
  const closed = (closedAlerts as AlertRow[] | null) || [];

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">Plataforma</p>
        <h1 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight text-white">
          Fraud alerts
        </h1>
        <p className="mt-1.5 text-sm text-white/50">
          {open.length} abiertas · {closed.length} recientes en historial.
        </p>
      </header>

      {/* Abiertas */}
      <section>
        <h2 className="text-xs uppercase tracking-[0.18em] text-white/50 mb-3">Abiertas</h2>
        {open.length === 0 ? (
          <div className="glass-card p-10 text-center text-sm text-white/50">
            No hay alertas abiertas. El detector corre nocturno.
          </div>
        ) : (
          <ul className="space-y-3">
            {open.map((a, idx) => {
              const meta = anomalyColor(a.anomaly_type);
              return (
                <li
                  key={a.id}
                  className="stagger-item glass-card p-5"
                  style={{ animationDelay: `${60 + idx * 40}ms` }}
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-mono font-medium ${meta.tone}`}>
                          {meta.label}
                        </span>
                        <span className="text-white/20">·</span>
                        <span className="text-xs text-white/70">
                          {tenantMap.get(a.tenant_id) || a.tenant_id.slice(0, 8)}
                        </span>
                        <span className="text-white/20">·</span>
                        <span className="text-[11px] text-white/45">
                          {new Date(a.created_at).toLocaleString('es-MX')}
                        </span>
                      </div>
                      {a.evidence && (
                        <p className="mt-2 text-sm text-white/80 font-mono break-words">
                          {a.evidence}
                        </p>
                      )}
                    </div>
                    <FraudActions alertId={a.id} current={a.status} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Historial */}
      {closed.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-[0.18em] text-white/50 mb-3">Historial reciente</h2>
          <div className="glass-card overflow-hidden">
            <ul>
              {closed.map((a) => {
                const meta = anomalyColor(a.anomaly_type);
                return (
                  <li
                    key={a.id}
                    className="px-5 py-3 border-b border-white/5 last:border-0 flex items-center justify-between gap-4 flex-wrap"
                  >
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <span className={`font-mono ${meta.tone}`}>{meta.label}</span>
                      <span className="text-white/20">·</span>
                      <span className="text-white/70">{tenantMap.get(a.tenant_id) || a.tenant_id.slice(0, 8)}</span>
                      <span className="text-white/20">·</span>
                      <span className="text-white/45">
                        {new Date(a.created_at).toLocaleDateString('es-MX')}
                      </span>
                    </div>
                    <span
                      className={
                        a.status === 'resolved'
                          ? 'inline-flex items-center rounded-md bg-emerald-400/10 border border-emerald-400/20 px-2 py-0.5 text-[10px] text-emerald-300'
                          : 'inline-flex items-center rounded-md bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] text-white/50'
                      }
                    >
                      {a.status === 'resolved' ? 'Resuelto' : 'Falso positivo'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
