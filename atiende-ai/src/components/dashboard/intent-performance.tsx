'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Brain } from 'lucide-react';

interface IntentStat { intent: string; total: number; resolved: number; escalated: number; rate: number; }

const COLORS = ['#18181b', '#3f3f46', '#52525b', '#71717a', '#a1a1aa', '#d4d4d8', '#e4e4e7', '#f4f4f5'];

export function IntentPerformance({ stats }: { stats: IntentStat[] }) {
  if (!stats.length) {
    return (
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Brain className="w-5 h-5" /> Rendimiento por Intent</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-zinc-500 text-center py-8">Sin datos todavía. Los intents aparecerán cuando el bot conteste mensajes.</p></CardContent>
      </Card>
    );
  }

  const chartData = stats.slice(0, 8).map(s => ({ name: s.intent, value: s.total }));

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Brain className="w-5 h-5" /> Rendimiento por Intent</CardTitle></CardHeader>
      <CardContent>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart><Pie data={chartData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
              {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie><Tooltip /></PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 space-y-2">
          {stats.slice(0, 6).map(s => (
            <div key={s.intent} className="flex items-center gap-2 text-sm">
              <span className="w-28 truncate text-zinc-600">{s.intent}</span>
              <div className="flex-1 h-2 bg-zinc-100 rounded-full overflow-hidden">
                <div className="h-full bg-zinc-900 rounded-full" style={{ width: `${s.rate}%` }} />
              </div>
              <span className="text-xs text-zinc-500 w-12 text-right">{s.rate}% AI</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
