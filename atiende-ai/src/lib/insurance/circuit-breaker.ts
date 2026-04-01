// ═══════════════════════════════════════════════════════════
// MÓDULO DE SEGUROS AGÉNTICO — Circuit Breaker
// Redis-backed circuit breaker per carrier portal
// States: closed → open → half_open → closed
// ═══════════════════════════════════════════════════════════

import { Redis } from '@upstash/redis'
import {
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_BREAKER_TIMEOUT_MS,
  CIRCUIT_BREAKER_TTL_SECONDS,
} from './constants'
import type { CircuitState } from './types'

function getRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}

const DEFAULT_STATE: CircuitState = {
  failures: 0,
  successes: 0,
  total: 0,
  state: 'closed',
  last_failure_at: 0,
  opened_at: 0,
}

function getKey(carrierSlug: string): string {
  return `ins:cb:${carrierSlug}`
}

/**
 * Check if the circuit breaker for a carrier is open (should skip).
 * Also handles half_open transition after timeout.
 */
export async function isCircuitOpen(carrierSlug: string): Promise<boolean> {
  try {
    const state = await getRedis().get<CircuitState>(getKey(carrierSlug))
    if (!state) return false

    if (state.state === 'open') {
      if (Date.now() - state.opened_at > CIRCUIT_BREAKER_TIMEOUT_MS) {
        await getRedis().set(
          getKey(carrierSlug),
          { ...state, state: 'half_open' },
          { ex: CIRCUIT_BREAKER_TTL_SECONDS }
        )
        return false // Allow one probe request
      }
      return true // Still open, reject
    }

    return false
  } catch {
    return false // On Redis error, allow the request
  }
}

/**
 * Record a successful carrier portal interaction.
 * If half_open → transitions back to closed.
 */
export async function recordSuccess(carrierSlug: string): Promise<void> {
  try {
    const key = getKey(carrierSlug)
    const state = (await getRedis().get<CircuitState>(key)) ?? { ...DEFAULT_STATE }

    state.successes++
    state.total++

    if (state.state === 'half_open') {
      state.state = 'closed'
      state.failures = 0
    }

    await getRedis().set(key, state, { ex: CIRCUIT_BREAKER_TTL_SECONDS })
  } catch {
    // Silently fail — circuit breaker is non-critical
  }
}

/**
 * Record a failed carrier portal interaction.
 * If failures >= threshold → opens the circuit.
 */
export async function recordFailure(carrierSlug: string): Promise<void> {
  try {
    const key = getKey(carrierSlug)
    const state = (await getRedis().get<CircuitState>(key)) ?? { ...DEFAULT_STATE }

    state.failures++
    state.total++
    state.last_failure_at = Date.now()

    if (state.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      state.state = 'open'
      state.opened_at = Date.now()
    }

    await getRedis().set(key, state, { ex: CIRCUIT_BREAKER_TTL_SECONDS })
  } catch {
    // Silently fail
  }
}

/**
 * Get current circuit state for a carrier (for health dashboard).
 */
export async function getCircuitState(carrierSlug: string): Promise<CircuitState> {
  try {
    return (await getRedis().get<CircuitState>(getKey(carrierSlug))) ?? { ...DEFAULT_STATE }
  } catch {
    return { ...DEFAULT_STATE }
  }
}
