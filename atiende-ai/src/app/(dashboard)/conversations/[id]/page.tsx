import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ChatViewer } from '@/components/chat/chat-viewer';
import { decryptPII } from '@/lib/utils/crypto';

export default async function ConvDetail({ params }:{ params:Promise<{id:string}> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data:{user} } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data:tenant } = await supabase.from('tenants').select('id,wa_phone_number_id').eq('user_id', user.id).single();
  if (!tenant) redirect('/onboarding');
  const { data:conv } = await supabase.from('conversations').select('*').eq('id', id).eq('tenant_id', tenant.id).single();
  const { data:messages } = await supabase.from('messages').select('*').eq('conversation_id', id).order('created_at');
  if (!conv) return <div>Conversación no encontrada</div>;

  // Desencriptar en el server antes de mandar al client — chat-viewer es
  // 'use client' así que no puede llamar decryptPII (usa `crypto` de Node).
  const decryptedConv = { ...conv, customer_name: decryptPII(conv.customer_name) };
  const decryptedMessages = (messages || []).map((m) => ({
    ...m,
    content: decryptPII(m.content) ?? m.content,
  }));

  return <ChatViewer conversation={decryptedConv} messages={decryptedMessages} tenantId={tenant.id} phoneNumberId={tenant.wa_phone_number_id || ''} />;
}
