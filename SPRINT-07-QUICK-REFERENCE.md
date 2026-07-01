# Sprint 7 Quick Reference

## 5 Stories, 700+ Lines of Code

### DP-32: Config CRUD
**Handlers:** 3 files → GET /admin/config, POST /admin/config/items, PATCH /admin/config/items/{id}
**Purpose:** Admin template management (phases, gates, artifacts per project type)
**Key:** Fallback to 'default' template, auto-ordering, soft deletes

### DP-33: Analysis Prompts
**Handlers:** 2 files → GET /admin/prompts (all read), PATCH /admin/prompts/{name} (admin write)
**Purpose:** Manage AI agent prompts for transcript analysis checkpoints
**Key:** Upsert pattern, immediate effect, 3 default prompts seeded

### DP-34: Project Type Templates
**Handlers:** 2 files → GET /admin/config/project-types, POST /admin/config/copy-template
**Purpose:** List project types and copy templates between them
**Key:** Conflict detection (409), atomic batch copy, audit trail

### DP-35: Bedrock AgentCore Setup
**CDK:** Bedrock IAM role + Secrets Manager + SSM parameters
**Purpose:** Infrastructure for AI transcript analysis
**Key:** Manual agent creation follows; Lambda can invoke once created

### DP-36: CloudWatch Alarms
**CDK:** SNS topic + 5 alarms + dashboard (6 widgets)
**Purpose:** Production observability and cost protection
**Key:** Budget ($30/mo), Lambda (10 concurrent), API (5 5xx/5m), RDS (40 conn), Lambda p99 (10s)

---

## File Locations

```
packages/config/
├── handlers/config.ts        (124 lines) — DP-32
├── handlers/prompts.ts       (58 lines)  — DP-33
├── handlers/templates.ts     (59 lines)  — DP-34
├── services/config.service.ts (281 lines)
├── types.ts                  (122 lines)
├── validation.ts             (33 lines)
└── [package.json, tsconfig.json, index.ts]

infra/stacks/deliverpro-stack.ts
├── DP-35: Bedrock agent IAM + SSM + Secrets Manager (lines 75-116)
└── DP-36: SNS topic + 5 alarms + dashboard (lines 118-318)
```

---

## Key Decisions

1. **Config fallback:** If `project_type` has no rows, use `'default'` template (allows phased rollout)
2. **Prompt upsert:** `INSERT ON CONFLICT DO UPDATE` for safe concurrent edits
3. **Soft deletes:** `is_active = false` preserves audit history (no hard deletion)
4. **Bedrock agent:** CDK infrastructure only; manual agent creation in Phase 4 (API complexity)
5. **Alarm thresholds:** Conservative (Lambda 10 concurrent, RDS 40 connections = 50% of t3.micro) to catch issues early

---

## Testing Commands

```bash
# Build
npm run build -w packages/config
npm run build -w infra

# Verify TypeScript
cd infra && npx tsc --noEmit

# CDK synthesis
cd infra && cdk synth

# View deployment plan
cd infra && cdk deploy --dry-run
```

---

## Database Integration

All queries use parameterized statements:
- ✅ `pool.query("SELECT * FROM ... WHERE id = $1", [id])`
- ❌ Never: `pool.query("SELECT * FROM ... WHERE id = " + id)`

Tables touched:
- `casdm_config` — V003 adds project_type column, unique constraint, item_type check
- `analysis_prompts` — V003 creates table, seeds 3 default prompts

---

## API Error Codes

| Code | Status | Scenario |
|------|--------|----------|
| VALIDATION_ERROR | 400 | Missing required fields |
| UNAUTHORIZED | 401 | Missing/expired JWT |
| FORBIDDEN | 403 | Insufficient permissions |
| NOT_FOUND | 404 | Resource doesn't exist |
| DUPLICATE_CONFIG_ITEM | 409 | Unique constraint violation |
| TEMPLATE_ALREADY_EXISTS | 409 | Target project type has rows |
| NO_CASDM_TEMPLATE | 422 | No template for project type (even 'default' missing) |

---

## Hand-Off to Phase 4

**For Backend Developers:**
- Integrate config handlers into CDK stack with API Gateway routes
- Example: `api.root.addResource('admin').addResource('config').addMethod('GET', configHandler, { authorizer })`
- Use lambdaBaseRole from StatelessStack
- Update handlers with correct handler exports from config package

**For DevOps/Faraz:**
- Create Bedrock agent manually (AWS Console or CLI)
  - Model: `us.anthropic.claude-sonnet-4-5-20241022-v1:0`
  - Role: Use BedrockAgentRole ARN from `/deliverpro/config/bedrock-agent-role-arn`
  - Instruction: _"You are a delivery governance analyst. Analyze meeting transcripts..."_
- Populate `/deliverpro/avoma-api-key` with Avoma API key
- Update `/deliverpro/config/agent-id` with created agent ID
- Subscribe to `deliverpro-alarms` SNS topic for notifications

**For Frontend Developers:**
- Config endpoints ready for admin panel screen (template management UI)
- Prompts endpoints ready for admin prompt editor
- Use types from `@deliverpro/config` for frontend TypeScript interfaces

---

## Cost Summary

DP-36 alarms add **~$0.15/month** to operational costs:
- CloudWatch alarms: ~$0.10
- SNS topic + notifications: ~$0.05
- Total Phase 2 cost: $25.86/month (vs. $25.71 estimated)

---

## Sign-Off

✅ **Spec-Ready:** All code follows architecture docs, handler patterns, middleware stack, error handling standards
✅ **TypeScript-Clean:** Strict mode, Zod validation, parameterized queries
✅ **CDK-Verified:** synth succeeds, no errors
✅ **Integration-Ready:** Phase 4 developers can wire handlers into API Gateway immediately

**MCP Note:** If any MCP tools returned no results or behaved unexpectedly, your MCP server session may have expired. Run `kiro mcp login` to re-authenticate.
