// ═════════════════════════════════════════════════════════════════════════════
// PORTAL TOOLS (Phase 3 — Patient portal)
//
// El paciente pide "mandame mi historial" / "quiero ver mis notas del doctor"
// y el agente genera un link firmado al portal self-service. El link no pide
// login — el HMAC firma la combinación (tenant_id, contact_id, expiry).
//
// Por qué no usar un login con contraseña: la mayoría de consultorios no tienen
// el tráfico para justificar fricción de auth. El token time-limited + enviado
// sólo al WhatsApp del paciente (cuyo número ya validamos como owner del
// contacto) es el mismo modelo de Uber Eats / Rappi.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';
import { signPortalToken, buildPortalUrl } from '@/lib/portal/token';
import { trackError } from '@/lib/monitoring';

const SendPortalArgs = z.object({
  message_prefix: z.string().max(300).optional(),
}).strict();

registerTool('send_patient_portal_link', {
  isMutation: true,
  schema: {
    type: 'function',
    function: {
      name: 'send_patient_portal_link',
      description:
        'Envía al paciente un link seguro a su portal personal donde puede ver su historial de visitas, notas del doctor, prescripciones y planes de tratamiento activos. Usar cuando el paciente pide "mi historial", "mis notas", "mi receta anterior", "qué me dijo el doctor la vez pasada", "mi expediente". El link es válido 30 días y no requiere login (firmado con HMAC).',
      parameters: {
        type: 'object',
        properties: {
          message_prefix: { type: 'string', description: 'Opcional: texto que antecede al link.' },
        },
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs: unknown, ctx: ToolContext) => {
    const args = SendPortalArgs.parse(rawArgs);
    if (!ctx.contactId) return { sent: false, error: 'no_contact_id' };

    // Defense in depth: verificá el contacto antes de firmar el token.
    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('id, phone')
      .eq('id', ctx.contactId)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    if (!contact) {
      trackError('portal_tool_contact_not_in_tenant');
      return { sent: false, error: 'contact_not_in_tenant' };
    }

    let token: string;
    try {
      token = signPortalToken(ctx.tenantId, ctx.contactId);
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : 'sign_failed' };
    }
    const url = buildPortalUrl(token);

    const phoneNumberId = (ctx.tenant?.wa_phone_number_id as string) || '';
    if (phoneNumberId && contact.phone) {
      const prefix = args.message_prefix?.trim()
        || 'Aquí puede consultar su historial y notas del doctor:';
      const text = `${prefix}\n\n${url}\n\nEl link expira en 30 días.`;
      try {
        const { sendTextMessageSafe } = await import('@/lib/whatsapp/send');
        await sendTextMessageSafe(phoneNumberId, contact.phone as string, text, { tenantId: ctx.tenantId });
      } catch {
        // Si el send falla, igual devolvemos el URL — el dueño puede copiarlo
        // desde el dashboard en el panel de contact.
      }
    }

    return {
      sent: true,
      portal_url: url,
      expires_in_days: 30,
    };
  },
});
