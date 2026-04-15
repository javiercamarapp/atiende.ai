import axios, { AxiosError } from 'axios';
import { supabaseAdmin } from '@/lib/supabase/admin';

const WA_API = 'https://graph.facebook.com/v21.0';
const getHeaders = () => ({
  Authorization: `Bearer ${process.env.WA_SYSTEM_TOKEN}`,
  'Content-Type': 'application/json',
});

/** Códigos de error de Meta más comunes que el sistema debería loggear distintos. */
const META_ERROR_CODES: Record<number, string> = {
  131026: 'message_not_delivered',     // número inválido o no en WhatsApp
  131030: 'recipient_not_in_allowed_list', // sandbox/test mode
  131047: 'reengagement_required',     // fuera de ventana 24h
  131051: 'unsupported_message_type',
  131052: 'media_download_failed',
  133000: 'auth_failure',              // token inválido o expirado
  368: 'temporarily_blocked',          // anti-spam de Meta
  131056: 'too_many_messages',         // rate limit Meta
};

interface SendResult {
  ok: boolean;
  errorCode?: number;
  errorLabel?: string;
  errorMessage?: string;
}

function inspectAxiosError(err: unknown, fnName: string): SendResult {
  if (err instanceof AxiosError) {
    const status = err.response?.status;
    const metaError = err.response?.data?.error;
    const code = metaError?.code as number | undefined;
    const message = metaError?.message as string | undefined;
    const label = code ? META_ERROR_CODES[code] || 'unknown_meta_code' : 'http_error';

    // Auth failures + token expiration son CRITICAL — log error
    if (code === 133000 || status === 401) {
      console.error(`[whatsapp:${fnName}] AUTH FAILURE — verificar WA_SYSTEM_TOKEN. Status=${status} Code=${code} Msg=${message}`);
    } else if (code) {
      console.warn(`[whatsapp:${fnName}] Meta error ${code} (${label}): ${message}`);
    } else {
      console.warn(`[whatsapp:${fnName}] HTTP ${status}: ${err.message}`);
    }

    return { ok: false, errorCode: code, errorLabel: label, errorMessage: message };
  }
  console.warn(`[whatsapp:${fnName}] unexpected error:`, err);
  return { ok: false, errorMessage: err instanceof Error ? err.message : String(err) };
}

// Enviar mensaje de texto simple (ventana 24h aplica)
export async function sendTextMessage(
  phoneNumberId: string, to: string, text: string,
): Promise<SendResult> {
  try {
    await axios.post(
      `${WA_API}/${phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
      { headers: getHeaders(), timeout: 10_000 },
    );
    return { ok: true };
  } catch (err) {
    const result = inspectAxiosError(err, 'sendTextMessage');
    // WA-1: persistir el último error de envío en contacts para que el dueño
    // del consultorio pueda ver desde el dashboard qué pacientes ya no son
    // contactables (bloquearon el WhatsApp business, número inválido, etc.)
    if (!result.ok && result.errorCode) {
      void persistContactSendError(to, result.errorCode, result.errorLabel || 'unknown');
    }
    return result;
  }
}

async function persistContactSendError(
  phone: string, errorCode: number, errorLabel: string,
): Promise<void> {
  try {
    await supabaseAdmin
      .from('contacts')
      .update({
        last_send_error_code: errorCode,
        last_send_error_label: errorLabel,
        last_send_error_at: new Date().toISOString(),
      })
      .eq('phone', phone);
  } catch {
    /* best effort — no romper el flujo si la columna no existe */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 13: sendTextMessageSafe — verifica la ventana 24h antes de enviar
//
// Meta solo permite mensajes free-form si el usuario nos escribió en las
// últimas 24h. Fuera de esa ventana hay que usar un template aprobado o el
// envío fallará con error 131047 (reengagement_required).
//
// sendTextMessageSafe consulta la última inbound del paciente (tabla messages)
// y, si la ventana cerró, reporta sin gastar la llamada a Meta.
// ─────────────────────────────────────────────────────────────────────────────

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function sendTextMessageSafe(
  phoneNumberId: string,
  to: string,
  text: string,
  opts?: { tenantId?: string },
): Promise<SendResult & { windowExpired?: boolean }> {
  // Consulta la última inbound del paciente para este tenant
  let query = supabaseAdmin
    .from('messages')
    .select('created_at')
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1);

  if (opts?.tenantId) query = query.eq('tenant_id', opts.tenantId);

  const { data: lastInbound } = await query.maybeSingle();

  if (lastInbound) {
    const ageMs = Date.now() - new Date(lastInbound.created_at as string).getTime();
    if (ageMs > WINDOW_MS) {
      console.warn(`[sendTextMessageSafe] window expired (${Math.floor(ageMs / 3600000)}h) — not sending free-form to ${to}`);
      return {
        ok: false,
        windowExpired: true,
        errorCode: 131047,
        errorLabel: 'reengagement_required',
        errorMessage: 'Outside 24h window — use a template instead.',
      };
    }
  }
  return sendTextMessage(phoneNumberId, to, text);
}

// Enviar mensaje con botones (max 3 botones)
export async function sendButtonMessage(
  phoneNumberId: string, to: string,
  body: string, buttons: string[],
): Promise<SendResult> {
  try {
    await axios.post(
      `${WA_API}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp', to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          action: {
            buttons: buttons.slice(0, 3).map((btn, i) => ({
              type: 'reply',
              reply: { id: `btn_${i}`, title: btn.substring(0, 20) },
            })),
          },
        },
      },
      { headers: getHeaders(), timeout: 10_000 },
    );
    return { ok: true };
  } catch (err) {
    return inspectAxiosError(err, 'sendButtonMessage');
  }
}

// Enviar lista de opciones (max 10 secciones x 10 items)
export async function sendListMessage(
  phoneNumberId: string, to: string,
  header: string, body: string,
  sections: { title: string; rows: { id: string; title: string; description?: string }[] }[],
): Promise<SendResult> {
  try {
    await axios.post(
      `${WA_API}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp', to,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: header },
          body: { text: body },
          action: { button: 'Ver opciones', sections },
        },
      },
      { headers: getHeaders(), timeout: 10_000 },
    );
    return { ok: true };
  } catch (err) {
    return inspectAxiosError(err, 'sendListMessage');
  }
}

// Enviar template (recordatorios, promos — fuera de ventana 24h)
export async function sendTemplate(
  phoneNumberId: string, to: string,
  templateName: string, params: string[],
): Promise<SendResult> {
  try {
    await axios.post(
      `${WA_API}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp', to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'es_MX' },
          components: [{
            type: 'body',
            parameters: params.map((p) => ({ type: 'text', text: p })),
          }],
        },
      },
      { headers: getHeaders(), timeout: 10_000 },
    );
    return { ok: true };
  } catch (err) {
    return inspectAxiosError(err, 'sendTemplate');
  }
}

// Enviar ubicación del negocio
export async function sendLocation(
  phoneNumberId: string, to: string,
  lat: number, lng: number, name: string, address: string,
): Promise<SendResult> {
  try {
    await axios.post(
      `${WA_API}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp', to,
        type: 'location',
        location: { latitude: lat, longitude: lng, name, address },
      },
      { headers: getHeaders(), timeout: 10_000 },
    );
    return { ok: true };
  } catch (err) {
    return inspectAxiosError(err, 'sendLocation');
  }
}

// Marcar mensaje como leído
export async function markAsRead(
  phoneNumberId: string, messageId: string,
): Promise<SendResult> {
  try {
    await axios.post(
      `${WA_API}/${phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
      { headers: getHeaders(), timeout: 5_000 },
    );
    return { ok: true };
  } catch (err) {
    return inspectAxiosError(err, 'markAsRead');
  }
}

// Enviar indicador de escritura (best-effort)
export async function sendTypingIndicator(phoneNumberId: string, to: string): Promise<SendResult> {
  try {
    await axios.post(
      `${WA_API}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'reaction',
        reaction: { message_id: '', emoji: '' },
      },
      { headers: getHeaders(), timeout: 5_000 },
    );
    return { ok: true };
  } catch {
    // Typing indicator is best-effort, don't fail the pipeline
    return { ok: false };
  }
}
