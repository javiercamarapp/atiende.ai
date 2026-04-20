'use client';
import { MessageSquare, Calendar, ShoppingBag, Users, Zap, TrendingDown } from 'lucide-react';

type TodayShape = {
  messages_inbound?: number;
  orders_total?: number;
  orders_revenue?: number;
  leads_new?: number;
  appointments_booked?: number;
};
type MonthRow = {
  messages_inbound?: number;
  appointments_booked?: number;
  appointments_no_show?: number;
  orders_total?: number;
  leads_new?: number;
};

interface Kpi {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  /** Semantic tint for the icon + accent line */
  tone: 'ink' | 'emerald' | 'amber' | 'red' | 'sky' | 'violet';
}

function getKPIs(type: string, today: TodayShape | null, month: MonthRow[]): Kpi[] {
  const tMsgs = month.reduce((s, d) => s + (d.messages_inbound || 0), 0);
  const tAppts = month.reduce((s, d) => s + (d.appointments_booked || 0), 0);
  const tNoShow = month.reduce((s, d) => s + (d.appointments_no_show || 0), 0);
  const tOrders = month.reduce((s, d) => s + (d.orders_total || 0), 0);
  const tLeads = month.reduce((s, d) => s + (d.leads_new || 0), 0);

  const base: Kpi[] = [
    { label: 'Mensajes hoy', value: today?.messages_inbound || 0, icon: MessageSquare, tone: 'sky' },
    { label: 'Msgs ahorrados', value: tMsgs, icon: Zap, tone: 'emerald' },
  ];

  const food = ['restaurant', 'taqueria', 'cafe', 'florist'];
  const realty = ['real_estate', 'insurance', 'school', 'accountant'];

  if (food.includes(type)) {
    return [
      ...base,
      { label: 'Pedidos hoy', value: today?.orders_total || 0, icon: ShoppingBag, tone: 'amber' },
      { label: 'Revenue hoy', value: '$' + (today?.orders_revenue || 0).toLocaleString(), icon: ShoppingBag, tone: 'emerald' },
      { label: 'Pedidos mes', value: tOrders, icon: ShoppingBag, tone: 'violet' },
    ];
  }
  if (realty.includes(type)) {
    return [
      ...base,
      { label: 'Leads nuevos', value: today?.leads_new || 0, icon: Users, tone: 'sky' },
      { label: 'Leads mes', value: tLeads, icon: Users, tone: 'violet' },
    ];
  }
  return [
    ...base,
    { label: 'Citas hoy', value: today?.appointments_booked || 0, icon: Calendar, tone: 'sky' },
    { label: 'No-shows mes', value: tNoShow, icon: TrendingDown, tone: tNoShow > 5 ? 'red' : 'emerald' },
    { label: 'Citas mes', value: tAppts, icon: Calendar, tone: 'violet' },
  ];
}

const TONES: Record<Kpi['tone'], { icon: string; accent: string }> = {
  ink:     { icon: 'text-zinc-700',       accent: 'from-zinc-400/40 to-transparent' },
  emerald: { icon: 'text-emerald-600',    accent: 'from-emerald-500/50 to-transparent' },
  amber:   { icon: 'text-amber-600',      accent: 'from-amber-500/50 to-transparent' },
  red:     { icon: 'text-red-600',        accent: 'from-red-500/50 to-transparent' },
  sky:     { icon: 'text-sky-600',        accent: 'from-sky-500/50 to-transparent' },
  violet:  { icon: 'text-violet-600',     accent: 'from-violet-500/50 to-transparent' },
};

export function KPICards({
  tenant,
  today,
  monthData,
}: {
  tenant: { business_type?: string | null };
  today: TodayShape | null;
  monthData: MonthRow[];
}) {
  const kpis = getKPIs(tenant.business_type || 'other', today, monthData || []);
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {kpis.map((k) => {
        const Icon = k.icon;
        const tone = TONES[k.tone];
        return (
          <div
            key={k.label}
            className="stagger-item glass-card relative overflow-hidden p-5 group"
          >
            {/* Subtle top accent bar */}
            <div
              aria-hidden
              className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${tone.accent}`}
            />
            <div className="flex items-center gap-2">
              <Icon className={`w-4 h-4 ${tone.icon}`} />
              <span className="text-[11px] uppercase tracking-wider text-zinc-500">
                {k.label}
              </span>
            </div>
            <p className="kpi-number text-4xl font-semibold mt-3 tabular-nums">
              {k.value}
            </p>
          </div>
        );
      })}
    </div>
  );
}
