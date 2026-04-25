-- Audit fix: el cron /api/cron/analytics hacía 11 queries serial por tenant
-- → con 1k tenants se acercaba al timeout de 300s. Esta función hace todo
-- en 1 sola query con CTEs paralelas + upsert al final.
--
-- IDEMPOTENTE.

CREATE OR REPLACE FUNCTION compute_daily_analytics_for_tenant(
  p_tenant_id UUID,
  p_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_start TIMESTAMPTZ := (p_date::TEXT || 'T00:00:00')::TIMESTAMPTZ;
  v_end   TIMESTAMPTZ := (p_date::TEXT || 'T23:59:59')::TIMESTAMPTZ;
BEGIN
  WITH
    msg_stats AS (
      SELECT
        COUNT(*) FILTER (WHERE direction = 'inbound')                          AS inbound,
        COUNT(*) FILTER (WHERE direction = 'outbound')                         AS outbound,
        COUNT(*) FILTER (WHERE sender_type = 'human')                          AS handoff,
        COALESCE(SUM(cost_usd) FILTER (WHERE cost_usd IS NOT NULL), 0)::NUMERIC AS llm_cost
      FROM messages
      WHERE tenant_id = p_tenant_id AND created_at >= v_start AND created_at <= v_end
    ),
    apt_stats AS (
      SELECT
        COUNT(*) FILTER (WHERE created_at >= v_start AND created_at <= v_end)  AS booked,
        COUNT(*) FILTER (WHERE status = 'no_show'   AND datetime >= v_start AND datetime <= v_end) AS no_show,
        COUNT(*) FILTER (WHERE status = 'cancelled' AND datetime >= v_start AND datetime <= v_end) AS cancelled
      FROM appointments
      WHERE tenant_id = p_tenant_id
    ),
    order_stats AS (
      SELECT
        COUNT(*)                          AS total,
        COALESCE(SUM(total), 0)::NUMERIC  AS revenue
      FROM orders
      WHERE tenant_id = p_tenant_id AND created_at >= v_start AND created_at <= v_end
    ),
    conv_stats AS (
      SELECT COUNT(*) AS new_count
      FROM conversations
      WHERE tenant_id = p_tenant_id AND created_at >= v_start AND created_at <= v_end
    )
  INSERT INTO daily_analytics (
    tenant_id, date,
    conversations_new, messages_inbound, messages_outbound, handoffs_human,
    appointments_booked, appointments_no_show, appointments_cancelled,
    orders_total, orders_revenue, llm_cost_usd, messages_saved, minutes_saved
  )
  SELECT
    p_tenant_id, p_date,
    conv_stats.new_count, msg_stats.inbound, msg_stats.outbound, msg_stats.handoff,
    apt_stats.booked, apt_stats.no_show, apt_stats.cancelled,
    order_stats.total, order_stats.revenue, msg_stats.llm_cost,
    msg_stats.inbound, msg_stats.inbound * 2.5
  FROM msg_stats, apt_stats, order_stats, conv_stats
  ON CONFLICT (tenant_id, date) DO UPDATE SET
    conversations_new       = EXCLUDED.conversations_new,
    messages_inbound        = EXCLUDED.messages_inbound,
    messages_outbound       = EXCLUDED.messages_outbound,
    handoffs_human          = EXCLUDED.handoffs_human,
    appointments_booked     = EXCLUDED.appointments_booked,
    appointments_no_show    = EXCLUDED.appointments_no_show,
    appointments_cancelled  = EXCLUDED.appointments_cancelled,
    orders_total            = EXCLUDED.orders_total,
    orders_revenue          = EXCLUDED.orders_revenue,
    llm_cost_usd            = EXCLUDED.llm_cost_usd,
    messages_saved          = EXCLUDED.messages_saved,
    minutes_saved           = EXCLUDED.minutes_saved;
END;
$$;

-- Composite indexes para acelerar las CTEs de arriba (también ayudan a otros
-- crons como retencion / agenda-gap que filtran por (tenant_id, status, datetime))
CREATE INDEX IF NOT EXISTS idx_messages_tenant_dir_created
  ON messages (tenant_id, direction, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_sender_created
  ON messages (tenant_id, sender_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_status_datetime
  ON appointments (tenant_id, status, datetime);
