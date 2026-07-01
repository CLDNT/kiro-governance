# Gates Domain Architecture — Phase 2: DeliverPro

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-29 | v1.0 | AWS Architect | Initial gates domain architecture from SRS v1.3 (FR-P2-002, 003, 004, 007, 008, 011, 017, 024, 026, 027), domain decomposition v1.0 §2.3, auth-architecture v1.0, projects-architecture v1.0 §4, V002 migration |

---

## 1. Overview

The `gates` domain owns CASDM checkpoint and artifact tracking per project — the core governance view of DeliverPro. It surfaces the per-project gate status including Phase 1 `governance_events` integration via the shared RDS instance.

**Domain responsibilities:**

| Responsibility | SRS Source |
|---------------|-----------|
| Gate status view (all phases, micro + macro) | FR-P2-002 |
| Manual evidence attachment (meeting_link, url, ai_analysis) | FR-P2-003 |
| Meeting link entry (sets occurred + reached_at) | FR-P2-004 |
| Micro artifact status tracking | FR-P2-007 |
| Macro checkpoint completion (state machine) | FR-P2-008 |
| Phase 1 governance_events integration (timeline) | FR-P2-011 |
| Checkpoint notes (append-only) | FR-P2-017 |
| Executive check-in calls (Phase 3 + 4) | FR-P2-024 |
| Kickoff prep meeting (Phase 1) | FR-P2-026 |
| Account planning session (Phase 4) | FR-P2-027 |

**Tables owned:** `macro_checkpoints`, `micro_artifacts`, `gate_evidence`, `checkpoint_notes`

**Cross-domain reads:**
- Reads `governance_events` (Phase 1 MCP server table) for timeline interleaving
- Reads `onboarding_checklist_items` (owned by `projects`) to determine `checklist`-type checkpoint completion
- Reads `casdm_config` (owned by `config`) for template lookup

---

## 2. API Endpoints

### 2.1 `GET /api/projects/{projectId}/gates`

**Purpose:** Return full gate status view — all phases with micro artifacts, macro checkpoints, and Phase 1 governance_events interleaved.
**Source:** FR-P2-002, FR-P2-011

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `sa`, `engineer`, `leadership`, `admin` |
| Handler | `packages/gates/handlers/list-gates.ts` |

**Path params:** `projectId` — the `jira_key` (e.g., `CST-674` or `DP-001`)

**Response (200):**

```typescript
interface GateStatusResponse {
  project_id: string;
  phases: PhaseGateView[];
}

interface PhaseGateView {
  phase: string;             // 'Phase 0' .. 'Phase 4'
  phase_name: string;        // 'Internal Preparation' .. 'Launch & Enable'
  micro_artifacts: MicroArtifactDetail[];
  macro_checkpoints: MacroCheckpointDetail[];
  phase_complete: boolean;   // all mandatory macro checkpoints have reached_at
}
```

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `PROJECT_NOT_FOUND` | No project with that jira_key |

**Phase completion logic:** Same as `projects-architecture.md` §4 — a phase is complete when all mandatory `macro_checkpoints` for the project's type (from `casdm_config`) have `reached_at IS NOT NULL`.

---

### 2.2 `PATCH /api/projects/{projectId}/checkpoints/{checkpointId}`

**Purpose:** Complete or enrich a macro checkpoint.
**Source:** FR-P2-008, FR-P2-004, FR-P2-024, FR-P2-026, FR-P2-027

| Property | Value |
|----------|-------|
| Auth roles | Depends on `checkpoint_type` — see §4 |
| Handler | `packages/gates/handlers/complete-checkpoint.ts` |

**Path params:**
- `projectId` — the `jira_key`
- `checkpointId` — the `macro_checkpoints.id` (BIGSERIAL)

**Request body:**

```typescript
interface UpdateCheckpointInput {
  occurred?: boolean;         // meeting type: mark as occurred
  meeting_date?: string;      // ISO date — when the meeting happened
  meeting_link?: string;      // Avoma URL
  reviewed_by?: string;       // human_review type: who reviewed
  result_detail?: string;     // rich outcome text
}
```

**Response (200):** Updated `MacroCheckpointDetail`.

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Invalid field values or disallowed field for checkpoint_type |
| 400 | `CHECKPOINT_ALREADY_COMPLETE` | Attempting to un-set `occurred` or `reviewed_by` (append-only) |
| 403 | `FORBIDDEN` | Role not permitted for this checkpoint_type |
| 404 | `CHECKPOINT_NOT_FOUND` | Checkpoint does not exist or does not belong to project |

---

### 2.3 `POST /api/projects/{projectId}/checkpoints/{checkpointId}/evidence`

**Purpose:** Attach evidence to a macro checkpoint.
**Source:** FR-P2-003

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `sa`, `leadership`, `admin` |
| Handler | `packages/gates/handlers/attach-evidence.ts` |

**Request body:**

```typescript
interface AttachEvidenceInput {
  evidence_type: 'meeting_link' | 'url' | 'file_upload' | 'ai_analysis';
  label?: string;          // display label
  value: string;           // URL, S3 key, or JSON string
  link_metadata?: {        // optional — from metadata extraction (FR-P2-031)
    title?: string;
    date?: string;
    duration_minutes?: number | null;
  };
}
```

**Response (201):**

```typescript
interface EvidenceItem {
  id: number;
  project_id: string;
  checkpoint_name: string;
  evidence_type: string;
  label: string | null;
  value: string;
  link_metadata: { title?: string; date?: string; duration_minutes?: number | null } | null;
  uploaded_by: string;
  created_at: string;
}
```

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Missing `value`, invalid `evidence_type` |
| 404 | `CHECKPOINT_NOT_FOUND` | Checkpoint does not exist or does not belong to project |

**Side effect:** If `evidence_type = 'meeting_link'`, also updates `macro_checkpoints.meeting_link` with the value.

---

### 2.4 `GET /api/projects/{projectId}/checkpoints/{checkpointId}/evidence`

**Purpose:** List all evidence attached to a checkpoint.
**Source:** FR-P2-003

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `sa`, `engineer`, `leadership`, `admin` |
| Handler | `packages/gates/handlers/list-evidence.ts` |

**Response (200):**

```typescript
interface ListEvidenceResponse {
  evidence: EvidenceItem[];
  total_count: number;
}
```

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `CHECKPOINT_NOT_FOUND` | Checkpoint does not exist or does not belong to project |

---

### 2.5 `PATCH /api/projects/{projectId}/artifacts/{artifactId}`

**Purpose:** Update micro artifact status.
**Source:** FR-P2-007

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `sa`, `leadership`, `admin` |
| Handler | `packages/gates/handlers/update-artifact.ts` |

**Path params:**
- `projectId` — the `jira_key`
- `artifactId` — the `micro_artifacts.id` (BIGSERIAL)

**Request body:**

```typescript
interface UpdateArtifactInput {
  status: 'pending' | 'in_progress' | 'complete';
}
```

**Response (200):** Updated `MicroArtifactDetail`.

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Invalid status value |
| 404 | `ARTIFACT_NOT_FOUND` | Artifact does not exist or does not belong to project |

**Side effect:** Sets `completed_at = now()` and `completed_by = auth.email` when status transitions to `'complete'`. Clears both when status moves back from `'complete'`.

---

### 2.6 `POST /api/projects/{projectId}/checkpoints/{checkpointId}/notes`

**Purpose:** Add an append-only note to a checkpoint.
**Source:** FR-P2-017

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `sa`, `leadership`, `admin` |
| Handler | `packages/gates/handlers/add-note.ts` |

**Request body:**

```typescript
interface AddNoteInput {
  note_text: string;  // max 4000 chars
}
```

**Response (201):**

```typescript
interface GateNote {
  id: number;
  project_id: string;
  checkpoint_name: string;
  note_text: string;
  author: string;
  created_at: string;
}
```

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | `note_text` exceeds 4000 chars or is empty |
| 404 | `CHECKPOINT_NOT_FOUND` | Checkpoint does not exist or does not belong to project |

---

### 2.7 `GET /api/projects/{projectId}/checkpoints/{checkpointId}/notes`

**Purpose:** List all notes for a checkpoint.
**Source:** FR-P2-017

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `sa`, `engineer`, `leadership`, `admin` |
| Handler | `packages/gates/handlers/list-notes.ts` |

**Response (200):**

```typescript
interface ListNotesResponse {
  notes: GateNote[];
  total_count: number;
}
```

---

### 2.8 `GET /api/projects/{projectId}/timeline`

**Purpose:** Chronological timeline merging `governance_events` + checkpoint completions + evidence attachments.
**Source:** FR-P2-011

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `sa`, `engineer`, `leadership`, `admin` |
| Handler | `packages/gates/handlers/project-timeline.ts` |

**Query params:**

```typescript
interface TimelineQuery {
  limit?: number;   // default 50, max 200
  cursor?: string;  // ISO timestamp for keyset pagination (events before this timestamp)
}
```

**Response (200):**

```typescript
interface TimelineResponse {
  events: TimelineEvent[];
  next_cursor: string | null;
}

interface TimelineEvent {
  id: string;                          // prefixed: 'ge-{id}' | 'mc-{id}' | 'ev-{id}'
  event_type: 'governance_event' | 'checkpoint_completed' | 'evidence_attached';
  timestamp: string;                   // ISO 8601
  phase: string | null;
  title: string;                       // human-readable label
  actor: string | null;
  detail: string | null;               // update_text, result_detail, or evidence label
  source: 'kiro_mcp' | 'deliverpro';  // origin system
}
```

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `PROJECT_NOT_FOUND` | No project with that jira_key |

---

## 3. Gate Status View Structure

The `GET /api/projects/{projectId}/gates` response assembles the full CASDM view. Structure:

```json
{
  "project_id": "CST-674",
  "phases": [
    {
      "phase": "Phase 0",
      "phase_name": "Internal Preparation",
      "micro_artifacts": [
        {
          "id": 1,
          "artifact_name": "Preliminary SRS",
          "status": "complete",
          "completed_at": "2026-06-20T10:00:00Z",
          "completed_by": "aws-architect"
        }
      ],
      "macro_checkpoints": [
        {
          "id": 10,
          "checkpoint_name": "5 outputs reviewed by SA",
          "checkpoint_type": "human_review",
          "occurred": null,
          "meeting_date": null,
          "meeting_link": null,
          "result_detail": null,
          "reviewed_by": "John Doe",
          "reached_at": "2026-06-21T14:30:00Z",
          "evidence_count": 2,
          "notes_count": 1
        }
      ],
      "phase_complete": true
    }
  ]
}
```

### 3.1 Assembly SQL

```sql
-- Micro artifacts for a project
SELECT id, phase, phase_name, artifact_name, status, completed_at, completed_by
FROM micro_artifacts
WHERE project_id = $1
ORDER BY phase, id;

-- Macro checkpoints with evidence and notes counts
SELECT
  mc.id, mc.phase, mc.phase_name, mc.checkpoint_name, mc.checkpoint_type,
  mc.occurred, mc.meeting_link, mc.reviewed_by, mc.reviewed_at,
  mc.meeting_date, mc.result_detail, mc.reached_at,
  mc.analysis_result, mc.analysis_run_at,
  (SELECT COUNT(*) FROM gate_evidence ge WHERE ge.project_id = mc.project_id AND ge.checkpoint_name = mc.checkpoint_name) AS evidence_count,
  (SELECT COUNT(*) FROM checkpoint_notes cn WHERE cn.project_id = mc.project_id AND cn.checkpoint_name = mc.checkpoint_name) AS notes_count
FROM macro_checkpoints mc
WHERE mc.project_id = $1
ORDER BY mc.phase, mc.id;
```

### 3.2 Phase Completion Logic

Same as `projects-architecture.md` §4 — applied per phase in the response builder:

```typescript
function isPhaseComplete(
  checkpoints: MacroCheckpointRow[],
  configRows: CasdmConfigRow[],
  phase: string
): boolean {
  const mandatoryGates = configRows.filter(
    c => c.phase === phase && c.config_type === 'macro_checkpoint' && c.is_mandatory && c.is_active
  );
  if (mandatoryGates.length === 0) return true; // no mandatory gates → phase complete
  return mandatoryGates.every(gate =>
    checkpoints.some(cp => cp.checkpoint_name === gate.item_name && cp.reached_at !== null)
  );
}
```

---

## 4. Checkpoint Completion State Machine

Each `checkpoint_type` has distinct completion rules:

### 4.1 `human_review`

**Trigger:** SA/Tech Lead clicks "Mark Reviewed".
**Allowed roles:** `pm`, `sa`, `leadership`, `admin`
**Fields set:** `reviewed_by = auth.email`, `reached_at = now()`
**Optional enrichment:** `result_detail` (can be set at completion or later)

```
[pending] ──[PATCH {reviewed_by}]──► [completed]
                                       ├── reviewed_by = auth.email
                                       ├── reached_at = now()
                                       └── result_detail (optional)
```

**Cannot un-set:** Once `reviewed_by` is set, it is permanent. Re-patching with a different `reviewed_by` returns `400 CHECKPOINT_ALREADY_COMPLETE`.

---

### 4.2 `meeting`

**Trigger:** PM confirms meeting occurred.
**Allowed roles:** `pm`, `leadership`, `admin`
**Fields set:** `occurred = true`, `reached_at = now()`, optionally `meeting_date`, `meeting_link`, `result_detail`

```
[pending] ──[PATCH {occurred: true}]──► [completed]
                                          ├── occurred = true
                                          ├── reached_at = now()
                                          ├── meeting_date (optional, user-provided)
                                          ├── meeting_link (optional, Avoma URL)
                                          └── result_detail (optional)
```

**Enrichment after completion:** `meeting_date` and `result_detail` can be updated after initial completion (re-PATCH allowed for these fields only). `occurred` cannot be un-set.

---

### 4.3 `transcript_analysis`

**Trigger:** Analysis domain writes result after AI processing.
**Allowed roles for read:** All. **Trigger initiation:** `pm` (clicks "Analyze").
**Fields set (by analysis domain):** `analysis_result` (JSONB), `analysis_run_at`, `reached_at = now()`, `result_detail` (human-readable summary)

```
[pending] ──[meeting_link evidence required]──► [ready_for_analysis]
              ──[analysis domain writes result]──► [completed]
                                                     ├── analysis_result = {JSON}
                                                     ├── analysis_run_at = now()
                                                     ├── reached_at = now()
                                                     └── result_detail = summary text
```

**Pre-condition:** At least one `gate_evidence` row with `evidence_type = 'meeting_link'` must exist for this checkpoint before analysis can run. The `PATCH` endpoint returns `400 VALIDATION_ERROR` with message "Meeting link evidence required before analysis" if this pre-condition is not met.

**Note:** The `analysis` domain (deferred to Iteration 3) writes directly to `macro_checkpoints` to set `analysis_result`, `analysis_run_at`, and `reached_at`. The `gates` domain only reads these fields.

---

### 4.4 `checklist`

**Trigger:** Auto-completed when all child `onboarding_checklist_items` (or closure items) are complete.
**Allowed roles:** None directly — completion is computed.
**Fields set (automatically):** `reached_at = now()` when all children complete.

```
[pending] ──[all child items completed]──► [completed]
                                             └── reached_at = now()

[completed] ──[any child item unchecked]──► [pending]
                                              └── reached_at = NULL
```

**Not directly settable via PATCH.** If a user attempts to PATCH a `checklist` checkpoint, return `400 VALIDATION_ERROR` with message "Checklist checkpoints are auto-completed when all child items are done."

**Implementation:** The `projects` domain's `update-checklist-item` handler calls a shared function to evaluate checklist checkpoint completion after each toggle:

```typescript
// Called by projects domain after checklist item toggle
async function evaluateChecklistCompletion(tx: PoolClient, projectId: string): Promise<void> {
  const allComplete = await tx.query(
    `SELECT COUNT(*) = 0 AS all_done
     FROM onboarding_checklist_items
     WHERE project_id = $1 AND completed = false`,
    [projectId]
  );

  if (allComplete.rows[0].all_done) {
    await tx.query(
      `UPDATE macro_checkpoints SET reached_at = now()
       WHERE project_id = $1 AND checkpoint_type = 'checklist'
         AND checkpoint_name = 'Onboarding Checklist' AND reached_at IS NULL`,
      [projectId]
    );
  } else {
    await tx.query(
      `UPDATE macro_checkpoints SET reached_at = NULL
       WHERE project_id = $1 AND checkpoint_type = 'checklist'
         AND checkpoint_name = 'Onboarding Checklist' AND reached_at IS NOT NULL`,
      [projectId]
    );
  }
}
```

---

## 5. Phase 1 Governance Events Integration

**Source:** FR-P2-011, SRS §8.4

The Phase 1 MCP server writes `governance_events` to the same RDS instance. This domain reads those rows to surface them in the project timeline and to auto-complete matching checkpoints.

### 5.1 Join Condition

```sql
governance_events.project_id = projects.jira_key
```

The Phase 1 MCP server uses the Jira key (e.g., `rainn`, `CST-674`) as `project_id`. The join is exact-match on `projects.jira_key`.

### 5.2 Gate Name Matching

Phase 1 `governance_events.gate` field uses canonical gate names from the kiro-governance shared constants (e.g., `'SRS approved'`, `'Design docs approved'`). These must be matched to `macro_checkpoints.checkpoint_name`.

**Matching strategy:** Case-insensitive, trimmed exact match against the canonical names:

```typescript
const GATE_TO_CHECKPOINT: Record<string, string> = {
  'discovery outputs validated': '5 outputs reviewed by SA',
  'preliminary srs validated': 'Working SRS reviewed by SA',
  'srs approved': 'Working SRS reviewed by SA',
  'design docs approved': 'Technically validate 6 design docs with spec strategy by SA',
  'implementation plan approved': 'Implementation Plan Review (Transcript Analysis)',
  'spec strategy approved': 'Review 3 generated outputs by Tech Lead',
  'code approved': 'Validate performance, security, compliance by Tech Lead',
  'uat report approved': 'UAT Review with Client (SA Support)',
  'runbooks approved': 'Validate customer documentation by Tech Lead',
  'project documentation approved': 'Validate customer documentation by Tech Lead',
};
```

### 5.3 Auto-Completion from Governance Events

When loading the gate view, if a `governance_events` row matches a checkpoint AND the checkpoint has no `reached_at`, auto-set completion:

```sql
-- Run during gate view assembly (read path, not a persistent write)
UPDATE macro_checkpoints mc
SET
  reached_at = ge.created_at,
  reviewed_by = ge.actor
FROM governance_events ge
WHERE ge.project_id = mc.project_id
  AND ge.type = 'macro'
  AND mc.reached_at IS NULL
  AND LOWER(TRIM(ge.gate)) = ANY($1::text[])  -- array of mapped gate names
  AND mc.checkpoint_name = $2                   -- resolved checkpoint_name from mapping
  AND mc.project_id = $3;
```

**Alternative (lazy auto-complete on read):** To avoid mutating data on a GET request, the auto-completion can run as a background reconciliation job or be triggered on the first GET after a new governance event arrives. For MVP, we use a **write-through on first read** approach:

```typescript
async function reconcileGovernanceEvents(projectId: string): Promise<void> {
  const events = await pool.query(
    `SELECT ge.gate, ge.actor, ge.created_at
     FROM governance_events ge
     WHERE ge.project_id = $1 AND ge.type = 'macro'
     ORDER BY ge.created_at ASC`,
    [projectId]
  );

  for (const event of events.rows) {
    const checkpointName = GATE_TO_CHECKPOINT[event.gate.toLowerCase().trim()];
    if (!checkpointName) continue;

    // Use earliest matching event — skip if checkpoint already reached
    await pool.query(
      `UPDATE macro_checkpoints
       SET reached_at = $1, reviewed_by = $2
       WHERE project_id = $3 AND checkpoint_name = $4 AND reached_at IS NULL`,
      [event.created_at, event.actor, projectId, checkpointName]
    );
  }
}
```

### 5.4 Timeline Interleaving SQL

```sql
WITH timeline_events AS (
  -- Source 1: governance_events from Phase 1 MCP
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
  WHERE ge.project_id = $1

  UNION ALL

  -- Source 2: macro checkpoint completions
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

  -- Source 3: evidence attachments
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
ORDER BY timestamp DESC
LIMIT $2
OFFSET 0;
```

For keyset pagination (cursor-based):

```sql
-- Replace LIMIT/OFFSET with:
WHERE timestamp IS NOT NULL
  AND ($3::timestamptz IS NULL OR timestamp < $3)
ORDER BY timestamp DESC
LIMIT $2;
```

Where `$3` is the `cursor` parameter (ISO timestamp of the last event from the previous page).

### 5.5 Orphan Governance Events

If `governance_events.project_id` does not match any `projects.jira_key`, those events are silently excluded from the timeline (the JOIN naturally filters them). No error is raised.

### 5.6 Multiple Events Matching Same Checkpoint

When multiple `governance_events` rows match the same checkpoint:
- **Auto-completion uses the earliest** (`ORDER BY created_at ASC`, first match wins due to `AND reached_at IS NULL`)
- **Timeline shows all matching events** (they are distinct timeline entries regardless of auto-completion)

---

## 6. Evidence Attachment

### 6.1 Evidence Types

| Type | Stored In | Written By | Notes |
|------|-----------|-----------|-------|
| `meeting_link` | `gate_evidence.value` + `macro_checkpoints.meeting_link` | `gates` domain | Avoma URL; also updates checkpoint |
| `url` | `gate_evidence.value` | `gates` domain | Generic external URL |
| `file_upload` | `gate_evidence.value` (S3 key) | `gates` domain (after client uploads via `files` domain presigned URL) | S3 key stored post-upload |
| `ai_analysis` | `gate_evidence.value` (JSON string) + `macro_checkpoints.analysis_result` | `analysis` domain | Written by analysis domain on completion |

### 6.2 Flow: Meeting Link Attachment

```
User pastes Avoma URL
  → POST /checkpoints/{id}/evidence { evidence_type: 'meeting_link', value: 'https://app.avoma.com/...' }
  → INSERT into gate_evidence
  → UPDATE macro_checkpoints SET meeting_link = value WHERE id = checkpointId
  → Return 201 with EvidenceItem
```

### 6.3 Flow: File Upload

```
User clicks "Upload File"
  → Frontend calls files domain: POST /api/files/presigned-url { project_id, phase, checkpoint_name, filename }
  → Files domain returns { upload_url, s3_key }
  → Frontend uploads file directly to S3 via presigned PUT URL
  → Frontend calls gates domain: POST /checkpoints/{id}/evidence { evidence_type: 'file_upload', value: s3_key, label: filename }
  → INSERT into gate_evidence
  → Return 201 with EvidenceItem
```

### 6.4 Flow: AI Analysis Result

```
Analysis domain completes transcript analysis
  → Analysis domain writes to macro_checkpoints: analysis_result, analysis_run_at, reached_at, result_detail
  → Analysis domain writes to gate_evidence: { evidence_type: 'ai_analysis', value: JSON.stringify(result) }
  → Gates domain reads these on next GET
```

### 6.5 Link Metadata (FR-P2-031)

When `evidence_type` is `'meeting_link'` or `'url'`, the optional `link_metadata` field stores best-effort extracted metadata. This is populated by the frontend or an async Lambda (architecture TBD in Iteration 3). The `gate_evidence.link_metadata` JSONB column stores it:

```json
{ "title": "Weekly Standup — Project CST-674", "date": "2026-06-28", "duration_minutes": 45 }
```

---

## 7. TypeScript Interfaces

```typescript
// packages/shared/types/gates.ts

export interface GateStatusResponse {
  project_id: string;
  phases: PhaseGateView[];
}

export interface PhaseGateView {
  phase: string;
  phase_name: string;
  micro_artifacts: MicroArtifactDetail[];
  macro_checkpoints: MacroCheckpointDetail[];
  phase_complete: boolean;
}

export interface MacroCheckpointDetail {
  id: number;
  checkpoint_name: string;
  checkpoint_type: 'human_review' | 'meeting' | 'transcript_analysis' | 'checklist';
  occurred: boolean | null;
  meeting_date: string | null;
  meeting_link: string | null;
  result_detail: string | null;
  reviewed_by: string | null;
  reached_at: string | null;
  analysis_result: Record<string, unknown> | null;
  analysis_run_at: string | null;
  evidence_count: number;
  notes_count: number;
}

export interface MicroArtifactDetail {
  id: number;
  artifact_name: string;
  phase: string;
  phase_name: string;
  status: 'pending' | 'in_progress' | 'complete';
  completed_at: string | null;
  completed_by: string | null;
}

export interface EvidenceItem {
  id: number;
  project_id: string;
  checkpoint_name: string;
  evidence_type: 'meeting_link' | 'url' | 'file_upload' | 'ai_analysis';
  label: string | null;
  value: string;
  link_metadata: { title?: string; date?: string; duration_minutes?: number | null } | null;
  uploaded_by: string;
  created_at: string;
}

export interface GateNote {
  id: number;
  project_id: string;
  checkpoint_name: string;
  note_text: string;
  author: string;
  created_at: string;
}

export interface TimelineEvent {
  id: string;
  event_type: 'governance_event' | 'checkpoint_completed' | 'evidence_attached';
  timestamp: string;
  phase: string | null;
  title: string;
  actor: string | null;
  detail: string | null;
  source: 'kiro_mcp' | 'deliverpro';
}

export interface TimelineResponse {
  events: TimelineEvent[];
  next_cursor: string | null;
}

export interface UpdateCheckpointInput {
  occurred?: boolean;
  meeting_date?: string;
  meeting_link?: string;
  reviewed_by?: string;
  result_detail?: string;
}

export interface UpdateArtifactInput {
  status: 'pending' | 'in_progress' | 'complete';
}

export interface AttachEvidenceInput {
  evidence_type: 'meeting_link' | 'url' | 'file_upload' | 'ai_analysis';
  label?: string;
  value: string;
  link_metadata?: { title?: string; date?: string; duration_minutes?: number | null };
}

export interface AddNoteInput {
  note_text: string;
}

export interface ListEvidenceResponse {
  evidence: EvidenceItem[];
  total_count: number;
}

export interface ListNotesResponse {
  notes: GateNote[];
  total_count: number;
}
```

---

## 8. Edge Cases

| Scenario | Handling | Source |
|----------|----------|--------|
| Checkpoint already completed — re-patching | Only `meeting_date` and `result_detail` are allowed on re-PATCH (enrichment). Attempting to change `occurred`, `reviewed_by`, or clear `reached_at` returns `400 CHECKPOINT_ALREADY_COMPLETE`. | FR-P2-008: "A checkpoint cannot be un-completed once marked (append-only audit trail)" |
| `governance_events` match for project not in `projects` table | Silently skipped — the JOIN excludes orphan events. No error raised. | Architect decision |
| Multiple `governance_events` matching same checkpoint | Use the **earliest** event (lowest `created_at`) for auto-completion. All events still appear in the timeline. | Architect decision |
| Checklist checkpoint auto-completion race condition | Wrap the checklist item update + checkpoint evaluation in a single DB transaction with `FOR UPDATE` on the checklist items row. | FR-P2-019 + architect decision |
| `transcript_analysis` checkpoint PATCH without meeting_link evidence | Return `400 VALIDATION_ERROR`: "Meeting link evidence required before analysis can run." | FR-P2-005 pre-condition |
| PATCH on `checklist` type checkpoint | Return `400 VALIDATION_ERROR`: "Checklist checkpoints are auto-completed when all child items are done." | FR-P2-008 |
| Evidence attached to non-existent checkpoint | Return `404 CHECKPOINT_NOT_FOUND`. Foreign key integrity ensures `checkpoint_name` matches. | Architect decision |
| Note exceeds 4000 characters | Return `400 VALIDATION_ERROR` with field `note_text` and message "Note exceeds 4000 character limit". | FR-P2-017 |
| Timeline for project with no events | Return `{ events: [], next_cursor: null }`. | Architect decision |
| Micro artifact status downgrade (complete → in_progress) | Allowed — clears `completed_at` and `completed_by`. Status is mutable. | FR-P2-007: "Users with PM or SA role can manually override status with a note" |
| Concurrent checkpoint completion (two users PATCH same checkpoint simultaneously) | First write wins. Second PATCH finds `reached_at IS NOT NULL` and returns `400 CHECKPOINT_ALREADY_COMPLETE`. | Architect decision — row-level WHERE clause acts as optimistic lock |

---

## 9. Cost Estimate

### 9.1 Lambda Invocations

| Endpoint | Est. Monthly Invocations | Rationale |
|----------|------------------------|-----------|
| `GET /gates` | ~6,000 | ~50 users × 4 project detail views/day × 30 days |
| `PATCH /checkpoints/{id}` | ~300 | ~10 checkpoints completed per project × 30 active projects/month |
| `POST /evidence` | ~200 | ~2 evidence items per checkpoint completion |
| `GET /evidence` | ~1,000 | Viewed alongside checkpoint detail |
| `PATCH /artifacts/{id}` | ~500 | Status updates from Kiro + manual overrides |
| `POST /notes` | ~150 | ~5 notes per project/month across 30 projects |
| `GET /notes` | ~600 | Viewed with checkpoint |
| `GET /timeline` | ~3,000 | PM/leadership daily timeline check |
| **Total** | **~11,750** | |

### 9.2 Lambda Cost

11,750 invocations × 256 MB × ~300ms avg = ~903 GB-seconds/month

- Compute: 903 GB-s × $0.0000166667 = **$0.015/mo**
- Requests: 11,750 × $0.20/1M = **$0.002/mo**
- **Total Lambda: ~$0.02/mo** (within free tier)

### 9.3 RDS Query Complexity

| Query | Avg Duration | Notes |
|-------|-------------|-------|
| Gate view (2 queries: artifacts + checkpoints with subquery counts) | ~30ms | Index on `(project_id, phase)` keeps both fast |
| Timeline UNION ALL (3 sources) | ~50ms | Each source is indexed by `project_id`; sorts ~100 rows max |
| Reconcile governance events | ~20ms | Runs once per project view if stale; UPDATE with WHERE filter |
| Checkpoint PATCH (single row update) | ~5ms | PK-based update |

**Index coverage:**
- `idx_macro_checkpoints_project_phase` → gate view + timeline source 2
- `idx_micro_artifacts_project_phase` → gate view micro query
- `idx_gate_evidence_project` → evidence list + timeline source 3
- `idx_checkpoint_notes_project` → notes list
- `governance_events` has `idx_governance_project` (from V001) → timeline source 1

**RDS impact:** Negligible on the existing db.t4g.medium instance. Timeline query is the most complex (3-way UNION + sort) but operates on small per-project datasets (~50-200 rows total).

### 9.4 Total Gates Domain Cost

| Component | Monthly |
|-----------|---------|
| Lambda | $0.02 |
| RDS (incremental) | $0.00 (shared existing instance) |
| **Total** | **~$0.02/mo** |

---

*End of Gates Architecture v1.0*
