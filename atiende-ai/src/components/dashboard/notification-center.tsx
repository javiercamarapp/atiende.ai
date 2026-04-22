'use client';
import { useState, useEffect, useRef, useSyncExternalStore, useCallback } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { createClient } from '@/lib/supabase/client';

const READ_IDS_KEY = 'notifications_read_ids';
const MAX_TRACKED = 500;

type Notification = {
  id: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};

// ---- localStorage-backed store of read notification IDs ----
// We cache the parsed Set so useSyncExternalStore sees a stable reference
// between snapshots (required — React bails out when Object.is(prev, next)).
let cachedRaw: string | null = null;
let cachedSet: Set<string> = new Set();
const seenListeners = new Set<() => void>();
const SERVER_SET = new Set<string>();

function readFromStorage(): Set<string> {
  const raw = localStorage.getItem(READ_IDS_KEY);
  if (raw === cachedRaw) return cachedSet;
  cachedRaw = raw;
  try {
    cachedSet = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    cachedSet = new Set();
  }
  return cachedSet;
}

function subscribeSeen(cb: () => void) {
  seenListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === READ_IDS_KEY) cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    seenListeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

function getSeenSnapshot(): Set<string> {
  return readFromStorage();
}

function getSeenServerSnapshot(): Set<string> {
  return SERVER_SET;
}

function markIdsRead(ids: string[]) {
  if (ids.length === 0) return;
  const current = readFromStorage();
  let changed = false;
  for (const id of ids) {
    if (!current.has(id)) {
      current.add(id);
      changed = true;
    }
  }
  if (!changed) return;
  // Cap growth
  let arr = Array.from(current);
  if (arr.length > MAX_TRACKED) arr = arr.slice(-MAX_TRACKED);
  const serialized = JSON.stringify(arr);
  localStorage.setItem(READ_IDS_KEY, serialized);
  cachedRaw = serialized;
  cachedSet = new Set(arr);
  seenListeners.forEach((l) => l());
}

// ---- helpers ----
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
  if (action.includes('crisis')) return '\u{26A0}\u{FE0F}';
  if (action.includes('emergency')) return '\u{1F198}';
  return '\u{1F514}';
}

export function NotificationCenter({ tenantId }: { tenantId: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const supabaseRef = useRef(createClient());

  const readIds = useSyncExternalStore(subscribeSeen, getSeenSnapshot, getSeenServerSnapshot);

  const fetchNotifications = useCallback(() => {
    supabaseRef.current
      .from('audit_log')
      .select('id, action, details, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setNotifications(data || []));
  }, [tenantId]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markAllRead = useCallback(() => {
    markIdsRead(notifications.map((n) => n.id));
  }, [notifications]);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen);
      if (isOpen) {
        fetchNotifications();
      } else {
        markIdsRead(notifications.map((n) => n.id));
      }
    },
    [fetchNotifications, notifications],
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
          <div className="p-6 text-center text-sm text-zinc-500 bg-white">
            Sin notificaciones
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
                      <p className="text-[13px] text-zinc-900 truncate">
                        {n.action.replace('agent.action.', '').replace(/\./g, ' ')}
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
