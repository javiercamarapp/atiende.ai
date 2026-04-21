'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Clock, User } from 'lucide-react';
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

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const CATEGORIES = [
  { key: 'scheduled', label: 'Programadas', color: 'hsl(235 84% 55%)', bg: 'bg-[hsl(235_84%_92%)]', text: 'text-[hsl(235_84%_45%)]' },
  { key: 'confirmed', label: 'Confirmadas', color: 'hsl(235 70% 72%)', bg: 'bg-[hsl(235_60%_88%)]', text: 'text-[hsl(235_60%_35%)]' },
  { key: 'completed', label: 'Completadas', color: 'hsl(158 64% 52%)', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  { key: 'cancelled', label: 'Canceladas', color: 'hsl(349 89% 60%)', bg: 'bg-rose-50', text: 'text-rose-700' },
  { key: 'no_show', label: 'No se presentó', color: 'hsl(38 92% 50%)', bg: 'bg-amber-50', text: 'text-amber-700' },
  { key: 'ongoing', label: 'En curso', color: 'hsl(271 76% 53%)', bg: 'bg-violet-50', text: 'text-violet-700' },
];

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function fmtFullDate(d: Date): string {
  return d.toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
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
  const [selected, setSelected] = useState<Date>(new Date());
  const today = new Date();

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const cells = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const offset = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();
    const arr: { date: Date; current: boolean }[] = [];
    for (let i = offset - 1; i >= 0; i--) {
      arr.push({ date: new Date(year, month - 1, prevMonthDays - i), current: false });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      arr.push({ date: new Date(year, month, i), current: true });
    }
    while (arr.length < 42) {
      const nextDay = arr.length - (offset + daysInMonth) + 1;
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

  const selectedEvents = useMemo(() => {
    const key = `${selected.getFullYear()}-${selected.getMonth()}-${selected.getDate()}`;
    return (eventsByDay.get(key) || []).sort(
      (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime(),
    );
  }, [selected, eventsByDay]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of events) {
      counts.set(e.status, (counts.get(e.status) || 0) + 1);
    }
    return counts;
  }, [events]);

  function goPrev() {
    setCursor(new Date(year, month - 1, 1));
  }
  function goNext() {
    setCursor(new Date(year, month + 1, 1));
  }
  function goToday() {
    const t = new Date();
    setCursor(new Date(t.getFullYear(), t.getMonth(), 1));
    setSelected(t);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between animate-element">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-400">Panel</p>
          <h1 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight text-zinc-900">
            Calendario
          </h1>
          <p className="mt-1.5 text-sm text-zinc-500">
            {events.length} eventos en {MONTHS[month]} {year}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={goToday}
            className="px-3 py-2 rounded-xl bg-white border border-zinc-200 text-xs font-medium text-zinc-700 hover:border-zinc-300 transition"
          >
            Hoy
          </button>
          <div className="flex items-center rounded-xl bg-white border border-zinc-200">
            <button
              onClick={goPrev}
              className="px-2 py-2 text-zinc-500 hover:text-zinc-900 transition"
              aria-label="Mes anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 text-xs font-medium text-zinc-900 tabular-nums min-w-[140px] text-center">
              {MONTHS[month]} {year}
            </span>
            <button
              onClick={goNext}
              className="px-2 py-2 text-zinc-500 hover:text-zinc-900 transition"
              aria-label="Mes siguiente"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <button className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[hsl(var(--brand-blue))] text-white text-xs font-medium hover:opacity-90 transition">
            <Plus className="w-3.5 h-3.5" />
            Evento
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-3 glass-card overflow-hidden animate-element animate-delay-100">
          <div className="grid grid-cols-7 border-b border-zinc-100">
            {DAYS.map((d) => (
              <div
                key={d}
                className="px-3 py-3 text-[10px] uppercase tracking-wider text-zinc-400 font-medium"
              >
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 grid-rows-6 h-[640px]">
            {cells.map((c, i) => {
              const key = `${c.date.getFullYear()}-${c.date.getMonth()}-${c.date.getDate()}`;
              const dayEvents = eventsByDay.get(key) || [];
              const isToday = sameDay(c.date, today);
              const isSelected = sameDay(c.date, selected);
              return (
                <button
                  key={i}
                  onClick={() => setSelected(c.date)}
                  className={cn(
                    'text-left p-2 border-r border-b border-zinc-100 last:border-r-0 transition overflow-hidden flex flex-col gap-1',
                    (i + 1) % 7 === 0 && 'border-r-0',
                    i >= 35 && 'border-b-0',
                    !c.current && 'bg-zinc-50/40',
                    isSelected && 'bg-[hsl(var(--brand-blue-soft))]',
                    !isSelected && c.current && 'hover:bg-zinc-50',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        'text-xs tabular-nums inline-flex items-center justify-center w-6 h-6 rounded-full',
                        !c.current && 'text-zinc-300',
                        c.current && !isToday && 'text-zinc-700',
                        isToday && 'bg-[hsl(var(--brand-blue))] text-white font-semibold',
                      )}
                    >
                      {c.date.getDate()}
                    </span>
                    {dayEvents.length > 0 && (
                      <span className="text-[10px] text-zinc-400 tabular-nums">
                        {dayEvents.length}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 space-y-0.5 overflow-hidden">
                    {dayEvents.slice(0, 3).map((e) => {
                      const cat = CATEGORIES.find((c) => c.key === e.status) || CATEGORIES[0];
                      return (
                        <div
                          key={e.id}
                          className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded-md truncate',
                            cat.bg,
                            cat.text,
                          )}
                        >
                          <span className="tabular-nums font-medium">{fmtTime(e.datetime)}</span>{' '}
                          {e.customer_name || e.serviceName}
                        </div>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <p className="text-[10px] text-zinc-400 px-1.5">
                        +{dayEvents.length - 3} más
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="glass-card p-5 animate-element animate-delay-200">
            <h3 className="text-sm font-semibold text-zinc-900 mb-4">Categorías</h3>
            <ul className="space-y-2.5">
              {CATEGORIES.map((cat) => (
                <li key={cat.key} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: cat.color }}
                    />
                    <span className="text-zinc-700">{cat.label}</span>
                  </span>
                  <span className="text-xs text-zinc-500 tabular-nums">
                    {categoryCounts.get(cat.key) || 0}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="glass-card p-5 animate-element animate-delay-300">
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">
                Agenda
              </p>
              <h3 className="text-sm font-semibold text-zinc-900 capitalize mt-0.5">
                {fmtFullDate(selected)}
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                {selectedEvents.length === 0
                  ? 'Sin eventos programados'
                  : `${selectedEvents.length} evento${selectedEvents.length === 1 ? '' : 's'}`}
              </p>
            </div>

            {selectedEvents.length === 0 ? (
              <div className="rounded-xl bg-zinc-50 p-6 text-center">
                <p className="text-xs text-zinc-500">Día libre.</p>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {selectedEvents.map((e) => {
                  const cat = CATEGORIES.find((c) => c.key === e.status) || CATEGORIES[0];
                  return (
                    <li
                      key={e.id}
                      className="relative rounded-xl bg-white border border-zinc-100 p-3 hover:border-zinc-200 transition"
                    >
                      <span
                        className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full"
                        style={{ background: cat.color }}
                      />
                      <div className="pl-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-zinc-900 truncate">
                            {e.serviceName}
                          </p>
                          <span
                            className={cn(
                              'text-[10px] font-medium rounded-full px-2 py-0.5 shrink-0',
                              cat.bg,
                              cat.text,
                            )}
                          >
                            {cat.label}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-zinc-500">
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Clock className="w-3 h-3" />
                            {fmtTime(e.datetime)}
                            {e.end_datetime && ` – ${fmtTime(e.end_datetime)}`}
                          </span>
                          <span className="inline-flex items-center gap-1 truncate">
                            <User className="w-3 h-3" />
                            {e.customer_name || e.customer_phone}
                          </span>
                        </div>
                        {e.staffName && (
                          <p className="text-[11px] text-zinc-400 mt-1">Con {e.staffName}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
