# Reporting Domain Architecture — Phase 2: DeliverPro

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-07-02 | v1.1 | AWS Architect | GitHub↔Slack linkage CR (FR-P2-037). Repointed the `v_timeline` governance source join and the per-project reporting-timeline query from `projects.jira_key` to `projects.github_repo` (emitting `jira_key` as `project_id`), with the collision-safe backfill transition. Macro governance events remain display-only. |
| 2026-06-30 | v1.0 | AWS Architect | Initial reporting domain architecture from SRS v1.3 (FR-P2-010), gates-architecture v1.0 §2.8 (timeline), projects-architecture v1.0 §4 (phase computation) |

---

## 1. Overview

The `reporting` domain is a **read-only aggregation layer** — it owns no tables. It provides cross-project summary views for leadership and wraps the per-project timeline query (from the `gates` domain) in a reporting context.

**Domain responsibilities:**

| Responsibility | SRS Source |
|---------------|-----------|
| Leadership summary: project counts by phase, stalled projects, gate completion rates | FR-P2-010 |
| Per-project timeline (delegates to gates domain query) | FR-P2-010, FR-P2-011 |
| QuickSight-ready views for future reporting (deferred) | Architect decision |

**Tables owned:** None.

**Tables read:**
- `projects` (owned by `projects` domain) — project list, status, type
- `macro_checkpoints` (owned by `gates` domain) — completion state, `reached_at`
- `weekly_status_logs` (owned by `meetings` domain) — last activity detection
- `casdm_config` (owned by `config` domain) — mandatory checkpoint definitions
- `governance_events` (Phase 1 MCP table) — timeline interleaving
- `gate_evidence` (owned by `gates` domain) — timeline interleaving

---

## 2. API Endpoints

### 2.1 `GET /api/reporting/summary`

**Purpose:** Leadership view — cross-project summary with phase distribution, stalled projects, and gate completion rates.
**Source:** FR-P2-010

| Property | Value |
|----------|-------|
| Auth roles | `leadership`, `admin` |
| Handler | `packages/reporting/handlers/summary.ts` |

**Response (200):**

```typescript
interface ReportingSummaryResponse {
  total_active_projects: number;
  projects_by_phase: PhaseCount[];
  stalled_projects: StalledProject[];
  gate_completion_rates: GateCompletionRate[];
  generated_at: string;   // ISO 8601 timestamp
}

interface PhaseCount {
  phase: string;           // 'Phase 0' .. 'Phase 4'
  phase_name: string;
  count: number;
}

interface StalledProject {
  jira_key: string;
  title: string;
  project_manager: string | null;
  current_phase: string;
  last_activity_at: string | null;   // most recent checkpoint or status log
  days_stalled: number;
}

interface GateCompletionRate {
  checkpoint_name: string;
  total_projects: number;           // projects that have this checkpoint seeded
  completed_count: number;          // projects where reached_at IS NOT NULL
  completion_pct: number;           // (completed / total) * 100, rounded to 1 decimal
}
```

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 401 | `UNAUTHORIZED` | Missing/expired JWT |
| 403 | `FORBIDDEN` | Role not in `['leadership', 'admin']` |

---

### 2.2 `GET /api/reporting/timeline/{projectId}`

**Purpose:** Per-project timeline in reporting context — delegates to the `gates` domain timeline query.
**Source:** FR-P2-010, FR-P2-011

| Property | Value |
|----------|-------|
| Auth roles | `leadership`, `admin` |
| Handler | `packages/reporting/handlers/timeline.ts` |

**Path params:** `projectId` — the `jira_key`

**Query params:**

```typescript
interface ReportingTimelineQuery {
  limit?: number;    // default 100, max 500 (larger than gates endpoint for reporting)
  cursor?: string;   // ISO timestamp for keyset pagination
}
```

**Response (200):**

```typescript
interface ReportingTimelineResponse {
  project_id: string;
  project_title: string;
  current_phase: string;
  events: TimelineEvent[];    // same shape as gates-architecture §2.8
  next_cursor: string | null;
}
```

This handler wraps the same timeline SQL from `gates-architecture.md` §5.4 (which, per V004, joins Phase 1 `governance_events` via `projects.github_repo = governance_events.project_id` while `projectId`/`$1` remains the `jira_key`) but adds project metadata (title, current_phase) to the response for reporting context. It also uses a larger default limit (100 vs 50) since leadership reviews full project history. Unlinked projects (`github_repo IS NULL`) show only DeliverPro-native events; Kiro macro events are display-only.

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 401 | `UNAUTHORIZED` | Missing/expired JWT |
| 403 | `FORBIDDEN` | Role not in `['leadership', 'admin']` |
| 404 | `PROJECT_NOT_FOUND` | No project with that jira_key |

---

## 3. Stalled Project Definition

A project is **stalled** when it has had no meaningful activity in 14 calendar days.

**Activity signals (any one resets the stall clock):**
1. A `macro_checkpoints.reached_at` timestamp for this project within the last 14 days
2. A `weekly_status_logs` entry with `created_at` within the last 14 days

**Both conditions must be absent** for the project to be classified as stalled.

### 3.1 Stalled Detection SQL

```sql
WITH last_activity AS (
  SELECT
    p.jira_key,
    p.title,
    p.project_manager,
    GREATEST(
      -- Most recent checkpoint completion
      (SELECT MAX(mc.reached_at) FROM macro_checkpoints mc WHERE mc.project_id = p.jira_key),
      -- Most recent status log
      (SELECT MAX(wsl.created_at) FROM weekly_status_logs wsl WHERE wsl.project_id = p.jira_key)
    ) AS last_activity_at
  FROM projects p
  WHERE p.status NOT IN ('Closed', 'On Hold', 'TEMPLATE')
)
SELECT
  jira_key,
  title,
  project_manager,
  last_activity_at,
  EXTRACT(DAY FROM (now() - COALESCE(last_activity_at, '1970-01-01'::timestamptz)))::int AS days_stalled
FROM last_activity
WHERE COALESCE(last_activity_at, '1970-01-01'::timestamptz) < (now() - INTERVAL '14 days')
ORDER BY days_stalled DESC;
```

**Notes:**
- Projects with status `'Closed'`, `'On Hold'`, or `'TEMPLATE'` are excluded (they are not expected to have activity)
- Projects with zero activity ever (`last_activity_at IS NULL`) are included with `days_stalled` calculated from epoch (effectively flagged immediately)
- The 14-day threshold is hardcoded for MVP; future enhancement could make it configurable in `casdm_config`

---

## 4. Cross-Project Summary SQL

### 4.1 Projects by Phase

Uses the same phase computation logic from `projects-architecture.md` §4.1, applied across all active projects:

```sql
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
  COUNT(*) AS count
FROM project_current_phase
GROUP BY current_phase
ORDER BY current_phase;
```

### 4.2 Gate Completion Rates

Shows per-checkpoint completion percentage across all active projects:

```sql
SELECT
  mc.checkpoint_name,
  COUNT(*) AS total_projects,
  COUNT(mc.reached_at) AS completed_count,
  ROUND(
    (COUNT(mc.reached_at)::numeric / NULLIF(COUNT(*), 0)) * 100,
    1
  ) AS completion_pct
FROM macro_checkpoints mc
INNER JOIN projects p ON p.jira_key = mc.project_id
WHERE p.status NOT IN ('Closed', 'TEMPLATE')
GROUP BY mc.checkpoint_name
ORDER BY completion_pct ASC;  -- lowest completion first (attention needed)
```

---

## 5. QuickSight Preparation (V003 Migration Views)

Three SQL views provide a clean read interface for future QuickSight integration. These views are created in the V003 migration and can be queried by QuickSight directly (via RDS data source) without additional ETL.

> **Note:** QuickSight integration is deferred (SRS §4.2). These views are created now to establish a stable reporting contract that future QuickSight dashboards can rely on.

### 5.1 `v_project_summary`

```sql
CREATE OR REPLACE VIEW v_project_summary AS
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
    AND cc.project_type = COALESCE(
      (SELECT p2.project_type FROM projects p2 WHERE p2.jira_key = mc.project_id),
      'default'
    )
  GROUP BY mc.project_id, mc.phase
)
SELECT
  p.jira_key,
  p.title,
  p.project_type,
  p.status,
  p.project_manager,
  p.solution_architect,
  p.sow_hours,
  p.hours_consumed,
  CASE
    WHEN p.sow_hours IS NULL OR p.sow_hours = 0 THEN NULL
    ELSE ROUND((p.hours_consumed / p.sow_hours) * 100, 1)
  END AS burn_rate_pct,
  CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM phase_completion pc WHERE pc.project_id = p.jira_key AND pc.phase = 'Phase 0' AND pc.phase_complete = true
    ) THEN 'Phase 0'
    WHEN NOT EXISTS (
      SELECT 1 FROM phase_completion pc WHERE pc.project_id = p.jira_key AND pc.phase = 'Phase 1' AND pc.phase_complete = true
    ) THEN 'Phase 1'
    WHEN NOT EXISTS (
      SELECT 1 FROM phase_completion pc WHERE pc.project_id = p.jira_key AND pc.phase = 'Phase 2' AND pc.phase_complete = true
    ) THEN 'Phase 2'
    WHEN NOT EXISTS (
      SELECT 1 FROM phase_completion pc WHERE pc.project_id = p.jira_key AND pc.phase = 'Phase 3' AND pc.phase_complete = true
    ) THEN 'Phase 3'
    ELSE 'Phase 4'
  END AS current_phase,
  (SELECT MAX(mc2.reached_at) FROM macro_checkpoints mc2 WHERE mc2.project_id = p.jira_key) AS last_checkpoint_at,
  (SELECT MAX(wsl.created_at) FROM weekly_status_logs wsl WHERE wsl.project_id = p.jira_key) AS last_status_log_at,
  p.planned_kickoff_date,
  p.expected_completion_date,
  p.created_at
FROM projects p
WHERE p.status != 'TEMPLATE';
```

**QuickSight usage:** Project list with computed phase, burn rate, and activity timestamps. Supports filters by phase, status, project_type, PM.

---

### 5.2 `v_gate_completion`

```sql
CREATE OR REPLACE VIEW v_gate_completion AS
SELECT
  mc.checkpoint_name,
  mc.checkpoint_type,
  mc.phase,
  mc.phase_name,
  p.project_type,
  COUNT(*) AS total_projects,
  COUNT(mc.reached_at) AS completed_count,
  ROUND(
    (COUNT(mc.reached_at)::numeric / NULLIF(COUNT(*), 0)) * 100,
    1
  ) AS completion_pct,
  AVG(
    CASE
      WHEN mc.reached_at IS NOT NULL AND p.created_at IS NOT NULL
      THEN EXTRACT(DAY FROM (mc.reached_at - p.created_at))
    END
  )::int AS avg_days_to_complete
FROM macro_checkpoints mc
INNER JOIN projects p ON p.jira_key = mc.project_id
WHERE p.status != 'TEMPLATE'
GROUP BY mc.checkpoint_name, mc.checkpoint_type, mc.phase, mc.phase_name, p.project_type;
```

**QuickSight usage:** Gate completion heatmap — which checkpoints are most often missed or delayed. Supports drill-down by project_type and phase.

---

### 5.3 `v_timeline`

> **Authoritative DDL:** The runnable `v_timeline` definition lives in the migrations (`V004__github_slack_linkage.sql`, which `DROP`s + re-creates the V003 view with source-1 joined on `github_repo`). The migration preserves the deployed V003 column contract (`project_id, project_title, event_type, event_id, event_timestamp, phase, phase_name, title, actor, detail, sub_type`). The illustrative SQL below shows the **join repoint only** (the pre-existing column-name drift between this doc and the deployed view predates this CR and is tracked as a separate consistency cleanup — do not copy this column shape into a migration).

```sql
CREATE OR REPLACE VIEW v_timeline AS
-- Source 1: governance_events from Phase 1 MCP
SELECT
  'ge-' || ge.id::text AS event_id,
  p.jira_key AS project_id,   -- V004: emit jira_key (governance_events.project_id is the repo name)
  'governance_event' AS event_type,
  ge.created_at AS event_timestamp,
  ge.phase,
  COALESCE(ge.gate, ge.update_text) AS title,
  ge.actor,
  ge.update_text AS detail,
  'kiro_mcp' AS source
FROM governance_events ge
JOIN projects p
  ON p.github_repo = ge.project_id
  -- INTERIM collision-safe branch (remove after CR-06 backfill validates; see unified-data-model §4.4.6):
  OR (p.github_repo IS NULL AND p.jira_key = ge.project_id)

UNION ALL

-- Source 2: macro checkpoint completions
SELECT
  'mc-' || mc.id::text AS event_id,
  mc.project_id,
  'checkpoint_completed' AS event_type,
  mc.reached_at AS event_timestamp,
  mc.phase,
  mc.checkpoint_name AS title,
  COALESCE(mc.reviewed_by, 'system') AS actor,
  mc.result_detail AS detail,
  'deliverpro' AS source
FROM macro_checkpoints mc
WHERE mc.reached_at IS NOT NULL

UNION ALL

-- Source 3: evidence attachments
SELECT
  'ev-' || ev.id::text AS event_id,
  ev.project_id,
  'evidence_attached' AS event_type,
  ev.created_at AS event_timestamp,
  (SELECT mc2.phase FROM macro_checkpoints mc2
   WHERE mc2.project_id = ev.project_id AND mc2.checkpoint_name = ev.checkpoint_name
   LIMIT 1) AS phase,
  ev.checkpoint_name || ' — ' || ev.evidence_type AS title,
  ev.uploaded_by AS actor,
  ev.label AS detail,
  'deliverpro' AS source
FROM gate_evidence ev;
```

**QuickSight usage:** Full activity timeline across all projects. Supports time-series charts showing delivery velocity and activity density.

---

## 6. Handler Pattern

```typescript
// packages/reporting/handlers/summary.ts
import { APIGatewayProxyHandler } from 'aws-lambda';
import { requireRole } from '@deliverpro/shared/middleware/auth';
import { getReportingSummary } from '../services/reporting.service';

export const handler: APIGatewayProxyHandler = async (event) => {
  requireRole(['leadership', 'admin'])(event);

  const summary = await getReportingSummary();
  return {
    statusCode: 200,
    body: JSON.stringify(summary),
  };
};
```

```typescript
// packages/reporting/handlers/timeline.ts
import { APIGatewayProxyHandler } from 'aws-lambda';
import { requireRole } from '@deliverpro/shared/middleware/auth';
import { getReportingTimeline } from '../services/reporting.service';

export const handler: APIGatewayProxyHandler = async (event) => {
  requireRole(['leadership', 'admin'])(event);

  const projectId = event.pathParameters!.projectId!;
  const limit = parseInt(event.queryStringParameters?.limit ?? '100', 10);
  const cursor = event.queryStringParameters?.cursor ?? null;

  const result = await getReportingTimeline(projectId, limit, cursor);
  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
};
```

---

## 7. TypeScript Interfaces

```typescript
// packages/shared/types/reporting.ts

export interface ReportingSummaryResponse {
  total_active_projects: number;
  projects_by_phase: PhaseCount[];
  stalled_projects: StalledProject[];
  gate_completion_rates: GateCompletionRate[];
  generated_at: string;
}

export interface PhaseCount {
  phase: string;
  phase_name: string;
  count: number;
}

export interface StalledProject {
  jira_key: string;
  title: string;
  project_manager: string | null;
  current_phase: string;
  last_activity_at: string | null;
  days_stalled: number;
}

export interface GateCompletionRate {
  checkpoint_name: string;
  total_projects: number;
  completed_count: number;
  completion_pct: number;
}

export interface ReportingTimelineResponse {
  project_id: string;
  project_title: string;
  current_phase: string;
  events: TimelineEvent[];
  next_cursor: string | null;
}

// Re-export from gates types
export { TimelineEvent } from './gates';
```

---

## 8. Edge Cases

| # | Scenario | Handling |
|---|----------|----------|
| 1 | Zero active projects | Return `{ total_active_projects: 0, projects_by_phase: [], stalled_projects: [], gate_completion_rates: [], generated_at: "..." }` |
| 2 | Project with no checkpoints seeded (template seeding failed) | Excluded from `gate_completion_rates`. Appears in `projects_by_phase` as Phase 0 (no checkpoints = cannot advance). |
| 3 | New project created today — immediately stalled? | No. `last_activity_at` is NULL for brand-new projects (no checkpoint reached, no status log). The stalled query uses `COALESCE(last_activity_at, '1970-01-01')` which flags them immediately. **Mitigation:** Exclude projects created within the last 14 days from the stalled list. |
| 4 | Project with status 'On Hold' — show as stalled? | No. `'On Hold'` projects are excluded from the stalled query (status filter). They are expected to be inactive. |
| 5 | Leadership views timeline for project they don't manage | Allowed — Leadership/Admin have cross-project read access per auth-architecture. |
| 6 | Very large project count (>200 projects) | Summary SQL uses aggregation (no row-level response for projects_by_phase). Stalled projects list could be large — returns all stalled projects unsorted would be unwieldy. Solution: stalled projects ordered by `days_stalled DESC` with implicit limit of 50. |

### 8.1 Edge Case #3 Fix — Exclude Recently Created Projects

```sql
-- Add to WHERE clause of stalled detection:
AND p.created_at < (now() - INTERVAL '14 days')
```

This ensures projects less than 14 days old are never flagged as stalled — they haven't had time to become stalled yet.

---

## 9. Cost Estimate

### 9.1 Lambda Invocations

| Endpoint | Est. Monthly Invocations | Rationale |
|----------|------------------------|-----------|
| `GET /api/reporting/summary` | ~300 | ~3 leadership users × 3 views/day × 30 days |
| `GET /api/reporting/timeline/{id}` | ~200 | Ad-hoc drill-down into specific projects |
| **Total** | **~500** | |

### 9.2 Lambda Cost

500 invocations × 256 MB × ~200ms avg = ~25.6 GB-seconds/month

- Compute: 25.6 GB-s × $0.0000166667 = **$0.0004/mo**
- Requests: 500 × $0.20/1M = **$0.0001/mo**
- **Total Lambda: <$0.01/mo** (within free tier)

### 9.3 RDS Query Load

The summary query is the most complex (cross-project CTE with phase computation). Expected execution time: ~100-200ms for 200 projects. Runs ~10 times/day — negligible RDS impact.

### 9.4 Total Reporting Domain Cost

| Component | Monthly |
|-----------|---------|
| Lambda | <$0.01 |
| RDS (incremental) | $0.00 (reads existing data) |
| S3/Storage | $0.00 (no owned storage) |
| **Total** | **<$0.01/mo** |

---

## 10. V003 Migration — View Definitions

The following SQL is added to `V003__phase2_additions.sql` to create the QuickSight-ready views:

```sql
-- =============================================================
-- Reporting Views (QuickSight-ready)
-- =============================================================

-- v_project_summary: Project list with computed phase and activity timestamps
CREATE OR REPLACE VIEW v_project_summary AS
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
    AND cc.project_type = COALESCE(
      (SELECT p2.project_type FROM projects p2 WHERE p2.jira_key = mc.project_id),
      'default'
    )
  GROUP BY mc.project_id, mc.phase
)
SELECT
  p.jira_key,
  p.title,
  p.project_type,
  p.status,
  p.project_manager,
  p.solution_architect,
  p.sow_hours,
  p.hours_consumed,
  CASE
    WHEN p.sow_hours IS NULL OR p.sow_hours = 0 THEN NULL
    ELSE ROUND((p.hours_consumed / p.sow_hours) * 100, 1)
  END AS burn_rate_pct,
  CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM phase_completion pc WHERE pc.project_id = p.jira_key AND pc.phase = 'Phase 0' AND pc.phase_complete = true
    ) THEN 'Phase 0'
    WHEN NOT EXISTS (
      SELECT 1 FROM phase_completion pc WHERE pc.project_id = p.jira_key AND pc.phase = 'Phase 1' AND pc.phase_complete = true
    ) THEN 'Phase 1'
    WHEN NOT EXISTS (
      SELECT 1 FROM phase_completion pc WHERE pc.project_id = p.jira_key AND pc.phase = 'Phase 2' AND pc.phase_complete = true
    ) THEN 'Phase 2'
    WHEN NOT EXISTS (
      SELECT 1 FROM phase_completion pc WHERE pc.project_id = p.jira_key AND pc.phase = 'Phase 3' AND pc.phase_complete = true
    ) THEN 'Phase 3'
    ELSE 'Phase 4'
  END AS current_phase,
  (SELECT MAX(mc2.reached_at) FROM macro_checkpoints mc2 WHERE mc2.project_id = p.jira_key) AS last_checkpoint_at,
  (SELECT MAX(wsl.created_at) FROM weekly_status_logs wsl WHERE wsl.project_id = p.jira_key) AS last_status_log_at,
  p.planned_kickoff_date,
  p.expected_completion_date,
  p.created_at
FROM projects p
WHERE p.status != 'TEMPLATE';

-- v_gate_completion: Per-checkpoint completion rates across all projects
CREATE OR REPLACE VIEW v_gate_completion AS
SELECT
  mc.checkpoint_name,
  mc.checkpoint_type,
  mc.phase,
  mc.phase_name,
  p.project_type,
  COUNT(*) AS total_projects,
  COUNT(mc.reached_at) AS completed_count,
  ROUND(
    (COUNT(mc.reached_at)::numeric / NULLIF(COUNT(*), 0)) * 100,
    1
  ) AS completion_pct,
  AVG(
    CASE
      WHEN mc.reached_at IS NOT NULL AND p.created_at IS NOT NULL
      THEN EXTRACT(DAY FROM (mc.reached_at - p.created_at))
    END
  )::int AS avg_days_to_complete
FROM macro_checkpoints mc
INNER JOIN projects p ON p.jira_key = mc.project_id
WHERE p.status != 'TEMPLATE'
GROUP BY mc.checkpoint_name, mc.checkpoint_type, mc.phase, mc.phase_name, p.project_type;

-- v_timeline: Full activity timeline across all projects
CREATE OR REPLACE VIEW v_timeline AS
SELECT
  'ge-' || ge.id::text AS event_id,
  p.jira_key AS project_id,   -- V004: emit jira_key (governance_events.project_id is the repo name)
  'governance_event' AS event_type,
  ge.created_at AS event_timestamp,
  ge.phase,
  COALESCE(ge.gate, ge.update_text) AS title,
  ge.actor,
  ge.update_text AS detail,
  'kiro_mcp' AS source
FROM governance_events ge
JOIN projects p
  ON p.github_repo = ge.project_id
  -- INTERIM collision-safe branch (remove after CR-06 backfill validates; see unified-data-model §4.4.6):
  OR (p.github_repo IS NULL AND p.jira_key = ge.project_id)

UNION ALL

SELECT
  'mc-' || mc.id::text AS event_id,
  mc.project_id,
  'checkpoint_completed' AS event_type,
  mc.reached_at AS event_timestamp,
  mc.phase,
  mc.checkpoint_name AS title,
  COALESCE(mc.reviewed_by, 'system') AS actor,
  mc.result_detail AS detail,
  'deliverpro' AS source
FROM macro_checkpoints mc
WHERE mc.reached_at IS NOT NULL

UNION ALL

SELECT
  'ev-' || ev.id::text AS event_id,
  ev.project_id,
  'evidence_attached' AS event_type,
  ev.created_at AS event_timestamp,
  (SELECT mc2.phase FROM macro_checkpoints mc2
   WHERE mc2.project_id = ev.project_id AND mc2.checkpoint_name = ev.checkpoint_name
   LIMIT 1) AS phase,
  ev.checkpoint_name || ' — ' || ev.evidence_type AS title,
  ev.uploaded_by AS actor,
  ev.label AS detail,
  'deliverpro' AS source
FROM gate_evidence ev;
```

---

## 11. Performance Considerations

### 11.1 Summary Query Optimization

The `projects_by_phase` CTE iterates all active projects. At <200 projects (NFR-P2-005), this is fast (~100ms). If project count grows beyond 500:

**Optimization path:**
1. **Materialized view** with periodic refresh (every 5 minutes via pg_cron or Lambda cron)
2. **Cache layer** — Redis or Lambda response cache with 5-minute TTL
3. **Denormalized `current_phase` column** — breaks the "computed at query time" principle but trades accuracy for speed

For MVP (≤200 projects), no optimization needed.

### 11.2 Index Coverage

All queries in this domain are covered by existing indexes:
- `macro_checkpoints(project_id, phase)` → phase completion CTE
- `weekly_status_logs(project_id, log_date)` → stalled detection
- `projects(status)` → active project filter (add if needed)
- `governance_events(project_id)` → timeline union

**Recommended additional index** (if summary query exceeds 200ms):

```sql
CREATE INDEX idx_projects_status ON projects (status) WHERE status NOT IN ('Closed', 'TEMPLATE');
```

---

*End of Reporting Architecture v1.0*
