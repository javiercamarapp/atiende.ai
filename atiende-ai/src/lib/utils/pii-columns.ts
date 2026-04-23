// ═════════════════════════════════════════════════════════════════════════════
// PII COLUMNS — encrypt/decrypt helpers for contact fields
//
// Wraps encryptPII/decryptPII + blind index for phone/name columns that are
// used across 30+ files. Import these instead of calling crypto directly
// when working with contacts.phone, conversations.customer_phone, etc.
//
// Write path: encryptContactPhone(phone) → { encrypted, hash }
// Read path:  decryptContactPhone(encrypted) → plaintext
// Query path: hashPhone(phone) → hash for WHERE phone_hash = X
// ═════════════════════════════════════════════════════════════════════════════

import {
  encryptPIIWithRotation,
  decryptPIIWithRotation,
  hashForBlindIndex,
} from '@/lib/utils/crypto';

export interface EncryptedPhone {
  encrypted: string | null;
  hash: string | null;
}

export function encryptContactPhone(phone: string | null | undefined): EncryptedPhone {
  if (phone == null || phone === '') return { encrypted: null, hash: null };
  return {
    encrypted: encryptPIIWithRotation(phone),
    hash: hashForBlindIndex(phone),
  };
}

export function decryptContactPhone(encrypted: string | null | undefined): string | null {
  return decryptPIIWithRotation(encrypted);
}

export function encryptContactName(name: string | null | undefined): string | null {
  if (name == null || name === '') return null;
  return encryptPIIWithRotation(name);
}

export function decryptContactName(encrypted: string | null | undefined): string | null {
  return decryptPIIWithRotation(encrypted);
}

export function hashPhone(phone: string | null | undefined): string | null {
  return hashForBlindIndex(phone);
}

/**
 * Decrypt a row object's PII fields in-place. Useful for query results.
 * Mutates the object and returns it for chaining.
 */
export function decryptRowPhoneFields(
  row: Record<string, unknown>,
  phoneField = 'phone',
  nameField = 'name',
): Record<string, unknown> {
  if (row[phoneField] && typeof row[phoneField] === 'string') {
    row[phoneField] = decryptContactPhone(row[phoneField] as string);
  }
  if (row[nameField] && typeof row[nameField] === 'string') {
    row[nameField] = decryptContactName(row[nameField] as string);
  }
  return row;
}

export function decryptConversationRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (row.customer_phone && typeof row.customer_phone === 'string') {
    row.customer_phone = decryptContactPhone(row.customer_phone as string);
  }
  if (row.customer_name && typeof row.customer_name === 'string') {
    row.customer_name = decryptContactName(row.customer_name as string);
  }
  return row;
}
