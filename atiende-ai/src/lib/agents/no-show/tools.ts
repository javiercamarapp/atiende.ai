// ═════════════════════════════════════════════════════════════════════════════
// NO-SHOW TOOLS — Phase 2 scaffolding (handlers stub)
// 5 tools del agente worker que confirma citas 24h antes via cron.
// ═════════════════════════════════════════════════════════════════════════════

import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

const NOT_IMPLEMENTED = {
  unimplemented: true,
  message: 'Tool registered (Phase 2 scaffolding) — handler implementation pending in next commit.',
};

registerTool('get_appointments_tomorrow', {
  schema: {
    type: 'function',
    function: {
      name: 'get_appointments_tomorrow',
      description: 'Lista citas del día siguiente que aún no han recibido recordatorio.',
      parameters: {
        type: 'object',
        properties: {
          tenant_id: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
        },
        required: ['tenant_id', 'date'],
        additionalProperties: false,
      },
    },
  },
  handler: async (_args: unknown, _ctx: ToolContext) => NOT_IMPLEMENTED,
});

registerTool('send_confirmation_request', {
  schema: {
    type: 'function',
    function: {
      name: 'send_confirmation_request',
      description: 'Envía template WhatsApp de confirmación 24h antes con CTA "CONFIRMAR / CANCELAR".',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          patient_phone: { type: 'string' },
          patient_name: { type: 'string' },
          appointment_datetime: { type: 'string' },
          doctor_name: { type: 'string' },
          service: { type: 'string' },
        },
        required: ['appointment_id', 'patient_phone', 'patient_name', 'appointment_datetime', 'doctor_name', 'service'],
        additionalProperties: false,
      },
    },
  },
  handler: async (_args: unknown, _ctx: ToolContext) => NOT_IMPLEMENTED,
});

registerTool('mark_confirmed', {
  schema: {
    type: 'function',
    function: {
      name: 'mark_confirmed',
      description: 'Marca cita como confirmada cuando el paciente responde CONFIRMAR.',
      parameters: {
        type: 'object',
        properties: { appointment_id: { type: 'string' } },
        required: ['appointment_id'],
        additionalProperties: false,
      },
    },
  },
  handler: async (_args: unknown, _ctx: ToolContext) => NOT_IMPLEMENTED,
});

registerTool('mark_no_show', {
  schema: {
    type: 'function',
    function: {
      name: 'mark_no_show',
      description: 'Marca cita como no_show e incrementa contador del paciente. Notifica al dueño.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          reason: { type: 'string', description: 'Opcional' },
        },
        required: ['appointment_id'],
        additionalProperties: false,
      },
    },
  },
  handler: async (_args: unknown, _ctx: ToolContext) => NOT_IMPLEMENTED,
});

registerTool('notify_risk', {
  schema: {
    type: 'function',
    function: {
      name: 'notify_risk',
      description: 'Avisa al dueño cuando un paciente con alto risk_score no ha confirmado.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          patient_name: { type: 'string' },
          appointment_time: { type: 'string' },
          risk_level: { type: 'string', enum: ['high', 'medium'] },
        },
        required: ['appointment_id', 'patient_name', 'appointment_time', 'risk_level'],
        additionalProperties: false,
      },
    },
  },
  handler: async (_args: unknown, _ctx: ToolContext) => NOT_IMPLEMENTED,
});
