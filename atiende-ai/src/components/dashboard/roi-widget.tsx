'use client';
import { TrendingUp, MessageSquare, Clock, DollarSign, Zap } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

function fmt(n: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(n);
}

interface ROIData {
  messagesSaved: number;
  hoursSaved: number;
  totalSavingsMXN: number;
  roiPercent: number;
  monthlyCostMXN: number;
}

export function ROIWidget({ roi }: { roi: ROIData }) {
  return (
    <Card className="border-zinc-200/60 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-zinc-900 text-base">
          <TrendingUp className="w-4 h-4 text-zinc-400" />
          Retorno de inversion
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="text-center">
            <MessageSquare className="w-4 h-4 text-zinc-300 mx-auto mb-1.5" />
            <p className="text-2xl font-bold text-zinc-900 tabular-nums">
              {roi.messagesSaved.toLocaleString()}
            </p>
            <p className="text-[11px] text-zinc-400 uppercase tracking-wider mt-0.5">
              Msgs contestados
            </p>
          </div>
          <div className="text-center">
            <Clock className="w-4 h-4 text-zinc-300 mx-auto mb-1.5" />
            <p className="text-2xl font-bold text-zinc-900 tabular-nums">
              {roi.hoursSaved}h
            </p>
            <p className="text-[11px] text-zinc-400 uppercase tracking-wider mt-0.5">
              Horas ahorradas
            </p>
          </div>
          <div className="text-center">
            <DollarSign className="w-4 h-4 text-zinc-300 mx-auto mb-1.5" />
            <p className="text-2xl font-bold text-zinc-900 tabular-nums">
              {fmt(roi.totalSavingsMXN)}
            </p>
            <p className="text-[11px] text-zinc-400 uppercase tracking-wider mt-0.5">
              Ahorro estimado
            </p>
          </div>
          <div className="text-center">
            <Zap className="w-4 h-4 text-zinc-300 mx-auto mb-1.5" />
            <p
              className={`text-2xl font-bold tabular-nums ${
                roi.roiPercent > 100 ? 'text-emerald-600' : 'text-zinc-900'
              }`}
            >
              {roi.roiPercent}%
            </p>
            <p className="text-[11px] text-zinc-400 uppercase tracking-wider mt-0.5">
              ROI
            </p>
          </div>
        </div>
      </CardContent>
      <CardFooter className="text-sm text-zinc-500 border-t border-zinc-100 pt-3">
        Inversion: {fmt(roi.monthlyCostMXN)}/mes — Ahorro:{' '}
        {fmt(roi.totalSavingsMXN)}/mes
      </CardFooter>
    </Card>
  );
}
