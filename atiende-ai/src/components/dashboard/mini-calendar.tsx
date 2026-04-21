'use client';

import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export function MiniCalendar({
  highlightedDates = [],
}: {
  highlightedDates?: string[];
}) {
  const [cursor, setCursor] = useState(new Date());
  const today = new Date();
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const highlights = new Set(highlightedDates);

  const cells: { day: number; current: boolean; isoDate: string }[] = [];
  for (let i = firstDay - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    const d = new Date(year, month - 1, day);
    cells.push({ day, current: false, isoDate: d.toISOString().slice(0, 10) });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(year, month, i);
    cells.push({ day: i, current: true, isoDate: d.toISOString().slice(0, 10) });
  }
  while (cells.length < 42) {
    const nextDay = cells.length - (firstDay + daysInMonth) + 1;
    const d = new Date(year, month + 1, nextDay);
    cells.push({ day: nextDay, current: false, isoDate: d.toISOString().slice(0, 10) });
  }

  const goPrev = () => setCursor(new Date(year, month - 1, 1));
  const goNext = () => setCursor(new Date(year, month + 1, 1));

  const isToday = (iso: string) => iso === today.toISOString().slice(0, 10);

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-zinc-900">
          {MONTHS[month]} {year}
        </p>
        <div className="flex flex-col">
          <button
            onClick={goPrev}
            className="text-zinc-400 hover:text-zinc-900 transition leading-none"
            aria-label="Mes anterior"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={goNext}
            className="text-zinc-400 hover:text-zinc-900 transition leading-none"
            aria-label="Mes siguiente"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {DAYS.map((d) => (
          <div key={d} className="text-[10px] font-medium text-zinc-400 uppercase py-1">
            {d}
          </div>
        ))}
        {cells.map((c, i) => {
          const highlighted = highlights.has(c.isoDate);
          const todayCell = isToday(c.isoDate) && c.current;
          return (
            <div
              key={i}
              className={cn(
                'text-xs tabular-nums rounded-full h-8 w-8 mx-auto flex items-center justify-center transition',
                !c.current && 'text-zinc-300',
                c.current && !todayCell && !highlighted && 'text-zinc-700 hover:bg-zinc-100',
                todayCell && 'bg-[hsl(var(--brand-blue))] text-white font-semibold',
                highlighted && !todayCell && 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] font-medium',
              )}
            >
              {c.day}
            </div>
          );
        })}
      </div>
    </div>
  );
}
