'use client';
import { useState, useEffect, useRef, useSyncExternalStore, useCallback, useMemo } from 'react';
import { Bell, CheckCheck, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { createClient } from '@/lib/supabase/client';

const STORAGE_KEY = 'notifications_read_ids';
const MAX_IDS = 1000;
const EMPTY_JSON = '[]';

// Blacklist of noisy audit_log actions that are NOT user-facing notifications.
// Everything else is shown. This is safer than a whitelist because new action
// types (e.g. medical.escalated) appear by default instead of being silently
// hidden until someone remembers to add them to the whitelist.
const NOISE_ACTIONS = new Set([
  'agent.action.reply',
  'ad_click.tracked',
]);
const NOISE_PREFIXES = ['cron.', 'redes_sociales.', 'respuesta_resenas.', 'faq_builder.'];

type Notification = {
  id: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};

// ---- External store for read notification IDs ----
// Snapshots are raw JSON strings so Object.is() comparison works cleanly for
// useSyncExternalStore (Set references are unstable).
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? EMPTY_JSON;
  } catch {
    return EMPTY_JSON;
  }
}

function getServerSnapshot(): string {
  return EMPTY_JSON;
}

function writeIds(ids: Set<string>) {
  let arr = Array.from(ids);
  if (arr.length > MAX_IDS) arr = arr.slice(-MAX_IDS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // Quota or private mode — fail silently; the UI still updates via emit().
  }
  emit();
}

function timeAgo(date: string): string {
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  if (mins < 1440) return `hace ${Math.floor(mins / 60)}h`;
  return `hace ${Math.floor(mins / 1440)}d`;
}

function getIcon(action: string): string {
  if (action.includes('appointment')) return '\u{1F4C5}';
  if (action.includes('order')) return '\u{1F9FE}';
  if (action.includes('complaint')) return '\u{1F6A8}';
  if (action.includes('lead')) return '\u{1F525}';
  if (action.includes('crisis') || action.includes('medical')) return '\u{26A0}\u{FE0F}';
  if (action.includes('emergency')) return '\u{1F198}';
  if (action.includes('no_show')) return '\u{1F6AB}';
  if (action.includes('retention')) return '\u{1F4AC}';
  if (action.includes('followup') || action.includes('nurturing')) return '\u{1F4E9}';
  if (action.includes('inventario')) return '\u{1F4E6}';
  return '\u{1F514}';
}

function prettyAction(action: string): string {
  return action
    .replace(/^agent\.action\./, '')
    .replace(/_/g, ' ')
    .replace(/\./g, ' · ');
}

export function NotificationCenter({ tenantId }: { tenantId: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const supabaseRef = useRef(createClient());
  const seenDuringSession = useRef<Set<string>>(new Set());

  const rawReadIds = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const readIds: Set<string> = useMemo(() => {
    try {
      return new Set(JSON.parse(rawReadIds) as string[]);
    } catch {
      return new Set<string>();
    }
  }, [rawReadIds]);

  const fetchNotifications = useCallback(() => {
    supabaseRef.current
      .from('audit_log')
      .select('id, action, details, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        const list = ((data || []) as Notification[])
          .filter(
            (n) =>
              !NOISE_ACTIONS.has(n.action) &&
              !NOISE_PREFIXES.some((p) => n.action.startsWith(p)),
          )
          .slice(0, 20);
        setNotifications(list);
        for (const n of list) seenDuringSession.current.add(n.id);
      });
  }, [tenantId]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markRead = useCallback(
    (ids: Iterable<string>) => {
      const next = new Set(readIds);
      let changed = false;
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      if (changed) writeIds(next);
    },
    [readIds],
  );

  const markAllRead = useCallback(() => {
    // Use both current notifications AND anything seen this session — avoids
    // race where fetch promise resolves just before/after this callback runs.
    const all = new Set<string>(seenDuringSession.current);
    for (const n of notifications) all.add(n.id);
    markRead(all);
  }, [notifications, markRead]);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen);
      if (isOpen) {
        fetchNotifications();
      } else {
        markAllRead();
      }
    },
    [fetchNotifications, markAllRead],
  );

  const unread = notifications.filter((n) => !readIds.has(n.id)).length;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[calc(100vw-2rem)] max-w-sm sm:w-80 p-0 bg-white border border-zinc-200 rounded-2xl shadow-[0_20px_60px_-12px_rgba(0,0,0,0.18)] overflow-hidden"
        align="end"
      >
        <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between bg-white">
          <span className="font-semibold text-[13px] text-zinc-900">Notificaciones</span>
          {unread > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-medium transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Marcar leídas
            </button>
          )}
        </div>
        {notifications.length === 0 ? (
          <div className="px-6 py-10 text-center bg-white">
            <BellOff className="w-6 h-6 text-zinc-300 mx-auto mb-2" />
            <p className="text-[13px] text-zinc-600 font-medium">Sin notificaciones</p>
            <p className="text-[11px] text-zinc-400 mt-1">
              Te avisamos cuando lleguen citas, pedidos o alertas.
            </p>
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto bg-white">
            {notifications.map((n) => {
              const isNew = !readIds.has(n.id);
              return (
                <div
                  key={n.id}
                  className={`px-4 py-3 border-b border-zinc-100 last:border-0 transition-colors ${
                    isNew ? 'bg-blue-50/60' : 'hover:bg-zinc-50'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="text-lg shrink-0">{getIcon(n.action)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-zinc-900 truncate capitalize">
                        {prettyAction(n.action)}
                      </p>
                      <p className="text-[11px] text-zinc-500 mt-0.5">
                        {timeAgo(n.created_at)}
                      </p>
                    </div>
                    {isNew && (
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
