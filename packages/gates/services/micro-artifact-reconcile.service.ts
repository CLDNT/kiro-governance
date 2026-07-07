/**
 * micro-artifact-reconcile.service — CR-12 Level-2 app-side auto-completion.
 *
 * Maps a linked project's OWN-REPO micro governance_events (by event_code) through the deterministic
 * micro_artifact_mapping lookup to the project's micro_artifacts, and idempotently completes the
 * matching rows (status='complete', completed_by='kiro:'||event.actor, completed_at=event.created_at).
 *
 * Compensating controls (CR-12 §1.2 — the trust model that lets Level-2 run without GitHub OIDC):
 *   1. Allow-list by construction — only an event_code present in micro_artifact_mapping with
 *      is_active=true can complete an artifact. Anything else is timeline-only (Level 1).
 *   2. Deterministic — config/lookup on event_code + (project_type, phase); never fuzzy text.
 *   3. Idempotent — status <> 'complete' guard; a re-run completes nothing.
 *   4. Reversible + audited — every auto-completion writes an append-only micro_artifact_audit row;
 *      a manual override (PATCH /artifacts) reverses it and is audited; a re-sync never clobbers a
 *      manual_override row.
 *   5. Own-repo-scoped — reads only the project's own github_repo events (from the project row,
 *      never request input) and writes only that project's micro_artifacts.
 *   6. App-owned — the UPDATE runs under kiro_phase2; kiro_mcp_app (MCP runtime) gets no grant and
 *      stays append-only. governance_events is never mutated here.
 *
 * Mirrors packages/projects/services/gate-sync.service.ts (CR-16): idempotent, audited, own-repo,
 * always-resolving trigger wrapper.
 *
 * Source: specs/phase2/CR-12-14-level2-spec.md §5.
 */
import { getPool } from '@kiro-governance/shared/db/pool';
import { log } from '@kiro-governance/shared/middleware/logger';
import { NotFoundError } from '@kiro-governance/shared/middleware/error-handler';

/** Completion provenance written to micro_artifacts.completed_by is 'kiro:'||event.actor.
 *  The audit `actor` column uses this constant to mark the system reconciliation run. */
export const ARTIFACT_SYNC_ACTOR = 'system:artifact-sync';

/** Non-secret summary of a reconcile run. */
export interface ReconcileArtifactsSummary {
  project_id: string;
  /** mapping-resolved micro events that have a target micro_artifacts row for the project */
  matched: number;
  /** rows newly set to complete by this run (0 on an idempotent re-run) */
  completed: number;
  /** resolved candidates that did NOT complete: already complete | manual_override | no target row */
  skipped: number;
}

interface ProjectRow {
  jira_key: string;
  github_repo: string | null;
  project_type: string;
}

interface UpdatedRow {
  id: number;
  phase: string;
  artifact_name: string;
  old_status: string;
  event_code: string;
  event_actor: string;
  created_at: string;
}

// The deterministic candidate CTE, shared by the UPDATE and the count query. Own-repo only
// (ge.project_id = github_repo), micro-only, event_code present, allow-listed (is_active),
// earliest-event-wins (DISTINCT ON ... ORDER BY created_at ASC).
const CANDIDATE_CTE = `
  candidate AS (
    SELECT DISTINCT ON (m.phase, m.artifact_name)
           m.phase, m.artifact_name, ge.actor AS event_actor, ge.created_at, ge.event_code
    FROM governance_events ge
    JOIN micro_artifact_mapping m
      ON  m.event_code   = ge.event_code
      AND m.project_type = $2
      AND m.is_active    = true
    WHERE ge.project_id = $3
      AND ge.type       = 'micro'
      AND ge.event_code IS NOT NULL
    ORDER BY m.phase, m.artifact_name, ge.created_at ASC
  )`;

/**
 * Fetch → map → idempotently complete micro_artifacts for a project's own-repo micro events.
 * Throws NotFoundError for an unknown project (caller maps to 404). An unlinked project
 * (github_repo IS NULL) is a graceful no-op ({matched:0, completed:0, skipped:0}).
 */
export async function reconcileMicroArtifacts(
  projectId: string,
  actor: string,
): Promise<ReconcileArtifactsSummary> {
  const pool = await getPool();

  const projectRes = await pool.query(
    `SELECT jira_key, github_repo, COALESCE(project_type, 'default') AS project_type
       FROM projects WHERE jira_key = $1`,
    [projectId],
  );
  if (projectRes.rows.length === 0) {
    throw new NotFoundError('Project', projectId);
  }
  const project = projectRes.rows[0] as ProjectRow;

  // Feature switch OFF: unlinked project has no repo events to reconcile.
  if (!project.github_repo) {
    log('info', 'ARTIFACT_SYNC', { projectId, actor, matched: 0, completed: 0, skipped: 0, reason: 'unlinked' });
    return { project_id: project.jira_key, matched: 0, completed: 0, skipped: 0 };
  }

  const params = [project.jira_key, project.project_type, project.github_repo];

  // Single guarded, idempotent UPDATE ... FROM. `target` captures old_status for the audit and
  // enforces the idempotent (status<>'complete') + reversibility (manual_override=false) guards.
  const upd = await pool.query(
    `WITH ${CANDIDATE_CTE},
     target AS (
       SELECT ma.id, ma.status AS old_status,
              c.phase, c.artifact_name, c.event_actor, c.created_at, c.event_code
       FROM micro_artifacts ma
       JOIN candidate c ON c.phase = ma.phase AND c.artifact_name = ma.artifact_name
       WHERE ma.project_id      = $1
         AND ma.status          <> 'complete'
         AND ma.manual_override  = false
     )
     UPDATE micro_artifacts ma
        SET status       = 'complete',
            completed_at = t.created_at,
            completed_by = 'kiro:' || t.event_actor
       FROM target t
      WHERE ma.id = t.id
     RETURNING ma.id, t.phase, t.artifact_name, t.old_status, t.event_code, t.event_actor, t.created_at`,
    params,
  );
  const updatedRows = upd.rows as UpdatedRow[];
  const completed = updatedRows.length;

  // Count matched (resolved candidates that have a target row) and total resolved candidates so
  // every non-completing resolved event is surfaced as `skipped` (nothing silently swallowed).
  const countRes = await pool.query(
    `WITH ${CANDIDATE_CTE}
     SELECT
       count(*)::int    AS total_candidates,
       count(ma.id)::int AS matched
     FROM candidate c
     LEFT JOIN micro_artifacts ma
       ON ma.project_id = $1 AND ma.phase = c.phase AND ma.artifact_name = c.artifact_name`,
    params,
  );
  const totalCandidates: number = countRes.rows[0]?.total_candidates ?? 0;
  const matched: number = countRes.rows[0]?.matched ?? 0;
  // completed rows are a subset of resolved candidates, so totalCandidates >= completed in a
  // consistent read; clamp defensively so a transient inconsistency can never report negative.
  const skipped = Math.max(0, totalCandidates - completed);

  // Append-only audit — attempted per completion; a failure is logged but never rolls back the
  // completion (which is still provenance-tagged kiro:<actor>).
  for (const row of updatedRows) {
    try {
      await pool.query(
        `INSERT INTO micro_artifact_audit
           (project_id, artifact_id, phase, artifact_name, event_code, event_actor, action, old_status, new_status, actor)
         VALUES ($1, $2, $3, $4, $5, $6, 'auto_complete', $7, 'complete', $8)`,
        [
          project.jira_key,
          row.id,
          row.phase,
          row.artifact_name,
          row.event_code,
          row.event_actor,
          row.old_status,
          ARTIFACT_SYNC_ACTOR,
        ],
      );
    } catch (err) {
      log('warn', 'ARTIFACT_SYNC_AUDIT_FAILED', {
        projectId,
        artifactId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log('info', 'ARTIFACT_SYNC', { projectId, actor, matched, completed, skipped });
  return { project_id: project.jira_key, matched, completed, skipped };
}

/**
 * Best-effort trigger wrapper that ALWAYS resolves (mirrors triggerLinkTimeSync): logs
 * ARTIFACT_SYNC_RESULT / ARTIFACT_SYNC_FAILED and never throws, so a reconcile failure never fails
 * the create/update/gate-view that triggered it. Callers `await` it (it always resolves) rather
 * than fire-and-forget, so a post-response Lambda freeze cannot silently drop the reconcile.
 */
export async function triggerMicroArtifactReconcile(projectId: string, actor: string): Promise<void> {
  try {
    const summary = await reconcileMicroArtifacts(projectId, actor);
    log('info', 'ARTIFACT_SYNC_RESULT', {
      projectId,
      matched: summary.matched,
      completed: summary.completed,
      skipped: summary.skipped,
    });
  } catch (err) {
    log('warn', 'ARTIFACT_SYNC_FAILED', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
