'use client';
import { useState } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

export function KnowledgeDelete({ chunkId }: { chunkId: string }) {
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const handleDelete = async () => {
    if (!confirm('¿Eliminar este conocimiento? El bot dejará de usar esta información.')) return;
    setDeleting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from('knowledge_chunks').delete().eq('id', chunkId);
      if (error) throw error;
      toast.success('Conocimiento eliminado');
      router.refresh();
    } catch {
      toast.error('Error al eliminar');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Button variant="ghost" size="icon" onClick={handleDelete} disabled={deleting} className="text-zinc-400 hover:text-red-500">
      {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
    </Button>
  );
}
