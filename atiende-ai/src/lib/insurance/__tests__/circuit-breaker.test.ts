// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CircuitState } from '../types'

// ── In-memory Redis mock ─────────────────────────────────
const store = new Map<string, { value: unknown; expiresAt: number }>()

const mockRedis = {
  get: vi.fn(async <T>(key: string): Promise<T | null> => {
    const entry = store.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      store.delete(key)
      return null
    }
    // Return a deep copy so mutations inside the module don't affect the store
    return JSON.parse(JSON.stringify(entry.value)) as T
  }),
  set: vi.fn(async (key: string, value: unknown, opts?: { ex?: number }) => {
    const ttl = opts?.ex ?? 86400
    store.set(key, { value: JSON.parse(JSON.stringify(value)), expiresAt: Date.now() + ttl * 1000 })
  }),
}

// Mock the redis module
vi.mock('../redis', () => ({
  getInsuranceRedis: () => mockRedis,
}))

// Mock the logger so it doesn't throw
vi.mock('../logger', () => ({
  logInsuranceError: vi.fn(),
}))

import {
  isCircuitOpen,
  recordSuccess,
  recordFailure,
  getCircuitState,
} from '../circuit-breaker'

describe('circuit-breaker', () => {
  beforeEach(() => {
    store.clear()
    vi.clearAllMocks()
  })

  it('default state is closed with zero counts', async () => {
    const state = await getCircuitState('qualitas')
    expect(state.state).toBe('closed')
    expect(state.failures).toBe(0)
    expect(state.successes).toBe(0)
    expect(state.total).toBe(0)
  })

  it('recording failures increments counter', async () => {
    await recordFailure('qualitas')
    await recordFailure('qualitas')
    const state = await getCircuitState('qualitas')
    expect(state.failures).toBe(2)
    expect(state.total).toBe(2)
    expect(state.state).toBe('closed')
  })

  it('5 failures opens the circuit', async () => {
    for (let i = 0; i < 5; i++) {
      await recordFailure('qualitas')
    }
    const state = await getCircuitState('qualitas')
    expect(state.state).toBe('open')
    expect(state.failures).toBe(5)
    expect(state.opened_at).toBeGreaterThan(0)
  })

  it('open circuit returns true for isCircuitOpen', async () => {
    for (let i = 0; i < 5; i++) {
      await recordFailure('qualitas')
    }
    const open = await isCircuitOpen('qualitas')
    expect(open).toBe(true)
  })

  it('after timeout, circuit transitions to half_open', async () => {
    for (let i = 0; i < 5; i++) {
      await recordFailure('qualitas')
    }

    // Manually set opened_at to be older than timeout (300_000 ms)
    const key = 'ins:cb:qualitas'
    const entry = store.get(key)!
    const state = entry.value as CircuitState
    state.opened_at = Date.now() - 400_000
    store.set(key, { value: state, expiresAt: entry.expiresAt })

    const open = await isCircuitOpen('qualitas')
    expect(open).toBe(false) // half_open allows one probe

    const updated = await getCircuitState('qualitas')
    expect(updated.state).toBe('half_open')
  })

  it('success in half_open closes circuit', async () => {
    // Set up half_open state directly
    const key = 'ins:cb:qualitas'
    const halfOpenState: CircuitState = {
      failures: 5,
      successes: 0,
      total: 5,
      state: 'half_open',
      last_failure_at: Date.now() - 400_000,
      opened_at: Date.now() - 400_000,
    }
    store.set(key, {
      value: halfOpenState,
      expiresAt: Date.now() + 86400 * 1000,
    })

    await recordSuccess('qualitas')
    const state = await getCircuitState('qualitas')
    expect(state.state).toBe('closed')
    expect(state.failures).toBe(0)
    expect(state.successes).toBe(1)
  })

  it('declined quotes (success) do not open circuit', async () => {
    // Record a few failures (but below threshold) then successes
    await recordFailure('gnp')
    await recordFailure('gnp')
    await recordSuccess('gnp')
    await recordSuccess('gnp')
    await recordSuccess('gnp')

    const state = await getCircuitState('gnp')
    expect(state.state).toBe('closed')
    expect(state.successes).toBe(3)
    expect(state.failures).toBe(2)
  })
})
