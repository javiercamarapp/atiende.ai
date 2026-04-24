'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Search, Plus, Lock, X, Clock, User, CalendarDays, SlidersHorizontal, XCircle, Loader2, MessageSquare, Check, CalendarClock, CheckCircle2, UserX, AlertTriangle, Edit3, CalendarX, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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
  source?: 'local' | 'google';
}

interface ServiceOption {
  id: string;
  name: string;
  category: string | null;
}

const WEEK_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const START_HOUR = 7;
const END_HOUR = 21;
const SLOT_MINUTES = 30;
const SLOT_HEIGHT = 28;

const STATUS_STYLES: Record<string, { block: string; strip: string; text: string }> = {
  scheduled: { block: 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100', strip: 'bg-emerald-400', text: 'text-emerald-900' },
  confirmed: { block: 'bg-sky-50 border-sky-200 hover:bg-sky-100', strip: 'bg-sky-400', text: 'text-sky-900' },
  completed: { block: 'bg-zinc-50 border-zinc-200 hover:bg-zinc-100', strip: 'bg-zinc-400', text: 'text-zinc-700' },
  cancelled: { block: 'bg-rose-50 border-rose-200 hover:bg-rose-100', strip: 'bg-rose-400', text: 'text-rose-900' },
  no_show: { block: 'bg-amber-50 border-amber-200 hover:bg-amber-100', strip: 'bg-amber-400', text: 'text-amber-900' },
  ongoing: { block: 'bg-violet-50 border-violet-200 hover:bg-violet-100', strip: 'bg-violet-400', text: 'text-violet-900' },
};

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtTimeLabel(h: number, m: number) { return `${pad(h)}:${pad(m)}`; }

function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

type View = 'semana' | 'dia' | 'agenda' | 'lista';

export function CalendarView({
  events,
  services,
  initialYear,
  initialMonth,
}: {
  events: CalendarEvent[];
  services: ServiceOption[];
  initialYear: number;
  initialMonth: number;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => startOfWeek(new Date(initialYear, initialMonth, today.getDate())));
  const [miniCursor, setMiniCursor] = useState(new Date(initialYear, initialMonth, 1));
  const [view, setView] = useState<View>(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) return 'agenda';
    return 'semana';
  });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [serviceFilter, setServiceFilter] = useState<Set<string>>(new Set());
  const [servicesOpen, setServicesOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [newApptOpen, setNewApptOpen] = useState(false);
  const [newAppt, setNewAppt] = useState({ customer: '', phone: '', service: '', date: '', time: '', notes: '', repeat_weeks: 1 });
  const [savingAppt, setSavingAppt] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [rescheduleNotify, setRescheduleNotify] = useState(true);
  const [rescheduling, setRescheduling] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Array<{ source: 'local' | 'google'; id: string; title: string; start: string; end: string; staffName: string | null }>>([]);
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [slotSuggestions, setSlotSuggestions] = useState<Array<{ start: string; end: string }>>([]);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ customer_name: '', customer_phone: '', service_name: '', duration_minutes: 30, notes: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  // Block time dialog
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockStart, setBlockStart] = useState({ date: '', time: '' });
  const [blockEnd, setBlockEnd] = useState({ date: '', time: '' });
  const [blockLabel, setBlockLabel] = useState('');
  const [blocking, setBlocking] = useState(false);

  // Bulk cancel dialog
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [bulkCancelDate, setBulkCancelDate] = useState('');
  const [bulkCancelReason, setBulkCancelReason] = useState('');
  const [bulkCancelNotify, setBulkCancelNotify] = useState(true);
  const [bulkCancelling, setBulkCancelling] = useState(false);

  async function handleEditAppt() {
    if (!selected || savingEdit) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/appointments/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: editForm.customer_name,
          customer_phone: editForm.customer_phone,
          service_name: editForm.service_name || undefined,
          duration_minutes: editForm.duration_minutes,
          notes: editForm.notes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || 'No se pudo guardar');
        return;
      }
      toast.success('Cita actualizada');
      setEditOpen(false);
      setSelected(null);
      window.location.reload();
    } catch {
      toast.error('Error de red');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleBlockTime() {
    if (!blockStart.date || !blockStart.time || !blockEnd.date || !blockEnd.time || blocking) return;
    setBlocking(true);
    try {
      const startIso = `${blockStart.date}T${blockStart.time}:00`;
      const endIso = `${blockEnd.date}T${blockEnd.time}:00`;
      if (new Date(endIso) <= new Date(startIso)) {
        toast.error('La hora final debe ser posterior a la inicial');
        return;
      }
      const res = await fetch('/api/calendar/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: startIso, end: endIso, label: blockLabel.trim() || 'Bloqueo' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || 'No se pudo bloquear');
        return;
      }
      toast.success('Horario bloqueado en Google Calendar');
      setBlockOpen(false);
      setBlockLabel('');
      setBlockStart({ date: '', time: '' });
      setBlockEnd({ date: '', time: '' });
      window.location.reload();
    } catch {
      toast.error('Error de red');
    } finally {
      setBlocking(false);
    }
  }

  async function handleBulkCancelDay() {
    if (!bulkCancelDate || bulkCancelling) return;
    setBulkCancelling(true);
    try {
      const res = await fetch('/api/appointments/cancel-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: bulkCancelDate,
          reason: bulkCancelReason.trim() || undefined,
          notify_customers: bulkCancelNotify,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || 'No se pudo cancelar el día');
        return;
      }
      if (data.cancelled === 0) {
        toast('Ese día no tenía citas agendadas', { icon: 'ℹ️' });
      } else {
        toast.success(`${data.cancelled} citas canceladas · ${data.notified} pacientes notificados`);
      }
      setBulkCancelOpen(false);
      setBulkCancelReason('');
      window.location.reload();
    } catch {
      toast.error('Error de red');
    } finally {
      setBulkCancelling(false);
    }
  }

  async function handleUpdateStatus(nextStatus: 'confirmed' | 'completed' | 'no_show') {
    if (!selected || statusUpdating) return;
    setStatusUpdating(nextStatus);
    try {
      const res = await fetch(`/api/appointments/${selected.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || 'No se pudo actualizar el estado');
        return;
      }
      const labels: Record<string, string> = {
        confirmed: 'Cita confirmada',
        completed: 'Marcada como asistida',
        no_show: 'Marcada como no asistida',
      };
      toast.success(labels[nextStatus] || 'Estado actualizado');
      setSelected({ ...selected, status: nextStatus });
      setTimeout(() => window.location.reload(), 300);
    } catch {
      toast.error('Error de red');
    } finally {
      setStatusUpdating(null);
    }
  }

  // Check for conflicts when the reschedule date/time changes
  useEffect(() => {
    if (!rescheduleOpen || !selected || !rescheduleDate || !rescheduleTime) {
      setConflicts([]);
      return;
    }
    const newIso = `${rescheduleDate}T${rescheduleTime}:00`;
    const startDt = new Date(newIso);
    if (isNaN(startDt.getTime())) return;
    const duration = 30;
    const endDt = new Date(startDt.getTime() + duration * 60000);

    let cancelled = false;
    setCheckingConflicts(true);
    (async () => {
      try {
        const res = await fetch('/api/appointments/check-conflicts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            start: startDt.toISOString(),
            end: endDt.toISOString(),
            exclude_appointment_id: selected.id,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          const list = Array.isArray(data?.conflicts) ? data.conflicts : [];
          setConflicts(list);
          // If conflicts found, ask backend for nearest open slots
          if (list.length > 0) {
            try {
              const suggRes = await fetch('/api/appointments/suggest-slots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  target: startDt.toISOString(),
                  duration_minutes: duration,
                  exclude_appointment_id: selected.id,
                  count: 5,
                  window_hours: 72,
                }),
              });
              const suggData = await suggRes.json().catch(() => ({}));
              if (!cancelled) {
                setSlotSuggestions(Array.isArray(suggData?.suggestions) ? suggData.suggestions : []);
              }
            } catch {
              if (!cancelled) setSlotSuggestions([]);
            }
          } else {
            setSlotSuggestions([]);
          }
        }
      } catch {
        if (!cancelled) {
          setConflicts([]);
          setSlotSuggestions([]);
        }
      } finally {
        if (!cancelled) setCheckingConflicts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rescheduleOpen, rescheduleDate, rescheduleTime, selected]);

  async function handleRescheduleAppt() {
    if (!selected || !rescheduleDate || !rescheduleTime || rescheduling) return;
    const newIso = `${rescheduleDate}T${rescheduleTime}:00`;
    setRescheduling(true);
    try {
      const res = await fetch(`/api/appointments/${selected.id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          new_datetime: newIso,
          reason: rescheduleReason.trim() || undefined,
          notify_customer: rescheduleNotify,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || 'No se pudo reagendar la cita');
        return;
      }
      if (rescheduleNotify && data?.customerNotified === false) {
        toast.success('Cita reagendada — no pudimos avisar al paciente por WhatsApp');
      } else if (rescheduleNotify) {
        toast.success('Cita reagendada y paciente notificado');
      } else {
        toast.success('Cita reagendada');
      }
      setRescheduleOpen(false);
      setSelected(null);
      setRescheduleReason('');
      window.location.reload();
    } catch (err) {
      toast.error('Error de red al reagendar');
      console.error(err);
    } finally {
      setRescheduling(false);
    }
  }

  async function handleCancelAppt() {
    if (!selected || cancelling) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/appointments/${selected.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: cancelReason.trim() || undefined,
          notify_customer: notifyCustomer,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || 'No se pudo cancelar la cita');
        return;
      }
      if (notifyCustomer && data?.customerNotified === false) {
        toast.success('Cita cancelada — no pudimos avisar al paciente por WhatsApp');
      } else if (notifyCustomer) {
        toast.success('Cita cancelada y paciente notificado');
      } else {
        toast.success('Cita cancelada');
      }
      setCancelOpen(false);
      setSelected(null);
      setCancelReason('');
      // Hard reload to re-fetch merged Google + local events
      window.location.reload();
    } catch (err) {
      toast.error('Error de red al cancelar');
      console.error(err);
    } finally {
      setCancelling(false);
    }
  }

  async function handleCreateAppt(e: React.FormEvent) {
    e.preventDefault();
    if (!newAppt.customer.trim() || !newAppt.date || !newAppt.time || savingAppt) return;
    setSavingAppt(true);
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: newAppt.customer,
          customer_phone: newAppt.phone,
          service_name: newAppt.service,
          datetime: `${newAppt.date}T${newAppt.time}:00`,
          notes: newAppt.notes || null,
          repeat_weeks: newAppt.repeat_weeks,
        }),
      });
      if (!res.ok) throw new Error('Error al crear cita');
      setNewApptOpen(false);
      setNewAppt({ customer: '', phone: '', service: '', date: '', time: '', notes: '', repeat_weeks: 1 });
      window.location.reload();
    } catch {
      // stay open on error
    } finally {
      setSavingAppt(false);
    }
  }

  const weekStart = cursor;
  const weekEnd = addDays(weekStart, 6);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (serviceFilter.size > 0 && !serviceFilter.has(e.serviceName)) return false;
      if (!q) return true;
      return (
        e.customer_name?.toLowerCase().includes(q) ||
        e.customer_phone.toLowerCase().includes(q) ||
        e.serviceName.toLowerCase().includes(q) ||
        e.staffName.toLowerCase().includes(q)
      );
    });
  }, [events, search, serviceFilter]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of filteredEvents) {
      const d = new Date(e.datetime);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(key) || [];
      arr.push(e);
      map.set(key, arr);
    }
    return map;
  }, [filteredEvents]);

  const todaysAppointments = useMemo(
    () => filteredEvents.filter((e) => sameDay(new Date(e.datetime), today)).sort((a, b) => a.datetime.localeCompare(b.datetime)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredEvents],
  );

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const miniCells = useMemo(() => {
    const y = miniCursor.getFullYear();
    const m = miniCursor.getMonth();
    const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const prevDays = new Date(y, m, 0).getDate();
    const arr: { date: Date; current: boolean }[] = [];
    for (let i = firstDow - 1; i >= 0; i--) arr.push({ date: new Date(y, m - 1, prevDays - i), current: false });
    for (let i = 1; i <= daysInMonth; i++) arr.push({ date: new Date(y, m, i), current: true });
    while (arr.length < 42) {
      const d = arr.length - (firstDow + daysInMonth) + 1;
      arr.push({ date: new Date(y, m + 1, d), current: false });
    }
    return arr;
  }, [miniCursor]);

  const timeSlots = useMemo(() => {
    const slots: { h: number; m: number }[] = [];
    for (let h = START_HOUR; h < END_HOUR; h++) {
      slots.push({ h, m: 0 });
      slots.push({ h, m: 30 });
    }
    slots.push({ h: END_HOUR, m: 0 });
    return slots;
  }, []);

  function fmtRange() {
    if (weekStart.getMonth() === weekEnd.getMonth()) {
      return `${weekStart.getDate()} - ${weekEnd.getDate()} ${MONTHS_SHORT[weekStart.getMonth()]}, ${weekStart.getFullYear()}`;
    }
    return `${weekStart.getDate()} ${MONTHS_SHORT[weekStart.getMonth()]} - ${weekEnd.getDate()} ${MONTHS_SHORT[weekEnd.getMonth()]}, ${weekStart.getFullYear()}`;
  }

  function uniqueServiceNames(): string[] {
    const set = new Set<string>();
    for (const s of services) set.add(s.name);
    for (const e of events) if (e.serviceName) set.add(e.serviceName);
    return Array.from(set).sort();
  }

  function toggleService(name: string) {
    setServiceFilter((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function eventPosition(e: CalendarEvent): { top: number; height: number } {
    const start = new Date(e.datetime);
    const end = e.end_datetime ? new Date(e.end_datetime) : new Date(start.getTime() + 30 * 60000);
    const mins = (start.getHours() - START_HOUR) * 60 + start.getMinutes();
    const duration = Math.max(15, (end.getTime() - start.getTime()) / 60000);
    return {
      top: (mins / SLOT_MINUTES) * SLOT_HEIGHT,
      height: Math.max(24, (duration / SLOT_MINUTES) * SLOT_HEIGHT - 2),
    };
  }

  return (
    <div className="bg-white rounded-2xl overflow-hidden animate-element animate-delay-100 h-[calc(100svh-13rem)] md:h-[calc(100vh-9rem)]">
      {/* ─── MOBILE FILTERS SHEET ─── */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="left" className="md:hidden p-0 flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-zinc-100">
            <SheetTitle>Filtros</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 pt-4">
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => setMiniCursor(new Date(miniCursor.getFullYear(), miniCursor.getMonth() - 1, 1))}
                  className="p-1 text-zinc-400 hover:text-zinc-900 transition"
                  aria-label="Mes anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <p className="text-[13px] font-medium text-zinc-900">
                  {MONTHS[miniCursor.getMonth()]} {miniCursor.getFullYear()}
                </p>
                <button
                  onClick={() => setMiniCursor(new Date(miniCursor.getFullYear(), miniCursor.getMonth() + 1, 1))}
                  className="p-1 text-zinc-400 hover:text-zinc-900 transition"
                  aria-label="Mes siguiente"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-y-0.5 text-center">
                {WEEK_SHORT.map((d) => (
                  <div key={d} className="text-[10px] uppercase tracking-wider text-zinc-400 py-1">{d[0]}</div>
                ))}
                {miniCells.map((c, i) => {
                  const inCurrentWeek = c.date >= weekStart && c.date <= weekEnd;
                  const isToday = sameDay(c.date, today);
                  return (
                    <button
                      key={i}
                      onClick={() => { setCursor(startOfWeek(c.date)); setFiltersOpen(false); }}
                      className={cn(
                        'h-7 w-7 mx-auto text-[11px] tabular-nums rounded-full flex items-center justify-center transition',
                        !c.current && 'text-zinc-300',
                        c.current && !isToday && !inCurrentWeek && 'text-zinc-700 hover:bg-zinc-100',
                        inCurrentWeek && !isToday && 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] font-medium',
                        isToday && 'bg-[hsl(var(--brand-blue))] text-white font-semibold',
                      )}
                    >
                      {c.date.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="px-4 pt-5">
              <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium mb-2">Servicios</p>
              <ul className="space-y-1">
                {uniqueServiceNames().length === 0 && (
                  <li className="text-[12px] text-zinc-500">Sin servicios</li>
                )}
                {uniqueServiceNames().map((name) => {
                  const checked = serviceFilter.has(name);
                  return (
                    <li key={name}>
                      <label className="flex items-center gap-2 px-1.5 py-1.5 rounded hover:bg-zinc-50 transition cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleService(name)}
                          className="w-4 h-4 rounded border-zinc-300 text-[hsl(var(--brand-blue))] focus:ring-[hsl(var(--brand-blue-soft))]"
                        />
                        <span className="text-[13px] text-zinc-700 truncate">{name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="px-4 pt-5 pb-6">
              <label className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium mb-2 block">Buscar</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar cita"
                  className="w-full pl-8 pr-3 h-9 text-[13px] rounded-full bg-zinc-50 border border-zinc-200 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
                />
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex h-full">
        {/* ─────────────── LEFT PANEL ─────────────── */}
        <aside className="hidden md:flex w-64 shrink-0 flex-col bg-white">
          {/* Mini calendar */}
          <div className="px-4 pt-4">
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => setMiniCursor(new Date(miniCursor.getFullYear(), miniCursor.getMonth() - 1, 1))}
                className="p-1 text-zinc-400 hover:text-zinc-900 transition"
                aria-label="Mes anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <p className="text-[13px] font-medium text-zinc-900">
                {MONTHS[miniCursor.getMonth()]} {miniCursor.getFullYear()}
              </p>
              <button
                onClick={() => setMiniCursor(new Date(miniCursor.getFullYear(), miniCursor.getMonth() + 1, 1))}
                className="p-1 text-zinc-400 hover:text-zinc-900 transition"
                aria-label="Mes siguiente"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-y-0.5 text-center">
              {WEEK_SHORT.map((d) => (
                <div key={d} className="text-[10px] uppercase tracking-wider text-zinc-400 py-1">{d[0]}</div>
              ))}
              {miniCells.map((c, i) => {
                const inCurrentWeek = c.date >= weekStart && c.date <= weekEnd;
                const isToday = sameDay(c.date, today);
                return (
                  <button
                    key={i}
                    onClick={() => setCursor(startOfWeek(c.date))}
                    className={cn(
                      'h-7 w-7 mx-auto text-[11px] tabular-nums rounded-full flex items-center justify-center transition',
                      !c.current && 'text-zinc-300',
                      c.current && !isToday && !inCurrentWeek && 'text-zinc-700 hover:bg-zinc-100',
                      inCurrentWeek && !isToday && 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] font-medium',
                      isToday && 'bg-[hsl(var(--brand-blue))] text-white font-semibold',
                    )}
                  >
                    {c.date.getDate()}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bloquear fechas */}
          <div className="px-4 pt-4">
            <button className="inline-flex items-center gap-2 text-[12.5px] font-medium text-[hsl(var(--brand-blue))] hover:opacity-80 transition">
              <Lock className="w-3.5 h-3.5" />
              Bloquear fechas
            </button>
          </div>

          {/* Visitas de hoy */}
          <div className="px-4 pt-5">
            <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium mb-2">Visitas de hoy</p>
            {todaysAppointments.length === 0 ? (
              <p className="text-[12px] text-zinc-500">No hay citas para hoy</p>
            ) : (
              <ul className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {todaysAppointments.map((e) => (
                  <li key={e.id}>
                    <button
                      onClick={() => setSelected(e)}
                      className="w-full text-left flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50 transition"
                    >
                      <span className="text-[10.5px] tabular-nums text-zinc-500 mt-0.5 shrink-0">{fmtTime(e.datetime)}</span>
                      <span className="text-[12px] text-zinc-800 truncate">{e.customer_name || e.serviceName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Servicios filter */}
          <div className="px-4 pt-5 pb-4 flex-1 flex flex-col min-h-0">
            <button
              onClick={() => setServicesOpen(!servicesOpen)}
              className="flex items-center justify-between w-full mb-2"
            >
              <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium">Servicios</span>
              <ChevronDown className={cn('w-3.5 h-3.5 text-zinc-400 transition-transform', !servicesOpen && '-rotate-90')} />
            </button>
            {servicesOpen && (
              <ul className="space-y-1 overflow-y-auto pr-1">
                {uniqueServiceNames().length === 0 && (
                  <li className="text-[12px] text-zinc-500">Sin servicios</li>
                )}
                {uniqueServiceNames().map((name) => {
                  const checked = serviceFilter.has(name);
                  return (
                    <li key={name}>
                      <label className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-zinc-50 transition cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleService(name)}
                          className="w-3.5 h-3.5 rounded border-zinc-300 text-[hsl(var(--brand-blue))] focus:ring-[hsl(var(--brand-blue-soft))]"
                        />
                        <span className="text-[12px] text-zinc-700 truncate">{name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* ─────────────── MAIN ─────────────── */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Top bar */}
          <div className="flex items-center justify-between gap-3 px-5 py-3 bg-white">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCursor(startOfWeek(today))}
                className="px-3 py-1.5 text-[12.5px] font-medium text-zinc-700 rounded-full border border-zinc-200 hover:bg-zinc-50 transition"
              >
                Esta semana
              </button>
              <button
                onClick={() => setCursor(addDays(cursor, -7))}
                className="p-1.5 text-zinc-400 hover:text-zinc-900 transition rounded-full hover:bg-zinc-50"
                aria-label="Semana anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setCursor(addDays(cursor, 7))}
                className="p-1.5 text-zinc-400 hover:text-zinc-900 transition rounded-full hover:bg-zinc-50"
                aria-label="Semana siguiente"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <p className="text-[13px] font-medium text-zinc-900 ml-1 tabular-nums">{fmtRange()}</p>
            </div>

            <div className="flex items-center gap-2">
              {/* Filters (mobile) */}
              <button
                onClick={() => setFiltersOpen(true)}
                aria-label="Filtros"
                className="md:hidden p-1.5 rounded-full border border-zinc-200 bg-zinc-50 text-zinc-600 hover:text-zinc-900 transition"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
              {/* Search */}
              <div className="relative hidden lg:block">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar cita"
                  className="w-48 pl-8 pr-3 h-8 text-[12.5px] rounded-full bg-zinc-50 border border-zinc-200 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
                />
              </div>
              {/* View toggle */}
              <div className="flex items-center bg-zinc-50 rounded-full p-0.5 border border-zinc-200">
                {(['lista', 'dia', 'semana', 'agenda'] as View[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={cn(
                      'px-3 py-1 rounded-full text-[12px] font-medium transition capitalize',
                      view === v ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-900',
                      (v === 'lista' || v === 'semana') && 'hidden md:inline-flex',
                    )}
                  >
                    {v === 'lista' ? 'Lista' : v === 'dia' ? 'Día' : v === 'semana' ? 'Semana' : 'Agenda'}
                  </button>
                ))}
              </div>
              {/* Block time */}
              <button
                type="button"
                onClick={() => setBlockOpen(true)}
                aria-label="Bloquear tiempo"
                title="Bloquear tiempo"
                className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white ring-1 ring-zinc-200 text-zinc-600 hover:text-zinc-900 hover:ring-zinc-300 transition"
              >
                <Ban className="w-3.5 h-3.5" />
              </button>
              {/* Bulk cancel day */}
              <button
                type="button"
                onClick={() => {
                  const d = new Date();
                  setBulkCancelDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
                  setBulkCancelReason('');
                  setBulkCancelNotify(true);
                  setBulkCancelOpen(true);
                }}
                aria-label="Cancelar un día"
                title="Cancelar todas las citas de un día"
                className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white ring-1 ring-zinc-200 text-zinc-600 hover:text-rose-700 hover:ring-rose-200 transition"
              >
                <CalendarX className="w-3.5 h-3.5" />
              </button>
              {/* New */}
              <button
                type="button"
                onClick={() => setNewApptOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-[hsl(var(--brand-blue))] text-white text-[12px] font-medium hover:opacity-90 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                Nueva
              </button>
            </div>
          </div>

          {/* Content area */}
          {view === 'semana' && (
            <div className="flex-1 overflow-auto">
              {/* Day headers */}
              <div className="grid sticky top-0 z-20 bg-white" style={{ gridTemplateColumns: '64px repeat(7, minmax(0,1fr))' }}>
                <div />
                {weekDays.map((d, i) => {
                  const isToday = sameDay(d, today);
                  return (
                    <div key={i} className="px-2 py-3 text-center">
                      <p className="text-[10.5px] uppercase tracking-wider text-zinc-400">{WEEK_SHORT[i]}. {d.getDate()}</p>
                      {isToday && (
                        <span className="inline-block mt-1 w-5 h-5 rounded-full bg-[hsl(var(--brand-blue))] text-white text-[10.5px] font-semibold leading-5">
                          {d.getDate()}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Time grid */}
              <div className="grid relative" style={{ gridTemplateColumns: '64px repeat(7, minmax(0,1fr))' }}>
                {/* Time column */}
                <div className="bg-white">
                  {timeSlots.map((s, i) => (
                    <div key={i} className="relative text-right pr-2" style={{ height: SLOT_HEIGHT }}>
                      {s.m === 0 && (
                        <span className="absolute -top-1.5 right-2 text-[10px] text-zinc-400 tabular-nums">{fmtTimeLabel(s.h, 0)}</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Day columns */}
                {weekDays.map((d, di) => {
                  const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
                  const dayEvents = eventsByDay.get(key) || [];
                  return (
                    <div key={di} className="relative">
                      {/* background slots */}
                      {timeSlots.map((s, i) => (
                        <div
                          key={i}
                          className={s.m === 0 ? 'border-t border-zinc-100/60' : ''}
                          style={{ height: SLOT_HEIGHT }}
                        />
                      ))}
                      {/* events */}
                      {dayEvents.map((e) => {
                        const pos = eventPosition(e);
                        const styles = STATUS_STYLES[e.status] || STATUS_STYLES.scheduled;
                        return (
                          <button
                            key={e.id}
                            onClick={() => setSelected(e)}
                            className={cn(
                              'absolute left-1 right-1 rounded-md border text-left px-2 py-1 overflow-hidden transition',
                              styles.block, styles.text,
                            )}
                            style={{ top: pos.top, height: pos.height }}
                          >
                            <span className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md" aria-hidden />
                            <span className={cn('absolute left-0 top-0 bottom-0 w-1 rounded-l-md', styles.strip)} aria-hidden />
                            {e.source === 'google' && (
                              <span
                                aria-hidden
                                title="Evento de Google Calendar"
                                className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-white ring-1 ring-zinc-200 flex items-center justify-center shadow-sm"
                              >
                                <svg viewBox="0 0 48 48" className="w-2 h-2">
                                  <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                                  <path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                                  <path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                                </svg>
                              </span>
                            )}
                            <p className="text-[10px] font-medium tabular-nums opacity-80 pl-1.5">
                              {fmtTime(e.datetime)}{e.end_datetime && ` - ${fmtTime(e.end_datetime)}`}
                            </p>
                            <p className="text-[11.5px] font-semibold truncate pl-1.5">
                              {e.customer_name || e.serviceName}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {view === 'dia' && (
            <div className="flex-1 overflow-auto px-5 py-4">
              <p className="text-[13px] font-semibold text-zinc-900 mb-3">
                {weekStart.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
              <div className="grid" style={{ gridTemplateColumns: '64px 1fr' }}>
                <div>
                  {timeSlots.map((s, i) => (
                    <div key={i} className="relative text-right pr-2" style={{ height: SLOT_HEIGHT }}>
                      {s.m === 0 && (
                        <span className="absolute -top-1.5 right-2 text-[10px] text-zinc-400 tabular-nums">{fmtTimeLabel(s.h, 0)}</span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="relative">
                  {timeSlots.map((s, i) => (
                    <div
                      key={i}
                      className={s.m === 0 ? 'border-t border-zinc-100/60' : ''}
                      style={{ height: SLOT_HEIGHT }}
                    />
                  ))}
                  {(eventsByDay.get(`${weekStart.getFullYear()}-${weekStart.getMonth()}-${weekStart.getDate()}`) || []).map((e) => {
                    const pos = eventPosition(e);
                    const styles = STATUS_STYLES[e.status] || STATUS_STYLES.scheduled;
                    return (
                      <button
                        key={e.id}
                        onClick={() => setSelected(e)}
                        className={cn(
                          'absolute left-1 right-4 rounded-md border text-left px-3 py-1.5 transition',
                          styles.block, styles.text,
                        )}
                        style={{ top: pos.top, height: pos.height }}
                      >
                        <span className={cn('absolute left-0 top-0 bottom-0 w-1 rounded-l-md', styles.strip)} aria-hidden />
                        <p className="text-[11px] tabular-nums opacity-80 pl-1.5">
                          {fmtTime(e.datetime)}{e.end_datetime && ` - ${fmtTime(e.end_datetime)}`}
                        </p>
                        <p className="text-[13px] font-semibold truncate pl-1.5">{e.customer_name || e.serviceName}</p>
                        <p className="text-[11px] opacity-70 pl-1.5 truncate">{e.serviceName}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {(view === 'agenda' || view === 'lista') && (
            <div className="flex-1 overflow-auto px-5 py-4">
              {filteredEvents.length === 0 ? (
                <p className="text-sm text-zinc-500 py-10 text-center">Sin citas en este rango</p>
              ) : (
                <ul className="space-y-1">
                  {filteredEvents
                    .filter((e) => {
                      const d = new Date(e.datetime);
                      return d >= weekStart && d <= addDays(weekEnd, 1);
                    })
                    .map((e) => {
                      const styles = STATUS_STYLES[e.status] || STATUS_STYLES.scheduled;
                      const d = new Date(e.datetime);
                      return (
                        <li key={e.id}>
                          <button
                            onClick={() => setSelected(e)}
                            className="w-full flex items-center gap-4 py-3 text-left hover:bg-zinc-50 transition px-2 rounded-lg"
                          >
                            <span className={cn('w-1 h-10 rounded-full shrink-0', styles.strip)} />
                            <div className="w-24 shrink-0">
                              <p className="text-[11.5px] text-zinc-500 tabular-nums">
                                {WEEK_SHORT[(d.getDay() + 6) % 7]}. {d.getDate()} {MONTHS_SHORT[d.getMonth()]}
                              </p>
                              <p className="text-[12.5px] font-medium text-zinc-900 tabular-nums">
                                {fmtTime(e.datetime)}
                              </p>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold text-zinc-900 truncate">{e.customer_name || e.customer_phone}</p>
                              <p className="text-[12px] text-zinc-500 truncate">{e.serviceName} · {e.staffName}</p>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* ─────────────── DETAILS DRAWER ─────────────── */}
        {selected && (
          <aside className="hidden lg:flex w-72 shrink-0 flex-col bg-white">
            <div className="flex items-center justify-between px-5 py-4">
              <h3 className="text-sm font-semibold text-zinc-900">Detalles de la cita</h3>
              <button onClick={() => setSelected(null)} className="text-zinc-400 hover:text-zinc-900 transition" aria-label="Cerrar">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-zinc-400 mb-1">Servicio</p>
                <p className="text-[14px] font-semibold text-zinc-900">{selected.serviceName}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-zinc-400 mb-1">Fecha y hora</p>
                <div className="flex items-center gap-2 text-[13px] text-zinc-800">
                  <CalendarDays className="w-3.5 h-3.5 text-zinc-400" />
                  {new Date(selected.datetime).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
                <div className="flex items-center gap-2 mt-1 text-[13px] text-zinc-800">
                  <Clock className="w-3.5 h-3.5 text-zinc-400" />
                  {fmtTime(selected.datetime)}{selected.end_datetime && ` - ${fmtTime(selected.end_datetime)}`}
                </div>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-zinc-400 mb-1">Paciente</p>
                <div className="flex items-center gap-2 text-[13px] text-zinc-800">
                  <User className="w-3.5 h-3.5 text-zinc-400" />
                  {selected.customer_name || selected.customer_phone}
                </div>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-zinc-400 mb-1">Especialista</p>
                <p className="text-[13px] text-zinc-800">{selected.staffName}</p>
              </div>
              {selected.notes && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-zinc-400 mb-1">Notas</p>
                  <p className="text-[12.5px] text-zinc-700 leading-relaxed">{selected.notes}</p>
                </div>
              )}
              <div className="pt-2">
                <span className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium',
                  (STATUS_STYLES[selected.status] || STATUS_STYLES.scheduled).block,
                  (STATUS_STYLES[selected.status] || STATUS_STYLES.scheduled).text,
                )}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', (STATUS_STYLES[selected.status] || STATUS_STYLES.scheduled).strip)} />
                  {selected.status}
                </span>
              </div>

              {selected.source === 'google' ? (
                <div className="pt-3 p-3 rounded-xl bg-zinc-50 ring-1 ring-zinc-100">
                  <p className="text-[11.5px] text-zinc-600 leading-relaxed">
                    Este evento viene directamente de Google Calendar. Para editarlo o cancelarlo, hazlo desde Google.
                  </p>
                </div>
              ) : selected.status !== 'cancelled' && (
                <div className="pt-3 space-y-2">
                  {/* Quick status actions */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleUpdateStatus('confirmed')}
                      disabled={!!statusUpdating || selected.status === 'confirmed'}
                      className={cn(
                        'inline-flex flex-col items-center justify-center gap-0.5 h-14 rounded-xl text-[10.5px] font-medium transition disabled:opacity-40 disabled:cursor-not-allowed',
                        selected.status === 'confirmed'
                          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                          : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-emerald-50 hover:text-emerald-700 hover:ring-emerald-200',
                      )}
                      title="Marcar como confirmada"
                    >
                      {statusUpdating === 'confirmed' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUpdateStatus('completed')}
                      disabled={!!statusUpdating || selected.status === 'completed'}
                      className={cn(
                        'inline-flex flex-col items-center justify-center gap-0.5 h-14 rounded-xl text-[10.5px] font-medium transition disabled:opacity-40 disabled:cursor-not-allowed',
                        selected.status === 'completed'
                          ? 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] ring-1 ring-[hsl(var(--brand-blue))]/20'
                          : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-[hsl(var(--brand-blue-soft))] hover:text-[hsl(var(--brand-blue))]',
                      )}
                      title="Marcar como asistida"
                    >
                      {statusUpdating === 'completed' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Asistió
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUpdateStatus('no_show')}
                      disabled={!!statusUpdating || selected.status === 'no_show'}
                      className={cn(
                        'inline-flex flex-col items-center justify-center gap-0.5 h-14 rounded-xl text-[10.5px] font-medium transition disabled:opacity-40 disabled:cursor-not-allowed',
                        selected.status === 'no_show'
                          ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                          : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-amber-50 hover:text-amber-700 hover:ring-amber-200',
                      )}
                      title="Marcar como no asistida"
                    >
                      {statusUpdating === 'no_show' ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
                      No vino
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setEditForm({
                        customer_name: selected.customer_name || '',
                        customer_phone: selected.customer_phone || '',
                        service_name: selected.serviceName || '',
                        duration_minutes: selected.end_datetime
                          ? Math.round((new Date(selected.end_datetime).getTime() - new Date(selected.datetime).getTime()) / 60000)
                          : 30,
                        notes: selected.notes || '',
                      });
                      setEditOpen(true);
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 h-9 rounded-full text-[13px] font-medium text-zinc-700 bg-white ring-1 ring-zinc-200 hover:bg-zinc-50 transition"
                  >
                    <Edit3 className="w-4 h-4" />
                    Editar detalles
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date(selected.datetime);
                      const yyyy = d.getFullYear();
                      const mm = String(d.getMonth() + 1).padStart(2, '0');
                      const dd = String(d.getDate()).padStart(2, '0');
                      const hh = String(d.getHours()).padStart(2, '0');
                      const mi = String(d.getMinutes()).padStart(2, '0');
                      setRescheduleDate(`${yyyy}-${mm}-${dd}`);
                      setRescheduleTime(`${hh}:${mi}`);
                      setRescheduleReason('');
                      setRescheduleNotify(true);
                      setRescheduleOpen(true);
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 h-9 rounded-full text-[13px] font-medium text-[hsl(var(--brand-blue))] bg-[hsl(var(--brand-blue-soft))] ring-1 ring-[hsl(var(--brand-blue))]/15 hover:bg-[hsl(var(--brand-blue))]/15 transition"
                  >
                    <CalendarClock className="w-4 h-4" />
                    Reagendar cita
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCancelReason('');
                      setNotifyCustomer(true);
                      setCancelOpen(true);
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 h-9 rounded-full text-[13px] font-medium text-rose-700 bg-rose-50 ring-1 ring-rose-200 hover:bg-rose-100 transition"
                  >
                    <XCircle className="w-4 h-4" />
                    Cancelar cita
                  </button>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ─── CANCEL DIALOG ─── */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>Cancelar cita</DialogTitle>
            <DialogDescription>
              {selected && (
                <>
                  {selected.customer_name || selected.customer_phone} — {new Date(selected.datetime).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })} a las {fmtTime(selected.datetime)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div>
              <label className="text-[12px] font-medium text-zinc-700 mb-1.5 block">
                Motivo (opcional)
              </label>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Ej. emergencia médica, viaje imprevisto…"
                maxLength={300}
                className="w-full h-10 px-3 rounded-lg bg-white border border-zinc-200 text-[13px] focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
              />
              <p className="text-[10.5px] text-zinc-500 mt-1">
                Si lo pones, se incluye en el mensaje al paciente.
              </p>
            </div>

            <label className="flex items-start gap-3 p-3 rounded-xl bg-zinc-50 ring-1 ring-zinc-100 cursor-pointer hover:bg-zinc-100/60 transition">
              <div className={cn(
                'mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition',
                notifyCustomer
                  ? 'bg-[hsl(var(--brand-blue))] text-white'
                  : 'bg-white ring-1 ring-zinc-300',
              )}>
                {notifyCustomer && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
              </div>
              <input
                type="checkbox"
                checked={notifyCustomer}
                onChange={(e) => setNotifyCustomer(e.target.checked)}
                className="sr-only"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                  <p className="text-[13px] font-semibold text-zinc-900">Avisar al paciente por WhatsApp</p>
                </div>
                <p className="text-[11.5px] text-zinc-500 mt-0.5 leading-snug">
                  Le enviamos un mensaje explicando la cancelación e invitándolo a reagendar. Si responde, la IA toma la conversación.
                </p>
              </div>
            </label>
          </div>

          <DialogFooter className="mt-5 gap-2 flex-col-reverse sm:flex-row">
            <button
              type="button"
              onClick={() => setCancelOpen(false)}
              disabled={cancelling}
              className="inline-flex items-center justify-center h-10 px-4 rounded-full ring-1 ring-zinc-200 bg-white text-[13px] font-medium text-zinc-700 hover:bg-zinc-50 transition disabled:opacity-50"
            >
              Conservar cita
            </button>
            <button
              type="button"
              onClick={handleCancelAppt}
              disabled={cancelling}
              className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-full bg-rose-600 text-white text-[13px] font-medium hover:bg-rose-700 transition disabled:opacity-60"
            >
              {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              {cancelling ? 'Cancelando…' : 'Sí, cancelar cita'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── RESCHEDULE DIALOG ─── */}
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>Reagendar cita</DialogTitle>
            <DialogDescription>
              {selected && (
                <>
                  {selected.customer_name || selected.customer_phone} — antes el {new Date(selected.datetime).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })} a las {fmtTime(selected.datetime)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] font-medium text-zinc-700 mb-1.5 block">Nueva fecha</label>
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-white border border-zinc-200 text-[13px] focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-zinc-700 mb-1.5 block">Nueva hora</label>
                <input
                  type="time"
                  value={rescheduleTime}
                  onChange={(e) => setRescheduleTime(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-white border border-zinc-200 text-[13px] focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
                />
              </div>
            </div>

            {/* Conflict warning */}
            {checkingConflicts && (
              <div className="flex items-center gap-2 text-[11.5px] text-zinc-500 px-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Revisando disponibilidad…
              </div>
            )}
            {!checkingConflicts && conflicts.length > 0 && (
              <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 p-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                  <p className="text-[12px] font-semibold text-amber-900">
                    {conflicts.length === 1 ? 'Horario ocupado' : `${conflicts.length} choques en ese horario`}
                  </p>
                </div>
                <ul className="space-y-1">
                  {conflicts.slice(0, 3).map((c) => (
                    <li key={`${c.source}-${c.id}`} className="flex items-start gap-2 text-[11.5px] text-amber-900">
                      <span className="mt-1 w-1 h-1 rounded-full bg-amber-600 shrink-0" />
                      <span className="truncate">
                        <strong className="font-semibold">{c.title}</strong>
                        <span className="opacity-70"> · {new Date(c.start).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
                        {c.staffName && <span className="opacity-70"> · {c.staffName}</span>}
                        {c.source === 'google' && <span className="opacity-70"> · Google</span>}
                      </span>
                    </li>
                  ))}
                  {conflicts.length > 3 && (
                    <li className="text-[11px] text-amber-800 opacity-70">+{conflicts.length - 3} más</li>
                  )}
                </ul>
                <p className="text-[10.5px] text-amber-800 mt-2">Puedes continuar de todas formas; Atiende no bloquea el doble-booking automáticamente.</p>
                {slotSuggestions.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-amber-200/70">
                    <p className="text-[11px] font-semibold text-amber-900 mb-2">Horarios cercanos disponibles:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {slotSuggestions.map((s) => {
                        const d = new Date(s.start);
                        const dateLabel = d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
                        const timeLabel = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
                        return (
                          <button
                            key={s.start}
                            type="button"
                            onClick={() => {
                              const yyyy = d.getFullYear();
                              const mm = String(d.getMonth() + 1).padStart(2, '0');
                              const dd = String(d.getDate()).padStart(2, '0');
                              const hh = String(d.getHours()).padStart(2, '0');
                              const mi = String(d.getMinutes()).padStart(2, '0');
                              setRescheduleDate(`${yyyy}-${mm}-${dd}`);
                              setRescheduleTime(`${hh}:${mi}`);
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white text-[11px] font-medium text-zinc-800 ring-1 ring-zinc-200 hover:bg-[hsl(var(--brand-blue-soft))] hover:ring-[hsl(var(--brand-blue))] hover:text-[hsl(var(--brand-blue))] transition"
                          >
                            {dateLabel} · {timeLabel}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            {!checkingConflicts && conflicts.length === 0 && rescheduleDate && rescheduleTime && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-50 ring-1 ring-emerald-100 text-[11.5px] text-emerald-700">
                <Check className="w-3 h-3" strokeWidth={3} /> Horario disponible
              </div>
            )}

            <div>
              <label className="text-[12px] font-medium text-zinc-700 mb-1.5 block">
                Motivo (opcional)
              </label>
              <input
                type="text"
                value={rescheduleReason}
                onChange={(e) => setRescheduleReason(e.target.value)}
                placeholder="Ej. reorganización de agenda, retraso…"
                maxLength={300}
                className="w-full h-10 px-3 rounded-lg bg-white border border-zinc-200 text-[13px] focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
              />
              <p className="text-[10.5px] text-zinc-500 mt-1">
                Se incluye en el mensaje al paciente.
              </p>
            </div>

            <label className="flex items-start gap-3 p-3 rounded-xl bg-zinc-50 ring-1 ring-zinc-100 cursor-pointer hover:bg-zinc-100/60 transition">
              <div className={cn(
                'mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition',
                rescheduleNotify
                  ? 'bg-[hsl(var(--brand-blue))] text-white'
                  : 'bg-white ring-1 ring-zinc-300',
              )}>
                {rescheduleNotify && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
              </div>
              <input
                type="checkbox"
                checked={rescheduleNotify}
                onChange={(e) => setRescheduleNotify(e.target.checked)}
                className="sr-only"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                  <p className="text-[13px] font-semibold text-zinc-900">Avisar al paciente por WhatsApp</p>
                </div>
                <p className="text-[11.5px] text-zinc-500 mt-0.5 leading-snug">
                  Le proponemos la nueva fecha. Si no le acomoda, responde y la IA busca otro hueco.
                </p>
              </div>
            </label>
          </div>

          <DialogFooter className="mt-5 gap-2 flex-col-reverse sm:flex-row">
            <button
              type="button"
              onClick={() => setRescheduleOpen(false)}
              disabled={rescheduling}
              className="inline-flex items-center justify-center h-10 px-4 rounded-full ring-1 ring-zinc-200 bg-white text-[13px] font-medium text-zinc-700 hover:bg-zinc-50 transition disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleRescheduleAppt}
              disabled={rescheduling || !rescheduleDate || !rescheduleTime}
              className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-full bg-[hsl(var(--brand-blue))] text-white text-[13px] font-medium hover:opacity-90 transition disabled:opacity-60"
            >
              {rescheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
              {rescheduling ? 'Reagendando…' : 'Reagendar y avisar'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── EDIT APPOINTMENT DIALOG ─── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>Editar detalles</DialogTitle>
            <DialogDescription>
              Cambia datos del paciente, servicio o duración. Para cambiar fecha/hora usa Reagendar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            <div>
              <label className="text-[12px] font-medium text-zinc-700 mb-1.5 block">Nombre del paciente</label>
              <input
                type="text"
                value={editForm.customer_name}
                onChange={(e) => setEditForm((f) => ({ ...f, customer_name: e.target.value }))}
                className="w-full h-10 px-3 rounded-lg bg-white border border-zinc-200 text-[13px] focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
              />
            </div>
            <div>
              <label className="text-[12px] font-medium text-zinc-700 mb-1.5 block">Teléfono (WhatsApp)</label>
              <input
                type="tel"
                value={editForm.customer_phone}
                onChange={(e) => setEditForm((f) => ({ ...f, customer_phone: e.target.value }))}
                className="w-full h-10 px-3 rounded-lg bg-white border border-zinc-200 text-[13px] focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] font-medium text-zinc-700 mb-1.5 block">Servicio</label>
                <input
                  type="text"
                  list="edit-services-list"
                  value={editForm.service_name}
                  onChange={(e) => setEditForm((f) => ({ ...f, service_name: e.target.value }))}
                  placeholder="Ej. Limpieza"
                  className="w-full h-10 px-3 rounded-lg bg-white border border-zinc-200 text-[13px] focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
                />
                <datalist id="edit-services-list">
                  {services.map((s) => (<option key={s.id} value={s.name} />))}
                </datalist>
              </div>
              <div>
                <label className="text-[12px] font-medium text-zinc-700 mb-1.5 block">Duración (min)</label>
                <input
                  type="number"
                  min={5}
                  max={600}
                  step={5}
                  value={editForm.duration_minutes}
                  onChange={(e) => setEditForm((f) => ({ ...f, duration_minutes: parseInt(e.target.value, 10) || 30 }))}
                  className="w-full h-10 px-3 rounded-lg bg-white border border-zinc-200 text-[13px] focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
                />
              </div>
            </div>
            <div>
              <label className="text-[12px] font-medium text-zinc-700 mb-1.5 block">Notas</label>
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-white border border-zinc-200 text-[13px] focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
              />
            </div>
          </div>

          <DialogFooter className="mt-5 gap-2 flex-col-reverse sm:flex-row">
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              disabled={savingEdit}
              className="inline-flex items-center justify-center h-10 px-4 rounded-full ring-1 ring-zinc-200 bg-white text-[13px] font-medium text-zinc-700 hover:bg-zinc-50 transition disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleEditAppt}
              disabled={savingEdit}
              className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-full bg-[hsl(var(--brand-blue))] text-white text-[13px] font-medium hover:opacity-90 transition disabled:opacity-60"
            >
              {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {savingEdit ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── BLOCK TIME DIALOG ─── */}
      <Dialog open={blockOpen} onOpenChange={setBlockOpen}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>Bloquear tiempo</DialogTitle>
            <DialogDescription>
              Marca horas como no disponibles. Aparecerá como evento en tu Google Calendar y la IA evita agendar en ese rango.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            <div>
              <label className="text-[12px] font-medium text-zinc-700 mb-1.5 block">Motivo</label>
              <input
                type="text"
                value={blockLabel}
                onChange={(e) => setBlockLabel(e.target.value)}
                placeholder="Ej. Vacaciones, comida, cirugía…"
                maxLength={200}
                className="w-full h-10 px-3 rounded-lg bg-white border border-zinc-200 text-[13px] focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] font-medium text-zinc-700 mb-1.5 block">Desde fecha</label>
                <input type="date" value={blockStart.date} onChange={(e) => setBlockStart((v) => ({ ...v, date: e.target.value }))} className="w-full h-10 px-3 rounded-lg bg-white border border-zinc-200 text-[13px] focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-zinc-700 mb-1.5 block">Hora</label>
                <input type="time" value={blockStart.time} onChange={(e) => setBlockStart((v) => ({ ...v, time: e.target.value }))} className="w-full h-10 px-3 rounded-lg bg-white border border-zinc-200 text-[13px] focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] font-medium text-zinc-700 mb-1.5 block">Hasta fecha</label>
                <input type="date" value={blockEnd.date} onChange={(e) => setBlockEnd((v) => ({ ...v, date: e.target.value }))} className="w-full h-10 px-3 rounded-lg bg-white border border-zinc-200 text-[13px] focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-zinc-700 mb-1.5 block">Hora</label>
                <input type="time" value={blockEnd.time} onChange={(e) => setBlockEnd((v) => ({ ...v, time: e.target.value }))} className="w-full h-10 px-3 rounded-lg bg-white border border-zinc-200 text-[13px] focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]" />
              </div>
            </div>
          </div>

          <DialogFooter className="mt-5 gap-2 flex-col-reverse sm:flex-row">
            <button type="button" onClick={() => setBlockOpen(false)} disabled={blocking} className="inline-flex items-center justify-center h-10 px-4 rounded-full ring-1 ring-zinc-200 bg-white text-[13px] font-medium text-zinc-700 hover:bg-zinc-50 transition disabled:opacity-50">Cancelar</button>
            <button type="button" onClick={handleBlockTime} disabled={blocking || !blockStart.date || !blockStart.time || !blockEnd.date || !blockEnd.time} className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-full bg-zinc-900 text-white text-[13px] font-medium hover:bg-zinc-800 transition disabled:opacity-60">
              {blocking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
              {blocking ? 'Bloqueando…' : 'Bloquear horario'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── BULK CANCEL DIALOG ─── */}
      <Dialog open={bulkCancelOpen} onOpenChange={setBulkCancelOpen}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>Cancelar día completo</DialogTitle>
            <DialogDescription>
              Cancela todas las citas activas de un día. Útil para emergencias, enfermedad o imprevistos.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            <div>
              <label className="text-[12px] font-medium text-zinc-700 mb-1.5 block">Fecha a cancelar</label>
              <input
                type="date"
                value={bulkCancelDate}
                onChange={(e) => setBulkCancelDate(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white border border-zinc-200 text-[13px] focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
              />
            </div>
            <div>
              <label className="text-[12px] font-medium text-zinc-700 mb-1.5 block">Motivo (opcional)</label>
              <input
                type="text"
                value={bulkCancelReason}
                onChange={(e) => setBulkCancelReason(e.target.value)}
                placeholder="Ej. incapacidad médica, emergencia familiar…"
                maxLength={300}
                className="w-full h-10 px-3 rounded-lg bg-white border border-zinc-200 text-[13px] focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
              />
              <p className="text-[10.5px] text-zinc-500 mt-1">Se incluye en el mensaje a cada paciente.</p>
            </div>

            <label className="flex items-start gap-3 p-3 rounded-xl bg-zinc-50 ring-1 ring-zinc-100 cursor-pointer hover:bg-zinc-100/60 transition">
              <div className={cn('mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition', bulkCancelNotify ? 'bg-[hsl(var(--brand-blue))] text-white' : 'bg-white ring-1 ring-zinc-300')}>
                {bulkCancelNotify && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
              </div>
              <input type="checkbox" checked={bulkCancelNotify} onChange={(e) => setBulkCancelNotify(e.target.checked)} className="sr-only" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                  <p className="text-[13px] font-semibold text-zinc-900">Avisar a todos los pacientes por WhatsApp</p>
                </div>
                <p className="text-[11.5px] text-zinc-500 mt-0.5 leading-snug">
                  Cada paciente recibe un mensaje individual invitándolo a reagendar. Si responde, la IA busca nuevo hueco.
                </p>
              </div>
            </label>
          </div>

          <DialogFooter className="mt-5 gap-2 flex-col-reverse sm:flex-row">
            <button type="button" onClick={() => setBulkCancelOpen(false)} disabled={bulkCancelling} className="inline-flex items-center justify-center h-10 px-4 rounded-full ring-1 ring-zinc-200 bg-white text-[13px] font-medium text-zinc-700 hover:bg-zinc-50 transition disabled:opacity-50">No cancelar</button>
            <button type="button" onClick={handleBulkCancelDay} disabled={bulkCancelling || !bulkCancelDate} className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-full bg-rose-600 text-white text-[13px] font-medium hover:bg-rose-700 transition disabled:opacity-60">
              {bulkCancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarX className="w-4 h-4" />}
              {bulkCancelling ? 'Cancelando…' : 'Cancelar todo el día'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MOBILE FAB — New appointment ─── */}
      <button
        onClick={() => setNewApptOpen(true)}
        aria-label="Nueva cita"
        className="md:hidden absolute bottom-5 right-5 w-14 h-14 rounded-full bg-[hsl(var(--brand-blue))] text-white shadow-[0_10px_30px_-6px_rgba(59,130,246,0.6)] flex items-center justify-center hover:opacity-95 active:scale-95 transition"
      >
        <Plus className="w-6 h-6" strokeWidth={2.25} />
      </button>

      {/* ─── NEW APPOINTMENT SHEET ─── */}
      <Sheet open={newApptOpen} onOpenChange={setNewApptOpen}>
        <SheetContent
          side="right"
          className="p-0 flex flex-col bg-white border-0 rounded-l-[28px] shadow-[0_20px_60px_-12px_rgba(0,0,0,0.18)] w-[92%] max-w-[420px]"
        >
          <SheetHeader className="px-6 pt-7 pb-5 border-b border-zinc-100">
            <SheetTitle className="text-[18px] font-semibold text-zinc-900 tracking-tight">Nueva cita</SheetTitle>
            <p className="text-[13px] text-zinc-500 font-normal">Agenda a un paciente en tu calendario.</p>
          </SheetHeader>
          <form onSubmit={handleCreateAppt} className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <label className="block space-y-1.5">
                <span className="text-[12px] text-zinc-600 font-medium">Paciente</span>
                <input
                  type="text"
                  required
                  value={newAppt.customer}
                  onChange={(e) => setNewAppt({ ...newAppt, customer: e.target.value })}
                  placeholder="Nombre completo"
                  className="w-full h-12 px-4 text-[14px] rounded-2xl bg-zinc-50 border border-zinc-200 placeholder:text-zinc-400 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-4 focus:ring-[hsl(var(--brand-blue-soft))] transition"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[12px] text-zinc-600 font-medium">Teléfono <span className="text-zinc-400 font-normal">· opcional</span></span>
                <input
                  type="tel"
                  value={newAppt.phone}
                  onChange={(e) => setNewAppt({ ...newAppt, phone: e.target.value })}
                  placeholder="52 999 123 4567"
                  className="w-full h-12 px-4 text-[14px] rounded-2xl bg-zinc-50 border border-zinc-200 placeholder:text-zinc-400 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-4 focus:ring-[hsl(var(--brand-blue-soft))] transition"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[12px] text-zinc-600 font-medium">Servicio</span>
                <div className="relative">
                  <select
                    value={newAppt.service}
                    onChange={(e) => setNewAppt({ ...newAppt, service: e.target.value })}
                    className="w-full h-12 pl-4 pr-10 text-[14px] rounded-2xl bg-zinc-50 border border-zinc-200 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-4 focus:ring-[hsl(var(--brand-blue-soft))] transition appearance-none text-zinc-900"
                  >
                    <option value="">Seleccionar servicio</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                  <ChevronRight className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 rotate-90 pointer-events-none" />
                </div>
              </label>
              <div className="space-y-1.5">
                <span className="text-[12px] text-zinc-600 font-medium block">Fecha y hora</span>
                <div className="grid grid-cols-5 gap-2">
                  <input
                    type="date"
                    required
                    value={newAppt.date}
                    onChange={(e) => setNewAppt({ ...newAppt, date: e.target.value })}
                    className="col-span-3 h-12 px-4 text-[14px] rounded-2xl bg-zinc-50 border border-zinc-200 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-4 focus:ring-[hsl(var(--brand-blue-soft))] transition tabular-nums"
                  />
                  <input
                    type="time"
                    required
                    value={newAppt.time}
                    onChange={(e) => setNewAppt({ ...newAppt, time: e.target.value })}
                    className="col-span-2 h-12 px-3 text-[14px] rounded-2xl bg-zinc-50 border border-zinc-200 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-4 focus:ring-[hsl(var(--brand-blue-soft))] transition tabular-nums text-center"
                  />
                </div>
              </div>
              <label className="block space-y-1.5">
                <span className="text-[12px] text-zinc-600 font-medium">Notas <span className="text-zinc-400 font-normal">· opcional</span></span>
                <textarea
                  value={newAppt.notes}
                  onChange={(e) => setNewAppt({ ...newAppt, notes: e.target.value })}
                  rows={3}
                  placeholder="Detalles adicionales…"
                  className="w-full px-4 py-3 text-[14px] rounded-2xl bg-zinc-50 border border-zinc-200 placeholder:text-zinc-400 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-4 focus:ring-[hsl(var(--brand-blue-soft))] transition resize-none leading-relaxed"
                />
              </label>
              <div className="space-y-1.5">
                <span className="text-[12px] text-zinc-600 font-medium">Repetir cada semana</span>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 4, 8, 12, 24].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNewAppt({ ...newAppt, repeat_weeks: n })}
                      className={cn(
                        'inline-flex items-center justify-center px-3.5 h-9 rounded-full text-[12.5px] font-medium transition',
                        newAppt.repeat_weeks === n
                          ? 'bg-[hsl(var(--brand-blue))] text-white shadow-sm'
                          : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50',
                      )}
                    >
                      {n === 1 ? 'Solo esta vez' : `${n} semanas`}
                    </button>
                  ))}
                </div>
                {newAppt.repeat_weeks > 1 && (
                  <p className="text-[11px] text-zinc-500 pl-1">
                    Se crearán {newAppt.repeat_weeks} citas en fechas consecutivas (cada {newAppt.repeat_weeks === 2 ? '2 semanas' : '7 días'}).
                  </p>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-zinc-100 bg-white/80 backdrop-blur-sm flex items-center gap-3">
              <button
                type="button"
                onClick={() => setNewApptOpen(false)}
                className="h-12 px-5 rounded-2xl text-[14px] font-medium text-zinc-600 hover:bg-zinc-100 transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingAppt || !newAppt.customer.trim() || !newAppt.date || !newAppt.time}
                className="flex-1 h-12 rounded-2xl bg-[hsl(var(--brand-blue))] text-white text-[14px] font-semibold hover:opacity-90 transition-all active:scale-[0.98] disabled:bg-zinc-100 disabled:text-zinc-400 disabled:shadow-none shadow-md shadow-[hsl(var(--brand-blue))]/25"
              >
                {savingAppt ? 'Guardando…' : 'Crear cita'}
              </button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
