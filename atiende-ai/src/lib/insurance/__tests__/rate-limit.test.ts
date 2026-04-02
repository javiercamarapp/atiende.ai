// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── In-memory sorted set mock for Redis ──────────────────
const sortedSets = new Map<string, Map<string, number>>()
const expiries = new Map<string, number>()

const mockPipeline = {
  zremrangebyscore: vi.fn((key: string, min: number, max: number) => {
    const set = sortedSets.get(key)
    if (set) {
      for (const [member, score] of set) {
        if (score >= min && score <= max) set.delete(member)
      }
    }
    return mockPipeline
  }),
  zadd: vi.fn((key: string, entry: { score: number; member: string }) => {
    if (!sortedSets.has(key)) sortedSets.set(key, new Map())
    sortedSets.get(key)!.set(entry.member, entry.score)
    return mockPipeline
  }),
  zcard: vi.fn((key: string) => {
    return mockPipeline
  }),
  expire: vi.fn((key: string, seconds: number) => {
    expiries.set(key, Date.now() + seconds * 1000)
    return mockPipeline
  }),
  exec: vi.fn(async () => {
    // Simulate pipeline execution:
    // results[0] = zremrangebyscore result (count removed)
    // results[1] = zadd result
    // results[2] = zcard result (current count)
    const calls = mockPipeline.zadd.mock.calls
    const lastCall = calls[calls.length - 1]
    const key = lastCall?.[0] as string
    const set = sortedSets.get(key)
    const count = set ? set.size : 0
    return [0, 1, count, true]
  }),
}

vi.mock('@upstash/redis', () => {
  return {
    Redis: class MockRedis {
      pipeline() {
        return mockPipeline
      }
    },
  }
})

vi.mock('../logger', () => ({
  logInsuranceError: vi.fn(),
}))

import { checkInsuranceRateLimit } from '../rate-limit'

describe('rate-limit', () => {
  beforeEach(() => {
    sortedSets.clear()
    expiries.clear()
    vi.clearAllMocks()
  })

  it('first request within window is allowed', async () => {
    const allowed = await checkInsuranceRateLimit('user-1', 5, 60_000)
    expect(allowed).toBe(true)
  })

  it('requests over limit are denied', async () => {
    // Fill up to the limit
    for (let i = 0; i < 5; i++) {
      await checkInsuranceRateLimit('user-2', 5, 60_000)
    }
    // 6th request should be denied
    const allowed = await checkInsuranceRateLimit('user-2', 5, 60_000)
    expect(allowed).toBe(false)
  })

  it('window resets after expiry (old entries removed)', async () => {
    // Add entries with old timestamps by manipulating the sorted set directly
    const key = 'ins:rl:user-3'
    sortedSets.set(key, new Map())
    const oldTime = Date.now() - 120_000 // 2 minutes ago
    for (let i = 0; i < 5; i++) {
      sortedSets.get(key)!.set(`${oldTime + i}:abc${i}`, oldTime + i)
    }

    // Override zremrangebyscore to actually clean old entries for this test
    mockPipeline.zremrangebyscore.mockImplementationOnce(
      (k: string, min: number, max: number) => {
        const set = sortedSets.get(k)
        if (set) {
          for (const [member, score] of set) {
            if (score >= min && score <= max) set.delete(member)
          }
        }
        return mockPipeline
      }
    )

    // After cleanup, zcard should return only the 1 new entry
    mockPipeline.exec.mockImplementationOnce(async () => {
      const set = sortedSets.get(key)
      return [5, 1, set ? set.size : 1, true]
    })

    const allowed = await checkInsuranceRateLimit('user-3', 5, 60_000)
    expect(allowed).toBe(true)
  })
})
