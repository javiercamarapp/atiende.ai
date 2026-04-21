import Link from 'next/link';
import { Search, Plus } from 'lucide-react';
import { createServerSupabase } from '@/lib/supabase/server';

type Msg = { content: string; direction: string; sender_type: string; created_at: string };

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 86_400_000) return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  if (diffMs < 2 * 86_400_000) return 'Ayer';
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

function initials(name: string | null, phone: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return phone.slice(-2);
}

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const search = typeof params.q === 'string' ? params.q : '';

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase.from('tenants').select('id').eq('user_id', user!.id).single();

  let query = supabase
    .from('conversations')
    .select('id, customer_name, customer_phone, channel, status, last_message_at, messages(content, direction, sender_type, created_at)')
    .eq('tenant_id', tenant!.id)
    .order('last_message_at', { ascending: false })
    .limit(50);

  if (search) {
    query = query.or(`customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`);
  }

  const { data: conversations } = await query;

  type ConvRow = {
    id: string; customer_name: string | null; customer_phone: string;
    channel: string; status: string; last_message_at: string | null;
    messages: Msg[] | null;
  };
  const convs = (conversations || []) as ConvRow[];

  return (
    <div className="h-[calc(100svh-13rem)] md:h-[calc(100vh-9rem)] flex">
      <div className="glass-card overflow-hidden animate-element animate-delay-100 flex-1 flex flex-col min-h-0">
        {/* Search + add header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <form>
              <input
                type="search"
                name="q"
                defaultValue={search}
                placeholder="Buscar nombre, chat, etc"
                className="w-full pl-9 pr-4 py-2 text-sm rounded-xl bg-zinc-50 border border-zinc-200 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
              />
            </form>
          </div>
          <button className="w-9 h-9 rounded-full bg-[hsl(var(--brand-blue))] text-white flex items-center justify-center hover:opacity-90 transition shrink-0">
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Conversation list */}
        {convs.length === 0 ? (
          <div className="py-16 text-center text-sm text-zinc-500">Sin conversaciones.</div>
        ) : (
          <ul className="flex-1 overflow-y-auto min-h-0">
            {convs.map((c) => {
              const msgs = (c.messages || []) as Msg[];
              const lastMsg = msgs.length > 0
                ? msgs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
                : null;
              const unread = msgs.filter((m) => m.direction === 'inbound').length;
              const name = c.customer_name || c.customer_phone;
              return (
                <li key={c.id}>
                  <Link
                    href={`/conversations/${c.id}`}
                    className="flex items-start gap-3 px-5 py-3.5 border-b border-zinc-100 hover:bg-zinc-50/60 transition"
                  >
                    <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center text-sm font-semibold text-zinc-600 shrink-0">
                      {initials(c.customer_name, c.customer_phone)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-zinc-900 truncate">{name}</p>
                        <span className="text-[10px] text-zinc-400 tabular-nums shrink-0">
                          {c.last_message_at ? fmtTime(c.last_message_at) : ''}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 truncate mt-0.5">
                        {lastMsg?.content || 'Sin mensajes'}
                      </p>
                    </div>
                    {unread > 0 && (
                      <span className="w-5 h-5 rounded-full bg-[hsl(var(--brand-blue))] text-white text-[10px] font-semibold flex items-center justify-center shrink-0 mt-1">
                        {unread > 9 ? '9+' : unread}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
