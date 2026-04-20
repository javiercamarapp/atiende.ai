// ─────────────────────────────────────────────────────────────────────────────
// Contacts — lista de pacientes con health/churn/LTV + filtros
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';

type Filter = 'all' | 'at_risk' | 'valuable' | 'inactive';

interface ContactRow {
  id: string;
  name: string | null;
  phone: string;
  health_score: number | null;
  churn_probability: number | null;
  lifetime_value_mxn: number | null;
  next_visit_predicted_at: string | null;
  last_contact_at?: string | null;
  created_at: string;
}

function healthBadgeColor(score: number | null): { bg: string; border: string; text: string } {
  const s = score ?? 0;
  if (s > 70) return { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-600' };
  if (s >= 40) return { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-600' };
  return { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-600' };
}

function churnBarColor(prob: number): string {
  if (prob > 60) return 'bg-red-500';
  if (prob > 30) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.round(diffMs / 86_400_000);
  if (days < 0) return `en ${Math.abs(days)}d`;
  if (days === 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days}d`;
  if (days < 365) return `hace ${Math.round(days / 30)}m`;
  return `hace ${Math.round(days / 365)}a`;
}

function fmtNext(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function fmtMXN(n: number | null): string {
  return `$${(n ?? 0).toLocaleString('es-MX')}`;
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const filter: Filter = (['all', 'at_risk', 'valuable', 'inactive'] as const).includes(
    (params.filter as Filter) ?? 'all',
  )
    ? (params.filter as Filter)
    : 'all';

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase.from('tenants').select('id, name').eq('user_id', user!.id).single();
  if (!tenant) return <div>No tenant found</div>;

  // Get last inbound message per contact for "último contacto"
  let query = supabase
    .from('contacts')
    .select('id, name, phone, health_score, churn_probability, lifetime_value_mxn, next_visit_predicted_at, created_at, last_retention_contact')
    .eq('tenant_id', tenant.id);

  if (filter === 'at_risk') {
    query = query.gt('churn_probability', 60);
  } else if (filter === 'valuable') {
    query = query.gt('lifetime_value_mxn', 5000);
  }
  // inactive se filtra en JS (requiere comparar última cita)

  const { data: contactsRaw } = await query.order('churn_probability', { ascending: false }).limit(200);

  // Last appointment per contact (for inactive filter + display)
  const phones = ((contactsRaw || []) as ContactRow[]).map((c) => c.phone);
  const { data: lastApts } =
    phones.length > 0
      ? await supabase
          .from('appointments')
          .select('customer_phone, datetime')
          .eq('tenant_id', tenant.id)
          .eq('status', 'completed')
          .in('customer_phone', phones)
          .order('datetime', { ascending: false })
      : { data: [] as Array<{ customer_phone: string; datetime: string }> };

  const lastByPhone = new Map<string, string>();
  for (const a of (lastApts || []) as Array<{ customer_phone: string; datetime: string }>) {
    if (!lastByPhone.has(a.customer_phone)) lastByPhone.set(a.customer_phone, a.datetime);
  }

  let contacts: ContactRow[] = ((contactsRaw || []) as ContactRow[]).map((c) => ({
    ...c,
    last_contact_at: lastByPhone.get(c.phone) ?? null,
  }));

  if (filter === 'inactive') {
    const cutoff = Date.now() - 90 * 86_400_000;
    contacts = contacts.filter((c) => {
      if (!c.last_contact_at) return true;
      return new Date(c.last_contact_at).getTime() < cutoff;
    });
  }

  const filters: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: 'Todos' },
    { id: 'at_risk', label: 'En riesgo' },
    { id: 'valuable', label: 'Valiosos' },
    { id: 'inactive', label: 'Inactivos' },
  ];

  return (
    <div className="space-y-6">
      <header className="animate-element">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-400">Panel</p>
        <h1 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight text-white">Pacientes</h1>
        <p className="mt-1.5 text-sm text-zinc-500">{contacts.length} pacientes en tu base.</p>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 animate-element animate-delay-100">
        {filters.map((f) => {
          const active = filter === f.id;
          return (
            <Link
              key={f.id}
              href={f.id === 'all' ? '/contacts' : `/contacts?filter=${f.id}`}
              className={
                active
                  ? 'px-3 py-1.5 rounded-lg bg-zinc-100 border border-zinc-300 text-xs font-medium text-white'
                  : 'px-3 py-1.5 rounded-lg bg-transparent border border-zinc-200 text-xs text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 transition'
              }
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {contacts.length === 0 ? (
        <div className="glass-card p-10 text-center text-sm text-zinc-500">
          Sin pacientes en este filtro.
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          {/* Header row */}
          <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-3 border-b border-zinc-100 text-[10px] uppercase tracking-wider text-zinc-500">
            <div className="col-span-3">Paciente</div>
            <div className="col-span-2">Última visita</div>
            <div className="col-span-2">Próxima predicha</div>
            <div className="col-span-1">Salud</div>
            <div className="col-span-2">Churn</div>
            <div className="col-span-2 text-right">LTV</div>
          </div>

          <ul>
            {contacts.map((c, idx) => {
              const badge = healthBadgeColor(c.health_score);
              const churn = Number(c.churn_probability ?? 0);
              return (
                <li
                  key={c.id}
                  className="stagger-item grid grid-cols-12 gap-4 px-5 py-4 border-b border-zinc-100 last:border-b-0 items-center hover:bg-white/[0.015] transition"
                  style={{ animationDelay: `${40 + Math.min(idx, 12) * 30}ms` }}
                >
                  <div className="col-span-12 md:col-span-3">
                    <p className="text-sm font-medium text-white truncate">
                      {c.name || c.phone}
                    </p>
                    {c.name && <p className="text-[11px] text-zinc-400 tabular-nums">{c.phone}</p>}
                  </div>

                  <div className="col-span-6 md:col-span-2 text-xs text-zinc-600">
                    {fmtRelative(c.last_contact_at ?? null)}
                  </div>

                  <div className="col-span-6 md:col-span-2 text-xs text-zinc-600">
                    {fmtNext(c.next_visit_predicted_at)}
                  </div>

                  <div className="col-span-4 md:col-span-1">
                    <span
                      className={`inline-flex items-center rounded-md border ${badge.border} ${badge.bg} px-2 py-0.5 text-[11px] font-medium ${badge.text} tabular-nums`}
                    >
                      {c.health_score ?? 0}
                    </span>
                  </div>

                  <div className="col-span-8 md:col-span-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-zinc-50 overflow-hidden">
                        <div
                          className={`h-full ${churnBarColor(churn)}`}
                          style={{ width: `${Math.min(100, churn)}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-zinc-600 tabular-nums w-8 text-right">
                        {churn}%
                      </span>
                    </div>
                  </div>

                  <div className="col-span-12 md:col-span-2 text-sm text-white tabular-nums md:text-right">
                    {fmtMXN(c.lifetime_value_mxn)}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
