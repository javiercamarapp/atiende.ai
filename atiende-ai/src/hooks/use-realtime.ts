'use client';
import { createClient } from '@/lib/supabase/client';
import { useEffect, useState, useCallback, useMemo } from 'react';

interface Message {
  id: string;
  conversation_id: string;
  direction: string;
  sender_type: string;
  content: string;
  message_type: string;
  intent: string;
  model_used: string;
  wa_status: string;
  created_at: string;
}

interface Conversation {
  id: string;
  customer_phone: string;
  customer_name: string;
  status: string;
  last_message_at: string;
  tags: string[];
}

export function useRealtimeMessages(conversationId: string | null) {
  // Store messages keyed by conversationId so loading is derived
  const [messagesData, setMessagesData] = useState<{ id: string | null; messages: Message[] | null }>({ id: null, messages: null });
  const supabase = createClient();

  const loading = messagesData.id !== conversationId || messagesData.messages === null;
  const messages = useMemo(() => (loading ? [] : messagesData.messages ?? []), [loading, messagesData.messages]);

  useEffect(() => {
    if (!conversationId) return;

    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setMessagesData({ id: conversationId, messages: data || [] });
      });

    const channel = supabase
      .channel(`msgs:${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        setMessagesData(prev => ({
          ...prev,
          messages: [...(prev.messages ?? []), payload.new as Message],
        }));
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        setMessagesData(prev => ({
          ...prev,
          messages: (prev.messages ?? []).map(m =>
            m.id === (payload.new as Message).id ? payload.new as Message : m
          ),
        }));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId]);

  return { messages, loading };
}

export function useRealtimeConversations(tenantId: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    if (!tenantId) return;

    supabase
      .from('conversations')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('last_message_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setConversations(data || []);
        setLoading(false);
      });

    const channel = supabase
      .channel(`convs:${tenantId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conversations',
        filter: `tenant_id=eq.${tenantId}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setConversations(prev => [payload.new as Conversation, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setConversations(prev => prev.map(c =>
            c.id === (payload.new as Conversation).id ? payload.new as Conversation : c
          ));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenantId]);

  return { conversations, loading };
}

export function useRealtimeNotifications(tenantId: string | null) {
  const [unreadCount, setUnreadCount] = useState(0);
  const supabase = createClient();

  useEffect(() => {
    if (!tenantId) return;

    // Count unread conversations
    supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .then(({ count }) => setUnreadCount(count || 0));

    const channel = supabase
      .channel(`notif:${tenantId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'conversations',
        filter: `tenant_id=eq.${tenantId}`,
      }, () => {
        setUnreadCount(prev => prev + 1);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenantId]);

  const markRead = useCallback(() => setUnreadCount(0), []);

  return { unreadCount, markRead };
}
