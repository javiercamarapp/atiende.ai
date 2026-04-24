import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { createServerSupabase } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';
import { decryptPII } from '@/lib/utils/crypto';
import { displayPatientName, patientInitials } from '@/lib/utils/patient-display';

type FilterKey = 'all' | 'at_risk' | 'valuable' | 'inactive';

interface ContactRow {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  tags: string[] | null;
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
  // Reuso del helper compartido que también filtra ciphertext/phone-shape.
  return patientInitials(name, phone);
}

function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function shortId(id: string): string {
  return `#${id.slice(0, 8).toUpperCase()}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusFromScore(score: number | null, churn: number | null): {
  label: string;
  className: string;
} {
  const c = churn ?? 0;
  const s = score ?? 0;
  if (c > 60) return { label: 'En riesgo', className: 'bg-rose-50 text-rose-700' };
  if (s >= 70) return { label: 'Activo', className: 'bg-emerald-50 text-emerald-700' };
  if (s >= 40) return { label: 'En tratamiento', className: 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]' };
  return { label: 'Alta', className: 'bg-zinc-100 text-zinc-600' };
}

function tagFromScore(score: number | null, ltv: number | null): string {
  if ((ltv ?? 0) > 5000) return 'VIP';
  const s = score ?? 0;
  if (s >= 70) return 'Recurrente';
  if (s >= 40) return 'Ambulatorio';
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
    .select('id, name, phone, email, tags, health_score, churn_probability, lifetime_value_mxn, next_visit_predicted_at, created_at')
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

  // Desencriptar el nombre antes de pasarlo al render. Si la env
  // PII_ENCRYPTION_KEY no está configurada, decryptPII devuelve el
  // ciphertext raw; el helper displayPatientName lo detecta y cae al
  // fallback "Paciente …XXXX". Así el UI nunca muestra el blob cifrado.
  let contacts: ContactRow[] = ((contactsRaw || []) as ContactRow[]).map((c) => ({
    ...c,
    name: decryptPII(c.name),
    last_contact_at: lastByPhone.get(c.phone) ?? null,
  }));

  if (filter === 'inactive') {
    // eslint-disable-next-line react-hooks/purity
    const cutoff = Date.now() - 90 * 86_400_000;
    contacts = contacts.filter(
      (c) => !c.last_contact_at || new Date(c.last_contact_at).getTime() < cutoff,
    );
  }

  const filters: Array<{ id: FilterKey; label: string }> = [
    { id: 'all', label: 'Todos' },
    { id: 'at_risk', label: 'En riesgo' },
    { id: 'valuable', label: 'Valiosos' },
    { id: 'inactive', label: 'Inactivos' },
  ];

  return (
    <div className="space-y-4">
      {/* Main table card */}
      <div className="glass-card overflow-hidden animate-element animate-delay-100">
        {/* Header with title + filter pills */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-6 py-4 gap-3">
          <h3 className="text-sm font-semibold text-zinc-900">Pacientes</h3>
          <div className="flex flex-wrap items-center gap-2">
            {filters.map((f) => {
              const active = filter === f.id;
              return (
                <Link
                  key={f.id}
                  href={f.id === 'all' ? '/contacts' : `/contacts?filter=${f.id}`}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition',
                    active
                      ? 'bg-[hsl(var(--brand-blue))] text-white'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200',
                  )}
                >
                  {f.label}
                  <ChevronDown className="w-3 h-3" />
                </Link>
              );
            })}
          </div>
        </div>

        {contacts.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-zinc-500">
            Sin pacientes en este filtro.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-zinc-100 text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="px-6 py-3 text-left font-medium">Nombre</th>
                  <th className="hidden md:table-cell px-6 py-3 text-left font-medium">Contacto</th>
                  <th className="hidden lg:table-cell px-6 py-3 text-left font-medium">Condición</th>
                  <th className="hidden lg:table-cell px-6 py-3 text-left font-medium">Tipo</th>
                  <th className="hidden xl:table-cell px-6 py-3 text-left font-medium">Última visita</th>
                  <th className="hidden xl:table-cell px-6 py-3 text-left font-medium">LTV</th>
                  <th className="px-6 py-3 text-right font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => {
                  const status = statusFromScore(c.health_score, c.churn_probability);
                  const tag = tagFromScore(c.health_score, c.lifetime_value_mxn);
                  const tags = c.tags || [];
                  const condition = tags[0] || '—';
                  return (
                    <tr key={c.id} className="border-t border-zinc-100 hover:bg-zinc-50/60 transition">
                      <td className="px-6 py-3.5">
                        <Link href={`/contacts/${c.id}`} className="flex items-center gap-3 min-w-0">
                          <div
                            className={cn(
                              'shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold',
                              avatarColor(c.id),
                            )}
                          >
                            {initials(c.name, c.phone)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-zinc-900 hover:text-[hsl(var(--brand-blue))] truncate">
                              {displayPatientName(c.name, c.phone)}
                            </p>
                            <p className="text-[11px] text-zinc-400 tabular-nums">{shortId(c.id)}</p>
                          </div>
                        </Link>
                      </td>
                      <td className="hidden md:table-cell px-6 py-3.5">
                        <p className="text-xs text-zinc-700 tabular-nums">{c.phone}</p>
                        {c.email && <p className="text-[11px] text-zinc-400 truncate">{c.email}</p>}
                      </td>
                      <td className="hidden lg:table-cell px-6 py-3.5 text-xs text-zinc-700">
                        {condition}
                      </td>
                      <td className="hidden lg:table-cell px-6 py-3.5 text-xs text-zinc-600">
                        {tag}
                      </td>
                      <td className="hidden xl:table-cell px-6 py-3.5 text-xs text-zinc-600">
                        {fmtDate(c.last_contact_at ?? null)}
                      </td>
                      <td className="hidden xl:table-cell px-6 py-3.5 text-xs text-zinc-900 tabular-nums font-medium">
                        ${(c.lifetime_value_mxn ?? 0).toLocaleString('es-MX')}
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                            status.className,
                          )}
                        >
                          <span
                            className={cn(
                              'w-1.5 h-1.5 rounded-full',
                              status.label === 'Activo' && 'bg-emerald-500',
                              status.label === 'En riesgo' && 'bg-rose-500',
                              status.label === 'En tratamiento' && 'bg-[hsl(var(--brand-blue))]',
                              status.label === 'Alta' && 'bg-zinc-400',
                            )}
                          />
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
