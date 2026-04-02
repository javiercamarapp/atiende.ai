import { supabaseAdmin } from '@/lib/supabase/admin';

// ═══════════════════════════════════════════════════════════
// MARKETPLACE AGENT VERSIONING
// Tracks prompt/config versions so agents can be rolled back.
// Supports canary deployments and automatic rollback on errors.
// ═══════════════════════════════════════════════════════════

export interface AgentVersion {
  agentSlug: string;
  version: number;
  promptTemplate: string;
  config: Record<string, unknown>;
  createdAt: Date;
  isActive: boolean;
  /** Optional changelog describing what changed in this version */
  changelog?: string;
  /** Traffic percentage for canary deployments (1-100, default 100) */
  trafficPercent?: number;
}

export interface VersionDiff {
  field: string;
  before: unknown;
  after: unknown;
}

// ── VERSION CREATION ──────────────────────────────────────

/**
 * Create a new version snapshot for a marketplace agent.
 * Automatically increments the version number and marks it as active.
 */
export async function createAgentVersion(
  agentSlug: string,
  promptTemplate: string,
  config: Record<string, unknown>,
  changelog?: string
): Promise<AgentVersion> {
  const existing = await getAgentVersions(agentSlug);
  const nextVersion = existing.length > 0
    ? Math.max(...existing.map(v => v.version)) + 1
    : 1;

  // Deactivate all previous versions
  await supabaseAdmin
    .from('webhook_logs')
    .update({ status_code: 0 }) // 0 = inactive, 1 = active
    .eq('provider', 'agent_version')
    .eq('event_type', agentSlug);

  // Store new version as active
  await supabaseAdmin.from('webhook_logs').insert({
    provider: 'agent_version',
    event_type: agentSlug,
    direction: 'outbound',
    status_code: 1,
    payload: {
      version: nextVersion,
      prompt_template: promptTemplate,
      config,
      changelog: changelog || null,
      traffic_percent: 100,
    },
  });

  return {
    agentSlug,
    version: nextVersion,
    promptTemplate,
    config,
    createdAt: new Date(),
    isActive: true,
    changelog,
    trafficPercent: 100,
  };
}

// ── ROLLBACK ──────────────────────────────────────────────

/**
 * Rollback an agent to a specific version.
 * Reactivates the target version and applies its prompt/config to the agent.
 */
export async function rollbackAgent(agentSlug: string, version: number): Promise<void> {
  const versions = await getAgentVersions(agentSlug);
  const target = versions.find(v => v.version === version);

  if (!target) {
    throw new Error(`Version ${version} not found for agent "${agentSlug}"`);
  }

  // Deactivate all versions
  await supabaseAdmin
    .from('webhook_logs')
    .update({ status_code: 0 })
    .eq('provider', 'agent_version')
    .eq('event_type', agentSlug);

  // Reactivate the target version
  await supabaseAdmin
    .from('webhook_logs')
    .update({ status_code: 1 })
    .eq('provider', 'agent_version')
    .eq('event_type', agentSlug)
    .filter('payload->>version', 'eq', String(version));

  // Apply the rolled-back prompt to the actual agent record
  await supabaseAdmin
    .from('agents')
    .update({ prompt_template: target.promptTemplate })
    .eq('slug', agentSlug);
}

// ── VERSION RETRIEVAL ─────────────────────────────────────

/**
 * Get all version history for an agent, newest first.
 */
export async function getAgentVersions(agentSlug: string): Promise<AgentVersion[]> {
  const { data } = await supabaseAdmin
    .from('webhook_logs')
    .select('payload, status_code, created_at')
    .eq('provider', 'agent_version')
    .eq('event_type', agentSlug)
    .order('created_at', { ascending: false });

  if (!data?.length) return [];

  return data.map((row: { payload: unknown; status_code: number | null; created_at: string }) => {
    const p = row.payload as Record<string, unknown>;
    return {
      agentSlug,
      version: p.version as number,
      promptTemplate: p.prompt_template as string,
      config: (p.config as Record<string, unknown>) || {},
      createdAt: new Date(row.created_at),
      isActive: row.status_code === 1,
      changelog: (p.changelog as string) || undefined,
      trafficPercent: (p.traffic_percent as number) || 100,
    };
  });
}

/**
 * Get the currently active version for an agent, or null if none.
 */
export async function getActiveVersion(agentSlug: string): Promise<AgentVersion | null> {
  const versions = await getAgentVersions(agentSlug);
  return versions.find(v => v.isActive) || null;
}

// ── VERSION DIFF ──────────────────────────────────────────

/**
 * Compare two versions of an agent and return a list of changes.
 * Useful for review UIs and audit trails before deploying a new version.
 */
export function diffVersions(older: AgentVersion, newer: AgentVersion): VersionDiff[] {
  const diffs: VersionDiff[] = [];

  if (older.promptTemplate !== newer.promptTemplate) {
    diffs.push({
      field: 'promptTemplate',
      before: older.promptTemplate,
      after: newer.promptTemplate,
    });
  }

  // Compare config keys
  const allKeys = Array.from(new Set([
    ...Object.keys(older.config),
    ...Object.keys(newer.config),
  ]));

  for (const key of allKeys) {
    const oldVal = older.config[key];
    const newVal = newer.config[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diffs.push({
        field: `config.${key}`,
        before: oldVal ?? null,
        after: newVal ?? null,
      });
    }
  }

  return diffs;
}

// ── CANARY DEPLOYMENTS ────────────────────────────────────

/**
 * Start a canary deployment: the new version receives a percentage of traffic
 * while the previous stable version handles the rest.
 *
 * Traffic split is stored in the version payload and resolved at runtime
 * by the agent execution engine via `resolveCanaryVersion`.
 */
export async function startCanaryDeployment(
  agentSlug: string,
  promptTemplate: string,
  config: Record<string, unknown>,
  trafficPercent: number,
  changelog?: string
): Promise<AgentVersion> {
  const clamped = Math.max(1, Math.min(99, trafficPercent));

  const existing = await getAgentVersions(agentSlug);
  const nextVersion = existing.length > 0
    ? Math.max(...existing.map(v => v.version)) + 1
    : 1;

  // Reduce the current active version's traffic
  const currentActive = existing.find(v => v.isActive);
  if (currentActive) {
    await supabaseAdmin
      .from('webhook_logs')
      .update({
        payload: {
          version: currentActive.version,
          prompt_template: currentActive.promptTemplate,
          config: currentActive.config,
          changelog: currentActive.changelog || null,
          traffic_percent: 100 - clamped,
        },
      })
      .eq('provider', 'agent_version')
      .eq('event_type', agentSlug)
      .eq('status_code', 1);
  }

  // Insert canary version as also active
  await supabaseAdmin.from('webhook_logs').insert({
    provider: 'agent_version',
    event_type: agentSlug,
    direction: 'outbound',
    status_code: 1,
    payload: {
      version: nextVersion,
      prompt_template: promptTemplate,
      config,
      changelog: changelog || null,
      traffic_percent: clamped,
    },
  });

  return {
    agentSlug,
    version: nextVersion,
    promptTemplate,
    config,
    createdAt: new Date(),
    isActive: true,
    changelog,
    trafficPercent: clamped,
  };
}

/**
 * Resolve which version to use for a given request during a canary deployment.
 * Uses a random number against the traffic percentages to decide.
 * Falls back to the highest-version active entry if no canary is in progress.
 */
export async function resolveCanaryVersion(agentSlug: string): Promise<AgentVersion | null> {
  const versions = await getAgentVersions(agentSlug);
  const active = versions.filter(v => v.isActive);

  if (active.length === 0) return null;
  if (active.length === 1) return active[0];

  // Multiple active versions = canary in progress
  // Sort ascending by version so the canary (newer) is last
  active.sort((a, b) => a.version - b.version);

  const roll = Math.random() * 100;
  let cumulative = 0;

  for (const v of active) {
    cumulative += v.trafficPercent ?? 0;
    if (roll < cumulative) return v;
  }

  // Fallback to the newest
  return active[active.length - 1];
}

/**
 * Promote the canary to 100% traffic by deactivating the old version.
 * Call this after the canary proves stable.
 */
export async function promoteCanary(agentSlug: string): Promise<void> {
  const versions = await getAgentVersions(agentSlug);
  const active = versions.filter(v => v.isActive);

  if (active.length <= 1) return; // No canary in progress

  // The canary is the highest version among active
  const canary = active.reduce((a, b) => (a.version > b.version ? a : b));

  // Deactivate all, then reactivate only the canary at 100%
  await supabaseAdmin
    .from('webhook_logs')
    .update({ status_code: 0 })
    .eq('provider', 'agent_version')
    .eq('event_type', agentSlug);

  await supabaseAdmin
    .from('webhook_logs')
    .update({
      status_code: 1,
      payload: {
        version: canary.version,
        prompt_template: canary.promptTemplate,
        config: canary.config,
        changelog: canary.changelog || null,
        traffic_percent: 100,
      },
    })
    .eq('provider', 'agent_version')
    .eq('event_type', agentSlug)
    .filter('payload->>version', 'eq', String(canary.version));

  // Apply canary prompt to the agent record
  await supabaseAdmin
    .from('agents')
    .update({ prompt_template: canary.promptTemplate })
    .eq('slug', agentSlug);
}

// ── AUTO-ROLLBACK ON ERROR THRESHOLD ──────────────────────

/**
 * Check the recent error rate for an agent and automatically rollback
 * to the previous stable version if errors exceed the threshold.
 *
 * Designed to be called from the agent execution engine's catch block
 * or a periodic health check.
 *
 * @returns true if a rollback was performed
 */
export async function autoRollbackIfUnhealthy(
  agentSlug: string,
  errorThresholdPercent = 30,
  windowMinutes = 15
): Promise<boolean> {
  const cutoff = new Date();
  cutoff.setMinutes(cutoff.getMinutes() - windowMinutes);

  // Count recent agent executions (successes + failures logged via webhook_logs)
  const { data: recentLogs } = await supabaseAdmin
    .from('webhook_logs')
    .select('status_code')
    .eq('provider', 'agent_execution')
    .eq('event_type', agentSlug)
    .gte('created_at', cutoff.toISOString())
    .limit(200);

  if (!recentLogs?.length || recentLogs.length < 5) return false; // Not enough data

  const errors = recentLogs.filter(r => r.status_code !== null && r.status_code >= 400).length;
  const errorRate = (errors / recentLogs.length) * 100;

  if (errorRate < errorThresholdPercent) return false;

  // Find the previous stable version to rollback to
  const versions = await getAgentVersions(agentSlug);
  const active = versions.find(v => v.isActive);
  if (!active) return false;

  // Find the version right before the currently active one
  const previousStable = versions
    .filter(v => v.version < active.version)
    .sort((a, b) => b.version - a.version)[0];

  if (!previousStable) return false;

  await rollbackAgent(agentSlug, previousStable.version);

  // Log the auto-rollback event
  await supabaseAdmin.from('webhook_logs').insert({
    provider: 'agent_version',
    event_type: agentSlug,
    direction: 'outbound',
    payload: {
      action: 'auto_rollback',
      from_version: active.version,
      to_version: previousStable.version,
      error_rate: Math.round(errorRate * 100) / 100,
      window_minutes: windowMinutes,
      sample_size: recentLogs.length,
    },
  });

  return true;
}
