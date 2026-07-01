# Projects Domain

Manages project lifecycle: creation, metadata management, CASDM phase progression, onboarding checklists, resource budget tracking, Jira CST import, and project closure workflows.

## API Endpoints

| Method | Path | Handler | Roles |
|--------|------|---------|-------|
| GET | `/api/projects` | `list-projects.ts` | pm, sa, engineer, leadership, admin |
| GET | `/api/projects/{projectId}` | `get-project.ts` | pm, sa, engineer, leadership, admin |
| POST | `/api/projects` | `create-project.ts` | pm, leadership, admin |
| PATCH | `/api/projects/{projectId}` | `update-project.ts` | pm, leadership, admin |
| PATCH | `/api/projects/{projectId}/hours` | `update-hours.ts` | pm, leadership, admin |
| POST | `/api/projects/import-jira` | `import-jira.ts` | admin |
| GET | `/api/projects/{projectId}/checklist` | `list-checklist.ts` | pm, sa, engineer, leadership, admin |
| PATCH | `/api/projects/{projectId}/checklist/{itemId}` | `update-checklist-item.ts` | pm, sa, leadership, admin |

## Database Tables

| Table | Purpose | Keys |
|-------|---------|------|
| `projects` | Core project metadata | `jira_key` (PK), unique constraint on key |
| `onboarding_checklist_items` | 9 onboarding items per project | `project_id` FK to projects |
| `macro_checkpoints` | CASDM phase gates (owned by gates domain) | `project_id` FK to projects |
| `micro_artifacts` | Phase deliverables (owned by gates domain) | `project_id` FK to projects |
| `casdm_config` | Template configuration | project_type, phase, item_name |

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | PostgreSQL connection | `postgresql://user:pass@host:5432/db` |
| `AWS_REGION` | AWS region for SSM/Secrets Manager | `us-east-1` |

## Features

### Project CRUD
- Create new projects with auto-generated keys (DP-001, DP-002, ...)
- Fetch project details with computed current_phase
- Update project metadata (immutable project_type)
- List projects with filters and cursor pagination

### CASDM Template Seeding
- On creation, seed micro_artifacts and macro_checkpoints from casdm_config
- Support multiple project_type templates (AppDev, App Mod/Migration, etc)
- Fallback to 'default' template if project_type not configured

### Onboarding Checklist
- 9 hardcoded items seeded on project creation
- Mark items complete/incomplete
- Auto-complete macro checkpoint when all 9 items checked
- Auto-clear checkpoint when any item is unchecked

### Hours Tracking
- Update hours_consumed (resource budget tracking)
- Compute burn_rate_pct = (hours_consumed / sow_hours) * 100
- Support null sow_hours (returns null burn_rate_pct)

### Jira CST Import
- One-time admin-only import from Jira board
- Guard via SSM Parameter to prevent re-execution
- Field mapping: Jira customfields → projects columns
- ON CONFLICT DO NOTHING for duplicates
- Returns import summary with error list

### Phase Progression
- `current_phase` computed at query time (not stored)
- Based on which CASDM macro checkpoints have reached_at set
- Phases: Phase 0, Phase 1, Phase 2, Phase 3, Phase 4

## Testing

All handlers tested via integration tests using mocked database and AWS services.

```bash
npm test -w packages/projects
```

## See Also

- [projects-architecture.md](../../docs/phase2/projects-architecture.md) — Full spec
- [types.ts](./types.ts) — TypeScript interfaces
- [migrations/V003__phase2_additions.sql](../../migrations/V003__phase2_additions.sql) — Schema
