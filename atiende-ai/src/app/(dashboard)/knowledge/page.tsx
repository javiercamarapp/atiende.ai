import { createServerSupabase } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { KnowledgeDelete } from '@/components/dashboard/knowledge-delete';

export default async function KnowledgePage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase.from('tenants').select('id').eq('user_id', user!.id).single();
  const { data: chunks } = await supabase.from('knowledge_chunks').select('id,content,category,source,created_at').eq('tenant_id', tenant!.id).order('created_at', { ascending: false }).limit(100);
  const cats = [...new Set((chunks || []).map(c => c.category))];

  return (
    <div>
      <h1 className="text-xl font-bold mb-2">Base de Conocimiento</h1>
      <p className="text-gray-500 text-sm mb-4">Tu bot usa esta info para responder. Entre mas completa, mejor.</p>
      <div className="flex gap-2 mb-4">
        {cats.map(c => (
          <Badge key={c} variant="outline">{c}: {chunks?.filter(ch => ch.category === c).length}</Badge>
        ))}
      </div>
      <div className="space-y-2">
        {(chunks || []).map(c => (
          <Card key={c.id} className="p-3 flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <Badge variant="secondary" className="text-xs mb-1">{c.category}</Badge>
              <p className="text-sm">{c.content.substring(0, 200)}{c.content.length > 200 ? '...' : ''}</p>
            </div>
            <KnowledgeDelete chunkId={c.id} />
          </Card>
        ))}
      </div>
    </div>
  );
}
