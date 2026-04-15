// ═════════════════════════════════════════════════════════════════════════════
// POST /api/chat-data  { question: string }
//
// Text-to-SQL contra los datos del tenant autenticado. Flujo:
//   1. Auth + resolver tenant del usuario
//   2. LLM genera SQL restringido a las 5 tablas permitidas y al tenant_id
//   3. Validación TS (regex) + ejecución vía execute_safe_readonly_query RPC
//      (que re-valida en Postgres)
//   4. LLM formatea el resultado como prosa en español mexicano
//
// Modelo: x-ai/grok-4.1-fast (rápido y barato). Fallback al formateador si
// el resultado es muy grande.
// ═════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateResponse, MODELS } from '@/lib/llm/openrouter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const Body = z.object({ question: z.string().min(3).max(500) });

const ALLOWED_TABLES = ['appointments', 'contacts', 'payments', 'conversations', 'messages'];

// Bloquea DML/DDL + ataques de bypass (UNION para escapar tenant_id filter,
// OR 1=1 tautologías, comments para truncar la query).
const FORBIDDEN_REGEX = /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|replace|copy|execute|listen|notify|lock|vacuum|union|intersect|except)\b/i;
const SQL_INJECTION_PATTERNS = [
  /\bor\s+\d+\s*=\s*\d+/i,        // OR 1=1
  /\bor\s+'[^']*'\s*=\s*'[^']*'/i,  // OR 'a'='a'
  /--/,                              // SQL comments
  /\/\*/,                            // Block comments
  /;.*\w/,                           // Multiple statements (más estricto)
];

const SCHEMA_CONTEXT = `
TABLAS PERMITIDAS (todas filtran por tenant_id):

appointments — citas del paciente
  id UUID, tenant_id UUID, customer_phone TEXT, customer_name TEXT,
  service_name TEXT, staff_id UUID, datetime TIMESTAMPTZ, duration_minutes INT,
  price_mxn NUMERIC, status TEXT ('scheduled','confirmed','completed','cancelled','no_show'),
  no_show_risk_score INT, confirmed_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT, payment_status TEXT, payment_received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ

contacts — pacientes
  id UUID, tenant_id UUID, phone TEXT, name TEXT, email TEXT, birth_date DATE,
  health_score INT (0-100), churn_probability INT (0-100),
  lifetime_value_mxn INT, no_show_count INT, next_visit_predicted_at TIMESTAMPTZ,
  intake_completed BOOL, last_satisfaction_rating TEXT, reactivated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ

payments — pagos recibidos
  id UUID, tenant_id UUID, appointment_id UUID, customer_phone TEXT,
  amount NUMERIC(10,2), currency TEXT, status TEXT ('completed','pending','refunded'),
  provider TEXT, created_at TIMESTAMPTZ

conversations — hilos WhatsApp
  id UUID, tenant_id UUID, customer_phone TEXT, customer_name TEXT,
  channel TEXT, status TEXT, assigned_to TEXT, tags TEXT[],
  summary TEXT, unsatisfied BOOL, last_message_at TIMESTAMPTZ, created_at TIMESTAMPTZ

messages — mensajes individuales
  id UUID, tenant_id UUID, conversation_id UUID, direction TEXT ('inbound','outbound'),
  sender_type TEXT ('customer','bot','human'), content TEXT, intent TEXT,
  model_used TEXT, cost_usd NUMERIC, response_time_ms INT, created_at TIMESTAMPTZ

NOTAS:
- La zona horaria del negocio es America/Merida (UTC-6)
- Precios en MXN; fechas en TIMESTAMPTZ
- Un paciente puede tener varias citas — join por tenant_id + customer_phone = contacts.phone
`;

function validateSql(sql: string, tenantId: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = sql.trim();
  if (!trimmed) return { ok: false, reason: 'empty_query' };

  const lowered = trimmed.toLowerCase();
  if (!(lowered.startsWith('select') || lowered.startsWith('with'))) {
    return { ok: false, reason: 'must_start_with_select_or_with' };
  }

  if (FORBIDDEN_REGEX.test(lowered)) {
    return { ok: false, reason: 'forbidden_keyword' };
  }

  // Patrones específicos de SQL injection (bypass de tenant_id filter)
  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: 'sql_injection_pattern' };
    }
  }

  // Debe mencionar el tenant_id
  if (!sql.includes(tenantId)) {
    return { ok: false, reason: 'tenant_id_filter_required' };
  }

  // Check que solo mencione tablas permitidas
  const tableRegex = /\bfrom\s+([a-z_]+)|\bjoin\s+([a-z_]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRegex.exec(sql)) !== null) {
    const table = (m[1] || m[2]).toLowerCase();
    if (!ALLOWED_TABLES.includes(table)) {
      return { ok: false, reason: `forbidden_table: ${table}` };
    }
  }

  // No semicolons extras (un SELECT, terminado opcionalmente con ;)
  const semicolons = (trimmed.match(/;/g) || []).length;
  if (semicolons > 1) return { ok: false, reason: 'multiple_statements' };

  return { ok: true };
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, city, business_type, timezone')
    .eq('user_id', user.id)
    .single();
  if (!tenant) return NextResponse.json({ error: 'no_tenant' }, { status: 403 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: 'invalid_body', details: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  // ── 1. Generar SQL con el LLM ────────────────────────────────────────────
  const sqlSystem = `Eres un analista de datos médicos. Genera SQL seguro de PostgreSQL.

REGLAS ABSOLUTAS (si violas alguna, el sistema rechaza):
- Solo SELECT, nunca INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER/CREATE.
- SIEMPRE incluye \`WHERE tenant_id = '${tenant.id}'\` en CADA tabla consultada.
- Solo accede a estas tablas: ${ALLOWED_TABLES.join(', ')}.
- Si la pregunta NO es sobre datos del negocio (ej. "cómo estás", "qué sabes de..."):
  responde literalmente con: -- SOLO_DATOS_DEL_NEGOCIO
- Nunca uses comillas simples sin escapar valores de usuario.
- Limita el resultado a 100 filas como máximo (LIMIT 100).

${SCHEMA_CONTEXT}

Zona horaria: ${tenant.timezone || 'America/Merida'}. Negocio: ${tenant.name} (${tenant.business_type}) en ${tenant.city || 'MX'}.
Retorna SOLO el SQL, sin explicación, sin markdown, sin comentarios.`;

  const sqlGen = await generateResponse({
    model: MODELS.ORCHESTRATOR,
    system: sqlSystem,
    messages: [{ role: 'user', content: body.question }],
    temperature: 0,
    maxTokens: 500,
  });

  let sql = sqlGen.text.trim();

  // Limpiar markdown code blocks si el modelo los agregó
  sql = sql.replace(/^```(?:sql)?\s*/i, '').replace(/```\s*$/i, '').trim();

  if (sql.includes('SOLO_DATOS_DEL_NEGOCIO') || sql.toLowerCase().startsWith('--')) {
    return NextResponse.json({
      sql: null,
      answer: 'Solo puedo consultar datos de tu consultorio. Pregúntame sobre citas, pacientes, pagos o conversaciones.',
      rows: [],
    });
  }

  // ── 2. Validar SQL antes de ejecutar ─────────────────────────────────────
  const v = validateSql(sql, tenant.id);
  if (!v.ok) {
    return NextResponse.json({
      error: 'unsafe_query',
      reason: v.reason,
      sql,
      answer: 'No pude generar una consulta segura para esa pregunta. Intenta ser más específico sobre qué dato necesitas.',
    }, { status: 400 });
  }

  // ── 3. Ejecutar vía RPC (que re-valida en Postgres) ──────────────────────
  const { data: rowsData, error: rpcErr } = await supabaseAdmin.rpc('execute_safe_readonly_query', {
    query_sql: sql,
    p_tenant_id: tenant.id,
  });

  if (rpcErr) {
    return NextResponse.json({
      error: 'execution_failed',
      message: rpcErr.message,
      sql,
      answer: `No pude ejecutar esa consulta: ${rpcErr.message}`,
    }, { status: 500 });
  }

  const rows = Array.isArray(rowsData) ? (rowsData as Array<Record<string, unknown>>) : [];

  // ── 4. Formatear respuesta en lenguaje natural ───────────────────────────
  const preview = rows.slice(0, 20);
  const formatSystem = `Eres un asistente del dueño de un consultorio mexicano. Recibes una pregunta del doctor y los datos que responden esa pregunta (formato JSON). Genera una respuesta en español mexicano natural, en 2-3 líneas, con números concretos. Sin emojis excesivos. Sin formato markdown.`;

  const formatted = await generateResponse({
    model: MODELS.ORCHESTRATOR_FALLBACK,
    system: formatSystem,
    messages: [
      {
        role: 'user',
        content: `Pregunta: ${body.question}\n\nDatos (${rows.length} fila${rows.length === 1 ? '' : 's'}):\n${JSON.stringify(preview, null, 2)}`,
      },
    ],
    temperature: 0.3,
    maxTokens: 250,
  });

  return NextResponse.json({
    sql,
    answer: formatted.text.trim(),
    rows,
    row_count: rows.length,
  });
}
