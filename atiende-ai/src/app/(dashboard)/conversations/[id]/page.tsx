import { createServerSupabase } from '@/lib/supabase/server';
import { ChatViewer } from '@/components/chat/chat-viewer';

export default async function ConvDetail({ params }:{ params:Promise<{id:string}> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data:{user} } = await supabase.auth.getUser();
  const { data:tenant } = await supabase.from('tenants').select('id,wa_phone_number_id').eq('user_id',user!.id).single();
  const { data:conv } = await supabase.from('conversations').select('*').eq('id',id).eq('tenant_id',tenant!.id).single();
  const { data:messages } = await supabase.from('messages').select('*').eq('conversation_id',id).order('created_at');
  if(!conv) return <div>Conversación no encontrada</div>;
  return <ChatViewer conversation={conv} messages={messages||[]} tenantId={tenant!.id} phoneNumberId={tenant!.wa_phone_number_id||''}/>;
}
