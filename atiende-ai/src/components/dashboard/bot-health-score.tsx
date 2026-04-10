'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Brain, BookOpen, Zap, Clock, CheckCircle } from 'lucide-react';

interface BotHealthProps {
  score: number;
  breakdown: { knowledge: number; intents: number; responseTime: number; resolution: number };
}

export function BotHealthScore({ score, breakdown }: BotHealthProps) {
  const color = score >= 80 ? 'text-emerald-600' : score >= 50 ? 'text-zinc-500' : 'text-red-500';
  const bg = score >= 80 ? 'bg-zinc-50' : score >= 50 ? 'bg-zinc-50' : 'bg-red-50';
  const label = score >= 80 ? 'Excelente' : score >= 50 ? 'En progreso' : 'Necesita atención';

  const items = [
    { icon: BookOpen, label: 'Knowledge Base', value: breakdown.knowledge, max: 25 },
    { icon: Brain, label: 'Intents cubiertos', value: breakdown.intents, max: 25 },
    { icon: Clock, label: 'Tiempo de respuesta', value: breakdown.responseTime, max: 25 },
    { icon: CheckCircle, label: 'Resolución AI', value: breakdown.resolution, max: 25 },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Brain className="w-5 h-5" /> Salud del Bot</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`${bg} rounded-xl p-6 text-center mb-4`}>
          <p className={`text-5xl font-bold ${color}`}>{score}%</p>
          <p className={`text-sm font-medium ${color} mt-1`}>{label}</p>
        </div>
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <item.icon className="w-4 h-4 text-zinc-400" />
              <span className="text-sm text-zinc-600 flex-1">{item.label}</span>
              <div className="w-24 h-2 bg-zinc-100 rounded-full overflow-hidden">
                <div className="h-full bg-zinc-900 rounded-full transition-all" style={{ width: `${(item.value / item.max) * 100}%` }} />
              </div>
              <span className="text-xs text-zinc-500 w-10 text-right">{item.value}/{item.max}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
