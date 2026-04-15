export interface Tenant {
  id: string; user_id: string; name: string; slug: string;
  business_type: string; plan: 'free_trial'|'basic'|'pro'|'premium';
  status: 'onboarding'|'testing'|'active'|'paused'|'cancelled';
  email: string; phone: string; address: string; city: string; state: string;
  wa_phone_number_id: string|null; wa_waba_id: string|null; wa_display_phone: string|null;
  has_chat_agent: boolean; retell_agent_id: string|null; telnyx_number: string|null; has_voice_agent: boolean;
  chat_system_prompt: string|null; voice_system_prompt: string|null; welcome_message: string|null;
  llm_primary: string; llm_sensitive: string; llm_classifier: string;
  temperature: number; bot_name: string; timezone: string;
  business_hours: Record<string,string>; config: Record<string, unknown>;
  stripe_customer_id: string|null; conekta_customer_id: string|null;
  // Voice billing (plan premium) — populados al checkout de premium o manual.
  voice_minutes_included: number;            // 0 = sin voz, 200 = premium
  stripe_subscription_item_voice_id: string|null;
  trial_ends_at: string|null; created_at: string;
}

export interface Conversation {
  id: string; tenant_id: string; contact_id: string|null;
  customer_phone: string; customer_name: string|null;
  channel: 'whatsapp'|'voice'|'web'; status: 'active'|'resolved'|'human_handoff'|'spam';
  last_message_at: string|null; created_at: string;
}

export interface Message {
  id: string; conversation_id: string; tenant_id: string;
  direction: 'inbound'|'outbound'; sender_type: 'customer'|'bot'|'human'|'system';
  content: string|null; message_type: string; intent: string|null;
  model_used: string|null; tokens_in: number|null; tokens_out: number|null;
  cost_usd: number|null; created_at: string;
}

export interface Appointment {
  id: string; tenant_id: string; staff_id: string|null; service_id: string|null;
  customer_phone: string; customer_name: string|null; datetime: string;
  duration_minutes: number; status: 'scheduled'|'confirmed'|'completed'|'no_show'|'cancelled';
  source: 'chat'|'voice'|'manual'; created_at: string;
}
