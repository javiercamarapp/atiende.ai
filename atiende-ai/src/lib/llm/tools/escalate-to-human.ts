// ═════════════════════════════════════════════════════════════════════════════
// TOOL: escalate_to_human
//
// Marca la conversación como `human_handoff` para que el equipo del tenant
// la atienda manualmente desde el dashboard. Notifica al dueño con el motivo.
//
// Categorías:
//   - 'complaint'    → queja formal del cliente
//   - 'emergency'    → urgencia médica/operativa que requiere atención YA
//   - 'crisis'       → crisis personal del cliente (suicidio, violencia, etc.)
//   - 'user_request' → cliente PIDIÓ explícitamente hablar con un humano
//   - 'agent_unsure' → el LLM no sabe qué hacer y prefiere escalar
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

const argsSchema = z
  .object({
    reason: z.enum(['complaint', 'emergency', 'crisis', 'user_request', 'agent_unsure']),
    /** Resumen breve para el dueño (qué pasó, qué necesita el cliente). */
    summary: z.string().min(1).max(500),
  })
  .strict();

interface EscalateResult {
  success: boolean;
  /** Mensaje sugerido para mostrar al cliente. El LLM puede usarlo o reformularlo. */
  suggested_message_to_customer: string;
  notified_owner: boolean;
}

const TAG_BY_REASON: Record<string, string[]> = {
  complaint: ['complaint', 'urgent'],
  emergency: ['emergency', 'urgent'],
  crisis: ['crisis', 'urgent'],
  user_request: ['human_requested'],
  agent_unsure: ['needs_review'],
};

const SUGGESTED_MESSAGES: Record<string, string> = {
  complaint:
    'Lamento mucho la situación. Ya comuniqué su caso a nuestro equipo y alguien le contactará en los próximos minutos para resolverlo personalmente.',
  emergency:
    'Entiendo que es urgente. Ya notifiqué al equipo y lo van a contactar de inmediato. Si requiere atención médica de emergencia, llame al 911.',
  crisis:
    'Estoy aquí. Sé que esto es difícil. Ya avisé al equipo para que te contacten cuanto antes. Si necesitas ayuda inmediata, marca al 911 o a la Línea de la Vida 800-911-2000.',
  user_request:
    'Por supuesto, lo comunico con nuestro equipo. En unos momentos le atenderán por aquí mismo.',
  agent_unsure:
    'Permítame consultar con el equipo para darle la mejor respuesta. Le contactarán en breve.',
};

async function handler(rawArgs: unknown, ctx: ToolContext): Promise<EscalateResult> {
  const args = argsSchema.parse(rawArgs);

  // 1. Marcar conversación human_handoff con tags relevantes
  const tags = TAG_BY_REASON[args.reason] || ['needs_review'];
  await supabaseAdmin
    .from('conversations')
    .update({ status: 'human_handoff', tags })
    .eq('id', ctx.conversationId);

  // 2. Subir lead_temperature a hot para que el dueño lo vea como prioritario
  if (args.reason === 'complaint' || args.reason === 'emergency') {
    try {
      await supabaseAdmin
        .from('contacts')
        .update({ lead_temperature: 'hot', tags: tags })
        .eq('id', ctx.contactId);
    } catch {
      /* best effort */
    }
  }

  // 3. Notificar al dueño con el resumen
  let notified_owner = false;
  try {
    const { notifyOwner } = await import('@/lib/actions/notifications');
    const eventMap: Record<
      string,
      'complaint' | 'emergency' | 'crisis' | 'lead_hot'
    > = {
      complaint: 'complaint',
      emergency: 'emergency',
      crisis: 'crisis',
      user_request: 'lead_hot',
      agent_unsure: 'lead_hot',
    };
    await notifyOwner({
      tenantId: ctx.tenantId,
      event: eventMap[args.reason],
      details: `Cliente: ${ctx.customerPhone}\nMotivo: ${args.reason}\n\n${args.summary}`,
    });
    notified_owner = true;
  } catch {
    /* best effort */
  }

  return {
    success: true,
    suggested_message_to_customer: SUGGESTED_MESSAGES[args.reason] || SUGGESTED_MESSAGES.user_request,
    notified_owner,
  };
}

registerTool('escalate_to_human', {
  schema: {
    type: 'function',
    function: {
      name: 'escalate_to_human',
      description:
        'Marca la conversación como handoff a humano. Úsalo SIEMPRE en estos casos: queja del cliente (complaint), urgencia médica/operativa (emergency), crisis personal del cliente como suicidio/violencia (crisis), cuando el cliente pide expresamente hablar con humano (user_request), o cuando NO sabes qué hacer (agent_unsure). Después de llamar esta tool, usa `suggested_message_to_customer` o reformúlalo y envíalo como tu respuesta final.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            enum: ['complaint', 'emergency', 'crisis', 'user_request', 'agent_unsure'],
            description: 'Categoría que mejor describe por qué escalas.',
          },
          summary: {
            type: 'string',
            description: 'Resumen breve (1-2 oraciones) para el equipo: qué pasó y qué necesita el cliente.',
          },
        },
        required: ['reason', 'summary'],
        additionalProperties: false,
      },
    },
  },
  handler,
});
