// ═══════════════════════════════════════════════════════════
// MODULO DE SEGUROS AGENTICO — Zod Validation Schemas
// Input validation for insurance API routes
// ═══════════════════════════════════════════════════════════

import { z } from 'zod'

// ── Credential creation ──────────────────────────────────

export const credentialCreateSchema = z.object({
  carrier_id: z.string().uuid(),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  agent_number: z.string().optional(),
})

export type CredentialCreateInput = z.infer<typeof credentialCreateSchema>

// ── Quote request ────────────────────────────────────────

export const quoteRequestSchema = z.object({
  insurance_line: z.enum(['auto', 'vida', 'gastos_medicos', 'hogar', 'negocio']),
  client: z.object({
    name: z.string().min(1, 'Client name is required'),
    zip_code: z.string().length(5, 'Zip code must be exactly 5 characters'),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    rfc: z.string().optional(),
    birthdate: z.string().optional(),
    gender: z.enum(['M', 'F']).optional(),
  }),
  vehicle: z.object({
    brand: z.string().min(1),
    model: z.string().min(1),
    year: z.number().int().min(1900).max(new Date().getFullYear() + 2),
    version: z.string().optional(),
    use: z.enum(['particular', 'comercial']),
  }).optional(),
  coverage_type: z.enum(['amplia', 'limitada', 'rc_obligatoria']).optional(),
  source: z.enum(['whatsapp', 'web', 'voice', 'api']),
  conversation_id: z.string().optional(),
  contact_id: z.string().optional(),
  raw_input: z.string().optional(),
})

export type QuoteRequestValidated = z.infer<typeof quoteRequestSchema>

// ── Callback result (from worker) ────────────────────────

export const callbackResultSchema = z.object({
  request_id: z.string().uuid(),
  carrier_slug: z.string().min(1),
  status: z.enum(['pending', 'running', 'success', 'declined', 'error', 'timeout', 'skipped']),
  carrier_name: z.string().optional(),
  annual_premium: z.number().positive().optional(),
  monthly_premium: z.number().positive().optional(),
  deductible_amount: z.number().min(0).optional(),
  deductible_percentage: z.number().min(0).max(100).optional(),
  coverages: z.array(z.object({
    name: z.string(),
    sum_insured: z.number().optional(),
    deductible: z.string().optional(),
    included: z.boolean(),
    days: z.number().optional(),
  })).optional(),
  quote_number: z.string().optional(),
  valid_until: z.string().optional(),
  pdf_url: z.string().url().optional(),
  screenshot_url: z.string().url().optional(),
  duration_ms: z.number().int().min(0).optional(),
  error_message: z.string().optional(),
  error_type: z.string().optional(),
})

export type CallbackResultValidated = z.infer<typeof callbackResultSchema>

// ── Shared validation helper ─────────────────────────────

/**
 * Format Zod validation errors into a human-readable object.
 */
export function formatZodErrors(error: z.ZodError): Record<string, string[]> {
  const formatted: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root'
    if (!formatted[path]) formatted[path] = []
    formatted[path].push(issue.message)
  }
  return formatted
}
