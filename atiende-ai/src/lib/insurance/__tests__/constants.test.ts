// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { CARRIER_SEEDS, COVERAGE_LABELS } from '../constants'

describe('constants — CARRIER_SEEDS', () => {
  it('contains exactly 15 carriers', () => {
    expect(CARRIER_SEEDS).toHaveLength(15)
  })

  it('all carriers have required fields', () => {
    for (const carrier of CARRIER_SEEDS) {
      expect(carrier.name).toBeTruthy()
      expect(typeof carrier.name).toBe('string')

      expect(carrier.slug).toBeTruthy()
      expect(typeof carrier.slug).toBe('string')

      expect(carrier.portal_url).toBeTruthy()
      expect(typeof carrier.portal_url).toBe('string')

      expect(carrier.portal_type).toBeTruthy()
      expect(['browser', 'api', 'email']).toContain(carrier.portal_type)

      expect(Array.isArray(carrier.supported_lines)).toBe(true)
      expect(carrier.supported_lines.length).toBeGreaterThan(0)

      expect(typeof carrier.market_share).toBe('number')
      expect(carrier.market_share).toBeGreaterThan(0)
    }
  })

  it('no duplicate slugs', () => {
    const slugs = CARRIER_SEEDS.map((c) => c.slug)
    const uniqueSlugs = new Set(slugs)
    expect(uniqueSlugs.size).toBe(slugs.length)
  })

  it('all portal URLs are valid URLs', () => {
    for (const carrier of CARRIER_SEEDS) {
      expect(() => new URL(carrier.portal_url)).not.toThrow()
      const url = new URL(carrier.portal_url)
      expect(url.protocol).toMatch(/^https?:$/)
    }
  })

  it('no duplicate carrier names', () => {
    const names = CARRIER_SEEDS.map((c) => c.name)
    const uniqueNames = new Set(names)
    expect(uniqueNames.size).toBe(names.length)
  })

  it('all supported_lines contain valid insurance line values', () => {
    const validLines = ['auto', 'vida', 'gastos_medicos', 'hogar', 'negocio']
    for (const carrier of CARRIER_SEEDS) {
      for (const line of carrier.supported_lines) {
        expect(validLines).toContain(line)
      }
    }
  })
})

describe('constants — COVERAGE_LABELS', () => {
  it('coverage labels match coverage types', () => {
    const expectedTypes = ['amplia', 'limitada', 'rc_obligatoria']
    for (const type of expectedTypes) {
      expect(COVERAGE_LABELS).toHaveProperty(type)
      expect(typeof COVERAGE_LABELS[type]).toBe('string')
      expect(COVERAGE_LABELS[type].length).toBeGreaterThan(0)
    }
  })

  it('has exactly 3 coverage types', () => {
    expect(Object.keys(COVERAGE_LABELS)).toHaveLength(3)
  })
})
