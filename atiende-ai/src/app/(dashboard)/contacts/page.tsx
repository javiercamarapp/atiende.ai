import Link from 'next/link';
import { Search, Filter, Plus } from 'lucide-react';
import { createServerSupabase } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';

type FilterKey = 'all' | 'at_risk' | 'valuable' | 'inactive';

interface ContactRow {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  health_score: number | null;
  churn_probability: number | null;
  lifetime_value_mxn: number | null;
  next_visit_predicted_at: string | null;
  created_at: string;
  last_contact_at?: string | null;
}

const AVATAR_COLORS = [
  'bg-[hsl(235_84%_92%)] text-[hsl(235_84%_45%)]',
  'bg-zinc-100 text-zinc-700',
  'bg-amber-50 text-amber-700',
  'bg-emerald-50 text-emerald-700',
  'bg-violet-50 text-violet-700',
  'bg-rose-50 text-rose-700',
];

function initials(name: string | null, phone: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return phone.slice(-2);
}

function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function shortId(id: string): string {
  return `#${id.slice(0, 8).toUpperCase()}`;
}

function fmtMXN(n: number | null): string {
  return `$${(n ?? 0).toLocaleString('es-MX')}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusFromScore(score: number | null, churn: number | null): {
  label: string;
  className: string;
} {
  const s = score ?? 0;
  const c = churn ?? 0;
  if (c > 60) return { label: 'En riesgo', className: 'bg-rose-50 text-rose-700 border-rose-200' };
  if (s >= 70) return { label: 'Activo', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (s >= 40) return { label: 'Observación', className: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { label: 'Nuevo', className: 'bg-zinc-100 text-zinc-600 border-zinc-200' };
}

function tagFromScore(score: number | null, ltv: number | null): string {
  const s = score ?? 0;
  if ((ltv ?? 0) > 5000) return 'VIP';
  if (s >= 70) return 'Recurrente';
  if (s >= 40) return 'Ocasional';
  return 'Nuevo';
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const filter: FilterKey = (['all', 'at_risk', 'valuable', 'inactive'] as const).includes(
    (params.filter as FilterKey) ?? 'all',
  )
    ? (params.filter as FilterKey)
    : 'all';

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('user_id', user!.id)
    .single();
  if (!tenant) return <div>No tenant found</div>;

  let query = supabase
    .from('contacts')
    .select(
      'id, name, phone, email, health_score, churn_probability, lifetime_value_mxn, next_visit_predicted_at, created_at',
    )
    .eq('tenant_id', tenant.id);

  if (filter === 'at_risk') query = query.gt('churn_probability', 60);
  if (filter === 'valuable') query = query.gt('lifetime_value_mxn', 5000);

  const { data: contactsRaw } = await query
    .order('churn_probability', { ascending: false })
    .limit(200);

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
    // eslint-disable-next-line react-hooks/purity
    const cutoff = Date.now() - 90 * 86_400_000;
    contacts = contacts.filter(
      (c) => !c.last_contact_at || new Date(c.last_contact_at).getTime() < cutoff,
    );
  }

  const { count: totalAll } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id);

  const filters: Array<{ id: FilterKey; label: string; count?: number }> = [
    { id: 'all', label: 'Todos', count: totalAll ?? 0 },
    { id: 'at_risk', label: 'En riesgo' },
    { id: 'valuable', label: 'Valiosos' },
    { id: 'inactive', label: 'Inactivos' },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between animate-element">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-400">Panel</p>
          <h1 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight text-zinc-900">
            Pacientes
          </h1>
          <p className="mt-1.5 text-sm text-zinc-500">
            {contacts.length} de {totalAll ?? 0} pacientes en tu base.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="search"
              placeholder="Buscar paciente..."
              className="pl-9 pr-4 py-2 text-sm rounded-xl bg-white border border-zinc-200 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))] w-64"
            />
          </div>
          <button className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-zinc-200 text-xs font-medium text-zinc-700 hover:border-zinc-300 transition">
            <Filter className="w-3.5 h-3.5" />
            Filtros
          </button>
          <button className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[hsl(var(--brand-blue))] text-white text-xs font-medium hover:opacity-90 transition">
            <Plus className="w-3.5 h-3.5" />
            Nuevo
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 animate-element animate-delay-100">
        {filters.map((f) => {
          const active = filter === f.id;
          return (
            <Link
              key={f.id}
              href={f.id === 'all' ? '/contacts' : `/contacts?filter=${f.id}`}
              className={cn(
                'inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition border',
                active
                  ? 'bg-[hsl(var(--brand-blue))] text-white border-transparent shadow-sm'
                  : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300 hover:text-zinc-900',
              )}
            >
              {f.label}
              {typeof f.count === 'number' && (
                <span
                  className={cn(
                    'tabular-nums rounded-full px-1.5 text-[10px]',
                    active ? 'bg-white/20 text-white' : 'bg-zinc-100 text-zinc-500',
                  )}
                >
                  {f.count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {contacts.length === 0 ? (
        <div className="glass-card p-10 text-center text-sm text-zinc-500">
          Sin pacientes en este filtro.
        </div>
      ) : (
        <div className="glass-card overflow-hidden animate-element animate-delay-200">
          <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3.5 border-b border-zinc-100 text-[10px] uppercase tracking-wider text-zinc-500 bg-zinc-50/50">
            <div className="col-span-3">Paciente</div>
            <div className="col-span-2">Contacto</div>
            <div className="col-span-2">Etiqueta</div>
            <div className="col-span-2">Última visita</div>
            <div className="col-span-1 text-right">LTV</div>
            <div className="col-span-2 text-right">Estado</div>
          </div>

          <ul>
            {contacts.map((c, idx) => {
              const status = statusFromScore(c.health_score, c.churn_probability);
              const tag = tagFromScore(c.health_score, c.lifetime_value_mxn);
              return (
                <li
                  key={c.id}
                  className="stagger-item grid grid-cols-12 gap-4 px-6 py-4 border-b border-zinc-100 last:border-b-0 items-center hover:bg-zinc-50/60 transition"
                  style={{ animationDelay: `${40 + Math.min(idx, 12) * 25}ms` }}
                >
                  <div className="col-span-12 md:col-span-3 flex items-center gap-3 min-w-0">
                    <div
                      className={cn(
                        'shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold',
                        avatarColor(c.id),
                      )}
                    >
                      {initials(c.name, c.phone)}
                    </div>
                    <div className="min-w-0">
                      <Link
                        href={`/contacts/${c.id}`}
                        className="block text-sm font-medium text-zinc-900 hover:text-[hsl(var(--brand-blue))] truncate"
                      >
                        {c.name || c.phone}
                      </Link>
                      <p className="text-[11px] text-zinc-400 tabular-nums">{shortId(c.id)}</p>
                    </div>
                  </div>

                  <div className="col-span-6 md:col-span-2 min-w-0">
                    <p className="text-xs text-zinc-700 tabular-nums truncate">{c.phone}</p>
                    {c.email && (
                      <p className="text-[11px] text-zinc-400 truncate">{c.email}</p>
                    )}
                  </div>

                  <div className="col-span-6 md:col-span-2">
                    <span className="inline-flex items-center rounded-md bg-[hsl(var(--brand-blue-soft))] px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--brand-blue))]">
                      {tag}
                    </span>
                  </div>

                  <div className="col-span-6 md:col-span-2 text-xs text-zinc-600">
                    {fmtDate(c.last_contact_at ?? null)}
                  </div>

                  <div className="col-span-3 md:col-span-1 text-xs text-zinc-900 tabular-nums md:text-right font-medium">
                    {fmtMXN(c.lifetime_value_mxn)}
                  </div>

                  <div className="col-span-3 md:col-span-2 md:text-right">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
                        status.className,
                      )}
                    >
                      <span
                        className={cn(
                          'w-1.5 h-1.5 rounded-full mr-1.5',
                          status.label === 'Activo' && 'bg-emerald-500',
                          status.label === 'En riesgo' && 'bg-rose-500',
                          status.label === 'Observación' && 'bg-amber-500',
                          status.label === 'Nuevo' && 'bg-zinc-400',
                        )}
                      />
                      {status.label}
                    </span>
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
