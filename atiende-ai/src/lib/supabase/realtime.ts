'use client';
import { createClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';

export function useRealtimeMessages(conversationId: string) {
  const [messages, setMessages] = useState<Record<string, unknown>[]>([]);
  const supabase = createClient();

  useEffect(() => {
    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .then(({ data }) => setMessages(data || []));

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        setMessages(prev => [...prev, payload.new as Record<string, unknown>]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, supabase]);

  return messages;
}

export function useRealtimeConversations(tenantId: string) {
  const [conversations, setConversations] = useState<Record<string, unknown>[]>([]);
  const supabase = createClient();

  useEffect(() => {
    supabase
      .from('conversations')
      .select('*, contact:contact_id(name, phone)')
      .eq('tenant_id', tenantId)
      .order('last_message_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setConversations(data || []));

    const channel = supabase
      .channel(`conversations:${tenantId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conversations',
        filter: `tenant_id=eq.${tenantId}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setConversations(prev => [payload.new as Record<string, unknown>, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setConversations(prev =>
            prev.map(c => (c as { id: string }).id === (payload.new as { id: string }).id ? payload.new as Record<string, unknown> : c)
          );
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenantId, supabase]);

  return conversations;
}
