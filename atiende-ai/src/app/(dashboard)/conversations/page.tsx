import { createServerSupabase } from '@/lib/supabase/server';
import { ConversationList } from '@/components/chat/conversation-list';

export default async function ConversationsPage() {
  const supabase = await createServerSupabase();
  const { data:{user} } = await supabase.auth.getUser();
  const { data:tenant } = await supabase.from('tenants').select('id').eq('user_id',user!.id).single();
  const { data:conversations } = await supabase.from('conversations').select('*, messages(content,direction,sender_type,created_at)').eq('tenant_id',tenant!.id).order('last_message_at',{ascending:false}).limit(50);
  return (<div><h1 className="text-xl font-bold mb-4">Conversaciones</h1><ConversationList conversations={conversations||[]} /></div>);
}
