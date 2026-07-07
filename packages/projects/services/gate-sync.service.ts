/**
 * gate-sync.service — CR-16 orchestrator: fetch a linked repo's docs/project-progress.md,
 * parse the RESOLVED macro gates, and idempotently complete the matching macro_checkpoints.
 *
 * This is the ONLY sanctioned path by which the tracker auto-resolves macro checkpoints, and
 * only when EXPLICITLY invoked (admin/leadership sync endpoint, or a link-time trigger). The
 * passive `governance_events → v_timeline` join remains DISPLAY-ONLY and still never sets
 * reached_at (FR-P2-041 unchanged for that path). CR-16 is a scoped, provenance-tagged,
 * admin-only exception recorded in the SRS delta (FR-P2-043).
 *
 * Completion is provenance-tagged `reviewed_by = 'system:repo-sync'` and guarded by
 * `reached_at IS NULL`, so re-running is idempotent (never double-completes). The UPDATE runs
 * under the Phase-2 app DB role (kiro_phase2), never the append-only kiro_mcp role (SEC-H1),
 * and does NOT touch governance_events.
 *
 * CR16-H2 (auditability): auto-resolution is a human-approval-gate BYPASS path, so every run
 * that resolves ≥1 gate writes an APPEND-ONLY audit record to project_link_audit capturing the
 * actor, the source owner/repo (+ content fingerprint), and exactly which gates were resolved —
 * an immutable trail beyond the mutable macro_checkpoints.reviewed_by column and CloudWatch log.
 *
 * Source: specs/phase2/CR-16-link-time-gate-detection-spec.md §6, §7, §8; cr16-security-review CR16-H1/H2.
 */
import { getPool } from '@kiro-governance/shared/db/pool';
import { log } from '@kiro-governance/shared/middleware/logger';
import { NotFoundError } from '@kiro-governance/shared/middleware/error-handler';
import { MacroGate } from '@kiro-governance/shared/constants/macro-gates';
import { resolveCheckpointForGate } from '@kiro-governance/shared/constants/gate-checkpoint-map';
import { SSMClient } from '@aws-sdk/client-ssm';
import { fetchProgressFile, isOwnerAllowlistConfigured } from './github.service';
import { parseResolvedGates } from './progress-tracker.parser';

/** Completion provenance written to macro_checkpoints.reviewed_by (distinguishable source). */
export const REPO_SYNC_ACTOR = 'system:repo-sync';

const RESULT_DETAIL = 'Auto-resolved from repo docs/project-progress.md by repo-sync';

/** Non-secret summary of a sync run. */
export interface SyncGatesSummary {
  project_id: string;
  matched: number;
  resolved: number;
  skipped: number;
}

/** SSM client reused across warm invocations (no secret held here — see github.service). */
const ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });

interface ProjectLinkRow {
  jira_key: string;
  github_repo: string | null;
  github_url: string | null;
}

/**
 * Fetch → parse → map → idempotently complete macro_checkpoints for a project's repo tracker.
 * Returns { matched, resolved, skipped }. Throws NotFoundError (unknown project) and
 * GithubFetchError (rate-limit / auth / network) — the caller maps those to HTTP status.
 */
export async function syncGatesFromRepo(projectId: string, actor: string): Promise<SyncGatesSummary> {
  const pool = await getPool();

  const projectRes = await pool.query(
    `SELECT jira_key, github_repo, github_url FROM projects WHERE jira_key = $1`,
    [projectId],
  );
  if (projectRes.rows.length === 0) {
    throw new NotFoundError('Project', projectId);
  }
  const project = projectRes.rows[0] as ProjectLinkRow;

  if (!isOwnerAllowlistConfigured()) {
    // CR16-H1 — allowlist not configured: sync relies solely on token scope. Surface a
    // hardening warning so operators configure GITHUB_ALLOWED_OWNERS or a repo-scoped App token.
    log('warn', 'GATE_SYNC_OWNER_ALLOWLIST_UNSET', { projectId });
  }

  // Fetch the tracker file (own-repo-only — resolved from the row, never request input).
  const file = await fetchProgressFile(
    { githubRepo: project.github_repo, githubUrl: project.github_url },
    ssmClient,
  );

  if (file.content === null) {
    // Graceful no-op: unlinked / owner-unresolved / owner-not-allowed / file_not_found.
    log('info', 'GATE_SYNC', {
      projectId,
      actor,
      matched: 0,
      resolved: 0,
      skipped: 0,
      reason: file.reason,
    });
    return { project_id: project.jira_key, matched: 0, resolved: 0, skipped: 0 };
  }

  const resolvedGates = parseResolvedGates(file.content);

  let matched = 0;
  let resolved = 0;
  let skipped = 0;
  const newlyResolvedGates: MacroGate[] = [];

  for (const gate of resolvedGates) {
    const checkpointName = resolveCheckpointForGate(gate);
    if (!checkpointName) {
      // Unmapped gate — never guessed; surfaced as skipped.
      skipped++;
      continue;
    }

    // Idempotent, provenance-tagged completion — only rows not already reached.
    const upd = await pool.query(
      `UPDATE macro_checkpoints
          SET reached_at    = now(),
              reviewed_by   = $3,
              result_detail = COALESCE(result_detail, $4)
        WHERE project_id      = $1
          AND checkpoint_name = $2
          AND reached_at IS NULL
      RETURNING id`,
      [project.jira_key, checkpointName, REPO_SYNC_ACTOR, RESULT_DETAIL],
    );

    if (upd.rowCount === 1) {
      matched++;
      resolved++;
      newlyResolvedGates.push(gate);
      continue;
    }

    // No row updated → either the checkpoint row is missing, or it is already resolved.
    const exists = await pool.query(
      `SELECT 1 FROM macro_checkpoints WHERE project_id = $1 AND checkpoint_name = $2 LIMIT 1`,
      [project.jira_key, checkpointName],
    );
    if (exists.rows.length > 0) {
      matched++; // row exists but was already resolved (re-sync no-op)
    }
    skipped++;
  }

  // CR16-H2 — append-only audit of the gate-bypass, only when a state change actually occurred.
  if (resolved > 0) {
    try {
      await pool.query(
        `INSERT INTO project_link_audit (project_id, field, old_value, new_value, actor_sub)
         VALUES ($1, 'gate_sync', $2, $3, $4)`,
        [
          project.jira_key,
          // source provenance (owner/repo + non-secret content fingerprint) — never a token.
          JSON.stringify({ owner: file.owner ?? null, repo: file.repo ?? null, content_ref: file.contentRef ?? null }),
          JSON.stringify({ resolved_gates: newlyResolvedGates, matched, resolved, skipped }),
          actor,
        ],
      );
    } catch (err) {
      // Audit is best-effort at write time but MUST be attempted; a failure is logged loudly
      // (the completion still stands, tagged reviewed_by='system:repo-sync').
      log('warn', 'GATE_SYNC_AUDIT_FAILED', {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log('info', 'GATE_SYNC', { projectId, actor, matched, resolved, skipped });
  return { project_id: project.jira_key, matched, resolved, skipped };
}

/**
 * Link-time trigger (T1). Best-effort wrapper that ALWAYS resolves (mirrors
 * notifyMacroGateApproved): logs GATE_SYNC_RESULT / GATE_SYNC_FAILED and never throws, so a
 * sync failure never fails the create/update that triggered it.
 *
 * CR16-L1: callers `await` this before returning (it always resolves) rather than truly
 * fire-and-forget — a post-response Lambda freeze would otherwise silently drop the sync.
 */
export async function triggerLinkTimeSync(projectId: string, actor: string): Promise<void> {
  try {
    const summary = await syncGatesFromRepo(projectId, actor);
    log('info', 'GATE_SYNC_RESULT', {
      projectId,
      matched: summary.matched,
      resolved: summary.resolved,
      skipped: summary.skipped,
    });
  } catch (err) {
    log('warn', 'GATE_SYNC_FAILED', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
