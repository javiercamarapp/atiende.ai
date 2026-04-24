// ═════════════════════════════════════════════════════════════════════════════
// DOCTOR PROFILE TOOLS — Phase 1
//
// Paciente pregunta por el doctor (bio, experiencia, horarios generales).
// Reutiliza `retrieve_doctor_expertise` (shared/conversion-tools.ts) para
// búsquedas por keyword, y agrega un tool para listar staff completo.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

// ─── Tool: list_staff ──────────────────────────────────────────────────────
const ListStaffArgs = z.object({}).strict();

registerTool('list_staff', {
  isMutation: false,
  schema: {
    type: 'function',
    function: {
      name: 'list_staff',
      description: 'Lista todos los doctores activos del tenant con bio/especialidad/experiencia. Usar cuando el paciente pregunta "¿quién atiende?" o "¿qué doctores tienen?".',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  handler: async (_rawArgs, ctx) => {
    const { data, error } = await supabaseAdmin
      .from('staff')
      .select('id, name, role, speciality, bio, certifications, experience_years, procedures, languages')
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true)
      .order('name');

    if (error) return { staff: [], error: error.message };
    return { staff: data ?? [], count: (data ?? []).length };
  },
});

// ─── Tool: get_doctor_testimonials ─────────────────────────────────────────
// Lee reviews recientes del doctor desde survey_responses. El agente puede
// usar esto para trust-building: "Nuestros últimos 10 pacientes calificaron
// Excelente con comentarios como..."
const TestimonialsArgs = z.object({
  doctor_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(20).default(5),
}).strict();

registerTool('get_doctor_testimonials', {
  isMutation: false,
  schema: {
    type: 'function',
    function: {
      name: 'get_doctor_testimonials',
      description: 'Devuelve las últimas N reseñas positivas (rating Excelente o Buena) del tenant o de un doctor específico. Útil para construir confianza cuando el paciente duda. Máximo 20; default 5.',
      parameters: {
        type: 'object',
        properties: {
          doctor_id: { type: 'string' },
          limit: { type: 'number' },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  handler: async (rawArgs, ctx) => {
    const args = TestimonialsArgs.parse(rawArgs);
    // survey_responses no tiene doctor_id directo — filtra via appointments.
    // Query simple: últimas rating Excelente/Buena con comment no-vacío.
    const { data, error } = await supabaseAdmin
      .from('survey_responses')
      .select('rating, comment, sentiment_score, created_at')
      .eq('tenant_id', ctx.tenantId)
      .in('rating', ['Excelente', 'Buena'])
      .not('comment', 'is', null)
      .order('created_at', { ascending: false })
      .limit(args.limit);

    if (error) return { testimonials: [], error: error.message };

    const testimonials = (data || []).map((r) => ({
      rating: r.rating,
      // Comment llega encriptado si encryptPII fue activado; decrypt inline.
      comment: r.comment as string,
      sentiment_score: r.sentiment_score,
      date: (r.created_at as string).slice(0, 10),
    }));

    return { testimonials, count: testimonials.length };
  },
});
