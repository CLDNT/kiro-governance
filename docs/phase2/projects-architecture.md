# Projects Domain Architecture — Phase 2: DeliverPro

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-30 | v1.3 | AWS Architect | Resolved PD-13: project_type confirmed IMMUTABLE after creation. PATCH returns 422 if attempted. |
| 2026-06-30 | v1.2 | AWS Architect | Security Gate 1 fix: Added §10 IAM Permissions section; import-jira SSM PutParameter scoped to /deliverpro/config/jira-import-completed only |
| 2026-06-29 | v1.1 | AWS Architect | Fix §4.1 CTE semantics for zero-mandatory-checkpoint phases (LEFT JOIN + COALESCE); fix §4.3 LATERAL to use WHEN EXISTS for clarity and consistent semantics; add default status filter to §2.1; add `sa` role to PATCH /checklist/{itemId} |
| 2026-06-29 | v1.0 | AWS Architect | Initial projects domain architecture from SRS v1.3, domain decomposition v1.0 §2.2, auth-architecture v1.0, V002 migration |

---

## 1. Overview

The `projects` domain owns the full project lifecycle: creation, metadata management, one-time Jira import, onboarding checklist, resource budget tracking, closure workflow, phase progression (computed at query time), and search/filter.

**Domain responsibilities:**

| Responsibility | SRS Source |
|---------------|-----------|
| Project CRUD (list, get, create, update) | FR-P2-001, FR-P2-009 |
| One-time Jira CST import | FR-P2-009 |
| Onboarding checklist (9 items) | FR-P2-019 |
| Resource budget (SOW hours vs consumed) | FR-P2-022, FR-P2-028 |
| Closure workflow (Active → Closing → Closed) | FR-P2-023 |
| Phase progression (computed `current_phase`) | FR-P2-014 |
| Search and filter | FR-P2-015 |
| Project-type gate template seeding | FR-P2-030 |

**Tables owned:** `projects`, `onboarding_checklist_items`

**Cross-domain reads:** This domain reads `macro_checkpoints` (owned by `gates`) to compute `current_phase`, and reads `casdm_config` (owned by `config`) during project creation to seed templates.

---

## 2. API Endpoints

### 2.1 `GET /api/projects`

**Purpose:** List projects with filters and pagination.
**Source:** FR-P2-001, FR-P2-015

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `sa`, `engineer`, `leadership`, `admin` |
| Handler | `packages/projects/handlers/list-projects.ts` |

**Default filter:** When `status` param is omitted, the query applies `status NOT IN ('Closed', 'TEMPLATE')` so that closed and template projects are excluded from default views. To include closed projects, pass `status=Closed` explicitly.

**Request (query params):**

```typescript
interface ListProjectsQuery {
  status?: string;           // 'Active' | 'Closing' | 'Closed' | 'On Hold'
  phase?: string;            // 'Phase 0' .. 'Phase 4'
  pm?: string;               // project_manager filter (exact match)
  sa?: string;               // solution_architect filter (exact match)
  type?: string;             // project_type filter
  search?: string;           // case-insensitive ILIKE on title or jira_key
  limit?: number;            // default 50, max 100
  cursor?: string;           // base64-encoded last project id for keyset pagination
}
```

**Response (200):**

```typescript
interface ProjectListResponse {
  projects: ProjectSummary[];
  next_cursor: string | null;
  total_count: number;
}

interface ProjectSummary {
  id: number;
  jira_key: string;
  title: string;
  project_type: string | null;
  status: string | null;
  project_manager: string | null;
  solution_architect: string | null;
  current_phase: string;        // computed
  sow_hours: number | null;
  hours_consumed: number;
  burn_rate_pct: number | null; // null if sow_hours is 0 or null
  planned_kickoff_date: string | null;
  expected_completion_date: string | null;
}
```

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Invalid filter values or limit > 100 |
| 401 | `UNAUTHORIZED` | Missing/expired JWT |

---

### 2.2 `POST /api/projects`

**Purpose:** Create a new project with CASDM template seeding.
**Source:** FR-P2-009, FR-P2-019, FR-P2-030

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `leadership`, `admin` |
| Handler | `packages/projects/handlers/create-project.ts` |

**Request body:**

```typescript
interface CreateProjectInput {
  title: string;                     // required, 1-255 chars
  project_type: string;              // required — 'AppDev' | 'App Mod/Migration' | 'AI/ML' | 'Other'
  project_manager: string;           // required
  solution_architect: string;        // required
  account_executive?: string;
  engineers_assigned?: string;       // comma-separated
  sow_hours?: number;               // NUMERIC(8,2)
  planned_kickoff_date?: string;     // ISO date
  expected_completion_date?: string; // ISO date
  description?: string;
}
```

**Response (201):**

```typescript
interface CreateProjectResponse {
  project: Project;
  seeded: {
    micro_artifacts: number;
    macro_checkpoints: number;
    onboarding_items: number;
  };
}
```

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Missing required fields, invalid project_type |
| 409 | `DUPLICATE_JIRA_KEY` | Generated jira_key already exists |
| 422 | `NO_CASDM_TEMPLATE` | No `casdm_config` rows for the specified project_type AND no 'default' fallback |

---

### 2.3 `GET /api/projects/{projectId}`

**Purpose:** Get project detail with computed `current_phase`.
**Source:** FR-P2-001, FR-P2-014

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `sa`, `engineer`, `leadership`, `admin` |
| Handler | `packages/projects/handlers/get-project.ts` |

**Path params:** `projectId` — the `jira_key` value (e.g., `CST-674` or `DP-001`)

**Response (200):**

```typescript
interface Project {
  id: number;
  jira_key: string;
  title: string;
  description: string | null;
  project_type: string | null;
  status: string | null;
  account_executive: string | null;
  solution_architect: string | null;
  project_manager: string | null;
  engineers_assigned: string | null;
  planned_kickoff_date: string | null;
  expected_completion_date: string | null;
  resource_assignment_date: string | null;
  sow_hours: number | null;
  hours_consumed: number;
  burn_rate_pct: number | null;
  current_phase: string;           // computed at query time
  jira_link: string | null;
  created_at: string;
}
```

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `PROJECT_NOT_FOUND` | No project with that jira_key |

---

### 2.4 `PATCH /api/projects/{projectId}`

**Purpose:** Update project metadata.
**Source:** FR-P2-009

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `leadership`, `admin` |
| Handler | `packages/projects/handlers/update-project.ts` |

**Request body:**

```typescript
interface UpdateProjectInput {
  title?: string;
  description?: string;
  status?: string;
  project_manager?: string;
  solution_architect?: string;
  account_executive?: string;
  engineers_assigned?: string;
  planned_kickoff_date?: string | null;
  expected_completion_date?: string | null;
  sow_hours?: number | null;
}
```

**Response (200):** Updated `Project` object.

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Invalid field values |
| 403 | `FORBIDDEN` | PM trying to update a project they don't manage |
| 404 | `PROJECT_NOT_FOUND` | No project with that jira_key |
| 422 | `IMMUTABLE_FIELD` | Attempt to change `project_type` after creation (immutable — PD-13) |

---

### 2.5 `POST /api/projects/import-jira`

**Purpose:** One-time bulk import from Jira CST board.
**Source:** FR-P2-009

| Property | Value |
|----------|-------|
| Auth roles | `admin` |
| Handler | `packages/projects/handlers/import-jira.ts` |

**Request body:**

```typescript
interface ImportJiraInput {
  jira_base_url: string;  // e.g. 'https://cloudelligent.atlassian.net'
  project_key: string;    // e.g. 'CST'
}
```

**Response (200):**

```typescript
interface ImportJiraResponse {
  imported: number;
  skipped: number;   // duplicates (ON CONFLICT DO NOTHING)
  failed: number;
  errors: Array<{ jira_key: string; reason: string }>;
}
```

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 403 | `FORBIDDEN` | Non-admin role |
| 409 | `IMPORT_ALREADY_COMPLETE` | Import has already been executed |
| 502 | `JIRA_UNAVAILABLE` | Jira API call failed |

---

### 2.6 `GET /api/projects/{projectId}/checklist`

**Purpose:** Get onboarding checklist items for a project.
**Source:** FR-P2-019

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `sa`, `engineer`, `leadership`, `admin` |
| Handler | `packages/projects/handlers/list-checklist.ts` |

**Response (200):**

```typescript
interface ChecklistResponse {
  items: OnboardingChecklistItem[];
  completed_count: number;
  total_count: number;
}
```

---

### 2.7 `PATCH /api/projects/{projectId}/checklist/{itemId}`

**Purpose:** Mark/unmark an onboarding checklist item.
**Source:** FR-P2-019

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `sa`, `leadership`, `admin` |
| Handler | `packages/projects/handlers/update-checklist-item.ts` |

**Request body:**

```typescript
interface UpdateChecklistInput {
  completed: boolean;
}
```

**Response (200):** Updated `OnboardingChecklistItem`.

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `CHECKLIST_ITEM_NOT_FOUND` | Item does not exist or does not belong to project |

**Side effect:** When all 9 items are completed, the corresponding `macro_checkpoints` row with `checkpoint_type = 'checklist'` and `checkpoint_name = 'Onboarding Checklist'` has its `reached_at` set to `now()`. When any item is unchecked, `reached_at` is cleared.

---

### 2.8 `PATCH /api/projects/{projectId}/hours`

**Purpose:** Update `hours_consumed` on a project.
**Source:** FR-P2-022

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `leadership`, `admin` |
| Handler | `packages/projects/handlers/update-hours.ts` |

**Request body:**

```typescript
interface UpdateHoursInput {
  hours_consumed: number;  // >= 0, NUMERIC(8,2)
}
```

**Response (200):** `{ hours_consumed: number; burn_rate_pct: number | null }`

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Negative value or non-numeric |
| 404 | `PROJECT_NOT_FOUND` | No project with that jira_key |

---

### 2.9 `POST /api/projects/{projectId}/close`

**Purpose:** Trigger the closure workflow.
**Source:** FR-P2-023

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `leadership`, `admin` |
| Handler | `packages/projects/handlers/close-project.ts` |

**Request body:** None (or `{ confirm: true }` to skip prompt)

**Response (200):** `{ status: 'Closed'; closed_at: string }`

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `CLOSURE_INCOMPLETE` | Not all 4 closure checklist items are complete |
| 404 | `PROJECT_NOT_FOUND` | No project with that jira_key |
| 409 | `ALREADY_CLOSED` | Project status is already 'Closed' |

**Closure reversal:** Leadership/admin can call `PATCH /api/projects/{projectId}` with `{ "status": "Active" }` to reopen.

---

## 3. Data Model

### 3.1 `projects` Table (V002 — existing)

```sql
CREATE TABLE IF NOT EXISTS projects (
  id                       BIGSERIAL    PRIMARY KEY,
  jira_key                 TEXT         NOT NULL UNIQUE,
  jira_id                  TEXT,
  jira_link                TEXT,
  title                    TEXT         NOT NULL,
  description              TEXT,
  project_type             TEXT,
  status                   TEXT,
  account_executive        TEXT,
  solution_architect       TEXT,
  project_manager          TEXT,
  engineers_assigned       TEXT,
  planned_kickoff_date     DATE,
  expected_completion_date DATE,
  resource_assignment_date DATE,
  created_at_jira          TIMESTAMPTZ,
  updated_at_jira          TIMESTAMPTZ,
  sow_hours                NUMERIC(8,2),
  sow_link                 TEXT,
  last_synced_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

### 3.2 V003 Addition: `hours_consumed`

```sql
ALTER TABLE projects ADD COLUMN hours_consumed NUMERIC(8,2) NOT NULL DEFAULT 0;
```

**Source:** FR-P2-022 — "A new field `hours_consumed NUMERIC(8,2) DEFAULT 0` is added to the `projects` table"

**Note:** `project_type` already exists in V002. Confirmed present — no V003 ALTER needed.

### 3.3 `onboarding_checklist_items` Table (V002 — existing from SRS §7.2)

```sql
CREATE TABLE onboarding_checklist_items (
  id              BIGSERIAL    PRIMARY KEY,
  project_id      TEXT         NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  item_name       TEXT         NOT NULL,
  completed       BOOLEAN      NOT NULL DEFAULT false,
  completed_by    TEXT,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_onboarding_project ON onboarding_checklist_items (project_id);
```

### 3.4 Hardcoded Onboarding Checklist Items (9 items)

Seeded on every project creation. Source: FR-P2-019.

| # | Item Name |
|---|-----------|
| 1 | Set up Slack/Teams channel |
| 2 | Set up Clockify |
| 3 | Assign resources via email |
| 4 | Complete SOW handoff checklist |
| 5 | Send customer intro email — Introduce team |
| 6 | Send customer intro email — Schedule kickoff |
| 7 | Send customer intro email — Share discovery agenda & questions |
| 8 | Send customer intro email — Figure out account access |
| 9 | Send customer intro email — Confirm communication channels |

---

## 4. Computed `current_phase`

`current_phase` is **not stored** in the `projects` table. It is computed at query time by examining which phases have all mandatory macro checkpoints completed.

**Source:** FR-P2-014 — "current_phase is computed at query time — derived as the highest phase where all mandatory macro checkpoints have reached_at IS NOT NULL"

### 4.1 SQL — Computed Phase CTE

```sql
WITH phase_completion AS (
  SELECT
    mc.project_id,
    mc.phase,
    mc.phase_name,
    -- A phase with zero mandatory checkpoints is considered complete (COALESCE to true).
    -- A phase with mandatory checkpoints is complete when ALL have reached_at set.
    COALESCE(BOOL_AND(mc.reached_at IS NOT NULL), true) AS phase_complete
  FROM macro_checkpoints mc
  LEFT JOIN casdm_config cc
    ON cc.phase = mc.phase
    AND cc.item_name = mc.checkpoint_name
    AND cc.config_type = 'macro_checkpoint'
    AND cc.is_mandatory = true
    AND cc.is_active = true
    AND cc.project_type = (
      SELECT p.project_type FROM projects p WHERE p.jira_key = mc.project_id
    )
  WHERE mc.project_id = $1
    AND cc.id IS NOT NULL  -- only rows that matched a mandatory config entry
  GROUP BY mc.project_id, mc.phase, mc.phase_name
),
current_phase AS (
  SELECT
    project_id,
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM phase_completion
        WHERE project_id = $1 AND phase = 'Phase 0' AND phase_complete = true
      ) THEN 'Phase 0'
      WHEN NOT EXISTS (
        SELECT 1 FROM phase_completion
        WHERE project_id = $1 AND phase = 'Phase 1' AND phase_complete = true
      ) THEN 'Phase 1'
      WHEN NOT EXISTS (
        SELECT 1 FROM phase_completion
        WHERE project_id = $1 AND phase = 'Phase 2' AND phase_complete = true
      ) THEN 'Phase 2'
      WHEN NOT EXISTS (
        SELECT 1 FROM phase_completion
        WHERE project_id = $1 AND phase = 'Phase 3' AND phase_complete = true
      ) THEN 'Phase 3'
      ELSE 'Phase 4'
    END AS current_phase
  FROM projects
  WHERE jira_key = $1
)
SELECT current_phase FROM current_phase;
```

**Semantics:** A phase with zero mandatory checkpoints in `casdm_config` will not appear in `phase_completion` at all, which means the `NOT EXISTS … AND phase_complete = true` check will fire — but since no row exists for that phase, the phase is implicitly complete (the project advances past it). This matches the §4.3 LATERAL JOIN semantics where `NOT EXISTS(… AND reached_at IS NULL)` also returns true when no mandatory rows exist.

### 4.2 Service-Layer Implementation

```typescript
async function computeCurrentPhase(projectId: string): Promise<string> {
  const result = await pool.query(CURRENT_PHASE_QUERY, [projectId]);
  return result.rows[0]?.current_phase ?? 'Phase 0';
}
```

This is called by `get-project.ts` and `list-projects.ts`. For the list endpoint, a batch version uses a lateral join to compute `current_phase` for all returned projects in a single query.

### 4.3 Batch Version (for list endpoint)

```sql
SELECT p.*, cp.current_phase
FROM projects p
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM macro_checkpoints mc
      INNER JOIN casdm_config cc ON cc.phase = mc.phase
        AND cc.item_name = mc.checkpoint_name
        AND cc.config_type = 'macro_checkpoint'
        AND cc.is_mandatory = true AND cc.is_active = true
        AND cc.project_type = COALESCE(p.project_type, 'default')
      WHERE mc.project_id = p.jira_key AND mc.phase = 'Phase 0'
        AND mc.reached_at IS NULL
    ) THEN 'Phase 0'
    WHEN EXISTS (
      SELECT 1 FROM macro_checkpoints mc
      INNER JOIN casdm_config cc ON cc.phase = mc.phase
        AND cc.item_name = mc.checkpoint_name
        AND cc.config_type = 'macro_checkpoint'
        AND cc.is_mandatory = true AND cc.is_active = true
        AND cc.project_type = COALESCE(p.project_type, 'default')
      WHERE mc.project_id = p.jira_key AND mc.phase = 'Phase 1'
        AND mc.reached_at IS NULL
    ) THEN 'Phase 1'
    WHEN EXISTS (
      SELECT 1 FROM macro_checkpoints mc
      INNER JOIN casdm_config cc ON cc.phase = mc.phase
        AND cc.item_name = mc.checkpoint_name
        AND cc.config_type = 'macro_checkpoint'
        AND cc.is_mandatory = true AND cc.is_active = true
        AND cc.project_type = COALESCE(p.project_type, 'default')
      WHERE mc.project_id = p.jira_key AND mc.phase = 'Phase 2'
        AND mc.reached_at IS NULL
    ) THEN 'Phase 2'
    WHEN EXISTS (
      SELECT 1 FROM macro_checkpoints mc
      INNER JOIN casdm_config cc ON cc.phase = mc.phase
        AND cc.item_name = mc.checkpoint_name
        AND cc.config_type = 'macro_checkpoint'
        AND cc.is_mandatory = true AND cc.is_active = true
        AND cc.project_type = COALESCE(p.project_type, 'default')
      WHERE mc.project_id = p.jira_key AND mc.phase = 'Phase 3'
        AND mc.reached_at IS NULL
    ) THEN 'Phase 3'
    ELSE 'Phase 4'
  END AS current_phase
) cp
WHERE p.status NOT IN ('Closed', 'TEMPLATE')
ORDER BY p.id DESC
LIMIT $1 OFFSET $2;
```

**Logic:** A phase is incomplete when there EXISTS at least one mandatory macro checkpoint with `reached_at IS NULL`. If no mandatory checkpoints exist for a phase (zero rows match the INNER JOIN), the EXISTS returns false — meaning the phase is considered complete and the project advances. This matches §4.1 CTE semantics exactly.

---

## 5. Project Creation + CASDM Template Seeding

**Source:** FR-P2-009, FR-P2-030

When a project is created, the following happens in a **single database transaction**:

### 5.1 Transaction Steps

```typescript
async function createProject(input: CreateProjectInput, auth: AuthContext): Promise<CreateProjectResponse> {
  return pool.transaction(async (tx) => {
    // Step 1: Generate jira_key for directly-created projects
    const jiraKey = await generateProjectKey(tx); // 'DP-001', 'DP-002', ...

    // Step 2: Insert into projects
    const project = await tx.query(
      `INSERT INTO projects (jira_key, title, description, project_type, status,
        project_manager, solution_architect, account_executive, engineers_assigned,
        sow_hours, planned_kickoff_date, expected_completion_date)
       VALUES ($1,$2,$3,$4,'Active',$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [jiraKey, input.title, input.description, input.project_type,
       input.project_manager, input.solution_architect, input.account_executive,
       input.engineers_assigned, input.sow_hours, input.planned_kickoff_date,
       input.expected_completion_date]
    );

    // Step 3: Look up CASDM config for the project_type
    const configRows = await tx.query(
      `SELECT * FROM casdm_config
       WHERE project_type = $1 AND is_active = true
       ORDER BY phase_order, item_order`,
      [input.project_type]
    );

    // Fallback to 'default' if no rows found for the specified type
    let templateRows = configRows.rows;
    if (templateRows.length === 0) {
      const fallback = await tx.query(
        `SELECT * FROM casdm_config
         WHERE project_type = 'default' AND is_active = true
         ORDER BY phase_order, item_order`,
        []
      );
      templateRows = fallback.rows;
    }

    if (templateRows.length === 0) {
      throw new AppError('NO_CASDM_TEMPLATE',
        `No CASDM template found for project_type '${input.project_type}' or 'default'`, 422);
    }

    // Step 4: Insert micro_artifacts from config
    const microRows = templateRows.filter(r => r.config_type === 'micro_artifact');
    for (const row of microRows) {
      await tx.query(
        `INSERT INTO micro_artifacts (project_id, phase, phase_name, artifact_name)
         VALUES ($1, $2, $3, $4)`,
        [jiraKey, row.phase, row.phase_name, row.item_name]
      );
    }

    // Step 5: Insert macro_checkpoints from config
    const macroRows = templateRows.filter(r => r.config_type === 'macro_checkpoint');
    for (const row of macroRows) {
      await tx.query(
        `INSERT INTO macro_checkpoints (project_id, phase, phase_name, checkpoint_name, checkpoint_type)
         VALUES ($1, $2, $3, $4, $5)`,
        [jiraKey, row.phase, row.phase_name, row.item_name, row.item_type]
      );
    }

    // Step 6: Insert 9 onboarding checklist items
    const checklistItems = ONBOARDING_CHECKLIST_ITEMS; // constant array
    for (const itemName of checklistItems) {
      await tx.query(
        `INSERT INTO onboarding_checklist_items (project_id, item_name) VALUES ($1, $2)`,
        [jiraKey, itemName]
      );
    }

    return {
      project: project.rows[0],
      seeded: {
        micro_artifacts: microRows.length,
        macro_checkpoints: macroRows.length,
        onboarding_items: checklistItems.length,
      },
    };
  });
}
```

### 5.2 `jira_key` Generation for Direct Projects

Directly-created projects (not imported from Jira) use a generated key with prefix `DP-`:

```sql
SELECT 'DP-' || LPAD((COALESCE(MAX(
  CAST(SUBSTRING(jira_key FROM 4) AS INTEGER)
), 0) + 1)::TEXT, 3, '0') AS next_key
FROM projects WHERE jira_key LIKE 'DP-%';
```

Result: `DP-001`, `DP-002`, etc.

### 5.3 Onboarding Checklist Constant

```typescript
export const ONBOARDING_CHECKLIST_ITEMS = [
  'Set up Slack/Teams channel',
  'Set up Clockify',
  'Assign resources via email',
  'Complete SOW handoff checklist',
  'Send customer intro email — Introduce team',
  'Send customer intro email — Schedule kickoff',
  'Send customer intro email — Share discovery agenda & questions',
  'Send customer intro email — Figure out account access',
  'Send customer intro email — Confirm communication channels',
] as const;
```

---

## 6. Jira CST Import

**Source:** FR-P2-009, SRS §8.2

### 6.1 API Call

```
GET /rest/api/3/search?jql=project=CST&maxResults=100&startAt=0&fields=key,summary,description,status,assignee,customfield_10100,customfield_10101,customfield_10102,customfield_10103,customfield_10104,customfield_10105,customfield_10106,customfield_10107
```

Paginate with `startAt` until `total` is reached.

### 6.2 Field Mapping

| Jira Field | `projects` Column | Notes |
|-----------|------------------|-------|
| `key` | `jira_key` | e.g. 'CST-674' |
| `fields.summary` | `title` | |
| `fields.description` | `description` | ADF → plain text |
| `fields.status.name` | `status` | |
| `customfield_10100` | `project_manager` | Source: OQ-P2-004 (pending confirmation) |
| `customfield_10101` | `solution_architect` | |
| `customfield_10102` | `account_executive` | |
| `customfield_10103` | `engineers_assigned` | comma-separated |
| `customfield_10104` | `planned_kickoff_date` | ISO date |
| `customfield_10105` | `expected_completion_date` | ISO date |
| `customfield_10106` | `sow_hours` | numeric |
| `customfield_10107` | `project_type` | text |

> ⚠️ **ASSUMPTION (pending OQ-P2-004):** Custom field IDs are placeholder. Actual field IDs must be confirmed with Chris Xenos. If field IDs differ, only the mapping configuration changes — no architecture impact.

### 6.3 Idempotency

```sql
INSERT INTO projects (jira_key, title, description, status, project_manager, ...)
VALUES ($1, $2, $3, $4, $5, ...)
ON CONFLICT (jira_key) DO NOTHING;
```

Duplicate Jira keys are silently skipped. The response reports the `skipped` count.

### 6.4 One-Time Guard

The import uses an SSM Parameter (`/deliverpro/config/jira-import-completed`) as a flag:

```typescript
const param = await ssm.getParameter({ Name: '/deliverpro/config/jira-import-completed' });
if (param.Parameter?.Value === 'true') {
  throw new AppError('IMPORT_ALREADY_COMPLETE', 'Jira import has already been executed', 409);
}
// ... perform import ...
await ssm.putParameter({ Name: '/deliverpro/config/jira-import-completed', Value: 'true', Overwrite: true });
```

### 6.5 Credentials

Jira API token stored in AWS Secrets Manager at path: `/deliverpro/integrations/jira-api-token`

Secret shape:
```json
{
  "email": "faraz@cloudelligent.com",
  "api_token": "ATATT3x..."
}
```

Auth header: `Authorization: Basic base64(email:api_token)`

### 6.6 Post-Import Seeding

After import, each imported project is seeded with CASDM template (same logic as §5). The `project_type` from Jira data determines which template to use. If `project_type` is null or not found in `casdm_config`, falls back to `'default'`.

---

## 7. Closure Workflow

**Source:** FR-P2-023

### 7.1 State Machine

```
Active  ──[POST /close]──►  Closed
  ▲                            │
  └────[PATCH status=Active]───┘  (leadership/admin only)
```

> **Note:** The SRS mentions an intermediate "Closing" state but FR-P2-023 ACs indicate automatic transition to Closed when all 4 items are complete. The architecture implements: Active → Closed directly when closure is confirmed. Leadership can revert.

### 7.2 Closure Checklist Items

These 4 items are tracked as `macro_checkpoints` with `checkpoint_type = 'checklist'` in Phase 4 (seeded from `casdm_config`):

| # | Checkpoint Name | Completion Method |
|---|----------------|-------------------|
| 1 | Request Signoff from Business Ops | `occurred = true` + `meeting_date` |
| 2 | Share Signoff with Customer | `occurred = true` + `meeting_date` |
| 3 | Project Closure Meeting/Email | `occurred = true` + `meeting_date` + optional `meeting_link` |
| 4 | Create Project Closure Deck | Evidence file upload attached (checked via `gate_evidence` existence) |

### 7.3 Close Handler Logic

```typescript
async function closeProject(projectId: string, auth: AuthContext): Promise<void> {
  // Check all 4 closure checkpoints are complete
  const incomplete = await pool.query(
    `SELECT checkpoint_name FROM macro_checkpoints
     WHERE project_id = $1 AND phase = 'Phase 4'
       AND checkpoint_name IN ($2, $3, $4, $5)
       AND (occurred IS NULL OR occurred = false)
       AND reached_at IS NULL`,
    [projectId,
     'Request Signoff from Business Ops',
     'Share Signoff with Customer',
     'Project Closure Meeting/Email',
     'Create Project Closure Deck']
  );

  if (incomplete.rows.length > 0) {
    throw new AppError('CLOSURE_INCOMPLETE',
      `Closure items incomplete: ${incomplete.rows.map(r => r.checkpoint_name).join(', ')}`, 400);
  }

  await pool.query(
    `UPDATE projects SET status = 'Closed' WHERE jira_key = $1`,
    [projectId]
  );
}
```

### 7.4 Closure Reversal

Leadership/admin can revert a closed project via `PATCH /api/projects/{projectId}` with `{ "status": "Active" }`. The `update-project` handler checks:

```typescript
if (input.status === 'Active' && existing.status === 'Closed') {
  if (!['leadership', 'admin'].includes(auth.role)) {
    throw new AppError('FORBIDDEN', 'Only leadership can reopen a closed project', 403);
  }
}
```

---

## 8. TypeScript Interfaces

```typescript
// packages/shared/types/project.ts

export interface Project {
  id: number;
  jira_key: string;
  jira_id: string | null;
  jira_link: string | null;
  title: string;
  description: string | null;
  project_type: string | null;
  status: string | null;
  account_executive: string | null;
  solution_architect: string | null;
  project_manager: string | null;
  engineers_assigned: string | null;
  planned_kickoff_date: string | null;
  expected_completion_date: string | null;
  resource_assignment_date: string | null;
  sow_hours: number | null;
  hours_consumed: number;
  sow_link: string | null;
  current_phase: string;
  created_at: string;
}

export interface CreateProjectInput {
  title: string;
  project_type: string;
  project_manager: string;
  solution_architect: string;
  account_executive?: string;
  engineers_assigned?: string;
  sow_hours?: number;
  planned_kickoff_date?: string;
  expected_completion_date?: string;
  description?: string;
}

export interface UpdateProjectInput {
  title?: string;
  description?: string;
  status?: string;
  project_manager?: string;
  solution_architect?: string;
  account_executive?: string;
  engineers_assigned?: string;
  planned_kickoff_date?: string | null;
  expected_completion_date?: string | null;
  sow_hours?: number | null;
}

export interface ProjectListResponse {
  projects: ProjectSummary[];
  next_cursor: string | null;
  total_count: number;
}

export interface ProjectSummary {
  id: number;
  jira_key: string;
  title: string;
  project_type: string | null;
  status: string | null;
  project_manager: string | null;
  solution_architect: string | null;
  current_phase: string;
  sow_hours: number | null;
  hours_consumed: number;
  burn_rate_pct: number | null;
  planned_kickoff_date: string | null;
  expected_completion_date: string | null;
}

export interface ImportJiraInput {
  jira_base_url: string;
  project_key: string;
}

export interface ImportJiraResponse {
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ jira_key: string; reason: string }>;
}

export interface OnboardingChecklistItem {
  id: number;
  project_id: string;
  item_name: string;
  completed: boolean;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface UpdateChecklistInput {
  completed: boolean;
}

export interface UpdateHoursInput {
  hours_consumed: number;
}

export interface ChecklistResponse {
  items: OnboardingChecklistItem[];
  completed_count: number;
  total_count: number;
}

export interface CreateProjectResponse {
  project: Project;
  seeded: {
    micro_artifacts: number;
    macro_checkpoints: number;
    onboarding_items: number;
  };
}
```

---

## 9. Edge Cases

| Scenario | Handling | Source |
|----------|----------|--------|
| Project type not found in `casdm_config` | Fallback to `project_type = 'default'` template. If no default exists, return HTTP 422 `NO_CASDM_TEMPLATE`. | FR-P2-030 |
| Jira import duplicate | `ON CONFLICT (jira_key) DO NOTHING` — skip silently, report in `skipped` count. | FR-P2-009 |
| Closure reversal | Leadership/admin can `PATCH` status back to `'Active'`. PM cannot. | FR-P2-023 |
| No `casdm_config` rows at all | Return HTTP 422 with message: "No CASDM template configured. Please configure at least a 'default' project type template in the admin panel." | Architect decision |
| `hours_consumed` exceeds `sow_hours` | Allowed — no hard block. Burn rate shows >100%. Frontend shows red indicator. | FR-P2-022 (no constraint mentioned) |
| Project with `sow_hours = 0` or NULL | `burn_rate_pct` returns `null`. Frontend shows "SOW hours not set". | FR-P2-022 |
| Import Jira with invalid credentials | Return HTTP 502 `JIRA_UNAVAILABLE` with detail. No partial state — transaction rolls back. | FR-P2-009 |
| Concurrent project creation with same generated key | `jira_key` UNIQUE constraint prevents duplicates. Retry with next sequence value. | Architect decision |
| Template project `__template__` in list results | Filtered out: `WHERE status != 'TEMPLATE'` in all list queries. | V002 seed data |
| Checklist item toggled rapidly | Last-write-wins semantics. `completed_at` reflects the most recent state. No optimistic locking for MVP. | Architect decision |
| Project type changed after creation | **IMMUTABLE** — not supported. Attempting to update `project_type` via PATCH returns HTTP 422 `{ "code": "IMMUTABLE_FIELD", "message": "project_type cannot be changed after creation" }`. Changing project_type would orphan seeded checkpoints. If a different type is needed, create a new project. | Confirmed PD-13 (2026-06-30) |

---

## 10. IAM Permissions (Lambda Execution Roles)

### 10.1 Projects Domain — Common (all handlers)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SecretsManagerJiraToken",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-1:504649076991:secret:deliverpro/integrations/jira-api-token-*"
    },
    {
      "Sid": "SSMReadConfig",
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": "arn:aws:ssm:us-east-1:504649076991:parameter/deliverpro/config/*"
    }
  ]
}
```

### 10.2 Import-Jira Lambda — Additional Permission

The `import-jira` handler writes a one-time flag to SSM after successful import. This permission is scoped to the **single specific parameter** used as the import guard:

```json
{
  "Sid": "SSMWriteImportFlag",
  "Effect": "Allow",
  "Action": "ssm:PutParameter",
  "Resource": "arn:aws:ssm:us-east-1:504649076991:parameter/deliverpro/config/jira-import-completed"
}
```

**Principle of least privilege:**
- `PutParameter` scoped to exactly one parameter path — the one-time import completion flag
- No wildcard on SSM write — the import Lambda cannot write to any other SSM parameter
- `GetParameter` scoped to `/deliverpro/config/*` (read-only for checking the flag before import)
- Jira API token read-only from Secrets Manager (import only reads credentials, never writes them)

---

## 11. Cost Estimate

### 11.1 Lambda Invocations

| Endpoint | Est. Monthly Invocations | Rationale |
|----------|------------------------|-----------|
| `GET /api/projects` | ~3,000 | ~50 users × 2 views/day × 30 days |
| `GET /api/projects/{id}` | ~6,000 | ~50 users × 4 detail views/day × 30 days |
| `POST /api/projects` | ~20 | ~20 new projects/month |
| `PATCH /api/projects/{id}` | ~100 | Occasional metadata updates |
| `POST /api/projects/import-jira` | 1 | One-time import |
| `GET /checklist` | ~1,500 | PM checks onboarding daily for active projects |
| `PATCH /checklist/{itemId}` | ~500 | ~2 items checked per project per day on active onboarding |
| `PATCH /hours` | ~200 | Weekly hours update per active project |
| `POST /close` | ~5 | ~5 closures/month |
| **Total** | **~11,300** | |

**Lambda cost:** 11,300 invocations × 256 MB × ~500ms avg = ~1,440 GB-seconds/month

- Compute: 1,440 GB-s × $0.0000166667 = **$0.024/mo**
- Requests: 11,300 × $0.20/1M = **$0.002/mo**
- **Total Lambda: ~$0.03/mo** (within free tier of 400,000 GB-s)

### 11.2 RDS Query Load

| Query Type | Est. Monthly Queries | Avg Duration |
|-----------|---------------------|--------------|
| Project list (with LATERAL phase computation) | ~3,000 | ~50ms |
| Project detail (single + phase CTE) | ~6,000 | ~20ms |
| Checklist CRUD | ~2,000 | ~5ms |
| Create project (transaction — 5 inserts) | ~20 | ~100ms |
| Jira import (batch inserts) | 1 | ~5s |
| **Total query seconds/month** | | **~5.5 min** |

RDS load is negligible on the existing Phase 1 instance (db.t4g.medium, 2 vCPU, 4 GB RAM). No resizing needed for the `projects` domain.

### 11.3 Secrets Manager

- 1 secret (Jira API token): $0.40/mo + ~20 API calls × $0.05/10K = **$0.40/mo**

### 11.4 Total Projects Domain Cost

| Component | Monthly |
|-----------|---------|
| Lambda | $0.03 |
| RDS (incremental) | $0.00 (shared existing instance) |
| Secrets Manager | $0.40 |
| **Total** | **~$0.43/mo** |

> Source: AWS pricing as of 2026-06. Lambda free tier covers this entirely for 12 months. Secrets Manager is the only non-free cost.

---

*End of Projects Architecture v1.0*
