-- ATIENDE.AI — SCHEMA COMPLETO DE BASE DE DATOS
-- Ejecutar en Supabase > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════════
-- 1. EXTENSIONES
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- 2. TIPOS ENUMERADOS
CREATE TYPE business_type AS ENUM (
'dental','medical','nutritionist','dermatologist','psychologist',
'gynecologist','pediatrician','ophthalmologist','restaurant',
'taqueria','cafe','hotel','real_estate','salon','barbershop',
'spa','gym','veterinary','pharmacy','school','insurance',
'mechanic','accountant','florist','optics','other'
);
CREATE TYPE plan_type AS ENUM ('free_trial','basic','pro','premium');
CREATE TYPE agent_status AS ENUM (
'onboarding','testing','active','paused','cancelled'
);
-- 3. TABLA PRINCIPAL: TENANTS (cada negocio = 1 tenant)
CREATE TABLE tenants (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
-- Negocio
name TEXT NOT NULL,
slug TEXT UNIQUE,
business_type business_type NOT NULL,
plan plan_type DEFAULT 'free_trial',
status agent_status DEFAULT 'onboarding',
trial_ends_at TIMESTAMPTZ DEFAULT (now() + interval '14 days'),
-- Contacto
email TEXT, phone TEXT, address TEXT,
city TEXT DEFAULT 'Merida', state TEXT DEFAULT 'Yucatan',
lat DECIMAL(10,7), lng DECIMAL(10,7),
google_place_id TEXT, website TEXT,
-- WhatsApp
wa_phone_number_id TEXT,
wa_waba_id TEXT,
wa_display_phone TEXT,
wa_token TEXT, -- encrypted business token
has_chat_agent BOOLEAN DEFAULT false,
-- Voice
retell_agent_id TEXT,
telnyx_number TEXT,
elevenlabs_voice_id TEXT DEFAULT 'JBFqnCBsd6RMkjVDRZzb',
has_voice_agent BOOLEAN DEFAULT false,
-- Prompts
chat_system_prompt TEXT,
voice_system_prompt TEXT,
welcome_message TEXT DEFAULT 'Hola! Bienvenido(a). Soy su asistente virtual. En que le puedo ayudar?',
-- LLM config
llm_primary TEXT DEFAULT 'google/gemini-2.5-flash-lite',
llm_sensitive TEXT DEFAULT 'anthropic/claude-sonnet-4-6',
llm_classifier TEXT DEFAULT 'openai/gpt-5-nano',
temperature DECIMAL(2,1) DEFAULT 0.5,
-- Branding
bot_name TEXT DEFAULT 'Asistente',
timezone TEXT DEFAULT 'America/Merida',
business_hours JSONB DEFAULT '{
"lun":"09:00-18:00","mar":"09:00-18:00",
"mie":"09:00-18:00","jue":"09:00-18:00",
"vie":"09:00-18:00","sab":"09:00-14:00"
}',
config JSONB DEFAULT '{}',
-- Billing
stripe_customer_id TEXT,
conekta_customer_id TEXT,
rfc TEXT, -- facturacion MX
-- Timestamps
created_at TIMESTAMPTZ DEFAULT now(),
updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_tenants_user ON tenants(user_id);
CREATE INDEX idx_tenants_wa ON tenants(wa_phone_number_id);
CREATE INDEX idx_tenants_slug ON tenants(slug);
-- 4. STAFF (doctores, estilistas, meseros, etc.)
CREATE TABLE staff (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
name TEXT NOT NULL,
role TEXT,
speciality TEXT,
google_calendar_id TEXT,
schedule JSONB,
default_duration INT DEFAULT 30,
active BOOLEAN DEFAULT true,
created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_staff_tenant ON staff(tenant_id);
-- 5. SERVICIOS con precios
CREATE TABLE services (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
name TEXT NOT NULL,
description TEXT,
price DECIMAL(10,2),
duration_minutes INT DEFAULT 30,
category TEXT,
active BOOLEAN DEFAULT true,
created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_services_tenant ON services(tenant_id);
-- 6. KNOWLEDGE BASE (RAG — anti-alucinacion)
CREATE TABLE knowledge_chunks (
id BIGSERIAL PRIMARY KEY,
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
content TEXT NOT NULL,
embedding VECTOR(1536),
category TEXT,
source TEXT DEFAULT 'onboarding',
created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_kb_hnsw ON knowledge_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_kb_tenant ON knowledge_chunks(tenant_id);
CREATE INDEX idx_kb_category ON knowledge_chunks(tenant_id, category);
-- 7. CONTACTOS (clientes del negocio)
CREATE TABLE contacts (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
phone TEXT NOT NULL,
name TEXT,
email TEXT,
tags TEXT[],
lead_score INT DEFAULT 0,
lead_temperature TEXT,
last_contact_at TIMESTAMPTZ,
metadata JSONB DEFAULT '{}',
created_at TIMESTAMPTZ DEFAULT now(),
UNIQUE(tenant_id, phone)
);
CREATE INDEX idx_contacts_tenant ON contacts(tenant_id);
CREATE INDEX idx_contacts_phone ON contacts(tenant_id, phone);
-- 8. CONVERSACIONES
CREATE TABLE conversations (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
contact_id UUID REFERENCES contacts(id),
customer_phone TEXT NOT NULL,
customer_name TEXT,
channel TEXT DEFAULT 'whatsapp',
status TEXT DEFAULT 'active',
assigned_to UUID REFERENCES staff(id),
tags TEXT[],
last_message_at TIMESTAMPTZ,
created_at TIMESTAMPTZ DEFAULT now(),
UNIQUE(tenant_id, customer_phone, channel)
);
CREATE INDEX idx_conv_tenant ON conversations(tenant_id);
CREATE INDEX idx_conv_status ON conversations(tenant_id, status);
-- 9. MENSAJES (chat + voice transcripts)
CREATE TABLE messages (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
tenant_id UUID NOT NULL REFERENCES tenants(id),
direction TEXT NOT NULL,
sender_type TEXT DEFAULT 'customer',
content TEXT,
message_type TEXT DEFAULT 'text',
intent TEXT,
model_used TEXT,
tokens_in INT,
tokens_out INT,
cost_usd DECIMAL(10,6),
response_time_ms INT,
confidence DECIMAL(3,2),
wa_message_id TEXT,
created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_msg_conv ON messages(conversation_id);
CREATE INDEX idx_msg_tenant ON messages(tenant_id);
CREATE INDEX idx_msg_created ON messages(tenant_id, created_at DESC);

-- Message delivery tracking
ALTER TABLE messages ADD COLUMN IF NOT EXISTS wa_status TEXT DEFAULT 'sent';
-- sent, delivered, read
ALTER TABLE messages ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;
-- 10. CITAS
CREATE TABLE appointments (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id),
staff_id UUID REFERENCES staff(id),
service_id UUID REFERENCES services(id),
contact_id UUID REFERENCES contacts(id),
conversation_id UUID REFERENCES conversations(id),
customer_phone TEXT NOT NULL,
customer_name TEXT,
datetime TIMESTAMPTZ NOT NULL,
end_datetime TIMESTAMPTZ,
duration_minutes INT DEFAULT 30,
status TEXT DEFAULT 'scheduled',
google_event_id TEXT,
reminder_24h_sent BOOLEAN DEFAULT false,
reminder_1h_sent BOOLEAN DEFAULT false,
notes TEXT,
source TEXT DEFAULT 'chat',
created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_apt_tenant ON appointments(tenant_id);
CREATE INDEX idx_apt_datetime ON appointments(tenant_id, datetime);
CREATE INDEX idx_apt_status ON appointments(tenant_id, status);
-- 11. PEDIDOS (restaurantes, taquerias, cafeterias)
CREATE TABLE orders (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id),
conversation_id UUID REFERENCES conversations(id),
contact_id UUID REFERENCES contacts(id),
customer_phone TEXT,
customer_name TEXT,
items JSONB NOT NULL,
subtotal DECIMAL(10,2),
delivery_fee DECIMAL(10,2) DEFAULT 0,
total DECIMAL(10,2),
order_type TEXT DEFAULT 'delivery',
delivery_address TEXT,
status TEXT DEFAULT 'pending',
payment_method TEXT,
payment_status TEXT DEFAULT 'pending',
estimated_time_min INT,
notes TEXT,
created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_orders_tenant ON orders(tenant_id);
CREATE INDEX idx_orders_status ON orders(tenant_id, status);
-- 12. LEADS (inmobiliarias, seguros, escuelas)
CREATE TABLE leads (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id),
contact_id UUID REFERENCES contacts(id),
conversation_id UUID REFERENCES conversations(id),
customer_phone TEXT,
customer_name TEXT,
budget TEXT,
authority TEXT,
need TEXT,
timeline TEXT,
property_type TEXT,
zone TEXT,
bedrooms INT,
credit_type TEXT,
score INT DEFAULT 0,
temperature TEXT DEFAULT 'cold',
status TEXT DEFAULT 'new',
assigned_to UUID REFERENCES staff(id),
notes TEXT,
created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_leads_tenant ON leads(tenant_id);
CREATE INDEX idx_leads_score ON leads(tenant_id, score DESC);
-- 13. LLAMADAS DE VOZ
CREATE TABLE voice_calls (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id),
conversation_id UUID REFERENCES conversations(id),
contact_id UUID REFERENCES contacts(id),
retell_call_id TEXT UNIQUE,
direction TEXT,
from_number TEXT,
to_number TEXT,
duration_seconds INT,
cost_usd DECIMAL(10,4),
transcript TEXT,
transcript_segments JSONB,
summary TEXT,
sentiment TEXT,
outcome TEXT,
recording_url TEXT,
metadata JSONB DEFAULT '{}',
started_at TIMESTAMPTZ,
ended_at TIMESTAMPTZ,
created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_calls_tenant ON voice_calls(tenant_id);
CREATE INDEX idx_calls_retell ON voice_calls(retell_call_id);
-- 14. ANALYTICS DIARIAS (pre-agregadas para dashboards)
CREATE TABLE daily_analytics (
id BIGSERIAL PRIMARY KEY,
tenant_id UUID NOT NULL REFERENCES tenants(id),
date DATE NOT NULL,
conversations_new INT DEFAULT 0,
messages_inbound INT DEFAULT 0,
messages_outbound INT DEFAULT 0,
messages_audio INT DEFAULT 0,
avg_response_ms INT,
handoffs_human INT DEFAULT 0,
ai_resolution_rate DECIMAL(5,2),
appointments_booked INT DEFAULT 0,
appointments_confirmed INT DEFAULT 0,
appointments_completed INT DEFAULT 0,
appointments_no_show INT DEFAULT 0,
appointments_cancelled INT DEFAULT 0,
appointments_after_hours INT DEFAULT 0,
orders_total INT DEFAULT 0,
orders_delivery INT DEFAULT 0,
orders_pickup INT DEFAULT 0,
orders_dine_in INT DEFAULT 0,
orders_revenue DECIMAL(10,2) DEFAULT 0,
avg_order_value DECIMAL(10,2),
leads_new INT DEFAULT 0,
leads_qualified INT DEFAULT 0,
leads_hot INT DEFAULT 0,
visits_scheduled INT DEFAULT 0,
calls_total INT DEFAULT 0,
calls_inbound INT DEFAULT 0,
calls_outbound INT DEFAULT 0,
calls_duration_total INT DEFAULT 0,
calls_answered INT DEFAULT 0,
calls_transferred INT DEFAULT 0,
llm_cost_usd DECIMAL(10,4) DEFAULT 0,
voice_cost_usd DECIMAL(10,4) DEFAULT 0,
wa_cost_usd DECIMAL(10,4) DEFAULT 0,
total_cost_usd DECIMAL(10,4) DEFAULT 0,
messages_saved INT DEFAULT 0,
minutes_saved DECIMAL(10,1) DEFAULT 0,
estimated_savings_mxn DECIMAL(10,2) DEFAULT 0,
UNIQUE(tenant_id, date)
);
CREATE INDEX idx_analytics_tenant ON daily_analytics(tenant_id, date DESC);
-- 15. MARKETPLACE DE AGENTES
CREATE TABLE marketplace_agents (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
slug TEXT UNIQUE NOT NULL,
name TEXT NOT NULL,
description TEXT,
long_description TEXT,
category TEXT,
icon TEXT,
price_mxn DECIMAL(10,2),
trigger_type TEXT,
trigger_config JSONB,
prompt_template TEXT,
config_schema JSONB,
required_plan plan_type DEFAULT 'basic',
is_active BOOLEAN DEFAULT true,
created_at TIMESTAMPTZ DEFAULT now()
);
-- 16. AGENTES ACTIVADOS POR TENANT
CREATE TABLE tenant_agents (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
agent_id UUID NOT NULL REFERENCES marketplace_agents(id),
config JSONB DEFAULT '{}',
is_active BOOLEAN DEFAULT true,
last_run_at TIMESTAMPTZ,
run_count INT DEFAULT 0,
activated_at TIMESTAMPTZ DEFAULT now(),
UNIQUE(tenant_id, agent_id)
);
CREATE INDEX idx_ta_tenant ON tenant_agents(tenant_id);
-- 17. ONBOARDING RESPONSES
CREATE TABLE onboarding_responses (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
step INT NOT NULL,
question_key TEXT NOT NULL,
answer JSONB NOT NULL,
created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_onb_tenant ON onboarding_responses(tenant_id);
-- 18. DASHBOARD CONFIGS POR INDUSTRIA
CREATE TABLE dashboard_configs (
business_type business_type PRIMARY KEY,
kpis JSONB NOT NULL,
charts JSONB NOT NULL,
modules JSONB NOT NULL,
extra_tables JSONB DEFAULT '[]'
);
-- 19. AUDIT LOG (opcional pero recomendado)
CREATE TABLE audit_log (
id BIGSERIAL PRIMARY KEY,
tenant_id UUID REFERENCES tenants(id),
user_id UUID,
action TEXT NOT NULL,
entity_type TEXT,
entity_id UUID,
details JSONB,
ip_address TEXT,
created_at TIMESTAMPTZ DEFAULT now()
);
-- ═══════════════════════════════════════════════════════════
-- FUNCIONES
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION search_knowledge(
p_tenant UUID,
p_query VECTOR(1536),
p_threshold FLOAT DEFAULT 0.35,
p_limit INT DEFAULT 5
) RETURNS TABLE (
content TEXT, similarity FLOAT, category TEXT
) LANGUAGE sql STABLE AS $$
SELECT
kc.content,
1 - (kc.embedding <=> p_query) AS similarity,
kc.category
FROM knowledge_chunks kc
WHERE kc.tenant_id = p_tenant
AND 1 - (kc.embedding <=> p_query) > p_threshold
ORDER BY kc.embedding <=> p_query
LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION get_user_tenant_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
SELECT id FROM tenants
WHERE user_id = auth.uid()
LIMIT 1;
$$;
-- ═══════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_own" ON tenants FOR ALL
USING (user_id = auth.uid());
CREATE POLICY "tenant_data" ON staff FOR ALL
USING (tenant_id = get_user_tenant_id());
CREATE POLICY "tenant_data" ON services FOR ALL
USING (tenant_id = get_user_tenant_id());
CREATE POLICY "tenant_data" ON contacts FOR ALL
USING (tenant_id = get_user_tenant_id());
CREATE POLICY "tenant_data" ON conversations FOR ALL
USING (tenant_id = get_user_tenant_id());
CREATE POLICY "tenant_data" ON messages FOR ALL
USING (tenant_id = get_user_tenant_id());
CREATE POLICY "tenant_data" ON appointments FOR ALL
USING (tenant_id = get_user_tenant_id());
CREATE POLICY "tenant_data" ON orders FOR ALL
USING (tenant_id = get_user_tenant_id());
CREATE POLICY "tenant_data" ON leads FOR ALL
USING (tenant_id = get_user_tenant_id());
CREATE POLICY "tenant_data" ON voice_calls FOR ALL
USING (tenant_id = get_user_tenant_id());
CREATE POLICY "tenant_data" ON knowledge_chunks FOR ALL
USING (tenant_id = get_user_tenant_id());
CREATE POLICY "tenant_data" ON daily_analytics FOR ALL
USING (tenant_id = get_user_tenant_id());
CREATE POLICY "tenant_data" ON tenant_agents FOR ALL
USING (tenant_id = get_user_tenant_id());
CREATE POLICY "tenant_data" ON onboarding_responses FOR ALL
USING (tenant_id = get_user_tenant_id());
-- marketplace_agents es publico (lectura)
CREATE POLICY "public_read" ON marketplace_agents FOR SELECT
USING (true);

-- SEED: 15 Marketplace Agents
INSERT INTO marketplace_agents (slug, name, description, category, icon, price_mxn, trigger_type, trigger_config, required_plan) VALUES
('cobrador', 'Cobrador', 'Recordatorios de pago automáticos', 'cobranza', '💰', 499, 'cron', '{"schedule":"0 10 * * 1,3,5"}', 'basic'),
('resenas', 'Reseñas Google', 'Solicita reseñas post-servicio', 'marketing', '⭐', 299, 'event', '{"event":"appointment.completed","delay":"24h"}', 'basic'),
('reactivacion', 'Reactivación', 'Contacta clientes inactivos 90+ días', 'marketing', '🔄', 399, 'cron', '{"schedule":"0 10 1 * *"}', 'pro'),
('cumpleanos', 'Cumpleaños', 'Felicitación + oferta especial', 'marketing', '🎂', 199, 'cron', '{"schedule":"0 9 * * *"}', 'basic'),
('referidos', 'Referidos', 'Programa de referidos post-reseña positiva', 'marketing', '🤝', 299, 'event', '{"event":"review.positive"}', 'pro'),
('nps', 'NPS Survey', 'Encuesta 3 preguntas post-servicio', 'analytics', '📊', 199, 'event', '{"event":"appointment.completed","delay":"2h"}', 'basic'),
('reportes', 'Reportes Semanales', 'Resumen semanal por email al dueño', 'analytics', '📈', 299, 'cron', '{"schedule":"0 9 * * 1"}', 'pro'),
('faq_builder', 'FAQ Builder', 'Detecta gaps en knowledge base', 'analytics', '🧠', 199, 'cron', '{"schedule":"0 0 * * 0"}', 'pro'),
('seguimiento', 'Seguimiento Post-Servicio', 'Instrucciones de cuidado post-servicio', 'ops', '📋', 299, 'event', '{"event":"appointment.completed","delay":"4h"}', 'basic'),
('optimizador', 'Optimizador de Agenda', 'Recupera cancelaciones contactando lista de espera', 'ops', '📅', 399, 'event', '{"event":"appointment.cancelled"}', 'pro'),
('bilingue', 'Bilingüe', 'Detecta idioma y responde en el mismo', 'ops', '🌐', 299, 'event', '{"event":"conversation.new"}', 'pro'),
('inventario', 'Inventario', 'Verifica stock al recibir pedido', 'ops', '📦', 299, 'event', '{"event":"order.new"}', 'pro'),
('calificador', 'Calificador de Leads', 'BANT scoring automático 0-100', 'ventas', '🎯', 399, 'event', '{"event":"conversation.new"}', 'pro'),
('upselling', 'Upselling', 'Recomienda servicios complementarios', 'ventas', '💎', 299, 'event', '{"event":"appointment.completed"}', 'basic'),
('redes_sociales', 'Redes Sociales', 'Responde comentarios y redirige a WhatsApp', 'marketing', '📱', 399, 'event', '{"event":"social.comment"}', 'pro'),
-- 10 NEW high-value agents
('confirmacion_cita', 'Confirmación de Cita', 'Envía botones Confirmar/Cancelar/Reagendar 24h antes', 'ops', '✅', 199, 'cron', '{"schedule":"0 10 * * *"}', 'basic'),
('lista_espera', 'Lista de Espera', 'Cuando se cancela cita, notifica al siguiente en lista', 'ops', '⏳', 299, 'event', '{"event":"appointment.cancelled"}', 'pro'),
('menu_catalogo', 'Menú/Catálogo', 'Envía menú PDF o lista de servicios cuando cliente pregunta', 'ventas', '📄', 199, 'event', '{"event":"intent.menu_request"}', 'basic'),
('link_pago', 'Link de Pago', 'Genera y envía link de pago OXXO/SPEI/tarjeta por WhatsApp', 'cobranza', '💳', 399, 'event', '{"event":"appointment.completed"}', 'pro'),
('direcciones', 'Direcciones Google Maps', 'Envía ubicación del negocio cuando cliente pregunta cómo llegar', 'ops', '📍', 99, 'event', '{"event":"intent.location"}', 'basic'),
('happy_hour', 'Promociones Programadas', 'Envía ofertas en horarios específicos (happy hour, martes 2x1)', 'marketing', '🎉', 299, 'cron', '{"schedule":"0 16 * * 1-5"}', 'pro'),
('rendimiento_staff', 'Rendimiento de Staff', 'Reporte semanal de citas/pedidos por empleado', 'analytics', '👥', 349, 'cron', '{"schedule":"0 9 * * 1"}', 'pro'),
('nurturing', 'Lead Nurturing', 'Secuencia automática día 1, 3, 7, 14 para leads no convertidos', 'ventas', '🌱', 499, 'event', '{"event":"lead.new"}', 'premium'),
('respuesta_resenas', 'Respuesta a Reseñas', 'Auto-genera respuestas profesionales a reseñas Google', 'marketing', '💬', 349, 'event', '{"event":"review.new"}', 'pro'),
('horario_fuera', 'Fuera de Horario', 'Mensaje personalizado fuera de horario con próxima apertura', 'ops', '🌙', 149, 'event', '{"event":"message.after_hours"}', 'basic');

-- 20. WEBHOOK EVENT LOGS (debugging + observability)
CREATE TABLE webhook_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  provider TEXT NOT NULL, -- 'whatsapp', 'stripe', 'conekta', 'retell'
  event_type TEXT, -- 'message', 'status', 'checkout.completed', 'call_ended'
  direction TEXT DEFAULT 'inbound', -- 'inbound', 'outbound'
  status_code INT,
  payload JSONB,
  error TEXT,
  duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_wh_logs_tenant ON webhook_logs(tenant_id, created_at DESC);
CREATE INDEX idx_wh_logs_provider ON webhook_logs(provider, created_at DESC);
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_data" ON webhook_logs FOR ALL
USING (tenant_id = get_user_tenant_id());
