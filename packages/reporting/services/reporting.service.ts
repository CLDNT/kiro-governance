/**
 * Reporting service — cross-project leadership views.
 * Aggregates data from multiple domains (projects, gates, meetings).
 * See docs/phase2/reporting-architecture.md §4 for detailed SQL.
 */

import { queryMany, queryOne } from '@kiro-governance/shared/db/pool';
import {
  ReportingSummary,
  PhaseCount,
  StalledProject,
  GateCompletionRate,
  TimelineResponse,
  TimelineEvent,
} from './types';

/**
 * Get leadership reporting summary — project counts by phase, stalled projects, gate completion.
 * See docs/phase2/reporting-architecture.md §4.1-4.2 for SQL logic.
 */
export async function getReportingSummary(): Promise<ReportingSummary> {
  // 1. Total active projects
  const totalResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text FROM projects WHERE status NOT IN ('Closed', 'On Hold', 'TEMPLATE')`,
  );
  const total_active_projects = totalResult ? parseInt(totalResult.count, 10) : 0;

  // 2. Projects by phase
  const projectsByPhase = await queryMany<PhaseCount>(
    `
WITH phase_completion AS (
  SELECT
    mc.project_id,
    mc.phase,
    COALESCE(BOOL_AND(mc.reached_at IS NOT NULL), true) AS phase_complete
  FROM macro_checkpoints mc
  INNER JOIN casdm_config cc
    ON cc.phase = mc.phase
    AND cc.item_name = mc.checkpoint_name
    AND cc.config_type = 'macro_checkpoint'
    AND cc.is_mandatory = true
    AND cc.is_active = true
    AND cc.project_type = (
      SELECT p.project_type FROM projects p WHERE p.jira_key = mc.project_id
    )
  WHERE mc.project_id IN (
    SELECT jira_key FROM projects WHERE status NOT IN ('Closed', 'TEMPLATE')
  )
  GROUP BY mc.project_id, mc.phase
),
project_current_phase AS (
  SELECT
    p.jira_key AS project_id,
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM phase_completion pc
        WHERE pc.project_id = p.jira_key AND pc.phase = 'Phase 0' AND pc.phase_complete = true
      ) THEN 'Phase 0'
      WHEN NOT EXISTS (
        SELECT 1 FROM phase_completion pc
        WHERE pc.project_id = p.jira_key AND pc.phase = 'Phase 1' AND pc.phase_complete = true
      ) THEN 'Phase 1'
      WHEN NOT EXISTS (
        SELECT 1 FROM phase_completion pc
        WHERE pc.project_id = p.jira_key AND pc.phase = 'Phase 2' AND pc.phase_complete = true
      ) THEN 'Phase 2'
      WHEN NOT EXISTS (
        SELECT 1 FROM phase_completion pc
        WHERE pc.project_id = p.jira_key AND pc.phase = 'Phase 3' AND pc.phase_complete = true
      ) THEN 'Phase 3'
      ELSE 'Phase 4'
    END AS current_phase
  FROM projects p
  WHERE p.status NOT IN ('Closed', 'TEMPLATE')
)
SELECT
  current_phase AS phase,
  CASE current_phase
    WHEN 'Phase 0' THEN 'Internal Preparation'
    WHEN 'Phase 1' THEN 'Discover & Align'
    WHEN 'Phase 2' THEN 'Design & Review'
    WHEN 'Phase 3' THEN 'Build & Implement'
    WHEN 'Phase 4' THEN 'Launch & Enable'
  END AS phase_name,
  COUNT(*)::int AS count
FROM project_current_phase
GROUP BY current_phase
ORDER BY current_phase
    `,
  );

  // 3. Stalled projects
  const stalledProjects = await queryMany<StalledProject>(
    `
WITH phase_completion AS (
  SELECT
    mc.project_id,
    mc.phase,
    COALESCE(BOOL_AND(mc.reached_at IS NOT NULL), true) AS phase_complete
  FROM macro_checkpoints mc
  INNER JOIN casdm_config cc
    ON cc.phase = mc.phase
    AND cc.item_name = mc.checkpoint_name
    AND cc.config_type = 'macro_checkpoint'
    AND cc.is_mandatory = true
    AND cc.is_active = true
    AND cc.project_type = (
      SELECT p2.project_type FROM projects p2 WHERE p2.jira_key = mc.project_id
    )
  WHERE mc.project_id IN (
    SELECT jira_key FROM projects WHERE status NOT IN ('Closed', 'TEMPLATE')
  )
  GROUP BY mc.project_id, mc.phase
),
last_activity AS (
  SELECT
    p.jira_key,
    p.title,
    p.project_manager,
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM phase_completion pc
        WHERE pc.project_id = p.jira_key AND pc.phase = 'Phase 0' AND pc.phase_complete = true
      ) THEN 'Phase 0'
      WHEN NOT EXISTS (
        SELECT 1 FROM phase_completion pc
        WHERE pc.project_id = p.jira_key AND pc.phase = 'Phase 1' AND pc.phase_complete = true
      ) THEN 'Phase 1'
      WHEN NOT EXISTS (
        SELECT 1 FROM phase_completion pc
        WHERE pc.project_id = p.jira_key AND pc.phase = 'Phase 2' AND pc.phase_complete = true
      ) THEN 'Phase 2'
      WHEN NOT EXISTS (
        SELECT 1 FROM phase_completion pc
        WHERE pc.project_id = p.jira_key AND pc.phase = 'Phase 3' AND pc.phase_complete = true
      ) THEN 'Phase 3'
      ELSE 'Phase 4'
    END AS current_phase,
    GREATEST(
      (SELECT MAX(mc.reached_at) FROM macro_checkpoints mc WHERE mc.project_id = p.jira_key),
      (SELECT MAX(wsl.created_at) FROM weekly_status_logs wsl WHERE wsl.project_id = p.jira_key)
    ) AS last_activity_at
  FROM projects p
  WHERE p.status NOT IN ('Closed', 'On Hold', 'TEMPLATE')
    AND p.created_at < (now() - INTERVAL '14 days')
)
SELECT
  jira_key,
  title,
  project_manager,
  current_phase,
  last_activity_at,
  EXTRACT(DAY FROM (now() - COALESCE(last_activity_at, '1970-01-01'::timestamptz)))::int AS days_stalled
FROM last_activity
WHERE COALESCE(last_activity_at, '1970-01-01'::timestamptz) < (now() - INTERVAL '14 days')
ORDER BY days_stalled DESC
LIMIT 50
    `,
  );

  // 4. Gate completion rates
  const gateCompletionRates = await queryMany<GateCompletionRate>(
    `
SELECT
  mc.checkpoint_name,
  COUNT(*)::int AS total_projects,
  COUNT(mc.reached_at)::int AS completed_count,
  ROUND(
    (COUNT(mc.reached_at)::numeric / NULLIF(COUNT(*), 0)) * 100,
    1
  )::numeric AS completion_pct
FROM macro_checkpoints mc
INNER JOIN projects p ON p.jira_key = mc.project_id
WHERE p.status NOT IN ('Closed', 'TEMPLATE')
GROUP BY mc.checkpoint_name
ORDER BY completion_pct ASC
    `,
  );

  return {
    total_active_projects,
    projects_by_phase: projectsByPhase,
    stalled_projects: stalledProjects,
    gate_completion_rates: gateCompletionRates,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Get per-project timeline — merges governance events, checkpoints, and evidence.
 * See docs/phase2/reporting-architecture.md §2.2 for query spec.
 */
export async function getReportingTimeline(
  projectId: string,
  limit: number = 100,
  cursor: string | null = null,
): Promise<TimelineResponse> {
  // Validate limit
  const safeLimit = Math.min(Math.max(limit, 1), 500);

  // 1. Verify project exists and get metadata
  const projectRow = await queryOne<{
    jira_key: string;
    title: string;
    current_phase: string;
  }>(
    `
WITH phase_completion AS (
  SELECT
    mc.project_id,
    mc.phase,
    COALESCE(BOOL_AND(mc.reached_at IS NOT NULL), true) AS phase_complete
  FROM macro_checkpoints mc
  INNER JOIN casdm_config cc
    ON cc.phase = mc.phase
    AND cc.item_name = mc.checkpoint_name
    AND cc.config_type = 'macro_checkpoint'
    AND cc.is_mandatory = true
    AND cc.is_active = true
    AND cc.project_type = (
      SELECT p2.project_type FROM projects p2 WHERE p2.jira_key = mc.project_id
    )
  WHERE mc.project_id = $1
  GROUP BY mc.project_id, mc.phase
)
SELECT
  p.jira_key,
  p.title,
  CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM phase_completion pc
      WHERE pc.project_id = $1 AND pc.phase = 'Phase 0' AND pc.phase_complete = true
    ) THEN 'Phase 0'
    WHEN NOT EXISTS (
      SELECT 1 FROM phase_completion pc
      WHERE pc.project_id = $1 AND pc.phase = 'Phase 1' AND pc.phase_complete = true
    ) THEN 'Phase 1'
    WHEN NOT EXISTS (
      SELECT 1 FROM phase_completion pc
      WHERE pc.project_id = $1 AND pc.phase = 'Phase 2' AND pc.phase_complete = true
    ) THEN 'Phase 2'
    WHEN NOT EXISTS (
      SELECT 1 FROM phase_completion pc
      WHERE pc.project_id = $1 AND pc.phase = 'Phase 3' AND pc.phase_complete = true
    ) THEN 'Phase 3'
    ELSE 'Phase 4'
  END AS current_phase
FROM projects p
WHERE p.jira_key = $1
    `,
    [projectId],
  );

  if (!projectRow) {
    throw new Error(`Project not found: ${projectId}`);
  }

  // 2. Get timeline events
  const events = await queryMany<TimelineEvent>(
    `
SELECT
  'governance' as event_type,
  id::text as event_id,
  created_at as event_timestamp,
  phase,
  update_text as title,
  actor,
  gate as detail
FROM governance_events
WHERE project_id = $1
UNION ALL
SELECT
  'checkpoint' as event_type,
  id::text as event_id,
  reached_at as event_timestamp,
  phase,
  checkpoint_name as title,
  reviewed_by as actor,
  result_detail as detail
FROM macro_checkpoints
WHERE project_id = $1 AND reached_at IS NOT NULL
UNION ALL
SELECT
  'evidence' as event_type,
  id::text as event_id,
  created_at as event_timestamp,
  NULL as phase,
  checkpoint_name as title,
  uploaded_by as actor,
  label as detail
FROM gate_evidence
WHERE project_id = $1
ORDER BY event_timestamp DESC
LIMIT $2
    `,
    [projectId, safeLimit],
  );

  return {
    project_id: projectRow.jira_key,
    project_title: projectRow.title,
    current_phase: projectRow.current_phase,
    events,
    next_cursor: null, // Keyset pagination deferred to v2
  };
}
