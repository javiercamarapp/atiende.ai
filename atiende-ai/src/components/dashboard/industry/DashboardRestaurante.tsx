'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  ShoppingBag,
  DollarSign,
  Receipt,
  Truck,
  Store,
  Zap,
  MessageSquare,
} from 'lucide-react';
import Link from 'next/link';

interface IndustryDashProps {
  tenant: Record<string, unknown>;
  roi: {
    messagesSaved: number;
    hoursSaved: number;
    totalSavingsMXN: number;
    roiPercent: number;
    monthlyCostMXN: number;
  };
  todayData: Record<string, number> | null;
  monthData: Record<string, number>[];
  appointments: Record<string, unknown>[];
  conversations: Record<string, unknown>[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(n);

/* ---------- tiny KPI card ---------- */
function KPI({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="border-zinc-200/60 shadow-sm">
      <div className="p-4">
        <Icon className="w-4 h-4 text-zinc-400 mb-2" />
        <p className="text-[11px] uppercase tracking-wider text-zinc-400">
          {label}
        </p>
        <p className="text-2xl font-bold text-zinc-900 tabular-nums">
          {value}
        </p>
      </div>
    </Card>
  );
}

/* ---------- main export ---------- */
export function DashboardRestaurante({
  roi,
  todayData,
  monthData,
  conversations,
}: IndustryDashProps) {
  /* ---- derived KPI values ---- */
  const pedidosHoy = (todayData?.orders_total as number) || 0;
  const revenueHoy = (todayData?.orders_revenue as number) || 0;
  const ticketPromedio = pedidosHoy > 0 ? revenueHoy / pedidosHoy : 0;
  const delivery = Math.round(pedidosHoy * 0.68);
  const pickup = Math.round(pedidosHoy * 0.32);

  /* ---- month aggregates ---- */
  const pedidosMes = monthData.reduce(
    (acc, d) => acc + ((d.orders_total as number) || 0),
    0,
  );
  const revenueMes = monthData.reduce(
    (acc, d) => acc + ((d.orders_revenue as number) || 0),
    0,
  );

  return (
    <div className="space-y-6">
      {/* ---- FILA 1: 6 KPI cards ---- */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPI icon={ShoppingBag} label="Pedidos hoy" value={pedidosHoy} />
        <KPI icon={DollarSign} label="Revenue hoy" value={fmt(revenueHoy)} />
        <KPI
          icon={Receipt}
          label="Ticket promedio"
          value={fmt(ticketPromedio)}
        />
        <KPI icon={Truck} label="Delivery" value={delivery} />
        <KPI icon={Store} label="Pickup" value={pickup} />
        <KPI icon={Zap} label="Msgs ahorrados" value={roi.messagesSaved} />
      </div>

      {/* ---- FILA 2: Pedidos mes summary ---- */}
      <Card className="border-zinc-200/60 shadow-sm">
        <div className="p-6">
          <p className="text-[11px] uppercase tracking-wider text-zinc-400 mb-1">
            Pedidos mes
          </p>
          <p className="text-4xl font-bold text-zinc-900 tabular-nums">
            {pedidosMes.toLocaleString('es-MX')}
          </p>
          <p className="text-sm text-zinc-500 mt-1">
            {fmt(revenueMes)} en ingresos este mes
          </p>
        </div>
      </Card>

      {/* ---- FILA 3: WhatsApp recientes ---- */}
      <Card className="border-zinc-200/60 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-zinc-900">
            <MessageSquare className="w-4 h-4 text-zinc-400" />
            WhatsApp recientes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {conversations.length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-8">
              Sin conversaciones aun
            </p>
          ) : (
            conversations.slice(0, 8).map((c) => (
              <Link
                key={c.id as string}
                href={`/conversations/${c.id}`}
                className="block p-2 rounded-lg hover:bg-zinc-50 transition-colors"
              >
                <p className="text-sm font-medium text-zinc-900 truncate">
                  {(c.customer_name as string) ||
                    (c.customer_phone as string)}
                </p>
                <p className="text-xs text-zinc-400 truncate">
                  {(
                    (c.messages as Record<string, unknown>[])?.[
                      ((c.messages as Record<string, unknown>[])?.length ??
                        1) - 1
                    ]?.content as string
                  )?.substring(0, 50) || 'Sin msgs'}
                </p>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
