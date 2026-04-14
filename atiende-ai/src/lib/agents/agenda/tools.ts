// ═════════════════════════════════════════════════════════════════════════════
// AGENDA TOOLS — Phase 2 (in progress)
//
// 5 tools que reúsan helpers existentes de `appointment-helpers.ts`:
//   - check_availability
//   - book_appointment
//   - get_my_appointments
//   - modify_appointment
//   - cancel_appointment
//
// PHASE 2 STATUS: scaffolding only. Tools registradas con handlers stub que
// retornan { unimplemented: true }. La implementación completa (slot search,
// transacción atómica, Google Calendar sync) se completa en el siguiente
// commit incremental — vivirá en este mismo archivo.
//
// El registro vive en este archivo (side-effect al import) — `agenda/index.ts`
// importa este file para forzar el registerTool().
// ═════════════════════════════════════════════════════════════════════════════

import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

const NOT_IMPLEMENTED = {
  unimplemented: true,
  message: 'Tool registered (Phase 2 scaffolding) — handler implementation pending in next commit.',
};

// ─── Tool 1: check_availability ──────────────────────────────────────────────
registerTool('check_availability', {
  schema: {
    type: 'function',
    function: {
      name: 'check_availability',
      description:
        'Consulta horarios disponibles para agendar una cita. Llamar ANTES de book_appointment. Resolver fechas relativas (mañana, lunes, etc.) a YYYY-MM-DD antes de invocar.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          service_type: { type: 'string', description: 'Opcional' },
          staff_id: { type: 'string', description: 'Opcional' },
          duration_minutes: { type: 'number', description: 'Default 30' },
        },
        required: ['date'],
        additionalProperties: false,
      },
    },
  },
  handler: async (_args: unknown, _ctx: ToolContext) => NOT_IMPLEMENTED,
});

// ─── Tool 2: book_appointment ────────────────────────────────────────────────
registerTool('book_appointment', {
  schema: {
    type: 'function',
    function: {
      name: 'book_appointment',
      description:
        'Crea una cita confirmada. SOLO llamar después de (1) check_availability OK y (2) confirmación EXPLÍCITA del paciente. Nunca llamar sin confirmación.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM (24h)' },
          service_type: { type: 'string' },
          patient_name: { type: 'string' },
          patient_phone: { type: 'string' },
          staff_id: { type: 'string', description: 'Opcional' },
          notes: { type: 'string', description: 'Opcional' },
        },
        required: ['date', 'time', 'service_type', 'patient_name', 'patient_phone'],
        additionalProperties: false,
      },
    },
  },
  handler: async (_args: unknown, _ctx: ToolContext) => NOT_IMPLEMENTED,
});

// ─── Tool 3: get_my_appointments ─────────────────────────────────────────────
registerTool('get_my_appointments', {
  schema: {
    type: 'function',
    function: {
      name: 'get_my_appointments',
      description:
        'Obtiene las citas del paciente identificado por su número de WhatsApp.',
      parameters: {
        type: 'object',
        properties: {
          patient_phone: { type: 'string' },
          include_past: { type: 'boolean', description: 'Default false' },
        },
        required: ['patient_phone'],
        additionalProperties: false,
      },
    },
  },
  handler: async (_args: unknown, _ctx: ToolContext) => NOT_IMPLEMENTED,
});

// ─── Tool 4: modify_appointment ──────────────────────────────────────────────
registerTool('modify_appointment', {
  schema: {
    type: 'function',
    function: {
      name: 'modify_appointment',
      description:
        'Modifica fecha u hora de una cita existente. Verifica disponibilidad del nuevo slot.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          patient_phone: { type: 'string' },
          new_date: { type: 'string', description: 'YYYY-MM-DD opcional' },
          new_time: { type: 'string', description: 'HH:MM opcional' },
          reason: { type: 'string', description: 'Opcional' },
        },
        required: ['appointment_id', 'patient_phone'],
        additionalProperties: false,
      },
    },
  },
  handler: async (_args: unknown, _ctx: ToolContext) => NOT_IMPLEMENTED,
});

// ─── Tool 5: cancel_appointment ──────────────────────────────────────────────
registerTool('cancel_appointment', {
  schema: {
    type: 'function',
    function: {
      name: 'cancel_appointment',
      description: 'Cancela una cita. Verifica que pertenezca al paciente que escribe.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          patient_phone: { type: 'string' },
          reason: { type: 'string', description: 'Opcional' },
        },
        required: ['appointment_id', 'patient_phone'],
        additionalProperties: false,
      },
    },
  },
  handler: async (_args: unknown, _ctx: ToolContext) => NOT_IMPLEMENTED,
});
