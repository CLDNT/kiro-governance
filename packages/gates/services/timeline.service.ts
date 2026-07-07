/**
 * Gates timeline service — merges Phase 1 governance events + macro checkpoint completions +
 * evidence attachments into a single chronological project timeline.
 *
 * See docs/phase2/gates-architecture.md §5.4 for the authoritative interleaving SQL, §5.1 for the
 * `github_repo` join repoint (CR-03), and §5.3 for the app-owned macro rule (Kiro macro events are
 * display-only and NEVER complete a checkpoint).
 */

import { queryMany, queryOne } from '@kiro-governance/shared/db/pool';
import { TimelineEvent, TimelineResponse } from '../types';

interface TimelineRow {
  id: string;
  event_type: TimelineEvent['event_type'];
  timestamp: string;
  phase: string | null;
  title: string;
  actor: string | null;
  detail: string | null;
  source: TimelineEvent['source'];
}

/** Returns true if a project with the given jira_key exists. */
export async function projectExists(projectId: string): Promise<boolean> {
  const row = await queryOne<{ jira_key: string }>(
    'SELECT jira_key FROM projects WHERE jira_key = $1',
    [projectId],
  );
  return row !== null;
}

/**
 * Assemble the per-project timeline. `projectId` is the jira_key (route param) throughout.
 *
 * Source 1 (governance_events) joins via `projects.github_repo = governance_events.project_id`
 * (Phase 1 keys events by GitHub repo name). Unlinked projects (github_repo IS NULL) surface zero
 * governance rows — only DeliverPro-native events show. The interim collision-safe branch keeps
 * imported-but-not-yet-linked projects visible during the CR-06 backfill window (dropped after
 * backfill validates). Governance events emit `source = 'kiro_mcp'`; macro checkpoints + evidence
 * emit `source = 'deliverpro'`. Macro governance events surface but never set reached_at.
 */
export async function getProjectTimeline(
  projectId: string,
  limit: number,
  cursor: string | null = null,
): Promise<TimelineResponse> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);

  const rows = await queryMany<TimelineRow>(
    `
WITH timeline_events AS (
  -- Source 1: governance_events from Phase 1 MCP — joined via github_repo (CR-03 repoint).
  -- $1 remains the jira_key (route param); the join resolves the repo-keyed governance rows.
  -- Unlinked project (github_repo IS NULL) -> zero governance rows (feature switch OFF).
  -- INTERIM collision-safe branch during CR-06 backfill (drop after backfill validates):
  --   also match (p.github_repo IS NULL AND p.jira_key = ge.project_id).
  SELECT
    'ge-' || ge.id::text AS id,
    'governance_event' AS event_type,
    ge.created_at AS timestamp,
    ge.phase,
    COALESCE(ge.gate, ge.update_text) AS title,
    ge.actor,
    ge.update_text AS detail,
    'kiro_mcp' AS source
  FROM governance_events ge
  JOIN projects p
    ON p.github_repo = ge.project_id
    OR (p.github_repo IS NULL AND p.jira_key = ge.project_id)
  WHERE p.jira_key = $1

  UNION ALL

  -- Source 2: macro checkpoint completions (app-owned; reached_at set only by the §4 state machine).
  SELECT
    'mc-' || mc.id::text AS id,
    'checkpoint_completed' AS event_type,
    mc.reached_at AS timestamp,
    mc.phase,
    mc.checkpoint_name AS title,
    COALESCE(mc.reviewed_by, 'system') AS actor,
    mc.result_detail AS detail,
    'deliverpro' AS source
  FROM macro_checkpoints mc
  WHERE mc.project_id = $1 AND mc.reached_at IS NOT NULL

  UNION ALL

  -- Source 3: evidence attachments.
  SELECT
    'ev-' || ev.id::text AS id,
    'evidence_attached' AS event_type,
    ev.created_at AS timestamp,
    (SELECT mc2.phase FROM macro_checkpoints mc2
     WHERE mc2.project_id = ev.project_id AND mc2.checkpoint_name = ev.checkpoint_name
     LIMIT 1) AS phase,
    ev.checkpoint_name || ' — ' || ev.evidence_type AS title,
    ev.uploaded_by AS actor,
    ev.label AS detail,
    'deliverpro' AS source
  FROM gate_evidence ev
  WHERE ev.project_id = $1
)
SELECT *
FROM timeline_events
WHERE timestamp IS NOT NULL
  AND ($3::timestamptz IS NULL OR timestamp < $3::timestamptz)
ORDER BY timestamp DESC
LIMIT $2
    `,
    [projectId, safeLimit, cursor],
  );

  const events: TimelineEvent[] = rows.map((r) => ({
    id: r.id,
    event_type: r.event_type,
    timestamp: r.timestamp,
    phase: r.phase,
    title: r.title,
    actor: r.actor,
    detail: r.detail,
    source: r.source,
  }));

  // Keyset pagination: only advertise a cursor when the page was filled.
  const next_cursor = events.length === safeLimit ? events[events.length - 1].timestamp : null;

  return { events, next_cursor };
}
