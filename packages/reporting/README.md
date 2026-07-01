# Reporting Domain

Leadership dashboard views — cross-project visibility and governance tracking.

## Handlers

### GET /api/reporting/summary

Cross-project leadership summary: project distribution by phase, stalled projects, gate completion rates.

**Auth:** Leadership/Admin only (`withLeadership`)

**Query Parameters:** None

**Response (200):**
```json
{
  "total_active_projects": 42,
  "projects_by_phase": [
    { "phase": "Phase 0", "phase_name": "Internal Preparation", "count": 8 },
    { "phase": "Phase 1", "phase_name": "Discover & Align", "count": 12 },
    { "phase": "Phase 2", "phase_name": "Design & Review", "count": 15 },
    { "phase": "Phase 3", "phase_name": "Build & Implement", "count": 5 },
    { "phase": "Phase 4", "phase_name": "Launch & Enable", "count": 2 }
  ],
  "stalled_projects": [
    {
      "jira_key": "PROJ-123",
      "title": "Customer Portal Modernization",
      "project_manager": "john@company.com",
      "current_phase": "Phase 2",
      "last_activity_at": "2026-06-17T14:30:00Z",
      "days_stalled": 14
    }
  ],
  "gate_completion_rates": [
    {
      "checkpoint_name": "Discovery outputs validated",
      "total_projects": 42,
      "completed_count": 40,
      "completion_pct": 95.2
    }
  ],
  "generated_at": "2026-07-01T01:50:14Z"
}
```

**Error Codes:**
- `401 UNAUTHORIZED` — Missing/expired JWT
- `403 FORBIDDEN` — User role not in `['leadership', 'admin']`

---

### GET /api/reporting/projects/{projectId}/timeline

Per-project timeline merging governance events, checkpoints, and evidence attachments.

**Auth:** Leadership/Admin only (`withLeadership`)

**Path Parameters:**
- `projectId` (required) — JIRA project key (e.g., `PROJ-123`)

**Query Parameters:**
- `limit` (optional, default=100, max=500) — Number of events to return
- `cursor` (optional) — Pagination cursor (ISO timestamp, deferred to v2)

**Response (200):**
```json
{
  "project_id": "PROJ-123",
  "project_title": "Customer Portal Modernization",
  "current_phase": "Phase 2",
  "events": [
    {
      "event_id": "ge-12345",
      "event_type": "governance",
      "event_timestamp": "2026-06-30T10:00:00Z",
      "phase": "Phase 1",
      "title": "SRS approved",
      "actor": "product@company.com",
      "detail": "SRS v1.0 approved by aws-architect"
    },
    {
      "event_id": "mc-54321",
      "event_type": "checkpoint",
      "event_timestamp": "2026-06-25T15:30:00Z",
      "phase": "Phase 1",
      "title": "SRS approved",
      "actor": "architect@company.com",
      "detail": null
    },
    {
      "event_id": "ev-99999",
      "event_type": "evidence",
      "event_timestamp": "2026-06-20T09:15:00Z",
      "phase": null,
      "title": "SRS approved — Evidence attachment",
      "actor": "reviewer@company.com",
      "detail": "SRS_v1.0.pdf"
    }
  ],
  "next_cursor": null
}
```

**Error Codes:**
- `401 UNAUTHORIZED` — Missing/expired JWT
- `403 FORBIDDEN` — User role not in `['leadership', 'admin']`
- `404 PROJECT_NOT_FOUND` — Project with that jira_key does not exist

---

## Environment Variables

| Variable | Required | Example | Purpose |
|----------|----------|---------|---------|
| `DB_ENDPOINT` | Yes | `governance-db.123456.us-east-1.rds.amazonaws.com` | RDS cluster endpoint |
| `DB_PORT` | No (default 5432) | `5432` | PostgreSQL port |
| `DB_NAME` | Yes | `governance` | Database name |
| `DB_USER` | Yes | `iam_lambda_user` | IAM database user |
| `AWS_REGION` | Yes | `us-east-1` | AWS region for RDS Signer |

---

## IAM Permissions

Lambda execution role requires:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "rds-db:connect"
      ],
      "Resource": "arn:aws:rds:*:*:dbuser:*/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

---

## Database Tables Accessed (Read-Only)

| Table | Purpose |
|-------|---------|
| `projects` | Project metadata, status, phase |
| `macro_checkpoints` | Gate completion tracking |
| `weekly_status_logs` | Last activity detection (stalled projects) |
| `casdm_config` | Checkpoint definitions for phase computation |
| `governance_events` | Timeline: MCP governance events |
| `gate_evidence` | Timeline: evidence attachments |

**Notes:**
- Reporting domain owns NO tables
- All queries are read-only
- Uses existing views: `v_project_summary`, `v_gate_completion`, `v_timeline` (created in V003 migration)

---

## Key Features

### Stalled Project Detection

A project is flagged as **stalled** when:
- No `macro_checkpoints.reached_at` update in the last 14 days AND
- No `weekly_status_logs` entry in the last 14 days AND
- Project was created more than 14 days ago AND
- Project status is not `'Closed'`, `'On Hold'`, or `'TEMPLATE'`

Stalled projects are limited to 50 most recent (ordered by `days_stalled DESC`).

### Gate Completion Rates

Shows per-checkpoint completion percentage across all active projects:
- `total_projects` — All projects with this checkpoint seeded
- `completed_count` — Projects where `reached_at IS NOT NULL`
- `completion_pct` — (completed / total) × 100, rounded to 1 decimal

Ordered by lowest completion first (highlights bottlenecks).

### Timeline Merge Strategy

Events from three sources are merged chronologically:

| Source | Event Type | When Included |
|--------|-----------|---------------|
| `governance_events` | `governance` | All records for project |
| `macro_checkpoints` | `checkpoint` | Only where `reached_at IS NOT NULL` |
| `gate_evidence` | `evidence` | All records for project |

Results ordered by `event_timestamp DESC`, limited to 100 (customizable via query param, max 500).

---

## Testing

Unit tests for service layer: `__tests__/services/reporting.service.test.ts`

Integration tests for handlers: `__tests__/handlers/*.test.ts`

```bash
npm test -w packages/reporting
```

---

## TypeScript Types

```typescript
import type {
  ReportingSummary,
  PhaseCount,
  StalledProject,
  GateCompletionRate,
  TimelineResponse,
  TimelineEvent,
} from '@kiro-governance/reporting';
```

---

## Cost

- **Lambda:** < $0.01/month (~500 invocations/month)
- **RDS:** Negligible (read-only, existing query load)
- **Total:** < $0.01/month

---

## Related Documentation

- Architecture: `docs/phase2/reporting-architecture.md`
- OpenAPI spec: `specs/api/reporting.yaml`
- Phase computation: `docs/phase2/projects-architecture.md` §4.1
- Stalled detection: `docs/phase2/reporting-architecture.md` §3
