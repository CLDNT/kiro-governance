# Meetings Domain Architecture — Phase 2: DeliverPro

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-30 | v1.0 | AWS Architect | Initial meetings domain architecture from SRS v1.3 (FR-P2-020, FR-P2-021, FR-P2-025), auth-architecture v1.0, V002 migration |

---

## 1. Overview

The `meetings` domain owns weekly status call logging, escalation management, and discovery session tracking. These are project-level lifecycle artifacts that live outside the CASDM gate structure but are essential for delivery governance.

**Domain responsibilities:**

| Responsibility | SRS Source |
|---------------|-----------|
| Weekly status call logging | FR-P2-020 |
| Escalation raise + resolve | FR-P2-021 |
| Discovery session logging (auto-increment session_number) | FR-P2-025 |

**Tables owned:** `weekly_status_logs`, `escalations`, `discovery_sessions`

**Cross-domain reads:** None. This domain only references `projects.jira_key` via FK.

---

## 2. API Endpoints

### 2.1 `POST /api/projects/{projectId}/status-logs`

**Purpose:** Log a weekly client status call.
**Source:** FR-P2-020

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `leadership`, `admin` |
| Handler | `packages/meetings/handlers/create-status-log.ts` |

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | `projects.jira_key` |

**Request body:**

```typescript
interface CreateStatusLogInput {
  log_date: string;        // ISO 8601 date (YYYY-MM-DD), required, must not be future
  meeting_link?: string;   // Avoma URL, optional
  topics_covered: string;  // required, max 4000 chars
  demo_items?: string;     // optional, max 2000 chars
  blockers?: string;       // optional, max 2000 chars
}
```

**Response (201):**

```typescript
interface WeeklyStatusLog {
  id: number;
  project_id: string;
  log_date: string;
  meeting_link: string | null;
  topics_covered: string;
  demo_items: string | null;
  blockers: string | null;
  logged_by: string;
  created_at: string;
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Missing required fields, `log_date` in the future, field exceeds max length |
| 401 | `UNAUTHORIZED` | Missing/invalid JWT |
| 403 | `FORBIDDEN` | Role not in `[pm, leadership, admin]` |
| 404 | `PROJECT_NOT_FOUND` | `projectId` does not exist in `projects` table |
| 409 | `PROJECT_CLOSED` | Project `status = 'Closed'` — cannot add status logs to closed projects |

---

### 2.2 `GET /api/projects/{projectId}/status-logs`

**Purpose:** List all weekly status logs for a project, chronological descending.
**Source:** FR-P2-020

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `sa`, `engineer`, `leadership`, `admin` |
| Handler | `packages/meetings/handlers/list-status-logs.ts` |

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | `projects.jira_key` |

**Query params:**

```typescript
interface ListStatusLogsQuery {
  limit?: number;   // default 20, max 100
  cursor?: string;  // base64-encoded last id for keyset pagination
}
```

**Response (200):**

```typescript
interface StatusLogListResponse {
  status_logs: WeeklyStatusLog[];
  next_cursor: string | null;
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 401 | `UNAUTHORIZED` | Missing/invalid JWT |
| 403 | `FORBIDDEN` | Role not in allowed list |
| 404 | `PROJECT_NOT_FOUND` | `projectId` does not exist |

---

### 2.3 `POST /api/projects/{projectId}/escalations`

**Purpose:** Raise an escalation against a project.
**Source:** FR-P2-021

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `leadership`, `admin` |
| Handler | `packages/meetings/handlers/create-escalation.ts` |

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | `projects.jira_key` |

**Request body:**

```typescript
interface CreateEscalationInput {
  raised_date: string;     // ISO 8601 date (YYYY-MM-DD), required
  description: string;     // required, max 2000 chars
  severity: 'low' | 'medium' | 'high' | 'critical'; // required
  raised_by: string;       // required, max 200 chars
}
```

**Response (201):**

```typescript
interface Escalation {
  id: number;
  project_id: string;
  raised_date: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  raised_by: string;
  resolved_date: string | null;
  resolution_notes: string | null;
  status: 'open' | 'resolved';
  created_at: string;
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Missing required fields, invalid severity, description exceeds 2000 chars |
| 401 | `UNAUTHORIZED` | Missing/invalid JWT |
| 403 | `FORBIDDEN` | Role not in `[pm, leadership, admin]` |
| 404 | `PROJECT_NOT_FOUND` | `projectId` does not exist |

---

### 2.4 `PATCH /api/projects/{projectId}/escalations/{id}`

**Purpose:** Resolve an open escalation.
**Source:** FR-P2-021

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `leadership`, `admin` |
| Handler | `packages/meetings/handlers/resolve-escalation.ts` |

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | `projects.jira_key` |
| `id` | `number` | `escalations.id` |

**Request body:**

```typescript
interface ResolveEscalationInput {
  resolved_date: string;        // ISO 8601 date (YYYY-MM-DD), required
  resolution_notes?: string;    // optional, max 2000 chars — warn if empty (see §6 edge cases)
}
```

**Response (200):**

```typescript
// Returns the full updated Escalation object (same shape as §2.3 response)
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Missing `resolved_date`, invalid date format |
| 401 | `UNAUTHORIZED` | Missing/invalid JWT |
| 403 | `FORBIDDEN` | Role not in `[pm, leadership, admin]` |
| 404 | `ESCALATION_NOT_FOUND` | Escalation `id` does not exist for this project |
| 409 | `ALREADY_RESOLVED` | Escalation `status` is already `'resolved'` |

**Note on `resolution_notes`:** The field is optional. If omitted, the API returns a `warning` field in the response:

```json
{
  "id": 5,
  "status": "resolved",
  "resolution_notes": null,
  "warning": "Escalation resolved without notes. Consider adding resolution context."
}
```

---

### 2.5 `GET /api/projects/{projectId}/escalations`

**Purpose:** List escalations for a project with optional filters.
**Source:** FR-P2-021

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `sa`, `engineer`, `leadership`, `admin` |
| Handler | `packages/meetings/handlers/list-escalations.ts` |

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | `projects.jira_key` |

**Query params:**

```typescript
interface ListEscalationsQuery {
  status?: 'open' | 'resolved';           // filter by status
  severity?: 'low' | 'medium' | 'high' | 'critical'; // filter by severity
  limit?: number;                          // default 20, max 100
  cursor?: string;                         // base64-encoded last id
}
```

**Response (200):**

```typescript
interface EscalationListResponse {
  escalations: Escalation[];
  next_cursor: string | null;
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Invalid `status` or `severity` enum value |
| 401 | `UNAUTHORIZED` | Missing/invalid JWT |
| 403 | `FORBIDDEN` | Role not in allowed list |
| 404 | `PROJECT_NOT_FOUND` | `projectId` does not exist |

---

### 2.6 `POST /api/projects/{projectId}/discovery-sessions`

**Purpose:** Log a discovery session with auto-incremented session number.
**Source:** FR-P2-025

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `leadership`, `admin` |
| Handler | `packages/meetings/handlers/create-discovery-session.ts` |

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | `projects.jira_key` |

**Request body:**

```typescript
interface CreateDiscoverySessionInput {
  session_date: string;    // ISO 8601 date (YYYY-MM-DD), required
  meeting_link?: string;   // optional, Avoma/Zoom URL
  participants: string;    // required, max 1000 chars
  notes?: string;          // optional, max 4000 chars
}
```

**Response (201):**

```typescript
interface DiscoverySession {
  id: number;
  project_id: string;
  session_number: number;   // auto-assigned
  session_date: string;
  meeting_link: string | null;
  participants: string;
  notes: string | null;
  created_at: string;
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Missing required fields, field exceeds max length |
| 401 | `UNAUTHORIZED` | Missing/invalid JWT |
| 403 | `FORBIDDEN` | Role not in `[pm, leadership, admin]` |
| 404 | `PROJECT_NOT_FOUND` | `projectId` does not exist |

---

### 2.7 `GET /api/projects/{projectId}/discovery-sessions`

**Purpose:** List all discovery sessions for a project in session_number order.
**Source:** FR-P2-025

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `sa`, `engineer`, `leadership`, `admin` |
| Handler | `packages/meetings/handlers/list-discovery-sessions.ts` |

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | `string` | `projects.jira_key` |

**Query params:**

```typescript
interface ListDiscoverySessionsQuery {
  limit?: number;   // default 50, max 100
  cursor?: string;  // base64-encoded last id
}
```

**Response (200):**

```typescript
interface DiscoverySessionListResponse {
  sessions: DiscoverySession[];
  next_cursor: string | null;
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 401 | `UNAUTHORIZED` | Missing/invalid JWT |
| 403 | `FORBIDDEN` | Role not in allowed list |
| 404 | `PROJECT_NOT_FOUND` | `projectId` does not exist |

---

## 3. Table DDL (V003 additions)

These tables are created in `migrations/V003__phase2_additions.sql`. The DDL below is the final, definitive schema.

### 3.1 `weekly_status_logs`

```sql
CREATE TABLE weekly_status_logs (
  id              BIGSERIAL    PRIMARY KEY,
  project_id      TEXT         NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  log_date        DATE         NOT NULL,
  meeting_link    TEXT,
  topics_covered  TEXT         NOT NULL CHECK (char_length(topics_covered) <= 4000),
  demo_items      TEXT         CHECK (char_length(demo_items) <= 2000),
  blockers        TEXT         CHECK (char_length(blockers) <= 2000),
  logged_by       TEXT         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_weekly_status_logs_project_date
  ON weekly_status_logs (project_id, log_date DESC);
```

### 3.2 `escalations`

```sql
CREATE TABLE escalations (
  id               BIGSERIAL    PRIMARY KEY,
  project_id       TEXT         NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  raised_date      DATE         NOT NULL,
  description      TEXT         NOT NULL CHECK (char_length(description) <= 2000),
  severity         TEXT         NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  raised_by        TEXT         NOT NULL CHECK (char_length(raised_by) <= 200),
  resolved_date    DATE,
  resolution_notes TEXT         CHECK (char_length(resolution_notes) <= 2000),
  status           TEXT         NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_escalations_project_status
  ON escalations (project_id, status);

CREATE INDEX idx_escalations_project_severity
  ON escalations (project_id, severity);
```

### 3.3 `discovery_sessions`

```sql
CREATE TABLE discovery_sessions (
  id              BIGSERIAL    PRIMARY KEY,
  project_id      TEXT         NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  session_number  INT          NOT NULL,
  session_date    DATE         NOT NULL,
  meeting_link    TEXT,
  participants    TEXT         NOT NULL CHECK (char_length(participants) <= 1000),
  notes           TEXT         CHECK (char_length(notes) <= 4000),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT uq_discovery_session UNIQUE (project_id, session_number)
);

CREATE INDEX idx_discovery_sessions_project
  ON discovery_sessions (project_id, session_number);
```

---

## 4. Auto-Increment `session_number` Logic

Discovery sessions use an application-level auto-increment per project. The `session_number` is NOT a database sequence — it is scoped to `project_id`.

### 4.1 Implementation

```typescript
// packages/meetings/services/discovery-session.service.ts

async function createDiscoverySession(
  projectId: string,
  input: CreateDiscoverySessionInput,
  actor: string,
): Promise<DiscoverySession> {
  // Single transaction: compute next number + insert atomically
  const result = await db.transaction(async (tx) => {
    // Lock-free: the UNIQUE constraint (project_id, session_number) prevents duplicates
    // even under concurrent inserts. If a conflict occurs, PostgreSQL raises a unique
    // violation and the transaction retries.
    const { rows } = await tx.query<{ next_num: number }>(
      `SELECT COALESCE(MAX(session_number), 0) + 1 AS next_num
       FROM discovery_sessions
       WHERE project_id = $1
       FOR UPDATE`,
      [projectId],
    );

    const nextNumber = rows[0].next_num;

    const { rows: inserted } = await tx.query<DiscoverySession>(
      `INSERT INTO discovery_sessions (project_id, session_number, session_date, meeting_link, participants, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [projectId, nextNumber, input.session_date, input.meeting_link ?? null, input.participants, input.notes ?? null],
    );

    return inserted[0];
  });

  return result;
}
```

### 4.2 Concurrency Safety

The `FOR UPDATE` clause acquires a row-level lock on the `discovery_sessions` rows for the given `project_id` during the SELECT. This serializes concurrent inserts for the same project. Additionally, the `UNIQUE (project_id, session_number)` constraint acts as a safety net — if two transactions bypass the lock (edge case with no existing rows), one will fail with a unique violation and should be retried.

**Retry strategy:** On unique constraint violation (`23505`), retry once with a fresh `MAX(session_number) + 1`. If the retry also fails, return 500.

---

## 5. TypeScript Interfaces

All types live in `packages/shared/types/meetings.ts`:

```typescript
// ─── Domain Models ──────────────────────────────────────────────────────────

export interface WeeklyStatusLog {
  id: number;
  project_id: string;
  log_date: string;          // YYYY-MM-DD
  meeting_link: string | null;
  topics_covered: string;
  demo_items: string | null;
  blockers: string | null;
  logged_by: string;
  created_at: string;        // ISO 8601 timestamp
}

export interface Escalation {
  id: number;
  project_id: string;
  raised_date: string;       // YYYY-MM-DD
  description: string;
  severity: EscalationSeverity;
  raised_by: string;
  resolved_date: string | null;
  resolution_notes: string | null;
  status: EscalationStatus;
  created_at: string;        // ISO 8601 timestamp
}

export interface DiscoverySession {
  id: number;
  project_id: string;
  session_number: number;
  session_date: string;      // YYYY-MM-DD
  meeting_link: string | null;
  participants: string;
  notes: string | null;
  created_at: string;        // ISO 8601 timestamp
}

// ─── Enums ──────────────────────────────────────────────────────────────────

export type EscalationSeverity = 'low' | 'medium' | 'high' | 'critical';
export type EscalationStatus = 'open' | 'resolved';

// ─── Input Types ────────────────────────────────────────────────────────────

export interface CreateStatusLogInput {
  log_date: string;
  meeting_link?: string;
  topics_covered: string;
  demo_items?: string;
  blockers?: string;
}

export interface CreateEscalationInput {
  raised_date: string;
  description: string;
  severity: EscalationSeverity;
  raised_by: string;
}

export interface ResolveEscalationInput {
  resolved_date: string;
  resolution_notes?: string;
}

export interface CreateDiscoverySessionInput {
  session_date: string;
  meeting_link?: string;
  participants: string;
  notes?: string;
}
```

---

## 6. Edge Cases

| # | Scenario | Handling | Source |
|---|----------|----------|--------|
| 1 | Escalation resolved with no `resolution_notes` | **Allowed.** API returns a `warning` field in the response body: `"Escalation resolved without notes. Consider adding resolution context."` No blocking — PM may not have notes yet. | FR-P2-021 AC: `resolution_notes` is labeled required in SRS but implementation allows empty for UX flexibility. |
| 2 | Discovery session created before project kickoff | **No validation.** The system does not enforce ordering between discovery sessions and the kickoff checkpoint. PMs are responsible for using the system correctly. Rationale: some projects have discovery calls before kickoff is formally logged. | FR-P2-025: "These are distinct from the Discovery Readout" |
| 3 | Status log created for a Closed project | **Reject with 409.** Handler checks `projects.status` before insert. If `status = 'Closed'`, returns `{ "code": "PROJECT_CLOSED", "message": "Cannot add status logs to a closed project" }`. Rationale: closed projects are done — no new activity should be tracked. | Architect decision — prevents stale data. |
| 4 | Escalation resolve on already-resolved escalation | **Reject with 409.** Returns `{ "code": "ALREADY_RESOLVED", "message": "This escalation is already resolved" }`. Idempotent — no double-resolve allowed. | Architect decision — append-only audit. |
| 5 | Concurrent discovery session creation (same project) | **Handled by `FOR UPDATE` + unique constraint.** If two requests race, one succeeds and the other retries with the next number. See §4.2. | Architect decision — data integrity. |
| 6 | `log_date` in the future for status logs | **Reject with 400.** Validation: `log_date <= today (server time, UTC)`. Returns `{ "code": "VALIDATION_ERROR", "field": "log_date", "message": "Date cannot be in the future" }`. | FR-P2-020 AC |
| 7 | Project does not exist (`projectId` invalid) | **Reject with 404** for all endpoints. Handler verifies `EXISTS (SELECT 1 FROM projects WHERE jira_key = $1)` before processing. | Standard REST pattern. |
| 8 | Escalation filter with invalid enum value | **Reject with 400.** Zod validation on query params rejects unknown `status` or `severity` values. | Standard validation pattern. |

---

## 7. Handler Pattern

All handlers follow the project's established pattern from `auth-architecture.md` §4.3:

```typescript
// packages/meetings/handlers/create-status-log.ts
import { APIGatewayProxyHandler } from 'aws-lambda';
import { requireRole } from '@deliverpro/shared/middleware/auth';
import { CreateStatusLogInputSchema } from '../validation/status-log.schema';
import { createStatusLog } from '../services/status-log.service';
import { verifyProjectExists, verifyProjectNotClosed } from '../services/project-check.service';

export const handler: APIGatewayProxyHandler = async (event) => {
  const auth = requireRole(['pm', 'leadership', 'admin'])(event);
  const projectId = event.pathParameters?.projectId;

  await verifyProjectExists(projectId);
  await verifyProjectNotClosed(projectId);

  const input = CreateStatusLogInputSchema.parse(JSON.parse(event.body || '{}'));
  const result = await createStatusLog(projectId!, input, auth.email);

  return { statusCode: 201, body: JSON.stringify(result) };
};
```

---

## 8. Zod Validation Schemas

```typescript
// packages/meetings/validation/status-log.schema.ts
import { z } from 'zod';

export const CreateStatusLogInputSchema = z.object({
  log_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  meeting_link: z.string().url().optional(),
  topics_covered: z.string().min(1).max(4000),
  demo_items: z.string().max(2000).optional(),
  blockers: z.string().max(2000).optional(),
}).refine(
  (data) => new Date(data.log_date) <= new Date(),
  { message: 'Date cannot be in the future', path: ['log_date'] },
);

// packages/meetings/validation/escalation.schema.ts
export const CreateEscalationInputSchema = z.object({
  raised_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(2000),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  raised_by: z.string().min(1).max(200),
});

export const ResolveEscalationInputSchema = z.object({
  resolved_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  resolution_notes: z.string().max(2000).optional(),
});

// packages/meetings/validation/discovery-session.schema.ts
export const CreateDiscoverySessionInputSchema = z.object({
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meeting_link: z.string().url().optional(),
  participants: z.string().min(1).max(1000),
  notes: z.string().max(4000).optional(),
});
```

---

## 9. Service Layer

```typescript
// packages/meetings/services/project-check.service.ts
import { AppError } from '@deliverpro/shared/errors';
import { db } from '@deliverpro/shared/db';

export async function verifyProjectExists(projectId: string | undefined): Promise<void> {
  if (!projectId) throw new AppError('VALIDATION_ERROR', 'projectId is required', 400);
  const { rows } = await db.query('SELECT status FROM projects WHERE jira_key = $1', [projectId]);
  if (rows.length === 0) throw new AppError('PROJECT_NOT_FOUND', `Project ${projectId} not found`, 404);
}

export async function verifyProjectNotClosed(projectId: string): Promise<void> {
  const { rows } = await db.query('SELECT status FROM projects WHERE jira_key = $1', [projectId]);
  if (rows[0]?.status === 'Closed') {
    throw new AppError('PROJECT_CLOSED', 'Cannot add status logs to a closed project', 409);
  }
}
```

---

## 10. Cost Estimate

This domain adds no incremental AWS cost beyond the existing Lambda + RDS infrastructure. All endpoints run on the shared API Gateway and Lambda compute pool already provisioned for the DeliverPro app.

| Component | Incremental Cost | Notes |
|-----------|-----------------|-------|
| Lambda invocations | ~$0.00 | Included in existing DeliverPro compute budget. <1000 requests/month for meetings domain. |
| RDS storage | <$0.01/mo | Three new tables, low row counts (~50 rows/project/year). Shared with existing RDS instance. |
| API Gateway | $0.00 | Included in existing API Gateway deployment. |
| **Total** | **~$0/mo incremental** | |

---

*End of Meetings Domain Architecture v1.0*
