'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, CheckCheck, BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { createClient } from '@/lib/supabase/client';

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

interface NotificationCenterProps {
  tenantId: string;
  notificationsReadAt: string | null;
}

export function NotificationCenter({ tenantId, notificationsReadAt }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [readAt, setReadAt] = useState<Date | null>(
    notificationsReadAt ? new Date(notificationsReadAt) : null,
  );
  const supabaseRef = useRef(createClient());

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
      });
  }, [tenantId]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const isRead = useCallback(
    (n: Notification): boolean => {
      if (!readAt) return false;
      return new Date(n.created_at) <= readAt;
    },
    [readAt],
  );

  const markAllRead = useCallback(() => {
    setReadAt(new Date());
    fetch('/api/notifications/mark-read', { method: 'POST' }).catch(() => {
      // Best-effort — the local state already updated so the UI is responsive.
    });
  }, []);

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

  const unread = notifications.filter((n) => !isRead(n)).length;

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
              const isNew = !isRead(n);
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
