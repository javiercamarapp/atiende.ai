import { createServerSupabase } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Phone, PhoneOutgoing, PhoneIncoming, SmilePlus, Meh, Frown, CheckCircle, XCircle, Clock, PhoneOff } from 'lucide-react';

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function SentimentBadge({ sentiment }: { sentiment: string | null | undefined }) {
  if (!sentiment) return null;
  const lower = sentiment.toLowerCase();
  if (lower === 'positive' || lower === 'positivo') {
    return <Badge className="bg-green-100 text-green-800 border-green-200"><SmilePlus className="w-3 h-3 mr-1" />Positivo</Badge>;
  }
  if (lower === 'negative' || lower === 'negativo') {
    return <Badge className="bg-red-100 text-red-800 border-red-200"><Frown className="w-3 h-3 mr-1" />Negativo</Badge>;
  }
  return <Badge className="bg-gray-100 text-gray-700 border-gray-200"><Meh className="w-3 h-3 mr-1" />Neutral</Badge>;
}

function OutcomeBadge({ outcome }: { outcome: string | null | undefined }) {
  if (!outcome) return null;
  const lower = outcome.toLowerCase();
  if (lower.includes('success') || lower.includes('resolved') || lower.includes('booked') || lower.includes('completad')) {
    return <Badge className="bg-green-50 text-green-700 border-green-200"><CheckCircle className="w-3 h-3 mr-1" />{outcome}</Badge>;
  }
  if (lower.includes('fail') || lower.includes('abandon') || lower.includes('cancel') || lower.includes('no_answer')) {
    return <Badge className="bg-red-50 text-red-700 border-red-200"><XCircle className="w-3 h-3 mr-1" />{outcome}</Badge>;
  }
  if (lower.includes('transfer') || lower.includes('handoff')) {
    return <Badge className="bg-yellow-50 text-yellow-700 border-yellow-200"><PhoneOff className="w-3 h-3 mr-1" />{outcome}</Badge>;
  }
  return <Badge className="bg-gray-50 text-gray-600 border-gray-200"><Clock className="w-3 h-3 mr-1" />{outcome}</Badge>;
}

export default async function CallsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase.from('tenants').select('id').eq('user_id', user!.id).single();
  const { data: calls } = await supabase.from('voice_calls').select('*').eq('tenant_id', tenant!.id).order('started_at', { ascending: false }).limit(50);

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Llamadas</h1>
      <div className="space-y-2">
        {(calls || []).map(c => (
          <Card key={c.id} className="p-4">
            <div className="flex justify-between items-start">
              <div className="flex items-start gap-3">
                {c.direction === 'inbound'
                  ? <PhoneIncoming className="w-5 h-5 text-green-600 mt-0.5" />
                  : <PhoneOutgoing className="w-5 h-5 text-blue-600 mt-0.5" />}
                <div className="space-y-1">
                  <p className="font-medium">{c.direction === 'inbound' ? c.from_number : c.to_number}</p>
                  <p className="text-xs text-gray-400">
                    {c.started_at && new Date(c.started_at).toLocaleString('es-MX')}
                    {' '}· {formatDuration(c.duration_seconds)}
                  </p>
                  {c.summary && <p className="text-sm text-gray-600 mt-1">{c.summary}</p>}
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    <SentimentBadge sentiment={c.sentiment as string | null} />
                    <OutcomeBadge outcome={c.outcome as string | null} />
                  </div>
                  {c.recording_url && (
                    <div className="mt-2">
                      <audio controls preload="none" className="h-8 w-64">
                        <source src={c.recording_url as string} />
                      </audio>
                    </div>
                  )}
                </div>
              </div>
              <Badge>{c.direction === 'inbound' ? 'Entrante' : 'Saliente'}</Badge>
            </div>
          </Card>
        ))}
        {(!calls || calls.length === 0) && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Phone className="w-12 h-12 text-zinc-300 mb-4" />
            <h3 className="text-lg font-medium text-zinc-900">Sin llamadas todavia</h3>
            <p className="text-sm text-zinc-500 mt-1">Las llamadas atendidas por el bot apareceran aqui</p>
          </div>
        )}
      </div>
    </div>
  );
}
