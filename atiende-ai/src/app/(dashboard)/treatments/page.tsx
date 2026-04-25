// ═════════════════════════════════════════════════════════════════════════════
// /treatments — owner dashboard de planes de tratamiento (Phase 3)
//
// Vista operativa para el dueño/recepcionista: ver todos los planes activos
// con su progreso y flag de dropout risk (calculado on-the-fly).
//
// Dropout risk = paciente que no agendó la siguiente sesión a tiempo.
// Heurística: si la próxima sesión esperada (next pending) está vencida
// por más de 1.5× el cadence_days, marcar como at-risk.
// ═════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { decryptPII } from '@/lib/utils/crypto';
import { displayPatientName } from '@/lib/utils/patient-display';
import { ListTodo, AlertTriangle, Clock3, CheckCircle2, Pause } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PlanRow {
  id: string;
  plan_name: string;
  plan_type: string;
  total_sessions: number;
  cadence_days: number | null;
  status: string;
  started_at: string;
  contact_id: string;
  contact: { name: string | null; name_enc: string | null; phone: string | null } | { name: string | null; name_enc: string | null; phone: string | null }[] | null;
  staff: { name: string } | { name: string }[] | null;
}

const PLAN_TYPE_LABEL: Record<string, string> = {
  orthodontics: 'Ortodoncia',
  physiotherapy: 'Fisioterapia',
  endodontics: 'Endodoncia',
  implant: 'Implante',
  aesthetic: 'Estética',
  rehabilitation: 'Rehabilitación',
  other: 'Otro',
};

export default async function TreatmentsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('user_id', user.id)
    .single();
  if (!tenant) return null;

  const { data: plansRaw } = await supabase
    .from('treatment_plans')
    .select(`
      id, plan_name, plan_type, total_sessions, cadence_days, status, started_at,
      contact_id,
      contact:contact_id(name, name_enc, phone),
      staff:staff_id(name)
    `)
    .eq('tenant_id', tenant.id)
    .in('status', ['active', 'paused'])
    .order('started_at', { ascending: false });

  const plans = (plansRaw || []) as unknown as PlanRow[];
  const planIds = plans.map((p) => p.id);

  // Sesiones de TODOS los planes en una sola query
  const { data: sessionsRaw } = planIds.length
    ? await supabase
        .from('treatment_sessions')
        .select('plan_id, session_number, status, expected_date, completed_at')
        .in('plan_id', planIds)
    : { data: [] };
  const sessions = sessionsRaw || [];

  type Computed = {
    planId: string;
    completed: number;
    total: number;
    nextDate: string | null;
    nextNumber: number | null;
    daysOverdue: number | null;
    atRisk: boolean;
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const computed: Map<string, Computed> = new Map();
  for (const p of plans) {
    const planSessions = sessions.filter((s) => s.plan_id === p.id);
    const completed = planSessions.filter((s) => s.status === 'completed').length;
    const next = planSessions
      .filter((s) => s.status === 'pending' || s.status === 'scheduled')
      .sort((a, b) => (a.session_number as number) - (b.session_number as number))[0];

    let daysOverdue: number | null = null;
    if (next?.expected_date) {
      const exp = new Date(next.expected_date as string);
      const diffMs = today.getTime() - exp.getTime();
      daysOverdue = Math.floor(diffMs / 86_400_000);
    }
    const cadence = p.cadence_days ?? null;
    const atRisk =
      p.status === 'active' &&
      daysOverdue !== null &&
      cadence !== null &&
      daysOverdue > Math.floor(cadence * 0.5);

    computed.set(p.id, {
      planId: p.id,
      completed,
      total: p.total_sessions,
      nextDate: next?.expected_date ?? null,
      nextNumber: next?.session_number ?? null,
      daysOverdue,
      atRisk,
    });
  }

  const active = plans.filter((p) => p.status === 'active');
  const paused = plans.filter((p) => p.status === 'paused');
  const atRisk = active.filter((p) => computed.get(p.id)?.atRisk);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-5">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 flex items-center gap-2">
            <ListTodo className="w-6 h-6 text-[hsl(var(--brand-blue))]" />
            Tratamientos
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Planes multi-sesión activos. El sistema marca con ⚠ los pacientes que no
            agendaron la siguiente sesión a tiempo — llamalos antes de perder el caso.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Activos" value={active.length} icon={CheckCircle2} tint="emerald" />
        <KpiCard label="En riesgo" value={atRisk.length} icon={AlertTriangle} tint="amber" />
        <KpiCard label="Pausados" value={paused.length} icon={Pause} tint="zinc" />
      </div>

      {plans.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {[...atRisk, ...active.filter((p) => !computed.get(p.id)?.atRisk), ...paused].map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              computed={computed.get(p.id)!}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label, value, icon: Icon, tint,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tint: 'emerald' | 'amber' | 'zinc';
}) {
  const tints: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    zinc: 'bg-zinc-100 text-zinc-700',
  };
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tints[tint]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-semibold text-zinc-900 leading-none">{value}</p>
        <p className="text-xs text-zinc-500 mt-1">{label}</p>
      </div>
    </div>
  );
}

function PlanCard({
  plan, computed,
}: {
  plan: PlanRow;
  computed: { completed: number; total: number; nextDate: string | null; nextNumber: number | null; daysOverdue: number | null; atRisk: boolean };
}) {
  const contact = Array.isArray(plan.contact) ? plan.contact[0] : plan.contact;
  const staff = Array.isArray(plan.staff) ? plan.staff[0] : plan.staff;
  const patientName = displayPatientName(
    decryptPII(contact?.name_enc ?? null) || (contact?.name ?? null),
    contact?.phone ?? null,
  );
  const pct = (computed.completed / computed.total) * 100;
  const overdueLabel =
    computed.daysOverdue !== null && computed.daysOverdue > 0
      ? `${computed.daysOverdue} día${computed.daysOverdue === 1 ? '' : 's'} de retraso`
      : null;

  return (
    <Link
      href={`/contacts/${plan.contact_id}`}
      className={`block rounded-2xl p-4 border transition hover:shadow-sm ${
        computed.atRisk
          ? 'bg-amber-50/40 border-amber-200'
          : plan.status === 'paused'
            ? 'bg-zinc-50 border-zinc-100'
            : 'bg-white border-zinc-100'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-zinc-900">{patientName}</p>
            <span className="text-[11px] uppercase tracking-wider text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">
              {PLAN_TYPE_LABEL[plan.plan_type] || plan.plan_type}
            </span>
            {plan.status === 'paused' && (
              <span
                role="status"
                aria-label="Plan pausado"
                className="text-[10px] uppercase bg-zinc-200 text-zinc-700 px-1.5 py-0.5 rounded"
              >
                Pausado
              </span>
            )}
            {computed.atRisk && (
              <span
                role="status"
                aria-label="Plan en riesgo de dropout, contactar al paciente"
                className="text-[10px] uppercase bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded flex items-center gap-1"
              >
                <AlertTriangle className="w-3 h-3" aria-hidden="true" /> En riesgo
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            {plan.plan_name}
            {staff?.name ? ` · ${staff.name}` : ''}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
          <div
            className={`h-full ${computed.atRisk ? 'bg-amber-500' : 'bg-[hsl(var(--brand-blue))]'}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-1.5 text-[11px] text-zinc-500">
          <span>
            Sesión {computed.completed} de {computed.total}
          </span>
          <span className="flex items-center gap-1">
            <Clock3 className="w-3 h-3" />
            {computed.nextDate
              ? `Próxima: ${computed.nextDate}${overdueLabel ? ` (${overdueLabel})` : ''}`
              : computed.completed >= computed.total
                ? 'Completado'
                : 'Sin próxima fecha'}
          </span>
        </div>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-8 text-center">
      <ListTodo className="w-10 h-10 text-zinc-300 mx-auto" />
      <h2 className="text-sm font-semibold text-zinc-900 mt-3">
        Sin planes de tratamiento aún
      </h2>
      <p className="text-sm text-zinc-500 mt-1 max-w-md mx-auto leading-relaxed">
        Cuando el doctor cree un plan multi-sesión (ortodoncia, fisio, rehab),
        aparecerá acá con su progreso y alerta de dropout. El bot puede crearlos
        cuando el doctor le indica vía WhatsApp.
      </p>
    </div>
  );
}
