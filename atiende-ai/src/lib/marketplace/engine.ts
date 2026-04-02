import { supabaseAdmin } from '@/lib/supabase/admin';

// Agent modules
import { runResenas, runReactivacion, runCumpleanos, runReferidos, runRedesSociales, runHappyHour, runRespuestaResenas } from './agents/marketing';
import { runCobrador, runSeguimiento, runOptimizador, runBilingue, runInventario, runConfirmacionCita, runListaEspera, runMenuCatalogo, runDirecciones, runHorarioFuera } from './agents/operations';
import { runNPS, runReportes, runFAQBuilder, runRendimientoStaff } from './agents/analytics';
import { runCalificador, runUpselling, runNurturing, runLinkPago } from './agents/sales';
import { runSmartFollowup } from './agents/smart-followup';

// ═══════════════════════════════════════════════════════════
// MARKETPLACE AGENT EXECUTION ENGINE
// Routes 25 marketplace agents to their module handlers
// Runs agents in parallel with concurrency limit and timeout
// ═══════════════════════════════════════════════════════════

const MAX_CONCURRENCY = 5;
const AGENT_TIMEOUT_MS = 30_000;

export interface AgentContext {
  tenantId: string;
  agentSlug: string;
  config: Record<string, unknown>;
  tenant: Record<string, unknown>;
}

interface AgentTask {
  taId: string;
  slug: string;
  ctx: AgentContext;
  runCount: number;
}

/**
 * Runs a promise with a timeout. Rejects if the promise does not
 * settle within the given number of milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Agent ${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Executes an array of agent tasks in parallel with a concurrency limit.
 * Uses Promise.allSettled so one failure never blocks others.
 * Returns the count of successfully executed agents and any errors.
 */
async function runTasksWithConcurrency(
  tasks: AgentTask[],
): Promise<{ executed: number; errors: Array<{ slug: string; error: string }> }> {
  let executed = 0;
  const errors: Array<{ slug: string; error: string }> = [];

  // Process in batches of MAX_CONCURRENCY
  for (let i = 0; i < tasks.length; i += MAX_CONCURRENCY) {
    const batch = tasks.slice(i, i + MAX_CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (task) => {
        await withTimeout(runAgent(task.slug, task.ctx), AGENT_TIMEOUT_MS, task.slug);

        // Update run metadata on success
        await supabaseAdmin.from('tenant_agents').update({
          last_run_at: new Date().toISOString(),
          run_count: task.runCount + 1,
        }).eq('id', task.taId);

        return task.slug;
      }),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === 'fulfilled') {
        executed++;
      } else {
        const slug = batch[j].slug;
        const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push({ slug, error: errMsg });
        console.error(`Agent ${slug} failed:`, errMsg);
      }
    }
  }

  return { executed, errors };
}

// -- CRON EXECUTOR --

export async function executeCronAgents(schedule: string) {
  const { data: activeAgents } = await supabaseAdmin
    .from('tenant_agents')
    .select(`
      id, tenant_id, config, run_count, is_active,
      agent:agent_id(slug, trigger_type, trigger_config, prompt_template),
      tenant:tenant_id(id, name, wa_phone_number_id, business_type, chat_system_prompt, email, phone, address, lat, lng, business_hours)
    `)
    .eq('is_active', true);

  if (!activeAgents?.length) return { executed: 0, errors: [] };

  const tasks: AgentTask[] = [];

  for (const ta of activeAgents) {
    const agent = ta.agent as unknown as Record<string, unknown> | null;
    if (!agent || agent.trigger_type !== 'cron') continue;
    const conf = agent.trigger_config as Record<string, string> | null;
    if (conf?.schedule !== schedule) continue;

    const tenant = ta.tenant as unknown as Record<string, unknown>;
    tasks.push({
      taId: ta.id as string,
      slug: agent.slug as string,
      ctx: {
        tenantId: tenant.id as string,
        agentSlug: agent.slug as string,
        config: (ta.config as Record<string, unknown>) || {},
        tenant,
      },
      runCount: (ta.run_count as number) || 0,
    });
  }

  return runTasksWithConcurrency(tasks);
}

// -- EVENT EXECUTOR --

export async function executeEventAgents(eventName: string, payload: Record<string, unknown>) {
  const { data: activeAgents } = await supabaseAdmin
    .from('tenant_agents')
    .select(`
      id, tenant_id, config, run_count, is_active,
      agent:agent_id(slug, trigger_type, trigger_config, prompt_template),
      tenant:tenant_id(id, name, wa_phone_number_id, business_type, chat_system_prompt, email, phone, address, lat, lng)
    `)
    .eq('is_active', true);

  if (!activeAgents?.length) return { executed: 0, errors: [] };

  const tasks: AgentTask[] = [];

  for (const ta of activeAgents) {
    const agent = ta.agent as unknown as Record<string, unknown> | null;
    if (!agent || agent.trigger_type !== 'event') continue;
    const conf = agent.trigger_config as Record<string, string> | null;
    if (conf?.event !== eventName) continue;

    const tenant = ta.tenant as unknown as Record<string, unknown>;
    tasks.push({
      taId: ta.id as string,
      slug: agent.slug as string,
      ctx: {
        tenantId: tenant.id as string,
        agentSlug: agent.slug as string,
        config: { ...(ta.config as Record<string, unknown>), eventPayload: payload },
        tenant,
      },
      runCount: (ta.run_count as number) || 0,
    });
  }

  return runTasksWithConcurrency(tasks);
}

// -- AGENT ROUTER --

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
    // Smart follow-up
    smart_followup: async (ctx: AgentContext) => {
      await runSmartFollowup(ctx.tenantId, ctx.config);
    },
  };
  const handler = handlers[slug];
  if (handler) await handler(ctx);
}
