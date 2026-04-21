'use client';
import { useState, useEffect, useRef } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { createClient } from '@/lib/supabase/client';

const SEEN_KEY = 'notifications_last_seen';

type Notification = {
  id: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};

function readLastSeen(): number {
  if (typeof window === 'undefined') return 0;
  const raw = localStorage.getItem(SEEN_KEY);
  return raw ? Number(raw) : 0;
}

function writeLastSeen(ts: number) {
  localStorage.setItem(SEEN_KEY, String(ts));
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
  if (action.includes('crisis')) return '\u{26A0}\u{FE0F}';
  if (action.includes('emergency')) return '\u{1F198}';
  return '\u{1F514}';
}

export function NotificationCenter({ tenantId }: { tenantId: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState(readLastSeen);
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    supabaseRef.current
      .from('audit_log')
      .select('id, action, details, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setNotifications(data || []));
  }, [tenantId]);

  const fetchNotifications = () => {
    supabaseRef.current
      .from('audit_log')
      .select('id, action, details, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setNotifications(data || []));
  };

  const markAllRead = () => {
    const now = Date.now();
    writeLastSeen(now);
    setLastSeen(now);
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      fetchNotifications();
    } else {
      markAllRead();
    }
  };

  const unread = notifications.filter(
    (n) => new Date(n.created_at).getTime() > lastSeen,
  ).length;

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
              const isNew = new Date(n.created_at).getTime() > lastSeen;
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
