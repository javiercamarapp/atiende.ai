import { supabaseAdmin } from '@/lib/supabase/admin';

// Agent modules
import { runResenas, runReactivacion, runCumpleanos, runReferidos, runRedesSociales, runHappyHour, runRespuestaResenas } from './agents/marketing';
import { runCobrador, runSeguimiento, runOptimizador, runBilingue, runInventario, runConfirmacionCita, runListaEspera, runMenuCatalogo, runDirecciones, runHorarioFuera } from './agents/operations';
import { runNPS, runReportes, runFAQBuilder, runRendimientoStaff } from './agents/analytics';
import { runCalificador, runUpselling, runNurturing, runLinkPago } from './agents/sales';

// ═══════════════════════════════════════════════════════════
// MARKETPLACE AGENT EXECUTION ENGINE
// Routes 25 marketplace agents to their module handlers
// ═══════════════════════════════════════════════════════════

export interface AgentContext {
  tenantId: string;
  agentSlug: string;
  config: Record<string, unknown>;
  tenant: Record<string, unknown>;
}

// ── CRON EXECUTOR ──────────────────────────────────────────
export async function executeCronAgents(schedule: string) {
  const { data: activeAgents } = await supabaseAdmin
    .from('tenant_agents')
    .select(`
      id, tenant_id, config, run_count, is_active,
      agent:agent_id(slug, trigger_type, trigger_config, prompt_template),
      tenant:tenant_id(id, name, wa_phone_number_id, business_type, chat_system_prompt, email, phone, address, lat, lng, business_hours)
    `)
    .eq('is_active', true);

  if (!activeAgents?.length) return { executed: 0 };

  let executed = 0;
  for (const ta of activeAgents) {
    const agent = ta.agent as unknown as Record<string, unknown> | null;
    if (!agent || agent.trigger_type !== 'cron') continue;
    const conf = agent.trigger_config as Record<string, string> | null;
    if (conf?.schedule !== schedule) continue;

    try {
      const tenant = ta.tenant as unknown as Record<string, unknown>;
      await runAgent(agent.slug as string, {
        tenantId: tenant.id as string,
        agentSlug: agent.slug as string,
        config: (ta.config as Record<string, unknown>) || {},
        tenant,
      });
      await supabaseAdmin.from('tenant_agents').update({
        last_run_at: new Date().toISOString(),
        run_count: ((ta.run_count as number) || 0) + 1,
      }).eq('id', ta.id);
      executed++;
    } catch (err) {
      console.error(`Agent ${(agent.slug as string)} failed for tenant ${ta.tenant_id}:`, err);
    }
  }
  return { executed };
}

// ── EVENT EXECUTOR ─────────────────────────────────────────
export async function executeEventAgents(eventName: string, payload: Record<string, unknown>) {
  const { data: activeAgents } = await supabaseAdmin
    .from('tenant_agents')
    .select(`
      id, tenant_id, config, run_count, is_active,
      agent:agent_id(slug, trigger_type, trigger_config, prompt_template),
      tenant:tenant_id(id, name, wa_phone_number_id, business_type, chat_system_prompt, email, phone, address, lat, lng)
    `)
    .eq('is_active', true);

  if (!activeAgents?.length) return { executed: 0 };

  let executed = 0;
  for (const ta of activeAgents) {
    const agent = ta.agent as unknown as Record<string, unknown> | null;
    if (!agent || agent.trigger_type !== 'event') continue;
    const conf = agent.trigger_config as Record<string, string> | null;
    if (conf?.event !== eventName) continue;

    try {
      const tenant = ta.tenant as unknown as Record<string, unknown>;
      await runAgent(agent.slug as string, {
        tenantId: tenant.id as string,
        agentSlug: agent.slug as string,
        config: { ...(ta.config as Record<string, unknown>), eventPayload: payload },
        tenant,
      });
      await supabaseAdmin.from('tenant_agents').update({
        last_run_at: new Date().toISOString(),
        run_count: ((ta.run_count as number) || 0) + 1,
      }).eq('id', ta.id);
      executed++;
    } catch (err) {
      console.error(`Agent ${(agent.slug as string)} failed:`, err);
    }
  }
  return { executed };
}

// ── AGENT ROUTER ───────────────────────────────────────────
async function runAgent(slug: string, ctx: AgentContext) {
  const handlers: Record<string, (c: AgentContext) => Promise<void>> = {
    // Marketing
    resenas: runResenas,
    reactivacion: runReactivacion,
    cumpleanos: runCumpleanos,
    referidos: runReferidos,
    redes_sociales: runRedesSociales,
    happy_hour: runHappyHour,
    respuesta_resenas: runRespuestaResenas,
    // Operations
    cobrador: runCobrador,
    seguimiento: runSeguimiento,
    optimizador: runOptimizador,
    bilingue: runBilingue,
    inventario: runInventario,
    confirmacion_cita: runConfirmacionCita,
    lista_espera: runListaEspera,
    menu_catalogo: runMenuCatalogo,
    direcciones: runDirecciones,
    horario_fuera: runHorarioFuera,
    // Analytics
    nps: runNPS,
    reportes: runReportes,
    faq_builder: runFAQBuilder,
    rendimiento_staff: runRendimientoStaff,
    // Sales
    calificador: runCalificador,
    upselling: runUpselling,
    nurturing: runNurturing,
    link_pago: runLinkPago,
  };
  const handler = handlers[slug];
  if (handler) await handler(ctx);
}
