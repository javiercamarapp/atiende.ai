import { createServerSupabase } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Phone } from 'lucide-react';

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
            <div className="flex justify-between">
              <div className="flex items-center gap-3">
                <Phone className="w-5 h-5 text-green-600" />
                <div>
                  <p className="font-medium">{c.direction === 'inbound' ? c.from_number : c.to_number}</p>
                  <p className="text-xs text-gray-400">
                    {c.started_at && new Date(c.started_at).toLocaleString('es-MX')}
                    {c.duration_seconds && ` · ${Math.round(c.duration_seconds / 60)}min`}
                  </p>
                  {c.summary && <p className="text-sm text-gray-600 mt-1">{c.summary}</p>}
                </div>
              </div>
              <Badge>{c.direction === 'inbound' ? 'Entrante' : 'Saliente'}</Badge>
            </div>
          </Card>
        ))}
        {(!calls || calls.length === 0) && (
          <p className="text-gray-400 text-center py-8">Sin llamadas</p>
        )}
      </div>
    </div>
  );
}
