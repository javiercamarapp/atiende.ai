'use client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { MessageSquare, Calendar, Clock } from 'lucide-react';
import Link from 'next/link';

export function RecentActivity({
  conversations,
  appointments,
}: {
  conversations: Record<string, unknown>[];
  appointments: Record<string, unknown>[];
  tenant: Record<string, unknown>;
}) {
  return (
    <div className="space-y-4">
      <Card className="border-zinc-200/60 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-zinc-900">
            <MessageSquare className="w-4 h-4 text-zinc-400" />
            Conversaciones recientes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {conversations.slice(0, 5).map((c) => (
            <Link
              key={c.id as string}
              href={`/conversations/${c.id}`}
              className="block p-2 rounded-lg hover:bg-zinc-50 transition-colors"
            >
              <p className="text-sm font-medium text-zinc-900 truncate">
                {(c.customer_name as string) || (c.customer_phone as string)}
              </p>
              <p className="text-xs text-zinc-400 truncate">
                {(
                  (c.messages as Record<string, unknown>[])?.[
                    ((c.messages as Record<string, unknown>[])?.length ?? 1) - 1
                  ]?.content as string
                )?.substring(0, 50) || 'Sin msgs'}
              </p>
            </Link>
          ))}
          {conversations.length === 0 && (
            <p className="text-xs text-zinc-400 text-center py-4">
              Sin conversaciones aun
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-zinc-200/60 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-zinc-900">
            <Calendar className="w-4 h-4 text-zinc-400" />
            Proximas citas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {appointments.slice(0, 5).map((a) => (
            <div
              key={a.id as string}
              className="flex items-center gap-2 p-2 rounded-lg hover:bg-zinc-50 transition-colors"
            >
              <Clock className="w-3 h-3 text-zinc-300 shrink-0" />
              <div>
                <p className="text-sm text-zinc-900">
                  {(a.customer_name as string) || (a.customer_phone as string)}
                </p>
                <p className="text-xs text-zinc-400">
                  {new Date(a.datetime as string).toLocaleTimeString('es-MX', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {(a.services as Record<string, unknown>)?.name
                    ? ` · ${String((a.services as Record<string, unknown>).name)}`
                    : null}
                </p>
              </div>
            </div>
          ))}
          {appointments.length === 0 && (
            <p className="text-xs text-zinc-400 text-center py-4">Sin citas hoy</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
