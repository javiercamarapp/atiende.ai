#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════════════════════
// BACKFILL: encrypt existing plaintext phone/name columns + populate hashes
//
// Run AFTER deploying the migration (pii_encryption_phone_columns.sql) and
// the app code that writes encrypted values. This script encrypts existing
// plaintext rows in batches, populating the *_hash blind index columns.
//
// Usage:
//   MESSAGES_ENCRYPTION_KEY=<hex> SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
//     npx tsx scripts/backfill/pii-encrypt-phones.ts [--dry-run] [--batch-size=500]
//
// The script is idempotent: rows already encrypted (v1: prefix) are skipped.
// Safe to run multiple times or interrupt and resume.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

// Inline crypto to avoid path alias issues in standalone script
import crypto from 'crypto';

const ALG = 'aes-256-gcm';
const PREFIX = 'v1:';

function getKey(): Buffer | null {
  const hex = process.env.MESSAGES_ENCRYPTION_KEY || process.env.PII_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) return null;
  const buf = Buffer.from(hex, 'hex');
  return buf.length === 32 ? buf : null;
}

function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) throw new Error('No encryption key configured');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${Buffer.concat([ct, tag]).toString('base64')}`;
}

function hmacHash(value: string): string {
  const key = getKey();
  if (!key) throw new Error('No encryption key configured');
  const hmacKey = crypto.hkdfSync('sha256', key, 'atiende-blind-index', 'phone-hash', 32) as Buffer;
  const normalized = value.replace(/[^\d+]/g, '');
  return crypto.createHmac('sha256', hmacKey).update(normalized).digest('hex').slice(0, 32);
}

function isEncrypted(val: string | null): boolean {
  return val?.startsWith(PREFIX) ?? false;
}

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = parseInt(
  process.argv.find(a => a.startsWith('--batch-size='))?.split('=')[1] || '500',
  10,
);

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface Stats {
  table: string;
  scanned: number;
  encrypted: number;
  skipped: number;
  errors: number;
}

async function backfillTable(
  table: string,
  phoneCol: string,
  hashCol: string,
  nameCol?: string,
): Promise<Stats> {
  const stats: Stats = { table, scanned: 0, encrypted: 0, skipped: 0, errors: 0 };
  let lastId = '';

  while (true) {
    let query = supabase
      .from(table)
      .select(`id, ${phoneCol}${nameCol ? `, ${nameCol}` : ''}`)
      .order('id')
      .limit(BATCH_SIZE);

    if (lastId) {
      query = query.gt('id', lastId);
    }

    const { data: rows, error } = await query;
    if (error) {
      console.error(`[${table}] query error:`, error.message);
      stats.errors++;
      break;
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      stats.scanned++;
      lastId = row.id;

      const phone = row[phoneCol] as string | null;
      const name = nameCol ? (row[nameCol] as string | null) : null;

      if (!phone || isEncrypted(phone)) {
        stats.skipped++;
        continue;
      }

      const patch: Record<string, unknown> = {
        [phoneCol]: encrypt(phone),
        [hashCol]: hmacHash(phone),
      };

      if (nameCol && name && !isEncrypted(name)) {
        patch[nameCol] = encrypt(name);
      }

      if (DRY_RUN) {
        console.log(`[${table}] DRY RUN: would encrypt row ${row.id} (phone=${phone.slice(0, 6)}...)`);
        stats.encrypted++;
        continue;
      }

      const { error: updateErr } = await supabase
        .from(table)
        .update(patch)
        .eq('id', row.id);

      if (updateErr) {
        console.error(`[${table}] update error for row ${row.id}:`, updateErr.message);
        stats.errors++;
      } else {
        stats.encrypted++;
      }
    }

    if (rows.length < BATCH_SIZE) break;
  }

  return stats;
}

async function main() {
  if (!getKey()) {
    console.error('ERROR: MESSAGES_ENCRYPTION_KEY not set or invalid');
    process.exit(1);
  }

  console.log(`=== PII Backfill ${DRY_RUN ? '(DRY RUN)' : ''} ===`);
  console.log(`Batch size: ${BATCH_SIZE}`);

  const results: Stats[] = [];

  results.push(await backfillTable('contacts', 'phone', 'phone_hash', 'name'));
  results.push(await backfillTable('conversations', 'customer_phone', 'customer_phone_hash', 'customer_name'));
  results.push(await backfillTable('appointments', 'customer_phone', 'customer_phone_hash'));
  // leads.phone may not exist in all schemas — probe first
  const { error: leadsProbe } = await supabase.from('leads').select('phone').limit(1);
  if (!leadsProbe) {
    results.push(await backfillTable('leads', 'phone', 'phone_hash'));
  } else {
    console.log('leads: skipped (phone column not found)');
  }

  console.log('\n=== Results ===');
  for (const r of results) {
    console.log(`${r.table}: scanned=${r.scanned} encrypted=${r.encrypted} skipped=${r.skipped} errors=${r.errors}`);
  }

  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
  if (totalErrors > 0) {
    console.error(`\n${totalErrors} errors encountered. Re-run to retry failed rows.`);
    process.exit(1);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
