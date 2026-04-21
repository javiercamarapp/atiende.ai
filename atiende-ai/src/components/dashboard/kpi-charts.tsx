'use client';

import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell,
  LineChart, Line, Legend,
} from 'recharts';

const BRAND = 'hsl(235 84% 55%)';
const BRAND_MID = 'hsl(235 70% 72%)';
const BRAND_SOFT = 'hsl(235 84% 92%)';
const INK = 'hsl(222 47% 11%)';

const TooltipBox = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-zinc-900 text-white px-3 py-2 shadow-lg text-xs">
      {label && <p className="font-medium mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="tabular-nums">
          <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: p.color }} />
          {p.name}: <span className="font-semibold">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

export function WeekdayBarChart({ data }: { data: { day: string; count: number; prev: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} barCategoryGap={18}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
        <XAxis dataKey="day" fontSize={11} tickLine={false} axisLine={false} stroke="#71717a" />
        <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="#71717a" />
        <Tooltip content={<TooltipBox />} />
        <Bar dataKey="prev" name="Semana previa" fill={BRAND_SOFT} radius={[6, 6, 0, 0]} />
        <Bar dataKey="count" name="Esta semana" fill={BRAND} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ServicesDonut({
  data,
  total,
}: {
  data: { name: string; value: number; color: string }[];
  total: number;
}) {
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            innerRadius={68}
            outerRadius={92}
            dataKey="value"
            stroke="white"
            strokeWidth={2}
            paddingAngle={2}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<TooltipBox />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500">Total</p>
        <p className="text-2xl font-semibold tabular-nums text-zinc-900">{total}</p>
      </div>
    </div>
  );
}

export function RevenueLineChart({ data }: { data: { month: string; income: number; expense: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
        <XAxis dataKey="month" fontSize={11} tickLine={false} axisLine={false} stroke="#71717a" />
        <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="#71717a" />
        <Tooltip content={<TooltipBox />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="income" name="Ingresos" stroke={BRAND} strokeWidth={2.5} dot={{ fill: BRAND, r: 3 }} activeDot={{ r: 5 }} />
        <Line type="monotone" dataKey="expense" name="Gastos" stroke={INK} strokeWidth={2.5} dot={{ fill: INK, r: 3 }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TrendAreaChart({ data }: { data: { label: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND} stopOpacity={0.3} />
            <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
        <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} stroke="#71717a" />
        <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="#71717a" />
        <Tooltip content={<TooltipBox />} />
        <Area type="monotone" dataKey="value" stroke={BRAND} strokeWidth={2.5} fill="url(#trendGradient)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function AppointmentTypeBars({
  segments,
}: {
  segments: { name: string; count: number; color: string }[];
}) {
  const total = segments.reduce((sum, s) => sum + s.count, 0) || 1;
  return (
    <div className="flex items-end gap-0.5 h-32 pt-2">
      {segments.map((seg) => {
        const bars = Math.max(1, Math.round((seg.count / total) * 60));
        return Array.from({ length: bars }).map((_, i) => (
          <div
            key={`${seg.name}-${i}`}
            className="flex-1 rounded-sm"
            style={{
              background: seg.color,
              height: `${60 + Math.random() * 40}%`,
              minWidth: 2,
            }}
          />
        ));
      })}
    </div>
  );
}

export function BloodPressureChart({ data }: { data: { month: string; top: number; bottom: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} stackOffset="sign" barCategoryGap={12}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
        <XAxis dataKey="month" fontSize={11} tickLine={false} axisLine={false} stroke="#71717a" />
        <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="#71717a" />
        <Tooltip content={<TooltipBox />} />
        <Bar dataKey="top" name="Sistólica" fill={BRAND_MID} radius={[6, 6, 0, 0]} stackId="bp" />
        <Bar dataKey="bottom" name="Diastólica" fill={BRAND} radius={[0, 0, 6, 6]} stackId="bp" />
      </BarChart>
    </ResponsiveContainer>
  );
}
