// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// We must set the env var BEFORE importing the module under test
const TEST_KEY = 'a'.repeat(64) // 64 hex chars = 32 bytes

describe('credential-vault', () => {
  beforeEach(() => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', TEST_KEY)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('encrypt then decrypt returns original string', async () => {
    const { encryptCredential, decryptCredential } = await import('../credential-vault')
    const plaintext = 'my-secret-password-123!@#'
    const encrypted = encryptCredential(plaintext)
    const decrypted = decryptCredential(encrypted)
    expect(decrypted).toBe(plaintext)
  })

  it('different plaintexts produce different ciphertexts', async () => {
    const { encryptCredential } = await import('../credential-vault')
    const a = encryptCredential('password-one')
    const b = encryptCredential('password-two')
    expect(a).not.toBe(b)
  })

  it('same plaintext produces different ciphertexts (random IV)', async () => {
    const { encryptCredential } = await import('../credential-vault')
    const a = encryptCredential('same-value')
    const b = encryptCredential('same-value')
    expect(a).not.toBe(b)
  })

  it('decrypting tampered ciphertext throws', async () => {
    const { encryptCredential, decryptCredential } = await import('../credential-vault')
    const encrypted = encryptCredential('legit-data')
    // Tamper with the base64 payload
    const buf = Buffer.from(encrypted, 'base64')
    buf[buf.length - 1] ^= 0xff // flip bits in the last byte
    const tampered = buf.toString('base64')
    expect(() => decryptCredential(tampered)).toThrow()
  })

  it('empty string encrypts and decrypts correctly', async () => {
    const { encryptCredential, decryptCredential } = await import('../credential-vault')
    const encrypted = encryptCredential('')
    const decrypted = decryptCredential(encrypted)
    expect(decrypted).toBe('')
  })

  it('missing CREDENTIAL_ENCRYPTION_KEY throws descriptive error', async () => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', '')
    const { encryptCredential } = await import('../credential-vault')
    expect(() => encryptCredential('test')).toThrow(
      /CREDENTIAL_ENCRYPTION_KEY must be a 64-char hex string/
    )
  })

  it('short CREDENTIAL_ENCRYPTION_KEY throws descriptive error', async () => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', 'abcd')
    const { encryptCredential } = await import('../credential-vault')
    expect(() => encryptCredential('test')).toThrow(
      /CREDENTIAL_ENCRYPTION_KEY must be a 64-char hex string/
    )
  })
})
