'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Clock, MapPin, Users, X, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CalendarEvent {
  id: string;
  datetime: string;
  end_datetime: string | null;
  status: string;
  customer_name: string | null;
  customer_phone: string;
  notes: string | null;
  staffName: string;
  serviceName: string;
}

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const EVENT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  scheduled: { bg: 'bg-[hsl(235_84%_92%)]', text: 'text-[hsl(235_84%_40%)]', border: 'border-[hsl(235_84%_85%)]' },
  confirmed: { bg: 'bg-[hsl(235_60%_88%)]', text: 'text-[hsl(235_60%_35%)]', border: 'border-[hsl(235_60%_80%)]' },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  cancelled: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  no_show: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  ongoing: { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200' },
};

const CATEGORY_LIST = [
  { key: 'scheduled', label: 'Programadas' },
  { key: 'confirmed', label: 'Confirmadas' },
  { key: 'completed', label: 'Completadas' },
  { key: 'cancelled', label: 'Canceladas' },
];

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtFullDate(d: Date): string {
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function CalendarView({
  events,
  initialYear,
  initialMonth,
}: {
  events: CalendarEvent[];
  initialYear: number;
  initialMonth: number;
}) {
  const [cursor, setCursor] = useState(new Date(initialYear, initialMonth, 1));
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const today = new Date();

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const cells = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();
    const arr: { date: Date; current: boolean }[] = [];
    for (let i = firstDay - 1; i >= 0; i--) arr.push({ date: new Date(year, month - 1, prevMonthDays - i), current: false });
    for (let i = 1; i <= daysInMonth; i++) arr.push({ date: new Date(year, month, i), current: true });
    while (arr.length < 42) {
      const nextDay = arr.length - (firstDay + daysInMonth) + 1;
      arr.push({ date: new Date(year, month + 1, nextDay), current: false });
    }
    return arr;
  }, [year, month]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const d = new Date(e.datetime);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(key) || [];
      arr.push(e);
      map.set(key, arr);
    }
    return map;
  }, [events]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of events) counts.set(e.status, (counts.get(e.status) || 0) + 1);
    return counts;
  }, [events]);

  return (
    <div className="space-y-6">
      <header className="animate-element">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Calendario</h1>
      </header>

      <div className="glass-card overflow-hidden animate-element animate-delay-100">
        {/* Header bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-6 py-4 gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-zinc-900">
              {MONTHS[month]} {year}
            </h2>
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowFilter(!showFilter)} className="p-2 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition">
              <Filter className="w-4 h-4" />
            </button>
            <div className="flex items-center rounded-full bg-zinc-100 p-0.5">
              <button className="px-3 py-1.5 rounded-full text-xs font-medium bg-[hsl(var(--brand-blue))] text-white">Mes</button>
              <button className="px-3 py-1.5 rounded-full text-xs font-medium text-zinc-600 hover:text-zinc-900 transition">Semana</button>
              <button className="px-3 py-1.5 rounded-full text-xs font-medium text-zinc-600 hover:text-zinc-900 transition">Día</button>
            </div>
            <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[hsl(var(--brand-blue))] text-white text-xs font-medium hover:opacity-90 transition">
              <Plus className="w-3.5 h-3.5" />
              Nuevo
            </button>
          </div>
        </div>

        <div className="flex">
          {/* Filter sidebar (collapsible) */}
          {showFilter && (
            <div className="w-64 border-r border-zinc-100 px-5 py-4 shrink-0">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-400">Total agendas</p>
                  <p className="text-2xl font-semibold tabular-nums text-zinc-900">{events.length}</p>
                </div>
                <button onClick={() => setShowFilter(false)} className="text-zinc-400 hover:text-zinc-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ul className="space-y-3">
                {CATEGORY_LIST.map((cat) => {
                  const colors = EVENT_COLORS[cat.key] || EVENT_COLORS.scheduled;
                  return (
                    <li key={cat.key} className="flex items-center gap-2.5">
                      <span className={cn('w-1 h-6 rounded-full', colors.bg)} />
                      <div>
                        <p className="text-xs font-medium text-zinc-900">{cat.label}</p>
                        <p className="text-[10px] text-zinc-500">{categoryCounts.get(cat.key) || 0} eventos</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Calendar grid */}
          <div className="flex-1 min-w-0">
            {/* Navigation arrows */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-100">
              <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="p-1 text-zinc-400 hover:text-zinc-900 transition">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="p-1 text-zinc-400 hover:text-zinc-900 transition">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-zinc-100">
              {DAYS.map((d) => (
                <div key={d} className="px-2 py-2.5 text-[10px] uppercase tracking-wider text-zinc-400 font-medium text-center">
                  {d}
                </div>
              ))}
            </div>
            {/* Cells */}
            <div className="grid grid-cols-7 grid-rows-6">
              {cells.map((c, i) => {
                const key = `${c.date.getFullYear()}-${c.date.getMonth()}-${c.date.getDate()}`;
                const dayEvents = eventsByDay.get(key) || [];
                const isToday = sameDay(c.date, today);
                return (
                  <div
                    key={i}
                    className={cn(
                      'min-h-[90px] sm:min-h-[110px] p-1.5 border-r border-b border-zinc-100 overflow-hidden',
                      (i + 1) % 7 === 0 && 'border-r-0',
                      i >= 35 && 'border-b-0',
                      !c.current && 'bg-zinc-50/40',
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={cn(
                        'text-xs tabular-nums inline-flex items-center justify-center w-6 h-6 rounded-full',
                        !c.current && 'text-zinc-300',
                        c.current && !isToday && 'text-zinc-600',
                        isToday && 'bg-[hsl(var(--brand-blue))] text-white font-semibold',
                      )}>
                        {c.date.getDate()}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {dayEvents.slice(0, 2).map((e) => {
                        const colors = EVENT_COLORS[e.status] || EVENT_COLORS.scheduled;
                        return (
                          <button
                            key={e.id}
                            onClick={() => setSelected(e)}
                            className={cn(
                              'w-full text-left text-[9px] sm:text-[10px] leading-snug px-1.5 py-1 rounded-md truncate',
                              colors.bg, colors.text,
                            )}
                          >
                            <span className="font-medium tabular-nums">{e.customer_name || e.serviceName}</span>
                            <br />
                            <span className="opacity-70 tabular-nums">{fmtTime(e.datetime)}</span>
                          </button>
                        );
                      })}
                      {dayEvents.length > 2 && (
                        <p className="text-[9px] text-zinc-400 px-1">+{dayEvents.length - 2} más</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Schedule Details sidebar */}
          {selected && (
            <div className="hidden lg:block w-72 border-l border-zinc-100 px-5 py-4 shrink-0">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-zinc-900">Detalles</h3>
                <button onClick={() => setSelected(null)} className="text-zinc-400 hover:text-zinc-600">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {(() => {
                const colors = EVENT_COLORS[selected.status] || EVENT_COLORS.scheduled;
                const d = new Date(selected.datetime);
                return (
                  <div className={cn('rounded-xl p-4 border', colors.bg, colors.border)}>
                    <h4 className={cn('text-sm font-semibold', colors.text)}>
                      {selected.serviceName}
                    </h4>
                    <div className={cn('mt-3 space-y-2 text-[11px]', colors.text)}>
                      <p className="flex items-center gap-2 opacity-80">
                        <span>📅</span> {fmtFullDate(d)}
                      </p>
                      <p className="flex items-center gap-2 opacity-80">
                        <Clock className="w-3 h-3" />
                        {fmtTime(selected.datetime)}
                        {selected.end_datetime && ` – ${fmtTime(selected.end_datetime)}`}
                      </p>
                      <p className="flex items-center gap-2 opacity-80">
                        <Users className="w-3 h-3" />
                        {selected.customer_name || selected.customer_phone}
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-current/10">
                      <p className="text-[10px] uppercase tracking-wider font-medium opacity-60">Equipo</p>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="w-7 h-7 rounded-full bg-white/50 flex items-center justify-center text-[10px] font-semibold">
                          {selected.staffName.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2)}
                        </div>
                        <div>
                          <p className="text-xs font-medium">{selected.staffName}</p>
                        </div>
                      </div>
                    </div>
                    {selected.notes && (
                      <div className="mt-3 pt-3 border-t border-current/10">
                        <p className="text-[10px] uppercase tracking-wider font-medium opacity-60">Nota</p>
                        <p className="text-xs mt-1 opacity-80 leading-relaxed">{selected.notes}</p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
