// ═════════════════════════════════════════════════════════════════════════════
// LOCATION TOOLS (Phase 2.B.2)
//
// Para tenants con multiple sucursales. Un solo tool por ahora:
//   - list_locations — el agente lo usa cuando el paciente pregunta
//     "¿dónde están?" o para presentar opciones antes de agendar.
//
// El filtrado de availability por location se hace DENTRO de
// check_availability / book_appointment (ver agenda/tools.ts) porque
// necesita joins con staff_locations.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

const ListArgs = z.object({}).strict();

registerTool('list_locations', {
  isMutation: false,
  schema: {
    type: 'function',
    function: {
      name: 'list_locations',
      description:
        'Lista las sucursales activas del consultorio con dirección, ciudad y teléfono. Usar cuando el paciente pregunta "¿dónde están?", "¿qué sucursales tienen?", "¿cuál queda más cerca?". También útil antes de book_appointment si hay ≥2 locations para confirmar en cuál quiere agendar.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  handler: async (_rawArgs: unknown, ctx: ToolContext) => {
    const { data, error } = await supabaseAdmin
      .from('locations')
      .select('id, name, address, city, state, phone, is_primary, google_place_id')
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true)
      .order('is_primary', { ascending: false })  // primary primero
      .order('name');

    if (error) return { locations: [], error: error.message };
    return {
      locations: data ?? [],
      count: (data ?? []).length,
      has_multiple: (data ?? []).length > 1,
    };
  },
});
