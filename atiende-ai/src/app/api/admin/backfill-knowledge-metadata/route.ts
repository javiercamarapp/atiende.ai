import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { ingestKnowledgeBatchWithMetadata } from '@/lib/rag/search';
import { ZONES, zoneForQuestionKey } from '@/lib/knowledge/zone-map';
import { getQuestions } from '@/lib/onboarding/questions';
import { requireCronAuth } from '@/lib/agents/internal/cron-helpers';

// Backfill existing tenants with metadata-tagged knowledge chunks.
// Wipes legacy untagged `source='onboarding'` chunks and re-ingests from
// `onboarding_responses` so save-answer's DELETE by metadata->>question_key
// works on every tenant going forward.
//
// Auth: CRON_SECRET bearer. Idempotent: can be run multiple times safely.
// Optional query params: ?tenantId=<uuid> limits to one tenant, ?dryRun=1
// skips all writes.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function answerToText(answer: unknown): string {
  if (answer === null || answer === undefined) return '';
  if (typeof answer === 'string') return answer.trim();
  if (typeof answer === 'number' || typeof answer === 'boolean') return String(answer);
  if (Array.isArray(answer)) return answer.map((a) => answerToText(a)).filter(Boolean).join(', ');
  if (typeof answer === 'object') {
    const obj = answer as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text.trim();
    if ('value' in obj) return answerToText(obj.value);
    return JSON.stringify(obj);
  }
  return '';
}

export async function POST(req: NextRequest) {
  const authFail = requireCronAuth(req);
  if (authFail) return authFail;

  const url = new URL(req.url);
  const onlyTenant = url.searchParams.get('tenantId');
  const dryRun = url.searchParams.get('dryRun') === '1';
  const log = logger.child({ job: 'backfill_knowledge_metadata', dry_run: dryRun });
  const start = Date.now();

  type TenantRow = { id: string; business_type: string | null };
  const tenantQuery = supabaseAdmin
    .from('tenants')
    .select('id, business_type');
  const tenantResult = onlyTenant
    ? await tenantQuery.eq('id', onlyTenant)
    : await tenantQuery;

  if (tenantResult.error) {
    log.error('Failed to list tenants', new Error(tenantResult.error.message));
    return NextResponse.json({ error: 'Failed to list tenants' }, { status: 500 });
  }

  const tenants = (tenantResult.data ?? []) as TenantRow[];
  const perTenant: Array<{
    tenantId: string;
    responses: number;
    chunksIngested: number;
    legacyWiped: number;
    skipped?: string;
    error?: string;
  }> = [];

  for (const tenant of tenants) {
    try {
      // 1. Pull all responses for this tenant.
      const { data: responses, error: respErr } = await supabaseAdmin
        .from('onboarding_responses')
        .select('question_key, answer')
        .eq('tenant_id', tenant.id);

      if (respErr) {
        perTenant.push({ tenantId: tenant.id, responses: 0, chunksIngested: 0, legacyWiped: 0, error: respErr.message });
        continue;
      }

      const responseList = (responses ?? []) as Array<{ question_key: string; answer: unknown }>;
      if (responseList.length === 0) {
        perTenant.push({ tenantId: tenant.id, responses: 0, chunksIngested: 0, legacyWiped: 0, skipped: 'no responses' });
        continue;
      }

      // 2. Labels lookup for nicer chunk prefixes.
      const labels = new Map<string, string>();
      if (tenant.business_type) {
        for (const q of getQuestions(tenant.business_type)) {
          labels.set(q.key, q.label);
        }
      }

      // 3. Build chunks. One per non-empty response, tagged with metadata.
      const chunks: { content: string; category: string; metadata: Record<string, unknown> }[] = [];
      for (const row of responseList) {
        const text = answerToText(row.answer);
        if (!text) continue;
        const zoneId = zoneForQuestionKey(row.question_key);
        const zone = ZONES.find((z) => z.id === zoneId)!;
        const label = labels.get(row.question_key);
        const content = label ? `${label.toUpperCase()}: ${text}` : text;
        chunks.push({
          content,
          category: zone.category,
          metadata: {
            question_key: row.question_key,
            zone: zoneId,
            question_label: label ?? null,
            backfilled: true,
          },
        });
      }

      if (chunks.length === 0) {
        perTenant.push({ tenantId: tenant.id, responses: responseList.length, chunksIngested: 0, legacyWiped: 0, skipped: 'no non-empty answers' });
        continue;
      }

      if (dryRun) {
        perTenant.push({ tenantId: tenant.id, responses: responseList.length, chunksIngested: chunks.length, legacyWiped: 0, skipped: 'dry run' });
        continue;
      }

      // 4. Wipe legacy onboarding chunks (both untagged and previously-
      // backfilled). Profile chunks (kind='profile') are preserved.
      const { count: wiped, error: wipeErr } = await supabaseAdmin
        .from('knowledge_chunks')
        .delete({ count: 'exact' })
        .eq('tenant_id', tenant.id)
        .eq('source', 'onboarding')
        .or('metadata->>kind.is.null,metadata->>kind.neq.profile');

      if (wipeErr) {
        log.warn('Failed to wipe legacy chunks, continuing', { tenant_id: tenant.id, error: wipeErr.message });
      }

      // 5. Ingest the fresh metadata-tagged set in one embedding call.
      await ingestKnowledgeBatchWithMetadata(tenant.id, chunks, 'onboarding');

      perTenant.push({
        tenantId: tenant.id,
        responses: responseList.length,
        chunksIngested: chunks.length,
        legacyWiped: wiped ?? 0,
      });
    } catch (err) {
      log.error('Tenant backfill failed', err instanceof Error ? err : new Error(String(err)), { tenant_id: tenant.id });
      perTenant.push({
        tenantId: tenant.id,
        responses: 0,
        chunksIngested: 0,
        legacyWiped: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const durationMs = Date.now() - start;
  const summary = {
    tenantsProcessed: perTenant.length,
    tenantsSucceeded: perTenant.filter((t) => !t.error && !t.skipped).length,
    tenantsSkipped: perTenant.filter((t) => t.skipped).length,
    tenantsFailed: perTenant.filter((t) => t.error).length,
    totalChunksIngested: perTenant.reduce((n, t) => n + t.chunksIngested, 0),
    totalLegacyWiped: perTenant.reduce((n, t) => n + t.legacyWiped, 0),
    durationMs,
    dryRun,
  };

  log.info('Backfill completed', summary);

  return NextResponse.json({ status: 'ok', summary, tenants: perTenant });
}
