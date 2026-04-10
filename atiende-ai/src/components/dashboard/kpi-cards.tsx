'use client';
import { Card } from '@/components/ui/card';
import {
  MessageSquare,
  Calendar,
  ShoppingBag,
  Users,
  Zap,
  TrendingDown,
} from 'lucide-react';

function getKPIs(type: string, today: Record<string, number> | null, month: Record<string, number>[]) {
  const tMsgs = month.reduce((s, d) => s + (d.messages_inbound || 0), 0);
  const tAppts = month.reduce((s, d) => s + (d.appointments_booked || 0), 0);
  const tNoShow = month.reduce((s, d) => s + (d.appointments_no_show || 0), 0);
  const tOrders = month.reduce((s, d) => s + (d.orders_total || 0), 0);
  const tLeads = month.reduce((s, d) => s + (d.leads_new || 0), 0);

  const base = [
    { label: 'Mensajes hoy', value: today?.messages_inbound || 0, icon: MessageSquare },
    { label: 'Msgs ahorrados', value: tMsgs, icon: Zap },
  ];

  const food = ['restaurant', 'taqueria', 'cafe', 'florist'];
  const realty = ['real_estate', 'insurance', 'school', 'accountant'];

  if (food.includes(type))
    return [
      ...base,
      { label: 'Pedidos hoy', value: today?.orders_total || 0, icon: ShoppingBag },
      {
        label: 'Revenue hoy',
        value: '$' + (today?.orders_revenue || 0).toLocaleString(),
        icon: ShoppingBag,
      },
      { label: 'Pedidos mes', value: tOrders, icon: ShoppingBag },
    ];

  if (realty.includes(type))
    return [
      ...base,
      { label: 'Leads nuevos', value: today?.leads_new || 0, icon: Users },
      { label: 'Leads mes', value: tLeads, icon: Users },
    ];

  return [
    ...base,
    { label: 'Citas hoy', value: today?.appointments_booked || 0, icon: Calendar },
    { label: 'No-shows mes', value: tNoShow, icon: TrendingDown },
    { label: 'Citas mes', value: tAppts, icon: Calendar },
  ];
}

export function KPICards({
  tenant,
  today,
  monthData,
}: {
  tenant: { business_type: string };
  today: Record<string, number> | null;
  monthData: Record<string, number>[];
}) {
  const kpis = getKPIs(tenant.business_type, today, monthData);
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {kpis.map((k) => {
        const Icon = k.icon;
        return (
          <Card
            key={k.label}
            className="p-4 border-zinc-200/60 shadow-sm hover:shadow-md transition-shadow duration-200"
          >
            <div className="flex items-center gap-2 mb-2">
              <Icon className="w-4 h-4 text-zinc-400" />
              <span className="text-[11px] text-zinc-400 uppercase tracking-wider">
                {k.label}
              </span>
            </div>
            <p className="text-2xl font-bold text-zinc-900 tabular-nums">{k.value}</p>
          </Card>
        );
      })}
    </div>
  );
}
