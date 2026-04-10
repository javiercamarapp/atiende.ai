'use client';
import { useState, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { createClient } from '@/lib/supabase/client';

export function NotificationCenter({ tenantId }: { tenantId: string }) {
  const [notifications, setNotifications] = useState<Array<{ id: string; action: string; details: Record<string, unknown>; created_at: string }>>([]);
  const [open, setOpen] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    supabase
      .from('audit_log')
      .select('id, action, details, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setNotifications(data || []));
  }, [tenantId, open]);

  const unread = notifications.filter(n => {
    const age = Date.now() - new Date(n.created_at).getTime();
    return age < 24 * 3600 * 1000;
  }).length;

  const timeAgo = (date: string) => {
    const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
    if (mins < 1) return 'ahora';
    if (mins < 60) return `hace ${mins}m`;
    if (mins < 1440) return `hace ${Math.floor(mins / 60)}h`;
    return `hace ${Math.floor(mins / 1440)}d`;
  };

  const getIcon = (action: string) => {
    if (action.includes('appointment')) return '📅';
    if (action.includes('order')) return '🧾';
    if (action.includes('complaint')) return '🚨';
    if (action.includes('lead')) return '🔥';
    if (action.includes('crisis')) return '⚠️';
    if (action.includes('emergency')) return '🆘';
    return '🔔';
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
      <PopoverContent className="w-80 p-0 shadow-xl border border-zinc-200 rounded-xl bg-white z-50" align="end" sideOffset={8}>
        <div className="p-3 border-b border-zinc-100 font-medium text-sm text-zinc-900">Notificaciones</div>
        {notifications.length === 0 ? (
          <div className="p-4 text-center text-sm text-zinc-500">Sin notificaciones</div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {notifications.map(n => (
              <div key={n.id} className="px-3 py-2.5 border-b last:border-0 hover:bg-zinc-50 transition-colors">
                <div className="flex items-start gap-2">
                  <span className="text-lg">{getIcon(n.action)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-900 truncate">{n.action.replace('agent.action.', '').replace(/\./g, ' ')}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{timeAgo(n.created_at)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
