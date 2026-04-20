// ─────────────────────────────────────────────────────────────────────────────
// Intelligence Alerts — urgent items sourced from health views + conversations
// Server component. Queries 4 sources, orders by urgencia. Inline SVG icons.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactElement } from 'react';
import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';

type AlertKind = 'churn' | 'revenue' | 'no_show' | 'unsatisfied';

interface AlertItem {
  id: string;
  kind: AlertKind;
  title: string;
  description: string;
  action: string;
  action_href: string | null;
  urgency: number; // higher = more urgent
  when: string; // ISO
}

const KIND_STYLES: Record<AlertKind, { tone: string; bg: string; border: string; icon: ReactElement }> = {
  no_show: {
    tone: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
  revenue: {
    tone: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  churn: {
    tone: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
  },
  unsatisfied: {
    tone: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <line x1="8" y1="10" x2="16" y2="10" />
        <line x1="8" y1="14" x2="13" y2="14" />
      </svg>
    ),
  },
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `hace ${days} d`;
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

export async function IntelligenceAlerts({ tenantId }: { tenantId: string }) {
  const supabase = await createServerSupabase();

  // 1. Churn risk — contacts con churn_probability > 80
  const churnQ = supabase
    .from('contacts')
    .select('id, name, phone, churn_probability, last_retention_contact')
    .eq('tenant_id', tenantId)
    .gt('churn_probability', 80)
    .order('churn_probability', { ascending: false })
    .limit(3);

  // 2. Revenue at risk today — business_health_current
  const revenueQ = supabase
    .from('business_health_current')
    .select('tenant_id, revenue_at_risk_today_mxn')
    .eq('tenant_id', tenantId)
    .gt('revenue_at_risk_today_mxn', 1000)
    .maybeSingle();

  // 3. No-show risk HOY — appointments con risk > 70 con cita hoy
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60_000);
  const noShowQ = supabase
    .from('appointments')
    .select('id, customer_phone, datetime, no_show_risk_score')
    .eq('tenant_id', tenantId)
    .eq('status', 'scheduled')
    .gt('no_show_risk_score', 70)
    .gte('datetime', todayStart.toISOString())
    .lt('datetime', todayEnd.toISOString())
    .order('no_show_risk_score', { ascending: false })
    .limit(3);

  // 4. Conversaciones con unsatisfied flag
  const unsatisfiedQ = supabase
    .from('conversations')
    .select('id, customer_name, customer_phone, last_message_at')
    .eq('tenant_id', tenantId)
    .eq('unsatisfied', true)
    .order('last_message_at', { ascending: false })
    .limit(3);

  const [churnR, revenueR, noShowR, unsatisfiedR] = await Promise.all([
    churnQ, revenueQ, noShowQ, unsatisfiedQ,
  ]);

  const alerts: AlertItem[] = [];

  for (const c of (churnR.data as Array<{ id: string; name: string | null; phone: string; churn_probability: number; last_retention_contact: string | null }> | null) || []) {
    alerts.push({
      id: `churn-${c.id}`,
      kind: 'churn',
      title: `${c.name || c.phone} en riesgo de perderse`,
      description: `Probabilidad de churn ${c.churn_probability}%. ${c.last_retention_contact ? 'Último contacto de retención ya realizado.' : 'Sin contacto de retención aún.'}`,
      action: 'Contactar ahora',
      action_href: `/conversations?phone=${encodeURIComponent(c.phone)}`,
      urgency: c.churn_probability,
      when: c.last_retention_contact || new Date().toISOString(),
    });
  }

  const rev = revenueR.data as { revenue_at_risk_today_mxn: number } | null;
  if (rev && rev.revenue_at_risk_today_mxn > 1000) {
    alerts.push({
      id: 'revenue-today',
      kind: 'revenue',
      title: `$${Math.round(rev.revenue_at_risk_today_mxn).toLocaleString('es-MX')} MXN en riesgo hoy`,
      description: 'Citas de hoy con probabilidad alta de no-show acumulan ingresos en riesgo.',
      action: 'Ver citas',
      action_href: '/appointments',
      urgency: Math.min(100, Math.floor(rev.revenue_at_risk_today_mxn / 100)),
      when: new Date().toISOString(),
    });
  }

  for (const a of (noShowR.data as Array<{ id: string; customer_phone: string; datetime: string; no_show_risk_score: number }> | null) || []) {
    const when = new Date(a.datetime);
    alerts.push({
      id: `noshow-${a.id}`,
      kind: 'no_show',
      title: `Cita en alto riesgo de no-show`,
      description: `${a.customer_phone} a las ${when.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}. Riesgo ${a.no_show_risk_score}%.`,
      action: 'Contactar ahora',
      action_href: `/conversations?phone=${encodeURIComponent(a.customer_phone)}`,
      urgency: a.no_show_risk_score,
      when: a.datetime,
    });
  }

  for (const u of (unsatisfiedR.data as Array<{ id: string; customer_name: string | null; customer_phone: string; last_message_at: string }> | null) || []) {
    alerts.push({
      id: `unsat-${u.id}`,
      kind: 'unsatisfied',
      title: `${u.customer_name || u.customer_phone} parece insatisfecho`,
      description: 'La conversación muestra señales de frustración. Considera una intervención humana.',
      action: 'Abrir chat',
      action_href: `/conversations/${u.id}`,
      urgency: 95,
      when: u.last_message_at,
    });
  }

  // Sort by urgency desc
  alerts.sort((a, b) => b.urgency - a.urgency);

  if (alerts.length === 0) {
    return (
      <div className="glass-card p-6">
        <h3 className="text-sm font-medium text-zinc-800">Alertas inteligentes</h3>
        <p className="mt-3 text-sm text-zinc-500">Sin alertas activas. Todo bajo control.</p>
      </div>
    );
  }

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-800">Alertas inteligentes</h3>
        <span className="text-[11px] uppercase tracking-wider text-zinc-400">
          {alerts.length} activa{alerts.length !== 1 ? 's' : ''}
        </span>
      </div>
      <ul className="mt-4 space-y-2.5">
        {alerts.slice(0, 8).map((a, idx) => {
          const s = KIND_STYLES[a.kind];
          return (
            <li
              key={a.id}
              className={`stagger-item flex items-start gap-3 rounded-lg border ${s.border} ${s.bg} p-3.5`}
              style={{ animationDelay: `${80 + idx * 60}ms` }}
            >
              <div className={`mt-0.5 ${s.tone}`}>{s.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-zinc-900 truncate">{a.title}</p>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-400 shrink-0">
                    {relativeTime(a.when)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-600">{a.description}</p>
                {a.action_href && (
                  <Link
                    href={a.action_href}
                    className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${s.tone} hover:opacity-80 transition`}
                  >
                    {a.action}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
