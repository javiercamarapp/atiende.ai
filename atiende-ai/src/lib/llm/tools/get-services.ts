// ═════════════════════════════════════════════════════════════════════════════
// TOOL: get_services
//
// Devuelve el catálogo de servicios activos del tenant con precios reales de
// la base de datos. El LLM lo usa para responder preguntas de precio o catálogo
// SIN inventar (anti-alucinación: si la tool devuelve un precio, el LLM debe
// citarlo literal; si no devuelve nada, el LLM debe decir "no tengo esa info").
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

const argsSchema = z
  .object({
    /** Filtro opcional por substring del nombre. Útil cuando el cliente pregunta por algo específico. */
    search: z.string().min(1).max(120).optional(),
    /** Filtro opcional por categoría exacta. */
    category: z.string().min(1).max(80).optional(),
  })
  .strict();

interface ServiceRow {
  id: string;
  name: string;
  price: number | string | null;
  currency: 'MXN';
  duration_minutes: number | null;
  description: string | null;
  category: string | null;
}

interface GetServicesResult {
  count: number;
  services: ServiceRow[];
  /** True si NO hay servicios activos en absoluto (no es un error de búsqueda, es un tenant sin catálogo). */
  empty_catalog: boolean;
}

async function handler(rawArgs: unknown, ctx: ToolContext): Promise<GetServicesResult> {
  const args = argsSchema.parse(rawArgs ?? {});

  let q = supabaseAdmin
    .from('services')
    .select('id, name, price, duration_minutes, description, category')
    .eq('tenant_id', ctx.tenantId)
    .eq('active', true)
    .order('category', { ascending: true })
    .limit(40);

  if (args.category) q = q.eq('category', args.category);

  const { data: rows } = await q;

  let services = (rows || []) as Array<{
    id: string;
    name: string;
    price: number | string | null;
    duration_minutes: number | null;
    description: string | null;
    category: string | null;
  }>;

  // Filtro de búsqueda local (más permisivo que un LIKE de Postgres con
  // acentos / mayúsculas / etc).
  if (args.search) {
    const needle = args.search.toLowerCase().trim();
    services = services.filter((s) => s.name.toLowerCase().includes(needle));
  }

  // Si NO había args (catálogo completo) y la query devolvió 0, el tenant
  // simplemente no tiene servicios cargados — distinguible para el LLM.
  const isFullCatalogQuery = !args.search && !args.category;
  const empty_catalog = isFullCatalogQuery && services.length === 0;

  return {
    count: services.length,
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      price: s.price,
      currency: 'MXN' as const,
      duration_minutes: s.duration_minutes,
      description: s.description,
      category: s.category,
    })),
    empty_catalog,
  };
}

registerTool('get_services', {
  schema: {
    type: 'function',
    function: {
      name: 'get_services',
      description:
        'Devuelve el catálogo de servicios activos del negocio con precios reales en MXN. Usa esta tool ANTES de mencionar cualquier precio o servicio — NUNCA inventes precios. Argumentos opcionales: `search` (substring del nombre, ej "limpieza") o `category` (categoría exacta).',
      parameters: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Substring para filtrar por nombre de servicio.',
          },
          category: {
            type: 'string',
            description: 'Categoría exacta para filtrar (ej: "ortodoncia", "preventivo").',
          },
        },
        additionalProperties: false,
      },
    },
  },
  handler,
});
