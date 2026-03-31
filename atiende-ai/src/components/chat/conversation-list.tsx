'use client';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { User, Phone } from 'lucide-react';
import Link from 'next/link';

interface ConversationSummary {
  id: string;
  customer_name?: string;
  customer_phone: string;
  channel: string;
  status: string;
  last_message_at?: string;
  tags?: string[];
  messages?: { content?: string }[];
}

export function ConversationList({
  conversations,
}: {
  conversations: ConversationSummary[];
}) {
  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
          <User className="w-7 h-7 text-gray-400" />
        </div>
        <p className="text-sm font-medium text-gray-500">
          No se encontraron conversaciones
        </p>
        <p className="text-xs text-gray-400 mt-1">
          Intenta ajustar los filtros de búsqueda
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {conversations.map((c) => {
        const last = c.messages?.[c.messages.length - 1];
        const tags: string[] = c.tags ?? [];
        return (
          <Link key={c.id} href={`/conversations/${c.id}`}>
            <Card className="p-3 hover:bg-gray-50 cursor-pointer transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center shrink-0">
                    {c.channel === 'voice' ? (
                      <Phone className="w-4 h-4" />
                    ) : (
                      <User className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm">
                      {c.customer_name || c.customer_phone}
                    </p>
                    <p className="text-xs text-gray-500 truncate max-w-xs">
                      {last?.content?.substring(0, 60) || 'Sin mensajes'}
                    </p>
                    {tags.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {tags.map((tag: string) => (
                          <span
                            key={tag}
                            className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${getTagColor(tag)}`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.last_message_at && (
                    <span className="text-[10px] text-gray-400">
                      {new Date(c.last_message_at).toLocaleDateString('es-MX', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </span>
                  )}
                  <Badge
                    variant={
                      c.status === 'human_handoff' ? 'destructive' : 'default'
                    }
                  >
                    {c.status === 'human_handoff'
                      ? '👤'
                      : c.status === 'resolved'
                        ? '✅'
                        : '🤖'}
                  </Badge>
                </div>
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

function getTagColor(tag: string): string {
  const lower = tag.toLowerCase();
  if (lower === 'vip') return 'bg-emerald-100 text-emerald-700';
  if (lower === 'queja') return 'bg-red-100 text-red-700';
  if (lower === 'oportunidad') return 'bg-blue-100 text-blue-700';
  if (lower === 'urgente') return 'bg-amber-100 text-amber-700';
  if (lower === 'seguimiento') return 'bg-purple-100 text-purple-700';
  return 'bg-gray-100 text-gray-600';
}
