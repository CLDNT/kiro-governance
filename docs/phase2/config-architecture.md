# Config Domain Architecture — Phase 2: DeliverPro

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-07-02 | v1.2 | AWS Architect | GitHub↔Slack linkage CR: **no change to the config domain.** `casdm_config` and `analysis_prompts` are unaffected. Slack channel ids are non-secret fields on `projects` (managed in the `projects` domain, not config); the workspace Slack bot token is an SSM SecureString secret (not config-managed). Level-2 `micro_artifact_mapping` admin management is **DEFERRED** (not built) — when reactivated it becomes a config-domain surface gated on GitHub OIDC (CR-OIDC) + `event_code` (CR-14). See `unified-data-model.md` §4.4 and `projects-architecture.md` §12. |
| 2026-06-30 | v1.1 | AWS Architect | Resolved PD-12: AppDev confirmed at launch; AppMod/AIML seeded without templates (admin adds). Resolved OQ-P2-006: V003 seeds default prompts; admin can overwrite; system default used if no custom prompt. Updated §3 and §5. |
| 2026-06-30 | v1.0 | AWS Architect | Initial config domain architecture from SRS v1.3 (FR-P2-006, FR-P2-016, FR-P2-029, FR-P2-030), auth-architecture v1.0, projects-architecture v1.0 §5, V002 migration |

---

## 1. Overview

The `config` domain owns the CASDM methodology template and analysis prompt configuration. It is the admin-facing domain that allows leadership to modify the phase/gate structure per project type without code deployments.

**Domain responsibilities:**

| Responsibility | SRS Source |
|---------------|-----------|
| Phase/gate template CRUD per project type | FR-P2-006, FR-P2-016, FR-P2-030 |
| Analysis prompt management per checkpoint | FR-P2-029 |
| Template reads for project seeding (consumed by `projects` domain) | FR-P2-030 |

**Tables owned:** `casdm_config`, `analysis_prompts`

**Cross-domain consumers:**
- `projects` domain reads `casdm_config` during project creation to seed micro artifacts and macro checkpoints (see `projects-architecture.md` §5)
- `analysis` domain reads `analysis_prompts` when processing transcript analysis (FR-P2-005)

---

## 2. Data Model

### 2.1 `casdm_config` Table — Final DDL (V003)

The base `casdm_config` table is created in V002. V003 adds the `project_type` column and updates the unique constraint.

**V002 (existing):**

```sql
CREATE TABLE IF NOT EXISTS casdm_config (
  id              BIGSERIAL    PRIMARY KEY,
  config_type     TEXT         NOT NULL CHECK (config_type IN ('phase', 'micro_artifact', 'macro_checkpoint')),
  phase           TEXT         NOT NULL,
  phase_name      TEXT         NOT NULL,
  phase_order     INT          NOT NULL,
  item_name       TEXT,
  item_order      INT,
  item_type       TEXT,
  is_mandatory    BOOLEAN      NOT NULL DEFAULT true,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  changed_by      TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_casdm_config_phase ON casdm_config (phase, config_type);
```

**V003 additions:**

```sql
-- Add project_type column
ALTER TABLE casdm_config
  ADD COLUMN project_type TEXT NOT NULL DEFAULT 'default';

-- Add config_type-specific constraint for item_type values
ALTER TABLE casdm_config
  ADD CONSTRAINT casdm_config_item_type_check
    CHECK (
      (config_type = 'macro_checkpoint' AND item_type IN ('human_review', 'meeting', 'transcript_analysis', 'checklist'))
      OR (config_type IN ('phase', 'micro_artifact') AND (item_type IS NULL OR item_type = ''))
    );

-- Drop old unique constraint (if exists) and add new compound unique
ALTER TABLE casdm_config
  DROP CONSTRAINT IF EXISTS casdm_config_phase_item_name_key;

ALTER TABLE casdm_config
  ADD CONSTRAINT uq_casdm_config_phase_item_project_type
    UNIQUE (phase, item_name, project_type, config_type);

-- Index for template lookup by project_type (used during project seeding)
CREATE INDEX idx_casdm_config_project_type ON casdm_config (project_type, is_active);
```

**Effective schema after V003:**

| Column | Type | Constraints | Purpose |
|--------|------|------------|---------|
| `id` | `BIGSERIAL` | PK | Surrogate key |
| `config_type` | `TEXT` | NOT NULL, CHECK `('phase','micro_artifact','macro_checkpoint')` | Discriminator |
| `phase` | `TEXT` | NOT NULL | Phase identifier (`'Phase 0'`..`'Phase 4'`) |
| `phase_name` | `TEXT` | NOT NULL | Human-readable phase name |
| `phase_order` | `INT` | NOT NULL | Display order for phases |
| `item_name` | `TEXT` | — | Gate/artifact name (NULL for `config_type='phase'` rows) |
| `item_order` | `INT` | — | Display order within phase |
| `item_type` | `TEXT` | CHECK (see above) | Checkpoint type for macros; NULL for micros/phases |
| `is_mandatory` | `BOOLEAN` | NOT NULL DEFAULT true | Whether gate is required for phase advancement |
| `is_active` | `BOOLEAN` | NOT NULL DEFAULT true | Soft-delete (deactivated gates remain for history) |
| `project_type` | `TEXT` | NOT NULL DEFAULT 'default' | Template key: `'AppDev'`, `'AppMod'`, `'AIML'`, `'default'` |
| `changed_by` | `TEXT` | — | Last modifier (Cognito `sub` or email) |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT now() | Row creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT now() | Last modification timestamp |

**Unique constraint:** `(phase, item_name, project_type, config_type)` — the same gate can exist in multiple project types independently.

### 2.2 `analysis_prompts` Table — Final DDL (V003)

```sql
CREATE TABLE analysis_prompts (
  id              BIGSERIAL    PRIMARY KEY,
  checkpoint_name TEXT         NOT NULL UNIQUE,
  prompt_text     TEXT         NOT NULL,
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

| Column | Type | Constraints | Purpose |
|--------|------|------------|---------|
| `id` | `BIGSERIAL` | PK | Surrogate key |
| `checkpoint_name` | `TEXT` | NOT NULL, UNIQUE | Maps to `macro_checkpoints.checkpoint_name` where `checkpoint_type = 'transcript_analysis'` |
| `prompt_text` | `TEXT` | NOT NULL | The Bedrock AgentCore prompt template for this checkpoint |
| `updated_by` | `TEXT` | — | Last editor (Cognito email or sub) |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT now() | Last edit timestamp |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT now() | Row creation timestamp |

### 2.3 V003 Seed Data — Default Analysis Prompts

```sql
INSERT INTO analysis_prompts (checkpoint_name, prompt_text) VALUES
  (
    'Transcript Analysis (Sales to Delivery Handoff)',
    'Analyze this meeting transcript and determine if the following topics were covered during the sales-to-delivery handoff:
1. Project scope and deliverables
2. Customer expectations and success criteria
3. Timeline and milestones
4. Resource allocation and team introduction
5. Known risks and constraints
6. Technical environment and access requirements

Return a JSON object: { "topics_covered": [...], "topics_missing": [...], "passed": boolean, "confidence": number (0-1) }'
  ),
  (
    'Implementation Plan Review (Transcript Analysis)',
    'Analyze this meeting transcript and determine if the following topics were covered during the implementation plan review:
1. Sprint plan walkthrough and story breakdown
2. Architecture decisions and design rationale
3. Risk mitigation strategies
4. Dependency identification and sequencing
5. Acceptance criteria clarity
6. Resource allocation per sprint

Return a JSON object: { "topics_covered": [...], "topics_missing": [...], "passed": boolean, "confidence": number (0-1) }'
  ),
  (
    'Project Retrospective (Transcript Analysis)',
    'Analyze this meeting transcript and determine if the following topics were covered during the project retrospective:
1. What went well
2. What could be improved
3. Action items for future projects
4. Customer satisfaction feedback
5. Lessons learned (technical and process)
6. Team feedback and recognition

Return a JSON object: { "topics_covered": [...], "topics_missing": [...], "passed": boolean, "confidence": number (0-1) }'
  )
ON CONFLICT (checkpoint_name) DO NOTHING;
```

### 2.4 V003 Seed Data — Default Template

```sql
-- Seed 'default' project type template from existing __template__ data
INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type, changed_by)
VALUES
  -- Phase 0 micro artifacts
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Preliminary SRS', 1, NULL, true, 'default', 'system'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Discovery Meeting(s) Agenda + Questions', 2, NULL, true, 'default', 'system'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'High-level Project Plan + Gantt Chart + RACI', 3, NULL, true, 'default', 'system'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Baseline Jira Backlog', 4, NULL, true, 'default', 'system'),
  ('micro_artifact', 'Phase 0', 'Internal Preparation', 0, 'Kickoff Deck Content/Slides', 5, NULL, true, 'default', 'system'),
  -- Phase 0 macro checkpoints
  ('macro_checkpoint', 'Phase 0', 'Internal Preparation', 0, '5 outputs reviewed by SA', 1, 'human_review', true, 'default', 'system'),
  ('macro_checkpoint', 'Phase 0', 'Internal Preparation', 0, 'Transcript Analysis (Sales to Delivery Handoff)', 2, 'transcript_analysis', true, 'default', 'system'),
  -- Phase 1 micro artifacts
  ('micro_artifact', 'Phase 1', 'Discover & Align', 1, 'Working SRS', 1, NULL, true, 'default', 'system'),
  -- Phase 1 macro checkpoints
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Working SRS reviewed by SA', 1, 'human_review', true, 'default', 'system'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Kickoff Call', 2, 'meeting', true, 'default', 'system'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Review SRS with internal team (Internal Meeting)', 3, 'meeting', true, 'default', 'system'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Discovery Readout/SRS Session (Client)', 4, 'meeting', true, 'default', 'system'),
  ('macro_checkpoint', 'Phase 1', 'Discover & Align', 1, 'Kickoff Prep Meeting', 5, 'meeting', true, 'default', 'system'),
  -- Phase 2 micro artifacts
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Workstream Decomposition', 1, NULL, true, 'default', 'system'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Spec Strategy per Workstream', 2, NULL, true, 'default', 'system'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Data Readiness', 3, NULL, true, 'default', 'system'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Solution Architecture Design', 4, NULL, true, 'default', 'system'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'TCO', 5, NULL, true, 'default', 'system'),
  ('micro_artifact', 'Phase 2', 'Design & Review', 2, 'Jira stories/sprint plan using validated SRS/design docs', 6, NULL, true, 'default', 'system'),
  -- Phase 2 macro checkpoints
  ('macro_checkpoint', 'Phase 2', 'Design & Review', 2, 'Technically validate 6 design docs with spec strategy by SA', 1, 'human_review', true, 'default', 'system'),
  ('macro_checkpoint', 'Phase 2', 'Design & Review', 2, 'Implementation Plan Review (Transcript Analysis)', 2, 'transcript_analysis', true, 'default', 'system'),
  -- Phase 3 micro artifacts
  ('micro_artifact', 'Phase 3', 'Build & Implement', 3, 'Specs per story-id', 1, NULL, true, 'default', 'system'),
  ('micro_artifact', 'Phase 3', 'Build & Implement', 3, 'Code', 2, NULL, true, 'default', 'system'),
  ('micro_artifact', 'Phase 3', 'Build & Implement', 3, 'UAT report', 3, NULL, true, 'default', 'system'),
  -- Phase 3 macro checkpoints
  ('macro_checkpoint', 'Phase 3', 'Build & Implement', 3, 'Review 3 generated outputs by Tech Lead', 1, 'human_review', true, 'default', 'system'),
  ('macro_checkpoint', 'Phase 3', 'Build & Implement', 3, 'Validate performance, security, compliance by Tech Lead', 2, 'human_review', true, 'default', 'system'),
  ('macro_checkpoint', 'Phase 3', 'Build & Implement', 3, 'Executive Check-in Call 1', 3, 'meeting', true, 'default', 'system'),
  -- Phase 4 micro artifacts
  ('micro_artifact', 'Phase 4', 'Launch & Enable', 4, 'Runbooks / Documentation', 1, NULL, true, 'default', 'system'),
  -- Phase 4 macro checkpoints
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Validate customer documentation by Tech Lead', 1, 'human_review', true, 'default', 'system'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'UAT Review with Client (SA Support)', 2, 'meeting', true, 'default', 'system'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Share Signoff Document with Customer', 3, 'meeting', true, 'default', 'system'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Project Retrospective (Transcript Analysis)', 4, 'transcript_analysis', true, 'default', 'system'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Executive Check-in Call 2', 5, 'meeting', true, 'default', 'system'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Conduct KT Sessions with customer', 6, 'meeting', true, 'default', 'system'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Account Planning Session', 7, 'meeting', false, 'default', 'system'),
  -- Phase 4 closure checklist items
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Request Signoff from Business Ops', 8, 'checklist', true, 'default', 'system'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Share Signoff with Customer', 9, 'checklist', true, 'default', 'system'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Project Closure Meeting/Email', 10, 'checklist', true, 'default', 'system'),
  ('macro_checkpoint', 'Phase 4', 'Launch & Enable', 4, 'Create Project Closure Deck', 11, 'checklist', true, 'default', 'system')
ON CONFLICT (phase, item_name, project_type, config_type) DO NOTHING;
```

---

## 3. Project Type Enum

Supported at launch:

| Value | Description | Status |
|-------|-------------|--------|
| `'AppDev'` | Application Development (greenfield) | **Confirmed at launch** (PD-12 resolved 2026-06-30) |
| `'AppMod'` | Application Modernization / Migration | In enum — seeded without gate templates initially; admin adds templates |
| `'AIML'` | AI/ML projects | In enum — seeded without gate templates initially; admin adds templates |
| `'default'` | Fallback template — used when no project-type-specific config exists | Always present (V003 seed) |

**Source:** Phase 2 Meeting Notes — "make gates and project type configuration extensible for different project categories (AppDev, Migration, AI/ML)"; SRS §5 FR-P2-030; PD-12 confirmed 2026-06-30.

**Launch behavior:** V003 seeds the `'default'` template with all standard CASDM gates. At launch, `'AppDev'` projects use the `'default'` fallback template. Admin can create AppDev-specific templates via the config panel. `'AppMod'` and `'AIML'` remain in the enum but have no pre-seeded gate templates — admin adds them when needed.

**Fallback logic:** When a project is created with `project_type = 'AppDev'` and no `casdm_config` rows exist for `'AppDev'`, the system falls back to `'default'`. This allows launching with a single `'default'` template and adding type-specific templates over time.

**TypeScript enum:**

```typescript
export const PROJECT_TYPES = ['AppDev', 'AppMod', 'AIML', 'default'] as const;
export type ProjectType = typeof PROJECT_TYPES[number];
```

> **Note:** The enum is not enforced at the database level via CHECK constraint. New project types can be added by inserting `casdm_config` rows with a new `project_type` value — no migration required. The `GET /api/config/templates` endpoint dynamically returns all distinct project types.

---

## 4. How Config Changes Affect Existing vs New Projects

**Core principle:** Config changes affect future project seeding only. Existing project checkpoints are immutable.

### 4.1 Seeding Query (used by `projects` domain)

When the `projects` domain creates a new project, it queries `casdm_config` for the active template:

```sql
-- Step 1: Try the specific project type
SELECT * FROM casdm_config
WHERE project_type = $1 AND is_active = true
ORDER BY phase_order, item_order;

-- Step 2: If zero rows returned, fall back to 'default'
SELECT * FROM casdm_config
WHERE project_type = 'default' AND is_active = true
ORDER BY phase_order, item_order;
```

See `projects-architecture.md` §5.1 Steps 3–5 for the full seeding transaction.

### 4.2 Immutability of Existing Projects

Once a project is seeded:
- Rows in `micro_artifacts` and `macro_checkpoints` for that project are independent of `casdm_config`
- Deactivating a config row (`is_active = false`) does NOT remove it from existing projects
- Adding a new config row does NOT add it to existing projects
- Renaming a config row does NOT rename it on existing projects

**Why:** Each project gets a snapshot of the template at creation time. The snapshot is the rows in `micro_artifacts` and `macro_checkpoints` with that project's `jira_key`. Template changes only affect the next `INSERT INTO micro_artifacts ... SELECT FROM casdm_config` during project creation.

### 4.3 Admin UX Implication

The admin panel should show a warning when editing templates:

> "Changes apply to new projects only. Existing projects retain their original gate configuration."

---

## 5. Analysis Prompts Design

### 5.1 Concept

One row per `checkpoint_name` that has `checkpoint_type = 'transcript_analysis'`. The AgentCore analysis agent reads the prompt at runtime — changes take effect immediately on the next analysis run.

**Default behavior (OQ-P2-006 RESOLVED 2026-06-30):** V003 migration seeds default prompts for all standard `transcript_analysis` checkpoints. Admin can overwrite any prompt via the config panel. If no custom prompt exists for a checkpoint, the system default (from V003 seed) is used. If the V003 seed row is missing (e.g., admin adds a brand-new transcript_analysis checkpoint), the generic fallback hardcoded in Lambda fires.

### 5.2 Data Flow

```
Admin edits prompt → analysis_prompts.prompt_text updated
                              ↓
User triggers "Analyze Transcript" on a checkpoint
                              ↓
Analysis Lambda reads: SELECT prompt_text FROM analysis_prompts WHERE checkpoint_name = $1
                              ↓
If found: use the custom prompt
If NOT found: use generic fallback prompt (hardcoded in Lambda code)
                              ↓
Prompt + transcript → Bedrock AgentCore → structured JSON result
```

### 5.3 Default Prompts

Seeded in V003 migration (see §2.3). Three default prompts for the three `transcript_analysis` checkpoints in the default template:
1. Sales to Delivery Handoff
2. Implementation Plan Review
3. Project Retrospective

These are the **system defaults** — admin can overwrite them via the config panel at any time. Edits are persisted to `analysis_prompts` and take effect immediately on the next analysis run (no restart required — FR-P2-029).

### 5.4 Generic Fallback Prompt (hardcoded)

If no `analysis_prompts` row exists for a checkpoint (e.g., admin adds a new `transcript_analysis` checkpoint but hasn't configured a prompt yet):

```typescript
const GENERIC_FALLBACK_PROMPT = `Analyze this meeting transcript and determine if the key discussion topics for a "${checkpointName}" meeting were covered. Evaluate comprehensively and return a JSON object: { "topics_covered": [...], "topics_missing": [...], "passed": boolean, "confidence": number (0-1) }`;
```

---

## 6. API Endpoints

### 6.1 `GET /api/config/templates`

**Purpose:** List all project types and their phase/gate counts.
**Source:** FR-P2-016

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `sa`, `engineer`, `leadership`, `admin` |
| Handler | `packages/config/handlers/list-templates.ts` |

**Response (200):**

```typescript
interface TemplateListResponse {
  templates: TemplateTypeSummary[];
}

interface TemplateTypeSummary {
  project_type: string;
  phase_count: number;
  micro_artifact_count: number;
  macro_checkpoint_count: number;
  last_updated: string;       // most recent updated_at across rows for this type
}
```

**SQL:**

```sql
SELECT
  project_type,
  COUNT(DISTINCT phase) FILTER (WHERE config_type = 'phase' OR item_name IS NOT NULL) AS phase_count,
  COUNT(*) FILTER (WHERE config_type = 'micro_artifact' AND is_active = true) AS micro_artifact_count,
  COUNT(*) FILTER (WHERE config_type = 'macro_checkpoint' AND is_active = true) AS macro_checkpoint_count,
  MAX(updated_at) AS last_updated
FROM casdm_config
WHERE is_active = true
GROUP BY project_type
ORDER BY project_type;
```

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 401 | `UNAUTHORIZED` | Missing/expired JWT |

---

### 6.2 `GET /api/config/templates/{projectType}`

**Purpose:** Get full template for a specific project type (all phases, gates, artifacts).
**Source:** FR-P2-016, FR-P2-030

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `sa`, `engineer`, `leadership`, `admin` |
| Handler | `packages/config/handlers/get-template.ts` |

**Path params:** `projectType` — one of `'AppDev'`, `'AppMod'`, `'AIML'`, `'default'`

**Response (200):**

```typescript
interface TemplateResponse {
  project_type: string;
  phases: TemplatePhase[];
}

interface TemplatePhase {
  phase: string;             // 'Phase 0'..'Phase 4'
  phase_name: string;        // 'Internal Preparation', etc.
  phase_order: number;
  micro_artifacts: TemplateItem[];
  macro_checkpoints: TemplateItem[];
}

interface TemplateItem {
  id: number;                // casdm_config.id — used for PATCH
  item_name: string;
  item_order: number;
  item_type: string | null;  // checkpoint type for macros
  is_mandatory: boolean;
  is_active: boolean;
}
```

**SQL:**

```sql
SELECT * FROM casdm_config
WHERE project_type = $1
ORDER BY phase_order, config_type, item_order;
```

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 401 | `UNAUTHORIZED` | Missing/expired JWT |
| 404 | `TEMPLATE_NOT_FOUND` | No rows exist for this project_type |

---

### 6.3 `POST /api/config/templates/{projectType}/items`

**Purpose:** Add a new phase, gate, or artifact to a project type template.
**Source:** FR-P2-006, FR-P2-016

| Property | Value |
|----------|-------|
| Auth roles | `leadership`, `admin` |
| Handler | `packages/config/handlers/create-config-item.ts` |

**Request body:**

```typescript
interface CreateConfigItemInput {
  config_type: 'phase' | 'micro_artifact' | 'macro_checkpoint';
  phase: string;              // 'Phase 0'..'Phase 4' (existing or new)
  phase_name: string;
  phase_order: number;
  item_name?: string;         // required for micro_artifact and macro_checkpoint
  item_order?: number;        // auto-assigned if omitted (MAX + 1)
  item_type?: string;         // required for macro_checkpoint: 'human_review'|'meeting'|'transcript_analysis'|'checklist'
  is_mandatory?: boolean;     // default true
}
```

**Response (201):**

```typescript
interface CreateConfigItemResponse {
  item: CasdmConfigItem;
}
```

**SQL:**

```sql
-- Auto-assign item_order if not provided
SELECT COALESCE(MAX(item_order), 0) + 1 AS next_order
FROM casdm_config
WHERE project_type = $1 AND phase = $2 AND config_type = $3;

INSERT INTO casdm_config (config_type, phase, phase_name, phase_order, item_name, item_order, item_type, is_mandatory, project_type, changed_by, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
RETURNING *;
```

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Missing required fields, invalid `config_type` or `item_type` |
| 401 | `UNAUTHORIZED` | Missing/expired JWT |
| 403 | `FORBIDDEN` | Role not in `['leadership', 'admin']` |
| 409 | `DUPLICATE_CONFIG_ITEM` | Unique constraint violation `(phase, item_name, project_type, config_type)` |

---

### 6.4 `PATCH /api/config/templates/{projectType}/items/{id}`

**Purpose:** Rename, reorder, or deactivate a config item.
**Source:** FR-P2-006, FR-P2-016

| Property | Value |
|----------|-------|
| Auth roles | `leadership`, `admin` |
| Handler | `packages/config/handlers/update-config-item.ts` |

**Path params:**
- `projectType` — project type (used for validation only — must match the row's `project_type`)
- `id` — `casdm_config.id`

**Request body:**

```typescript
interface UpdateConfigItemInput {
  item_name?: string;         // rename
  phase_name?: string;        // rename phase display name
  item_order?: number;        // reorder
  phase_order?: number;       // reorder phase
  is_active?: boolean;        // deactivate (false) or reactivate (true)
  is_mandatory?: boolean;     // change mandatory status
}
```

**Response (200):**

```typescript
interface UpdateConfigItemResponse {
  item: CasdmConfigItem;
}
```

**SQL:**

```sql
UPDATE casdm_config
SET
  item_name    = COALESCE($1, item_name),
  phase_name   = COALESCE($2, phase_name),
  item_order   = COALESCE($3, item_order),
  phase_order  = COALESCE($4, phase_order),
  is_active    = COALESCE($5, is_active),
  is_mandatory = COALESCE($6, is_mandatory),
  changed_by   = $7,
  updated_at   = now()
WHERE id = $8 AND project_type = $9
RETURNING *;
```

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Empty body or invalid values |
| 401 | `UNAUTHORIZED` | Missing/expired JWT |
| 403 | `FORBIDDEN` | Role not in `['leadership', 'admin']` |
| 404 | `CONFIG_ITEM_NOT_FOUND` | No row with this `id` and `project_type` |
| 409 | `DUPLICATE_CONFIG_ITEM` | Rename causes unique constraint violation |

---

### 6.5 `GET /api/config/prompts`

**Purpose:** List all analysis prompts.
**Source:** FR-P2-029

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `sa`, `engineer`, `leadership`, `admin` |
| Handler | `packages/config/handlers/list-prompts.ts` |

**Response (200):**

```typescript
interface PromptListResponse {
  prompts: AnalysisPrompt[];
}
```

**SQL:**

```sql
SELECT id, checkpoint_name, prompt_text, updated_by, updated_at, created_at
FROM analysis_prompts
ORDER BY checkpoint_name;
```

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 401 | `UNAUTHORIZED` | Missing/expired JWT |

---

### 6.6 `PATCH /api/config/prompts/{checkpointName}`

**Purpose:** Update the prompt text for a specific checkpoint.
**Source:** FR-P2-029

| Property | Value |
|----------|-------|
| Auth roles | `leadership`, `admin` |
| Handler | `packages/config/handlers/update-prompt.ts` |

**Path params:** `checkpointName` — URL-encoded checkpoint name (e.g., `Transcript%20Analysis%20(Sales%20to%20Delivery%20Handoff)`)

**Request body:**

```typescript
interface UpdatePromptInput {
  prompt_text: string;   // required, min 1 char
}
```

**Response (200):**

```typescript
interface UpdatePromptResponse {
  prompt: AnalysisPrompt;
}
```

**SQL:**

```sql
UPDATE analysis_prompts
SET prompt_text = $1, updated_by = $2, updated_at = now()
WHERE checkpoint_name = $3
RETURNING *;
```

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Empty or missing `prompt_text` |
| 401 | `UNAUTHORIZED` | Missing/expired JWT |
| 403 | `FORBIDDEN` | Role not in `['leadership', 'admin']` |
| 404 | `PROMPT_NOT_FOUND` | No `analysis_prompts` row with this `checkpoint_name` |

---

## 7. TypeScript Interfaces

```typescript
// packages/shared/types/config.ts

export const PROJECT_TYPES = ['AppDev', 'AppMod', 'AIML', 'default'] as const;
export type ProjectType = typeof PROJECT_TYPES[number];

export const CONFIG_TYPES = ['phase', 'micro_artifact', 'macro_checkpoint'] as const;
export type ConfigType = typeof CONFIG_TYPES[number];

export const CHECKPOINT_TYPES = ['human_review', 'meeting', 'transcript_analysis', 'checklist'] as const;
export type CheckpointType = typeof CHECKPOINT_TYPES[number];

// --- Models ---

export interface CasdmConfigItem {
  id: number;
  config_type: ConfigType;
  phase: string;
  phase_name: string;
  phase_order: number;
  item_name: string | null;
  item_order: number | null;
  item_type: CheckpointType | null;
  is_mandatory: boolean;
  is_active: boolean;
  project_type: string;
  changed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnalysisPrompt {
  id: number;
  checkpoint_name: string;
  prompt_text: string;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

// --- Inputs ---

export interface CreateConfigItemInput {
  config_type: ConfigType;
  phase: string;
  phase_name: string;
  phase_order: number;
  item_name?: string;
  item_order?: number;
  item_type?: CheckpointType;
  is_mandatory?: boolean;
}

export interface UpdateConfigItemInput {
  item_name?: string;
  phase_name?: string;
  item_order?: number;
  phase_order?: number;
  is_active?: boolean;
  is_mandatory?: boolean;
}

export interface UpdatePromptInput {
  prompt_text: string;
}

// --- Responses ---

export interface TemplateListResponse {
  templates: TemplateTypeSummary[];
}

export interface TemplateTypeSummary {
  project_type: string;
  phase_count: number;
  micro_artifact_count: number;
  macro_checkpoint_count: number;
  last_updated: string;
}

export interface TemplateResponse {
  project_type: string;
  phases: TemplatePhase[];
}

export interface TemplatePhase {
  phase: string;
  phase_name: string;
  phase_order: number;
  micro_artifacts: TemplateItem[];
  macro_checkpoints: TemplateItem[];
}

export interface TemplateItem {
  id: number;
  item_name: string;
  item_order: number;
  item_type: string | null;
  is_mandatory: boolean;
  is_active: boolean;
}

export interface PromptListResponse {
  prompts: AnalysisPrompt[];
}
```

---

## 8. Handler Pattern

All handlers follow the project standard middleware pattern:

```typescript
// packages/config/handlers/update-config-item.ts
import { APIGatewayProxyHandler } from 'aws-lambda';
import { requireRole } from '@deliverpro/shared/middleware/auth';
import { updateConfigItem } from '../services/config.service';

export const handler: APIGatewayProxyHandler = async (event) => {
  const auth = requireRole(['leadership', 'admin'])(event);
  const projectType = decodeURIComponent(event.pathParameters!.projectType!);
  const id = parseInt(event.pathParameters!.id!, 10);
  const input = JSON.parse(event.body || '{}');

  const result = await updateConfigItem(projectType, id, input, auth);
  return { statusCode: 200, body: JSON.stringify({ item: result }) };
};
```

---

## 9. Edge Cases

| # | Scenario | Handling | Source |
|---|----------|----------|--------|
| 1 | Deleting a project type that has active projects | Not allowed. The admin panel does not support deleting an entire project type — only deactivating individual items (`is_active = false`). If all items for a project type are deactivated, the template still exists with zero active rows. Attempting to create a project with this type returns HTTP 422 `NO_CASDM_TEMPLATE` (handled in `projects` domain). | Architect decision |
| 2 | Project type with zero active config rows | Project creation returns HTTP 422 `NO_CASDM_TEMPLATE`. The `projects` domain checks: if query returns 0 rows for the type AND 0 rows for `'default'`, throw 422. Admin must activate at least one item or ensure `'default'` template exists. | FR-P2-030 AC |
| 3 | Renaming a config item to a name that already exists in the same phase/type | Returns HTTP 409 `DUPLICATE_CONFIG_ITEM` due to unique constraint `(phase, item_name, project_type, config_type)`. | Architect decision |
| 4 | Concurrent admin edits to the same config item | Last-write-wins. `updated_at` reflects most recent change. No optimistic locking for MVP. | Architect decision |
| 5 | Admin adds a `transcript_analysis` checkpoint but no prompt configured | Analysis Lambda uses the generic fallback prompt (§5.4). Admin can add a prompt later via `PATCH /api/config/prompts/{checkpointName}` — but must first insert a row. Recommend the admin panel auto-creates a placeholder `analysis_prompts` row when a new `transcript_analysis` checkpoint is added. | Architect decision |
| 6 | Prompt checkpoint_name does not match any `casdm_config` item_name | Allowed — `analysis_prompts.checkpoint_name` is not FK-constrained to `casdm_config.item_name`. This allows pre-configuring prompts before the checkpoint exists. Orphaned prompts are harmless (never queried). | Architect decision |
| 7 | Admin reactivates a previously deactivated item | Sets `is_active = true`. New projects created after reactivation will include this item again. Existing projects are unaffected. | FR-P2-006 |
| 8 | `item_order` gap after deactivation | Gaps in `item_order` are acceptable. Display order is determined by `ORDER BY item_order ASC`. No rebalancing needed. | Architect decision |

---

## 10. Cost Estimate

### 10.1 Lambda Invocations

| Endpoint | Est. Monthly Invocations | Rationale |
|----------|------------------------|-----------|
| `GET /api/config/templates` | ~200 | Admin panel views + project creation lookups |
| `GET /api/config/templates/{type}` | ~300 | Admin editing + project seeding reads |
| `POST .../items` | ~10 | Rare — methodology changes infrequently |
| `PATCH .../items/{id}` | ~20 | Occasional renames, reorders, deactivations |
| `GET /api/config/prompts` | ~100 | Admin views + analysis reads |
| `PATCH /api/config/prompts/{name}` | ~5 | Rare prompt edits |
| **Total** | **~635** | |

**Lambda cost:** 635 invocations × 256 MB × ~100ms avg = ~16 GB-seconds/month

- Compute: 16 GB-s × $0.0000166667 = **$0.0003/mo**
- Requests: 635 × $0.20/1M = **$0.0001/mo**
- **Total Lambda: <$0.01/mo** (within free tier)

### 10.2 RDS Query Load

Config queries are simple selects/updates on a small table (<100 rows). Negligible load on shared RDS instance.

### 10.3 Total Config Domain Cost

| Component | Monthly |
|-----------|---------|
| Lambda | <$0.01 |
| RDS (incremental) | $0.00 |
| **Total** | **<$0.01/mo** |

---

*End of Config Architecture v1.0*
