// ═══════════════════════════════════════════════════════════
// INSURANCE DATABASE TYPES — Supabase table shapes for joined queries
// Eliminates unsafe `as Record<string, unknown>` casts
// ═══════════════════════════════════════════════════════════

export interface CarrierRow {
  id: string
  name: string
  slug: string
  logo_url: string | null
  portal_url: string
  portal_type: 'browser' | 'api' | 'email'
  supported_lines: string[]
  market_share_auto: number
  health_status: string
  failure_rate_24h: number
  is_active: boolean
}

export interface CredentialWithCarrier {
  id: string
  tenant_id: string
  carrier_id: string
  encrypted_username: string
  encrypted_password: string
  agent_number: string | null
  is_active: boolean
  ins_carriers: CarrierRow
}

export interface QuoteWithCarrier {
  id: string
  quote_request_id: string
  tenant_id: string
  carrier_id: string
  status: string
  annual_premium: number | null
  monthly_premium: number | null
  deductible_amount: number | null
  deductible_percentage: number | null
  coverages: unknown
  rank_position: number | null
  quote_number: string | null
  pdf_url: string | null
  ins_carriers: { name: string; slug: string } | null
}

export interface QuoteRequestWithQuotes {
  id: string
  tenant_id: string
  status: string
  client_name: string
  client_phone: string | null
  insurance_line: string
  vehicle_brand: string | null
  vehicle_model: string | null
  vehicle_year: number | null
  carriers_targeted: number
  carriers_succeeded: number
  carriers_failed: number
  created_at: string
  ins_quotes: QuoteWithCarrier[]
}

/** Shape returned by LLM extraction of insurance quote data */
export interface ExtractedInsuranceData {
  insurance_line: string
  complete: boolean
  missing: string[]
  client: ExtractedClient
  vehicle: ExtractedVehicle
  coverage_type: string | null
  [key: string]: unknown
}

export interface ExtractedClient {
  name: string | null
  birthdate: string | null
  gender: string | null
  zip_code: string | null
  rfc: string | null
  [key: string]: unknown
}

export interface ExtractedVehicle {
  brand: string | null
  model: string | null
  year: number | null
  version: string | null
  use: string | null
  [key: string]: unknown
}

export interface PolicyWithCarrier {
  id: string
  tenant_id: string
  contact_id: string | null
  carrier_id: string
  policy_number: string
  insurance_line: string
  status: string
  start_date: string
  end_date: string
  total_premium: number | null
  ins_carriers: { name: string } | null
}
