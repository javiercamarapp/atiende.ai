'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';

interface ModelCost {
  model_used: string;
  count: number;
  total_cost: number;
}

interface DailyCost {
  date: string;
  cost: number;
}

interface LLMCostsProps {
  modelCosts: ModelCost[];
  dailyCosts: DailyCost[];
  totalMonthCost: number;
}

const MODEL_COLORS: Record<string, string> = {
  'google/gemini-2.5-flash-lite': '#10b981',
  'google/gemini-2.5-flash': '#3b82f6',
  'anthropic/claude-sonnet-4-6': '#8b5cf6',
  'openai/gpt-5-nano': '#f97316',
};

const MODEL_LABELS: Record<string, string> = {
  'google/gemini-2.5-flash-lite': 'Gemini Flash-Lite',
  'google/gemini-2.5-flash': 'Gemini Flash',
  'anthropic/claude-sonnet-4-6': 'Claude Sonnet',
  'openai/gpt-5-nano': 'GPT-5 Nano',
};

function getColor(model: string): string {
  return MODEL_COLORS[model] ?? '#6b7280';
}

function getLabel(model: string): string {
  return MODEL_LABELS[model] ?? model;
}

export function LLMCosts({ modelCosts, dailyCosts, totalMonthCost }: LLMCostsProps) {
  const pieData = modelCosts.map((m) => ({
    name: getLabel(m.model_used),
    value: m.total_cost,
    color: getColor(m.model_used),
  }));

  const chartDaily = dailyCosts.map((d) => ({
    date: new Date(d.date).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
    costo: d.cost,
  }));

  return (
    <div className="space-y-4">
      <Card className="p-4 text-center border-2 border-blue-200 bg-blue-50">
        <p className="text-sm text-blue-600 font-medium">Costo total este mes</p>
        <p className="text-3xl font-bold text-blue-800">${totalMonthCost.toFixed(2)} USD</p>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Distribucion por modelo</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <p className="text-center text-gray-400 py-8">Sin datos</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) =>
                      `${name}: ${(percent * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => `$${value.toFixed(4)}`} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Costo diario (30 dias)</CardTitle>
          </CardHeader>
          <CardContent>
            {chartDaily.length === 0 ? (
              <p className="text-center text-gray-400 py-8">Sin datos</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartDaily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" fontSize={10} />
                  <YAxis fontSize={10} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
                  <Tooltip formatter={(value: number) => `$${value.toFixed(4)}`} />
                  <Bar dataKey="costo" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Detalle por modelo</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 font-medium">Modelo</th>
                <th className="pb-2 font-medium text-right">Mensajes</th>
                <th className="pb-2 font-medium text-right">Costo total</th>
                <th className="pb-2 font-medium text-right">Costo/msg</th>
              </tr>
            </thead>
            <tbody>
              {modelCosts.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-gray-400">
                    Sin datos de uso de LLM
                  </td>
                </tr>
              )}
              {modelCosts.map((m) => (
                <tr key={m.model_used} className="border-b last:border-0">
                  <td className="py-2 flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full inline-block"
                      style={{ backgroundColor: getColor(m.model_used) }}
                    />
                    {getLabel(m.model_used)}
                  </td>
                  <td className="py-2 text-right">{m.count.toLocaleString()}</td>
                  <td className="py-2 text-right font-mono">${m.total_cost.toFixed(4)}</td>
                  <td className="py-2 text-right font-mono text-gray-500">
                    ${m.count > 0 ? (m.total_cost / m.count).toFixed(6) : '0.000000'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
