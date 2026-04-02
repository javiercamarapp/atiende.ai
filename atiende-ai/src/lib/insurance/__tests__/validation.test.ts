// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  credentialCreateSchema,
  quoteRequestSchema,
  callbackResultSchema,
  formatZodErrors,
} from '../validation'

describe('validation — credentialCreateSchema', () => {
  it('valid credential input passes', () => {
    const input = {
      carrier_id: '550e8400-e29b-41d4-a716-446655440000',
      username: 'agent123',
      password: 'secret',
      agent_number: 'AG-001',
    }
    const result = credentialCreateSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('missing carrier_id fails', () => {
    const input = {
      username: 'agent123',
      password: 'secret',
    }
    const result = credentialCreateSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('non-uuid carrier_id fails', () => {
    const input = {
      carrier_id: 'not-a-uuid',
      username: 'agent123',
      password: 'secret',
    }
    const result = credentialCreateSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('empty username fails', () => {
    const input = {
      carrier_id: '550e8400-e29b-41d4-a716-446655440000',
      username: '',
      password: 'secret',
    }
    const result = credentialCreateSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

describe('validation — quoteRequestSchema', () => {
  const validQuoteRequest = {
    insurance_line: 'auto' as const,
    client: {
      name: 'Juan Perez',
      zip_code: '06600',
    },
    vehicle: {
      brand: 'Toyota',
      model: 'Corolla',
      year: 2024,
      use: 'particular' as const,
    },
    coverage_type: 'amplia' as const,
    source: 'whatsapp' as const,
  }

  it('valid quote request passes', () => {
    const result = quoteRequestSchema.safeParse(validQuoteRequest)
    expect(result.success).toBe(true)
  })

  it('invalid insurance_line fails', () => {
    const result = quoteRequestSchema.safeParse({
      ...validQuoteRequest,
      insurance_line: 'mascota',
    })
    expect(result.success).toBe(false)
  })

  it('ZIP code must be a string', () => {
    const result = quoteRequestSchema.safeParse({
      ...validQuoteRequest,
      client: { ...validQuoteRequest.client, zip_code: 12345 },
    })
    expect(result.success).toBe(false)
  })

  it('ZIP code must be exactly 5 characters', () => {
    const result = quoteRequestSchema.safeParse({
      ...validQuoteRequest,
      client: { ...validQuoteRequest.client, zip_code: '123' },
    })
    expect(result.success).toBe(false)
  })

  it('valid ZIP code string passes', () => {
    const result = quoteRequestSchema.safeParse({
      ...validQuoteRequest,
      client: { ...validQuoteRequest.client, zip_code: '01000' },
    })
    expect(result.success).toBe(true)
  })

  it('missing client name fails', () => {
    const result = quoteRequestSchema.safeParse({
      ...validQuoteRequest,
      client: { zip_code: '06600' },
    })
    expect(result.success).toBe(false)
  })
})

describe('validation — callbackResultSchema', () => {
  it('valid callback result passes', () => {
    const input = {
      request_id: '550e8400-e29b-41d4-a716-446655440000',
      carrier_slug: 'qualitas',
      status: 'success' as const,
      annual_premium: 15000,
      monthly_premium: 1350,
    }
    const result = callbackResultSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('invalid status value fails', () => {
    const input = {
      request_id: '550e8400-e29b-41d4-a716-446655440000',
      carrier_slug: 'qualitas',
      status: 'unknown',
    }
    const result = callbackResultSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('negative premium fails', () => {
    const input = {
      request_id: '550e8400-e29b-41d4-a716-446655440000',
      carrier_slug: 'qualitas',
      status: 'success',
      annual_premium: -100,
    }
    const result = callbackResultSchema.safeParse(input)
    expect(result.success).toBe(false)
  })

  it('deductible_percentage over 100 fails', () => {
    const input = {
      request_id: '550e8400-e29b-41d4-a716-446655440000',
      carrier_slug: 'qualitas',
      status: 'success',
      deductible_percentage: 150,
    }
    const result = callbackResultSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

describe('validation — formatZodErrors', () => {
  it('formats errors into path-keyed object', () => {
    const result = credentialCreateSchema.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) {
      const formatted = formatZodErrors(result.error)
      expect(formatted).toHaveProperty('carrier_id')
      expect(formatted).toHaveProperty('username')
      expect(formatted).toHaveProperty('password')
    }
  })
})
