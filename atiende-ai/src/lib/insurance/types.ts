// ═══════════════════════════════════════════════════════════
// MÓDULO DE SEGUROS AGÉNTICO — Tipos TypeScript
// Shared types for the insurance quoting & policy module
// ═══════════════════════════════════════════════════════════

export type InsuranceLine = 'auto' | 'vida' | 'gastos_medicos' | 'hogar' | 'negocio'
export type CoverageType = 'amplia' | 'limitada' | 'rc_obligatoria'
export type QuoteStatus = 'pending' | 'validating' | 'quoting' | 'partial' | 'complete' | 'expired' | 'error'
export type IndividualQuoteStatus = 'pending' | 'running' | 'success' | 'declined' | 'error' | 'timeout' | 'skipped'
export type PolicyStatus = 'active' | 'pending_payment' | 'cancelled' | 'expired' | 'renewed'
export type PaymentStatus = 'pending' | 'paid' | 'overdue' | 'cancelled'
export type CarrierPortalType = 'browser' | 'api' | 'email'
export type CarrierHealthStatus = 'healthy' | 'degraded' | 'down'
export type ClaimType = 'colision' | 'robo' | 'danos_terceros' | 'gastos_medicos' | 'fallecimiento' | 'otro'
export type ClaimStatus = 'intake' | 'submitted' | 'in_review' | 'approved' | 'denied' | 'paid'

export interface Carrier {
  id: string
  name: string
  slug: string
  logo_url: string | null
  portal_url: string
  portal_type: CarrierPortalType
  supported_lines: InsuranceLine[]
  market_share_auto: number
  health_status: CarrierHealthStatus
  failure_rate_24h: number
  is_active: boolean
  last_health_check: string | null
}

export interface CarrierCredential {
  id: string
  tenant_id: string
  carrier_id: string
  agent_number: string | null
  is_active: boolean
  last_login_success: string | null
  last_login_error: string | null
  login_failure_count: number
}

export interface QuoteRequestInput {
  insurance_line: InsuranceLine
  client: {
    name: string
    phone?: string
    email?: string
    rfc?: string
    birthdate?: string
    gender?: 'M' | 'F'
    zip_code: string
  }
  vehicle?: {
    brand: string
    model: string
    year: number
    version?: string
    use: 'particular' | 'comercial'
  }
  coverage_type?: CoverageType
  source: 'whatsapp' | 'web' | 'voice' | 'api'
  conversation_id?: string
  contact_id?: string
  raw_input?: string
}

export interface QuoteResult {
  request_id?: string
  carrier_slug: string
  carrier_name: string
  status: IndividualQuoteStatus
  annual_premium?: number
  monthly_premium?: number
  deductible_amount?: number
  deductible_percentage?: number
  coverages?: CoverageDetail[]
  quote_number?: string
  valid_until?: string
  pdf_url?: string
  screenshot_url?: string
  duration_ms?: number
  error_message?: string
  error_type?: string
}

export interface CoverageDetail {
  name: string
  sum_insured?: number
  deductible?: string
  included: boolean
  days?: number
}

export interface QuoteProgress {
  request_id: string
  total: number
  completed: number
  failed: number
  results: Array<{
    carrier_name: string
    carrier_slug: string
    annual_premium: number | null
  }>
  status: QuoteStatus
  best_price: number | null
}

export interface WorkerQuotePayload {
  request_id: string
  tenant_id: string
  carrier_slug: string
  carrier_portal_url: string
  carrier_portal_type: CarrierPortalType
  insurance_line: InsuranceLine
  client_data: QuoteRequestInput['client']
  vehicle_data?: QuoteRequestInput['vehicle']
  coverage_type?: CoverageType
  credentials: {
    username: string
    password: string
    agent_number?: string
  }
}

export interface CircuitState {
  failures: number
  successes: number
  total: number
  state: 'closed' | 'open' | 'half_open'
  last_failure_at: number
  opened_at: number
}
