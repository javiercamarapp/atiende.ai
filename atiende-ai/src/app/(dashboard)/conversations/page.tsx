import { createServerSupabase } from '@/lib/supabase/server';
import { ConversationList } from '@/components/chat/conversation-list';
import { ConversationFilters } from '@/components/chat/conversation-filters';
import { MessageSquare } from 'lucide-react';

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const search = typeof params.q === 'string' ? params.q : '';
  const status = typeof params.status === 'string' ? params.status : 'all';
  const dateFrom = typeof params.from === 'string' ? params.from : '';
  const dateTo = typeof params.to === 'string' ? params.to : '';

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('user_id', user!.id)
    .single();

  // Get total count (unfiltered)
  const { count: totalCount } = await supabase
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenant!.id);

  // Build filtered query
  let query = supabase
    .from('conversations')
    .select('*, messages(content,direction,sender_type,created_at)')
    .eq('tenant_id', tenant!.id)
    .order('last_message_at', { ascending: false })
    .limit(50);

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  if (dateFrom) {
    query = query.gte('last_message_at', `${dateFrom}T00:00:00`);
  }

  if (dateTo) {
    query = query.lte('last_message_at', `${dateTo}T23:59:59`);
  }

  if (search) {
    query = query.or(
      `customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`
    );
  }

  const { data: conversations } = await query;

  const filteredCount = conversations?.length ?? 0;
  const hasFilters = search || status !== 'all' || dateFrom || dateTo;

  return (
    <div className="space-y-6">
      {/* Premium header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <MessageSquare className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Conversaciones
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {hasFilters ? (
                  <>
                    Mostrando{' '}
                    <span className="font-semibold text-foreground">
                      {filteredCount}
                    </span>{' '}
                    de{' '}
                    <span className="font-semibold text-foreground">
                      {totalCount ?? 0}
                    </span>{' '}
                    conversaciones
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-foreground">
                      {totalCount ?? 0}
                    </span>{' '}
                    conversaciones en total
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <ConversationFilters
          currentSearch={search}
          currentStatus={status}
          currentDateFrom={dateFrom}
          currentDateTo={dateTo}
        />
      </div>

      {/* Results */}
      <ConversationList conversations={conversations || []} />
    </div>
  );
}
