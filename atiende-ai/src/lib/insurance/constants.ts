// ═══════════════════════════════════════════════════════════
// MÓDULO DE SEGUROS AGÉNTICO — Constantes y Seeds
// 15 carriers MX, timeouts, labels, circuit breaker config
// ═══════════════════════════════════════════════════════════

import type { CarrierPortalType, InsuranceLine } from './types'

interface CarrierSeed {
  name: string
  slug: string
  portal_url: string
  portal_type: CarrierPortalType
  supported_lines: InsuranceLine[]
  market_share: number
}

export const CARRIER_SEEDS: readonly CarrierSeed[] = [
  { name: 'Qualitas', slug: 'qualitas', portal_url: 'https://agentes.qualitas.com.mx', portal_type: 'browser', supported_lines: ['auto'], market_share: 32.8 },
  { name: 'GNP Seguros', slug: 'gnp', portal_url: 'https://intermediarios.gnp.com.mx', portal_type: 'browser', supported_lines: ['auto', 'vida', 'gastos_medicos', 'hogar', 'negocio'], market_share: 12.5 },
  { name: 'AXA Seguros', slug: 'axa', portal_url: 'https://distribuidores.axa.com.mx', portal_type: 'browser', supported_lines: ['auto', 'vida', 'gastos_medicos', 'hogar', 'negocio'], market_share: 8.3 },
  { name: 'HDI Seguros', slug: 'hdi', portal_url: 'https://portalagentes.hdi.com.mx', portal_type: 'browser', supported_lines: ['auto', 'vida', 'hogar'], market_share: 7.1 },
  { name: 'Chubb Seguros', slug: 'chubb', portal_url: 'https://agentes.chubb.com/mx', portal_type: 'browser', supported_lines: ['auto', 'vida', 'gastos_medicos', 'hogar', 'negocio'], market_share: 6.8 },
  { name: 'BBVA Seguros', slug: 'bbva', portal_url: 'https://api.bbva.com', portal_type: 'api', supported_lines: ['auto', 'vida', 'hogar'], market_share: 5.2 },
  { name: 'Zurich Seguros', slug: 'zurich', portal_url: 'https://portalagentes.zurich.com.mx', portal_type: 'browser', supported_lines: ['auto', 'negocio'], market_share: 4.1 },
  { name: 'Mapfre', slug: 'mapfre', portal_url: 'https://agentes.mapfre.com.mx', portal_type: 'browser', supported_lines: ['auto', 'vida', 'gastos_medicos', 'hogar'], market_share: 3.8 },
  { name: 'Seguros Atlas', slug: 'atlas', portal_url: 'https://portal.segurosatlas.com.mx', portal_type: 'browser', supported_lines: ['auto', 'vida', 'hogar'], market_share: 3.2 },
  { name: 'AIG Seguros', slug: 'aig', portal_url: 'https://agentes.aig.com.mx', portal_type: 'browser', supported_lines: ['auto', 'vida', 'negocio'], market_share: 2.9 },
  { name: 'Banorte Seguros', slug: 'banorte', portal_url: 'https://seguros.banorte.com/agentes', portal_type: 'browser', supported_lines: ['auto', 'vida', 'hogar'], market_share: 2.7 },
  { name: 'Afirme Seguros', slug: 'afirme', portal_url: 'https://agentes.afirme.com', portal_type: 'browser', supported_lines: ['auto', 'vida'], market_share: 2.1 },
  { name: 'SURA', slug: 'sura', portal_url: 'https://agentes.segurossura.com.mx', portal_type: 'browser', supported_lines: ['auto', 'vida', 'gastos_medicos'], market_share: 1.9 },
  { name: 'MetLife', slug: 'metlife', portal_url: 'https://agentes.metlife.com.mx', portal_type: 'browser', supported_lines: ['vida', 'gastos_medicos'], market_share: 1.8 },
  { name: 'Allianz', slug: 'allianz', portal_url: 'https://agentes.allianz.com.mx', portal_type: 'browser', supported_lines: ['auto', 'vida', 'gastos_medicos', 'hogar'], market_share: 1.5 },
] as const

// Timeouts and limits
export const QUOTE_TIMEOUT_MS = 120_000           // 2 min per carrier
export const QUOTE_CACHE_TTL_HOURS = 4
export const MAX_CONCURRENT_QUOTES = 8
export const SSE_POLL_INTERVAL_MS = 1_500
export const SSE_HEARTBEAT_INTERVAL_MS = 15_000
export const QUOTE_EXPIRY_HOURS = 4

// Circuit breaker
export const CIRCUIT_BREAKER_THRESHOLD = 5         // failures before opening
export const CIRCUIT_BREAKER_TIMEOUT_MS = 300_000  // 5 min in open state
export const CIRCUIT_BREAKER_TTL_SECONDS = 86_400  // 24hr Redis key TTL

// Labels
export const COVERAGE_LABELS: Record<string, string> = {
  amplia: 'Cobertura Amplia',
  limitada: 'Cobertura Limitada',
  rc_obligatoria: 'Responsabilidad Civil Obligatoria',
}

export const INSURANCE_LINE_LABELS: Record<string, string> = {
  auto: 'Seguro de Auto',
  vida: 'Seguro de Vida',
  gastos_medicos: 'Gastos Médicos Mayores',
  hogar: 'Seguro de Hogar',
  negocio: 'Seguro de Negocio',
}

export const INSURANCE_LINE_LABELS_SHORT: Record<string, string> = {
  auto: 'Auto',
  vida: 'Vida',
  gastos_medicos: 'GMM',
  hogar: 'Hogar',
  negocio: 'Negocio',
}

export const QUOTE_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  validating: 'Validando',
  quoting: 'Cotizando...',
  partial: 'Parcial',
  complete: 'Completada',
  expired: 'Expirada',
  error: 'Error',
}

export const POLICY_STATUS_LABELS: Record<string, string> = {
  active: 'Activa',
  pending_payment: 'Pago pendiente',
  cancelled: 'Cancelada',
  expired: 'Vencida',
  renewed: 'Renovada',
}

export const HEALTH_STATUS_LABELS: Record<string, string> = {
  healthy: 'Operativo',
  degraded: 'Degradado',
  down: 'Caído',
}

export const SSE_MAX_LIFETIME_MS = 3 * 60 * 1000  // 3 minutes
export const REDIS_PROGRESS_TTL_SECONDS = 3600     // 1 hour

// Ranking weights
export const RANKING_WEIGHTS = {
  price: 0.40,
  coverage: 0.30,
  carrier_rating: 0.20,
  response_speed: 0.10,
}
