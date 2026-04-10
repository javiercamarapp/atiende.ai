import { createServerSupabase } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

const PROVIDER_ICONS: Record<string, string> = {
  whatsapp: 'WA',
  stripe: 'ST',
  conekta: 'CK',
  retell: 'RE',
};

const PROVIDER_COLORS: Record<string, string> = {
  whatsapp: 'bg-zinc-100 text-zinc-700',
  stripe: 'bg-zinc-100 text-zinc-700',
  conekta: 'bg-zinc-100 text-zinc-700',
  retell: 'bg-zinc-100 text-zinc-700',
};

function statusColor(code: number | null): string {
  if (!code) return 'text-gray-500';
  if (code >= 200 && code < 300) return 'text-zinc-900';
  if (code >= 400 && code < 500) return 'text-zinc-400';
  return 'text-red-600';
}

function statusBg(code: number | null): string {
  if (!code) return 'bg-gray-50';
  if (code >= 200 && code < 300) return 'bg-zinc-50';
  if (code >= 400 && code < 500) return 'bg-zinc-50';
  return 'bg-red-50';
}

interface WebhookLog {
  id: number;
  provider: string;
  event_type: string | null;
  direction: string | null;
  status_code: number | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

export default async function WebhooksPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { provider: filterProvider } = await searchParams;
  const supabase = await createServerSupabase();

  let query = supabase
    .from('webhook_logs')
    .select('id, provider, event_type, direction, status_code, error, duration_ms, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (filterProvider && typeof filterProvider === 'string' && filterProvider !== 'all') {
    query = query.eq('provider', filterProvider);
  }

  const { data: logs } = await query;
  const webhookLogs: WebhookLog[] = (logs as WebhookLog[] | null) ?? [];

  const providers = ['all', 'whatsapp', 'stripe', 'conekta', 'retell'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Webhook Event Log</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Filtrar:</span>
          <div className="flex gap-1">
            {providers.map((p) => {
              const isActive = (filterProvider ?? 'all') === p;
              return (
                <a
                  key={p}
                  href={`/webhooks${p === 'all' ? '' : `?provider=${p}`}`}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    isActive
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {p === 'all' ? 'Todos' : p.charAt(0).toUpperCase() + p.slice(1)}
                </a>
              );
            })}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Ultimos 100 eventos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 pr-4 font-medium">Hora</th>
                  <th className="pb-2 pr-4 font-medium">Proveedor</th>
                  <th className="pb-2 pr-4 font-medium">Evento</th>
                  <th className="pb-2 pr-4 font-medium">Direccion</th>
                  <th className="pb-2 pr-4 font-medium text-right">Status</th>
                  <th className="pb-2 pr-4 font-medium text-right">Duracion</th>
                  <th className="pb-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {webhookLogs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-400">
                      No hay eventos de webhook registrados
                    </td>
                  </tr>
                )}
                {webhookLogs.map((log) => (
                  <tr key={log.id} className={`border-b last:border-0 ${statusBg(log.status_code)}`}>
                    <td className="py-2 pr-4 whitespace-nowrap text-gray-600">
                      {new Date(log.created_at).toLocaleString('es-MX', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          PROVIDER_COLORS[log.provider] ?? 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {PROVIDER_ICONS[log.provider] ?? '??'}{' '}
                        {log.provider}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {log.event_type ?? '-'}
                    </td>
                    <td className="py-2 pr-4 text-xs text-gray-500">
                      {log.direction ?? '-'}
                    </td>
                    <td className={`py-2 pr-4 text-right font-mono text-xs font-bold ${statusColor(log.status_code)}`}>
                      {log.status_code ?? '-'}
                    </td>
                    <td className="py-2 pr-4 text-right text-xs text-gray-500">
                      {log.duration_ms != null ? `${log.duration_ms}ms` : '-'}
                    </td>
                    <td className="py-2 text-xs text-red-600 max-w-[200px] truncate">
                      {log.error ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
