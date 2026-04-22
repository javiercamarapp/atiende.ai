#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════════════════════
// RE-ENCRYPT: migrate rows from v1 key to v2 key
//
// Run AFTER setting MESSAGES_ENCRYPTION_KEY_V2 in the environment. The app
// already reads with dual-key fallback and writes with v2, so this script
// only needs to re-encrypt existing rows that were written with v1.
//
// Usage:
//   MESSAGES_ENCRYPTION_KEY=<old> MESSAGES_ENCRYPTION_KEY_V2=<new> \
//   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
//     npx tsx scripts/backfill/re-encrypt-v2.ts [--dry-run] [--batch-size=200]
//
// Once all rows are re-encrypted, remove MESSAGES_ENCRYPTION_KEY from env
// and rename MESSAGES_ENCRYPTION_KEY_V2 to MESSAGES_ENCRYPTION_KEY.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const ALG = 'aes-256-gcm';
const PREFIX = 'v1:';

function loadKey(envName: string): Buffer | null {
  const hex = process.env[envName];
  if (!hex || hex.length !== 64) return null;
  const buf = Buffer.from(hex, 'hex');
  return buf.length === 32 ? buf : null;
}

const KEY_V1 = loadKey('MESSAGES_ENCRYPTION_KEY') || loadKey('PII_ENCRYPTION_KEY');
const KEY_V2 = loadKey('MESSAGES_ENCRYPTION_KEY_V2');

function decryptWith(ct: string, key: Buffer): string | null {
  try {
    const [, ivB64, payloadB64] = ct.split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const payload = Buffer.from(payloadB64, 'base64');
    const tag = payload.subarray(payload.length - 16);
    const data = payload.subarray(0, payload.length - 16);
    const decipher = crypto.createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${Buffer.concat([ct, tag]).toString('base64')}`;
}

function isEncryptedWithV1(ct: string): boolean {
  if (!ct.startsWith(PREFIX) || !KEY_V2) return false;
  if (decryptWith(ct, KEY_V2) !== null) return false;
  return KEY_V1 ? decryptWith(ct, KEY_V1) !== null : false;
}

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = parseInt(
  process.argv.find(a => a.startsWith('--batch-size='))?.split('=')[1] || '200',
  10,
);

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface TableConfig {
  table: string;
  encryptedCols: string[];
}

const TABLES: TableConfig[] = [
  { table: 'messages', encryptedCols: ['content', 'media_transcription', 'media_description'] },
  { table: 'contacts', encryptedCols: ['phone', 'name'] },
  { table: 'conversations', encryptedCols: ['customer_phone', 'customer_name'] },
  { table: 'appointments', encryptedCols: ['customer_phone'] },
  { table: 'leads', encryptedCols: ['phone'] },
];

async function reEncryptTable(config: TableConfig): Promise<{ scanned: number; migrated: number; errors: number }> {
  const stats = { scanned: 0, migrated: 0, errors: 0 };
  let lastId = '';

  const selectCols = ['id', ...config.encryptedCols].join(', ');

  while (true) {
    let query = supabase
      .from(config.table)
      .select(selectCols)
      .order('id')
      .limit(BATCH_SIZE);

    if (lastId) query = query.gt('id', lastId);

    const { data: rows, error } = await query;
    if (error) { stats.errors++; console.error(`[${config.table}]`, error.message); break; }
    if (!rows?.length) break;

    for (const row of rows) {
      stats.scanned++;
      lastId = row.id;

      const patch: Record<string, string> = {};

      for (const col of config.encryptedCols) {
        const val = row[col] as string | null;
        if (!val || !isEncryptedWithV1(val)) continue;

        const plain = decryptWith(val, KEY_V1!);
        if (!plain) continue;

        patch[col] = encrypt(plain, KEY_V2!);
      }

      if (Object.keys(patch).length === 0) continue;

      if (DRY_RUN) {
        console.log(`[${config.table}] DRY RUN: re-encrypt row ${row.id} cols=${Object.keys(patch).join(',')}`);
        stats.migrated++;
        continue;
      }

      const { error: updateErr } = await supabase
        .from(config.table)
        .update(patch)
        .eq('id', row.id);

      if (updateErr) {
        stats.errors++;
        console.error(`[${config.table}] update ${row.id}:`, updateErr.message);
      } else {
        stats.migrated++;
      }
    }

    if (rows.length < BATCH_SIZE) break;
  }

  return stats;
}

async function main() {
  if (!KEY_V1) { console.error('MESSAGES_ENCRYPTION_KEY (v1) not set'); process.exit(1); }
  if (!KEY_V2) { console.error('MESSAGES_ENCRYPTION_KEY_V2 not set'); process.exit(1); }

  console.log(`=== Key Rotation Re-encrypt ${DRY_RUN ? '(DRY RUN)' : ''} ===`);

  for (const config of TABLES) {
    console.log(`\nProcessing ${config.table}...`);
    const stats = await reEncryptTable(config);
    console.log(`  scanned=${stats.scanned} migrated=${stats.migrated} errors=${stats.errors}`);
  }

  console.log('\nDone.');
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
