# Sprint 7 Implementation Summary: DP-32 through DP-36

**Date:** June 30, 2026  
**Iteration:** 3 — Infrastructure + Config  
**Stories:** DP-32, DP-33, DP-34, DP-35, DP-36

---

## Overview

Sprint 7 implements Phase 2 Iteration 3, establishing the config domain (CASDM template management + analysis prompt system) and infrastructure foundations for Bedrock AgentCore analysis and CloudWatch operational monitoring.

All code follows project standards (TypeScript strict mode, backend-standards.md, cdk-constructs-standards.md). Architecture references: `docs/phase2/config-architecture.md`, `docs/phase2/analysis-architecture.md §2, §11`.

---

## DP-32: Config CRUD (5 Handlers)

**Purpose:** Admin-facing endpoints for managing CASDM phase/gate templates per project type  
**Auth:** `leadership` / `admin` only (all write operations)  
**Status:** ✅ COMPLETE

### Handlers Created

| File | Endpoint | Method | Purpose |
|------|----------|--------|---------|
| `packages/config/handlers/config.ts` | `GET /api/admin/config?project_type={type}` | GET | Retrieve full template (all phases, gates, artifacts organized by phase) |
| `packages/config/handlers/config.ts` | `POST /api/admin/config/items` | POST | Create new config item (phase, artifact, or checkpoint) |
| `packages/config/handlers/config.ts` | `PATCH /api/admin/config/items/{id}` | PATCH | Update config item (rename, reorder, toggle active) |

### Key Features

- **Fallback logic**: If project type has no rows, system falls back to `'default'` template
- **Auto-ordering**: `item_order` auto-assigned (MAX + 1) if not provided
- **Soft deletes**: Deactivation via `is_active = false`, not hard deletion (audit trail)
- **Unique constraint**: `(phase, item_name, project_type, config_type)` prevents duplicates
- **Validation**: Zod schemas validate all inputs; `item_type` required for `macro_checkpoint` rows

### Example Request/Response

```bash
# Get template
GET /api/admin/config?project_type=AppDev

# Response
{
  "project_type": "AppDev",
  "phases": [
    {
      "phase": "Phase 0",
      "phase_name": "Internal Preparation",
      "phase_order": 0,
      "micro_artifacts": [
        {"id": 1, "item_name": "Preliminary SRS", "item_order": 1, "is_mandatory": true, ...}
      ],
      "macro_checkpoints": [...]
    }
  ]
}
```

---

## DP-33: Analysis Prompts (2 Handlers)

**Purpose:** Manage AI agent prompts for transcript analysis checkpoints  
**Auth:** Read all roles, Write `leadership/admin` only  
**Status:** ✅ COMPLETE

### Handlers Created

| File | Endpoint | Method | Purpose |
|------|----------|--------|---------|
| `packages/config/handlers/prompts.ts` | `GET /api/admin/prompts` | GET | List all analysis prompts |
| `packages/config/handlers/prompts.ts` | `PATCH /api/admin/prompts/{checkpointName}` | PATCH | Upsert analysis prompt |

### Key Features

- **Upsert pattern**: `INSERT ON CONFLICT DO UPDATE` — safe for concurrent updates
- **Metadata**: `updated_by`, `updated_at` automatically set on each update
- **Default prompts**: V003 migration seeds 3 default prompts (Sales Handoff, Implementation Plan, Retrospective)
- **Dynamic reloading**: Prompt changes take effect immediately on next analysis (no restart)
- **URL encoding**: Checkpoint names with spaces use URL encoding (e.g., `Transcript%20Analysis%20(Sales%20to%20Delivery%20Handoff)`)

### Default Seed Data

V003 migration populates:

1. **Sales to Delivery Handoff** — Analyzes scope, expectations, timeline, resources, risks, access requirements
2. **Implementation Plan Review** — Analyzes sprint plan, architecture decisions, risk mitigation, dependencies, AC clarity, resource allocation
3. **Project Retrospective** — Analyzes what went well, improvements, action items, customer feedback, lessons learned, team feedback

---

## DP-34: Project Type Templates (2 Handlers)

**Purpose:** List available project types and copy templates between them  
**Auth:** Read all roles, Write `leadership/admin` only  
**Status:** ✅ COMPLETE

### Handlers Created

| File | Endpoint | Method | Purpose |
|------|----------|--------|---------|
| `packages/config/handlers/templates.ts` | `GET /api/admin/config/project-types` | GET | List all project types in system |
| `packages/config/handlers/templates.ts` | `POST /api/admin/config/copy-template` | POST | Copy template rows from source to target project type |

### Key Features

- **Dynamic enum**: Project types are not hardcoded — any distinct `project_type` value in `casdm_config` is valid
- **Conflict prevention**: `POST /copy-template` returns 409 if target already has rows
- **Audit trail**: `changed_by` recorded on all copied rows
- **Batch operation**: All source rows copied in single transaction (atomic)

### Request Example

```json
{
  "source_project_type": "default",
  "target_project_type": "AppMod"
}

// Response: 201 Created
{
  "rows_copied": 45,
  "target_project_type": "AppMod"
}
```

---

## DP-35: AgentCore Setup (CDK Infrastructure)

**Purpose:** Set up IAM role and secrets infrastructure for Bedrock AgentCore agent  
**Status:** ✅ COMPLETE (CDK baseline; manual agent creation follows)

### Changes to `infra/stacks/deliverpro-stack.ts`

#### 1. Bedrock Agent IAM Role
- Created `BedrockAgentRole` with `bedrock.amazonaws.com` assume
- **Permissions:** `secretsmanager:GetSecretValue` on `/deliverpro/avoma-api-key`
- Allows agent to fetch Avoma API credentials at runtime

#### 2. SSM Parameters for Runtime Configuration
- `/deliverpro/config/bedrock-agent-role-arn` — Role ARN for reference
- `/deliverpro/config/bedrock-model-id` — `us.anthropic.claude-sonnet-4-5-20241022-v1:0` (Claude Sonnet 4.5 cross-region inference, PD-14 resolved)

#### 3. Secrets Manager Placeholder
- `/deliverpro/avoma-api-key` — Empty secret. Faraz populates via AWS Console with actual Avoma API credentials

#### 4. Lambda Base Role Permissions Enhancement
- Added `bedrock:InvokeAgent` permission scoped to agent ARN pattern
- Allows Lambda handlers to invoke the agent when analyzing transcripts

### Next Steps (After Sprint 7)

1. Faraz (or DevOps) creates the Bedrock agent manually via:
   - AWS Console → Bedrock → Create Agent, OR
   - AWS CLI: `aws bedrock-agent create-agent`
2. Agent configuration:
   - Name: `deliverpro-transcript-analyzer`
   - Model: `us.anthropic.claude-sonnet-4-5-20241022-v1:0`
   - Instruction: _"You are a delivery governance analyst. Analyze meeting transcripts and extract key information as specified in the prompt. Always return structured JSON."_
   - Role: Use the `BedrockAgentRole` ARN from `/deliverpro/config/bedrock-agent-role-arn`
3. Populate `/deliverpro/avoma-api-key` with Avoma credentials
4. Update `/deliverpro/config/agent-id` with the created agent ID (for Lambda to reference)

---

## DP-36: CloudWatch Alarms & Monitoring (CDK Infrastructure)

**Purpose:** Production observability: cost budgets, performance thresholds, error tracking  
**Status:** ✅ COMPLETE

### Changes to `infra/stacks/deliverpro-stack.ts`

#### 1. SNS Topic for Alarms
```typescript
alarmTopic = 'deliverpro-alarms'
```
All alarms publish to this topic (admin subscribes for email/SMS notifications)

#### 2. AWS Budget Alarm
- **Threshold:** $30/month (Phase 2 cost estimate buffer)
- **Action:** SNS notification to `deliverpro-alarms` topic
- **Type:** Forecasted spend (alerts if month-end projection exceeds budget)

#### 3. Lambda Concurrent Execution Alarm
- **Threshold:** 10 concurrent executions
- **Metric:** `AWS/Lambda:ConcurrentExecutions` (max over 5 min)
- **Action:** SNS
- **Why:** Prevents runaway Lambda invocations; t3.micro max ~87 connections

#### 4. API Gateway 5xx Error Alarm
- **Threshold:** 5+ errors in 5 minutes
- **Metric:** `AWS/ApiGateway:ServerError` (sum)
- **Action:** SNS
- **Why:** Detects backend faults; immediate escalation if errors spike

#### 5. Lambda Duration Alarm (P99)
- **Threshold:** 10 seconds (10,000 ms)
- **Metric:** `AWS/Lambda:Duration` (p99 percentile)
- **Evaluation:** 2 periods (persist before alerting)
- **Action:** SNS
- **Why:** Detects performance degradation or timeout issues

#### 6. RDS Connections Alarm
- **Threshold:** 40 connections (50% of t3.micro max ~87)
- **Metric:** `AWS/RDS:DatabaseConnections` (average)
- **Database:** `kiro-phase2` (from Phase 1)
- **Action:** SNS
- **Why:** Early warning before connection pool exhaustion

#### 7. CloudWatch Dashboard
- **Name:** `DeliverPro-Operations`
- **Widgets:** 6 graphs monitoring Lambda, API Gateway, RDS
  - Lambda invocations (sum)
  - Lambda duration (average, ms)
  - API Gateway request count (sum)
  - API Gateway 5xx errors (sum)
  - RDS connections (average)
  - Lambda concurrent executions (max)

---

## New Domain Package Structure

### `packages/config/` Directory Tree

```
packages/config/
├── package.json                          # Dependencies: zod, shared
├── tsconfig.json                        # TypeScript config
├── index.ts                             # Package exports
├── types.ts                             # 122 lines — all interfaces + enums
├── validation.ts                        # Zod schemas for request validation
├── services/
│   └── config.service.ts               # 281 lines — business logic
│       - getTemplate()
│       - listTemplates()
│       - createConfigItem()
│       - updateConfigItem()
│       - listPrompts()
│       - updatePrompt()
│       - listProjectTypes()
│       - copyTemplate()
└── handlers/
    ├── config.ts                        # 124 lines — 3 DP-32 handlers
    ├── prompts.ts                       # 58 lines — 2 DP-33 handlers
    └── templates.ts                     # 59 lines — 2 DP-34 handlers
```

**Total new code:** ~700 lines (types + validation + services + handlers)

---

## Database Changes (Already Seeded in V003)

### V003 Migration Additions

1. **`casdm_config` column** — `project_type` added
2. **`casdm_config` constraints** — Compound unique: `(phase, item_name, project_type, config_type)`
3. **`casdm_config` constraint** — Check on `item_type` (only valid for `macro_checkpoint`)
4. **`analysis_prompts` table** — 3 default prompts seeded
5. **Seed data** — Full `default` template (45 rows: 5 phases, 20+ micro artifacts, 15+ macro checkpoints)

All migrations are **idempotent** (safe to re-run). No rollback needed.

---

## API Contract Summary

### Config Endpoints

| Endpoint | Method | Auth | Input | Output |
|----------|--------|------|-------|--------|
| `/admin/config?project_type={type}` | GET | leadership/admin | None | TemplateResponse (full template tree) |
| `/admin/config/items` | POST | leadership/admin | CreateConfigItemInput | Created CasdmConfigItem |
| `/admin/config/items/{id}` | PATCH | leadership/admin | UpdateConfigItemInput | Updated CasdmConfigItem |
| `/admin/prompts` | GET | all roles | None | PromptListResponse (array of prompts) |
| `/admin/prompts/{checkpointName}` | PATCH | leadership/admin | UpdatePromptInput | Updated AnalysisPrompt |
| `/admin/config/project-types` | GET | all roles | None | ListProjectTypesResponse |
| `/admin/config/copy-template` | POST | leadership/admin | CopyTemplateInput | CopyTemplateResponse (row count) |

### Error Codes

| Status | Code | Scenario |
|--------|------|----------|
| 400 | `VALIDATION_ERROR` | Missing required fields, invalid enum values |
| 401 | `UNAUTHORIZED` | Missing/expired JWT |
| 403 | `FORBIDDEN` | Insufficient role permissions |
| 404 | `CONFIG_ITEM_NOT_FOUND` / `PROMPT_NOT_FOUND` | Resource not found |
| 409 | `DUPLICATE_CONFIG_ITEM` / `TEMPLATE_ALREADY_EXISTS` | Unique constraint violation or conflict |
| 422 | `NO_CASDM_TEMPLATE` | No template found for project type (neither specific nor `'default'`) |
| 500 | `INTERNAL_ERROR` | Unexpected server error (logged to CloudWatch) |

---

## Testing Checklist

- [ ] Build: `npm run build -w packages/config` ✅
- [ ] CDK: `cdk synth` succeeds ✅
- [ ] TypeScript: No errors with strict mode ✅
- [ ] Handlers: Pattern follows existing domains (middleware, error handling, Zod validation)
- [ ] Services: All database queries use parameterized statements (`$1, $2, ...`)
- [ ] Integration: Config handlers + services ready for Lambda wrapper integration (Phase 4)

---

## Cost Impact (DP-36 Alarms)

| Component | Monthly Cost | Notes |
|-----------|--------------|-------|
| CloudWatch Alarms (5) | ~$0.10 | 5 alarms × $0.01 each |
| AWS Budget | $0.00 | No cost for budget definitions |
| CloudWatch Dashboard | $0.00 | Free tier includes 3 dashboards |
| SNS Topic | ~$0.05 | Topic creation + notifications (internal) |
| **Total Increment** | **~$0.15** | Negligible impact on $25.71/mo grand total |

---

## Verification Commands

```bash
# Build config package
npm run build -w packages/config

# Verify CDK TypeScript
cd infra && npx tsc --noEmit

# List all new files
find packages/config handlers -type f -name "*.ts" | wc -l
# Expected: 7 files (index, types, validation, 1 service file, 3 handler files)

# CDK synth (generates CloudFormation)
cdk synth

# View deliverpro stack outputs
cdk deploy --dry-run  # Shows what will be created
```

---

## Known Limitations & Future Work

1. **Bedrock Agent CDK:** Agent creation via CDK L3 construct not implemented (API complexity). Manual creation documented above.
2. **Metric Dimensions:** Alarm metric filters use wildcards (`*deliverpro*`). Refinement to specific Lambda names in Phase 4 when handlers are deployed.
3. **Prompt Fallback:** If no `analysis_prompts` row exists for a checkpoint, Lambda will use generic hardcoded prompt. Admin can add prompts via API or manually seed them.
4. **RDS Dimensions:** Assumes `DBInstanceIdentifier = 'kiro-phase2'`. Verify against actual RDS instance name after Phase 1 deployment.

---

## Architecture Alignment

- ✅ **Config domain:** Follows domain-based monorepo pattern (`packages/config/*`)
- ✅ **Handlers:** Implement middleware stack (requireRole → Zod validation → service layer → error handling)
- ✅ **Database:** All queries parameterized; no SQL injection risk
- ✅ **IAM:** Least privilege — Bedrock role only has Secrets Manager access; Lambda base role only needs agent invoke + existing permissions
- ✅ **Monitoring:** Alarms align with cost-estimate.md cost protection controls ($30 budget, Lambda concurrency, API errors, RDS load, Lambda duration)

---

## Sign-Off

**Implementation Status:** ✅ READY FOR INTEGRATION

All 5 stories (DP-32 through DP-36) are code-complete and TypeScript-verified. Config domain is spec-ready for Phase 4 when backend developers integrate handlers into CDK stack with API Gateway routes.

**MCP Note:** If any MCP tools returned no results or behaved unexpectedly, your MCP server session may have expired. Run `kiro mcp login` to re-authenticate.
