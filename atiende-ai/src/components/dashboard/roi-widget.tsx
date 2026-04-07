'use client';
import { TrendingUp, MessageSquare, Clock, DollarSign, Zap } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

function fmt(n:number) {
  return new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',maximumFractionDigits:0}).format(n);
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
    <Card className="bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-emerald-800">
          <TrendingUp className="w-5 h-5" />Tu retorno de inversión este mes
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <MessageSquare className="w-4 h-4 text-emerald-600 mx-auto mb-1" />
            <p className="text-xl font-bold">{roi.messagesSaved.toLocaleString()}</p>
            <p className="text-xs text-gray-500">Msgs contestados</p>
          </div>
          <div className="text-center">
            <Clock className="w-4 h-4 text-teal-600 mx-auto mb-1" />
            <p className="text-xl font-bold">{roi.hoursSaved}h</p>
            <p className="text-xs text-gray-500">Horas ahorradas</p>
          </div>
          <div className="text-center">
            <DollarSign className="w-4 h-4 text-emerald-600 mx-auto mb-1" />
            <p className="text-xl font-bold">{fmt(roi.totalSavingsMXN)}</p>
            <p className="text-xs text-gray-500">Ahorro estimado</p>
          </div>
          <div className="text-center">
            <Zap className="w-4 h-4 text-amber-600 mx-auto mb-1" />
            <p className={`text-xl font-bold ${roi.roiPercent>100?'text-emerald-600':'text-gray-800'}`}>{roi.roiPercent}%</p>
            <p className="text-xs text-gray-500">ROI</p>
          </div>
        </div>
      </CardContent>
      <CardFooter className="text-sm text-emerald-700 border-t border-emerald-200 pt-3">
        Inversión: {fmt(roi.monthlyCostMXN)}/mes — Ahorro: {fmt(roi.totalSavingsMXN)}/mes
      </CardFooter>
    </Card>
  );
}
