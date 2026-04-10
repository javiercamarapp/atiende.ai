'use client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

export function DashCharts({
  tenant,
  data,
}: {
  tenant: { business_type: string };
  data: Record<string, unknown>[];
}) {
  const cd = data.map((d: Record<string, unknown>) => ({
    date: new Date(d.date as string).toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'short',
    }),
    mensajes: (d.messages_inbound as number) || 0,
    citas: (d.appointments_booked as number) || 0,
    pedidos: (d.orders_total as number) || 0,
    revenue: (d.orders_revenue as number) || 0,
    leads: (d.leads_new as number) || 0,
  }));

  const isFood = ['restaurant', 'taqueria', 'cafe'].includes(tenant.business_type);
  const isRealty = ['real_estate', 'insurance'].includes(tenant.business_type);

  return (
    <div className="space-y-4">
      <Card className="border-zinc-200/60 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-zinc-900">Mensajes por dia</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={cd}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="date" fontSize={10} stroke="#a1a1aa" />
              <YAxis fontSize={10} stroke="#a1a1aa" />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="mensajes"
                stroke="#18181b"
                fill="#f4f4f5"
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-zinc-200/60 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-zinc-900">
            {isFood ? 'Revenue diario' : isRealty ? 'Leads por dia' : 'Citas por dia'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={cd}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="date" fontSize={10} stroke="#a1a1aa" />
              <YAxis fontSize={10} stroke="#a1a1aa" />
              <Tooltip />
              <Bar
                dataKey={isFood ? 'revenue' : isRealty ? 'leads' : 'citas'}
                fill="#27272a"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
