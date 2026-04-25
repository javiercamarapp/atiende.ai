// ═════════════════════════════════════════════════════════════════════════════
// /settings/insurance — Insurance claims tracking dashboard (Phase 3)
//
// Vista para que el dueño trackee reclamos a aseguradoras (GNP, AXA, Metlife,
// BUPA, IMSS, ISSSTE…). Direct-billing es el caso crítico — el consultorio
// está esperando pago de la aseguradora, no del paciente.
//
// Status flow: pending_submission → submitted → in_review →
//              approved/denied/partial → paid
// ═════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { decryptPII } from '@/lib/utils/crypto';
import { displayPatientName } from '@/lib/utils/patient-display';
import { Shield, AlertCircle, Hourglass, CheckCircle2, XCircle } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface ClaimRow {
  id: string;
  insurer_name: string;
  policy_number: string | null;
  claim_number: string | null;
  status: string;
  amount_claimed_mxn: number | null;
  amount_paid_mxn: number | null;
  deductible_mxn: number | null;
  direct_billing: boolean;
  denial_reason: string | null;
  notes: string | null;
  submitted_at: string | null;
  resolved_at: string | null;
  created_at: string;
  contact_id: string;
  contact: { name: string | null; name_enc: string | null; phone: string | null } | { name: string | null; name_enc: string | null; phone: string | null }[] | null;
  appointment: { datetime: string } | { datetime: string }[] | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending_submission: 'Por enviar',
  submitted: 'Enviado',
  in_review: 'En revisión',
  approved: 'Aprobado',
  denied: 'Rechazado',
  partial: 'Parcial',
  paid: 'Pagado',
};

const STATUS_TINT: Record<string, string> = {
  pending_submission: 'bg-zinc-100 text-zinc-700',
  submitted: 'bg-blue-50 text-blue-700',
  in_review: 'bg-violet-50 text-violet-700',
  approved: 'bg-emerald-50 text-emerald-700',
  denied: 'bg-red-50 text-red-700',
  partial: 'bg-amber-50 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-800',
};

function formatMoney(n: number | null): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n);
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export default async function InsuranceClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const filter = params.status || 'open';

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: tenant } = await supabase
    .from('tenants').select('id, name').eq('user_id', user.id).single();
  if (!tenant) return null;

  let query = supabase
    .from('insurance_claims')
    .select(`
      id, insurer_name, policy_number, claim_number, status,
      amount_claimed_mxn, amount_paid_mxn, deductible_mxn,
      direct_billing, denial_reason, notes, submitted_at, resolved_at, created_at,
      contact_id,
      contact:contact_id(name, name_enc, phone),
      appointment:appointment_id(datetime)
    `)
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (filter === 'open') {
    query = query.in('status', ['pending_submission', 'submitted', 'in_review', 'approved']);
  } else if (filter !== 'all') {
    query = query.eq('status', filter);
  }

  const { data: claimsRaw } = await query;
  const claims = (claimsRaw || []) as unknown as ClaimRow[];

  // Aggregates calculated against ALL claims (otra query liviana)
  const { data: allRaw } = await supabase
    .from('insurance_claims')
    .select('status, amount_claimed_mxn, amount_paid_mxn, direct_billing, submitted_at')
    .eq('tenant_id', tenant.id);
  const all = allRaw || [];

  const openCount = all.filter((c) => !['paid', 'denied'].includes(c.status as string)).length;
  const overdueCount = all.filter(
    (c) =>
      c.direct_billing === true &&
      ['submitted', 'in_review'].includes(c.status as string) &&
      (daysSince(c.submitted_at as string | null) ?? 0) > 45,
  ).length;
  const totalPending = all
    .filter((c) => !['paid', 'denied'].includes(c.status as string))
    .reduce((sum, c) => sum + Number(c.amount_claimed_mxn ?? 0), 0);
  const totalPaid = all.reduce((sum, c) => sum + Number(c.amount_paid_mxn ?? 0), 0);

  const filterTabs: Array<{ key: string; label: string }> = [
    { key: 'open', label: 'Abiertos' },
    { key: 'submitted', label: 'Enviados' },
    { key: 'in_review', label: 'En revisión' },
    { key: 'approved', label: 'Aprobados' },
    { key: 'paid', label: 'Pagados' },
    { key: 'denied', label: 'Rechazados' },
    { key: 'all', label: 'Todos' },
  ];

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-zinc-900 flex items-center gap-2">
          <Shield className="w-6 h-6 text-[hsl(var(--brand-blue))]" />
          Reclamos de aseguradora
        </h1>
        <p className="text-sm text-zinc-500 mt-1 leading-relaxed">
          Trackeo de claims a GNP, AXA, Metlife, BUPA, IMSS, ISSSTE y otras.
          Las direct-billing en revisión hace más de 45 días aparecen como vencidas
          — llamá a la aseguradora para acelerar.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Abiertos" value={openCount.toString()} icon={Hourglass} tint="violet" />
        <KpiCard label="Vencidos (>45d)" value={overdueCount.toString()} icon={AlertCircle} tint="amber" />
        <KpiCard label="Pendiente cobro" value={formatMoney(totalPending)} icon={Hourglass} tint="zinc" small />
        <KpiCard label="Cobrado total" value={formatMoney(totalPaid)} icon={CheckCircle2} tint="emerald" small />
      </div>

      <nav className="flex flex-wrap gap-2 text-[12px]">
        {filterTabs.map((t) => (
          <Link
            key={t.key}
            href={`/settings/insurance?status=${t.key}`}
            className={`px-2.5 py-1 rounded-full border transition ${
              filter === t.key
                ? 'bg-[hsl(var(--brand-blue))] text-white border-[hsl(var(--brand-blue))]'
                : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {claims.length === 0 ? (
        <div className="bg-white border border-zinc-100 rounded-2xl p-8 text-center">
          <Shield className="w-10 h-10 text-zinc-300 mx-auto" />
          <p className="mt-3 text-sm text-zinc-700 font-medium">Sin reclamos en este filtro</p>
          <p className="text-xs text-zinc-500 mt-1">
            El bot crea reclamos cuando el paciente dice "esto va por mi seguro" o cuando hacés direct-billing.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {claims.map((c) => (
            <ClaimCard key={c.id} claim={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

function KpiCard({
  label, value, icon: Icon, tint, small,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: 'emerald' | 'amber' | 'zinc' | 'violet';
  small?: boolean;
}) {
  const tints: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    zinc: 'bg-zinc-100 text-zinc-700',
    violet: 'bg-violet-50 text-violet-700',
  };
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tints[tint]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className={`font-semibold text-zinc-900 leading-none ${small ? 'text-base' : 'text-2xl'}`}>{value}</p>
        <p className="text-xs text-zinc-500 mt-1 truncate">{label}</p>
      </div>
    </div>
  );
}

function ClaimCard({ claim }: { claim: ClaimRow }) {
  const contact = Array.isArray(claim.contact) ? claim.contact[0] : claim.contact;
  const apt = Array.isArray(claim.appointment) ? claim.appointment[0] : claim.appointment;
  const patientName = displayPatientName(
    decryptPII(contact?.name_enc ?? null) || (contact?.name ?? null),
    contact?.phone ?? null,
  );
  const aptDate = apt?.datetime
    ? new Date(apt.datetime).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;
  const overdue =
    claim.direct_billing &&
    ['submitted', 'in_review'].includes(claim.status) &&
    (daysSince(claim.submitted_at) ?? 0) > 45;

  return (
    <li
      className={`rounded-2xl p-4 border ${
        overdue ? 'bg-amber-50/40 border-amber-200' : 'bg-white border-zinc-100'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/contacts/${claim.contact_id}`}
              className="text-sm font-semibold text-zinc-900 hover:underline"
            >
              {patientName}
            </Link>
            <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${STATUS_TINT[claim.status] || 'bg-zinc-100 text-zinc-700'}`}>
              {STATUS_LABEL[claim.status] || claim.status}
            </span>
            {claim.direct_billing && (
              <span className="text-[10px] uppercase bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                Direct billing
              </span>
            )}
            {overdue && (
              <span className="text-[10px] uppercase bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Vencido
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            {claim.insurer_name}
            {claim.claim_number && ` · #${claim.claim_number}`}
            {aptDate && ` · cita ${aptDate}`}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-zinc-900">{formatMoney(claim.amount_claimed_mxn)}</p>
          {claim.amount_paid_mxn != null && claim.status === 'paid' && (
            <p className="text-[11px] text-emerald-700">
              <CheckCircle2 className="w-3 h-3 inline mr-0.5" />
              {formatMoney(claim.amount_paid_mxn)}
            </p>
          )}
          {claim.amount_paid_mxn != null && claim.status === 'partial' && (
            <p className="text-[11px] text-amber-700">parcial: {formatMoney(claim.amount_paid_mxn)}</p>
          )}
        </div>
      </div>

      {claim.denial_reason && (
        <p className="mt-2 text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">
          <XCircle className="w-3 h-3 inline mr-1" />
          {claim.denial_reason}
        </p>
      )}
      {claim.notes && (
        <p className="mt-2 text-[12px] text-zinc-600 leading-relaxed">{claim.notes}</p>
      )}
    </li>
  );
}
