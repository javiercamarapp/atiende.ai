'use client';

import { Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Line, ComposedChart, Legend } from 'recharts';

type TrendPoint = { date: string; mensajes: number; citas: number; revenue: number };

export function AnalyticsCharts({ trend }: { trend: TrendPoint[] }) {
  if (trend.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center text-sm text-zinc-400">
        Aún no hay datos diarios. Las métricas se rellenan a medida que llegan mensajes y citas.
      </div>
    );
  }
  return (
    <div className="h-72 -mx-2">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={trend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="msgFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(235 84% 55%)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(235 84% 55%)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
          <XAxis dataKey="date" fontSize={11} stroke="#94a3b8" tickLine={false} axisLine={false} />
          <YAxis fontSize={11} stroke="#94a3b8" tickLine={false} axisLine={false} width={32} />
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" />
          <Area
            type="monotone"
            dataKey="mensajes"
            stroke="hsl(235 84% 55%)"
            strokeWidth={2}
            fill="url(#msgFill)"
            name="Mensajes"
          />
          <Line
            type="monotone"
            dataKey="citas"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ r: 3, fill: '#10b981' }}
            activeDot={{ r: 5 }}
            name="Citas"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
