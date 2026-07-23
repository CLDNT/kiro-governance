# Phase 0 Automation — AgentCore + Strands: Complete Plan

**Date:** 2026-07-23  
**Author:** Orchestrator  
**Status:** Draft — Pending Formal SRS Change Request

---

## 1. What This Is

When a new project is created in DeliverPro, the system automatically bootstraps the entire Phase 0 workflow — GitHub repo creation, Bedrock Knowledge Base provisioning, and a multi-agent loop that generates and reviews the Preliminary SRS — without any manual steps beyond clicking "Create Project."

This eliminates the "governance on day three" problem Qasim identified. Resources are assigned, the repo exists, and the Preliminary SRS is already committed to GitHub before the delivery team has their first standup.

---

## 2. Scope of This Plan

Covers Phase 0 only:

- Project creation cascade (GitHub, Jira, Clockify, Slack)
- Bedrock Knowledge Base provisioning per project
- Strands agent pipeline: product-analyst → aws-architect review loop → plan-reviewer
- Artifact commit to GitHub
- Governance event recording (MCP server)
- DeliverPro gate sync (existing CR-16)

Phase 1 onwards (architecture docs, sprint planning, implementation) are out of scope for this feature.

---

## 3. Architecture Components

### 3.1 Trigger Layer

**DeliverPro "Create Project" flow** (existing Lambda, extended):

When a PM clicks Create Project and fills in:
- Project name
- Project type (App Dev / App Mod / AI/ML / Migration)
- Assigned SA + PM + Engineer
- SOW document (PDF upload)
- Discovery transcript links (optional at creation, can be added later)

The existing `POST /api/projects` Lambda is extended to:

1. Create the project row in RDS (already done)
2. Upload SOW + any transcripts to S3
3. Create GitHub repo on Cloudelligent org
4. Create Jira project
5. Create Clockify project
6. Provision Slack channel
7. Publish `project.created` event to EventBridge

Steps 2–7 are new additions to the existing Lambda.

---

### 3.2 Knowledge Base Layer

**One Bedrock Knowledge Base per project.**

This is the most critical design decision. Each project KB has two data sources:

**Data Source A — Shared methodology (same for all projects):**
```
s3://cloudelligent-governance-kb/shared/
  casdm-methodology.pdf
  orchestrator-standards.md
  product-analyst-standard.md
  aws-architect-standards.md
  reviewer-standards.md
  srs-template.md
  hallucination-gate-rules.md
```

**Data Source B — Per-project documents:**
```
s3://cloudelligent-governance-kb/projects/<project-id>/
  sow.pdf
  transcript-1.txt
  transcript-2.txt
  meeting-notes.txt
  (approved SRS written back here after Phase 0 completes)
```

**Vector store: Amazon OpenSearch Managed Cluster (shared)**

Rather than OpenSearch Serverless (which charges ~$700/mo minimum for two OCUs regardless of usage), a single `t3.small.search` managed cluster (~$25/mo) is shared across all project KBs. Each project KB gets its own index on the shared cluster. This keeps costs flat as the number of projects grows.

Bedrock Knowledge Base supports bringing your own OpenSearch managed cluster as the vector store. The cluster is provisioned once at infrastructure setup and reused for every project KB created thereafter.

**KB creation timing:**

A dedicated "KB Provisioning Lambda" fires off the EventBridge `project.created` event. It:
1. Creates a new Bedrock Knowledge Base for the project
2. Attaches Data Source A (shared S3 prefix)
3. Attaches Data Source B (per-project S3 prefix)
4. Triggers a data source sync job
5. Waits for sync completion (polls Bedrock sync job status)
6. Once sync is confirmed complete, publishes `kb.ready` event to EventBridge

The Strands agent pipeline does NOT start until `kb.ready` fires. This ensures agents always query a populated KB.

---

### 3.3 Strands Agent Pipeline

Triggered by the `kb.ready` EventBridge event. Runs as a Python Lambda (or Step Functions if the loop duration exceeds Lambda's 15-min limit — addressed in §6).

**Runtime:** Amazon Bedrock AgentCore with Strands SDK  
**Memory:** STM (Short Term Memory) only — context lives within the session, no LTM needed for Phase 0  
**MCP connectivity:** Strands MCP Client connects to existing EC2 MCP server (44.219.249.6:443)

**Four agents participate:**

| Agent | Model | Role |
|---|---|---|
| Orchestrator | claude-sonnet-4-5 (us cross-region) | Drives the loop, commits outputs, fires MCP events |
| product-analyst | claude-sonnet-4-5 (us cross-region) | Generates Preliminary SRS, runs H1 self-audit |
| aws-architect | claude-opus-4-5 (us cross-region) | Reviews SRS against §15 checklist, approves or rejects |
| plan-reviewer | claude-opus-4-5 (us cross-region) | Validates domain decomp + feature list (post-SRS) |

**Tools available to agents (no execute_bash — not applicable on AgentCore):**

| Tool | Purpose |
|---|---|
| Bedrock KB Retrieve API | Query project KB (SOW, transcripts, methodology) |
| GitHub API (via Lambda tool) | Read/write files to project repo |
| AWS Pricing MCP (Strands client) | Architect cost checks |
| AWS Documentation MCP (Strands client) | Architect service lookups |
| record_progress MCP (Strands client) | Write governance events to RDS via EC2 MCP server |
| notify_slack MCP (Strands client) | Post to project Slack channel via EC2 MCP server |
| RDS read tool (Lambda) | Read project metadata (project type, team members) |


---

## 4. The Agent Loop in Detail

### 4.1 What product-analyst does

Receives from STM:
- Project type
- Compliance flag (HIPAA/SOC2/PCI detected in SOW?)
- KB ID to query

Steps:
1. Queries KB for SOW content
2. Queries KB for any available discovery transcripts
3. Queries KB for CASDM methodology and SRS template
4. Generates Preliminary SRS following the template structure (§1–§13)
5. Runs H1 self-audit on every FR:
   - Does every FR have a `Source:` tag?
   - Can it quote exact customer text for the FR?
   - Are specific numbers labeled as architect decisions, not customer requirements?
   - Are unverified items flagged with `⚠️ UNVERIFIED`?
6. Calls `record_progress` MCP: `type=micro, "Requirements gathering started"`
7. Calls `record_progress` MCP: `type=micro, "Draft SRS sections written"`
8. Returns SRS content to STM

### 4.2 What aws-architect does (review turn)

Receives from STM:
- SRS content
- Original source documents (for traceability check)
- Round number (1–4)
- Previous findings (if round > 1)

Steps:
1. Queries KB to verify that FRs trace back to actual SOW/transcript text
2. Runs §15 SRS Review Checklist:
   - Every FR has a `Source:` tag
   - FRs marked UNVERIFIED have a questionnaire entry
   - ACs are machine-testable (exact status codes, field names, validation rules)
   - NFRs with no client source are labeled as Cloudelligent recommendations
   - No contradictions between FRs
   - No invented numeric thresholds without labeling
3. Produces findings table `| # | Type | FR | Finding | Action |`
4. Returns `ReviewResult(approved: bool, findings: list)` to STM

### 4.3 The loop

```
Round 1:  product-analyst generates SRS → aws-architect reviews
Round 2:  product-analyst fixes findings → aws-architect re-reviews
Round 3:  product-analyst fixes findings → aws-architect re-reviews
Round 4:  product-analyst fixes findings → aws-architect re-reviews
          If still not approved after round 4:
          → Orchestrator calls notify_slack: "Phase 0 escalated — SRS needs human input"
          → Pipeline pauses, awaits human intervention
```

The loop exit condition is `ReviewResult.approved == true`. Strands implements this as a Python loop with a counter guard — not a recursive call.

### 4.4 What plan-reviewer does (post-SRS, optional at Phase 0)

After SRS is approved, if the Orchestrator has also triggered domain decomposition (Phase 2 step 2.1 kickoff), plan-reviewer validates:
- Every FR maps to exactly one domain
- No circular dependencies in the domain graph
- No FR is orphaned

For pure Phase 0 (Preliminary SRS only), plan-reviewer is not invoked — it enters at Phase 2.

---

## 5. End-to-End Flow (Numbered Steps)

```
1.  PM fills "Create Project" form in DeliverPro
2.  POST /api/projects Lambda runs:
      → Creates RDS project row
      → Uploads SOW + transcripts to S3 /projects/<id>/
      → Calls GitHub API → creates repo on Cloudelligent org
          → Commits .kiro/ folder structure
          → Commits docs/project-progress.md (empty template)
          → Commits .gitignore (.kiro/ excluded for app mod)
      → Calls Jira API → creates Jira project
      → Calls Clockify API → creates Clockify project
      → Calls Slack provisioning → creates #proj-<name> channel
      → Stores github_repo + slack_channel_id in RDS projects table
      → Publishes "project.created" to EventBridge

3.  EventBridge → KB Provisioning Lambda fires:
      → Creates Bedrock Knowledge Base for project
      → Attaches Data Source A (shared S3 /shared/)
      → Attaches Data Source B (project S3 /projects/<id>/)
      → Triggers Bedrock data source sync
      → Polls sync status until complete
      → Publishes "kb.ready" to EventBridge

4.  EventBridge → Phase 0 Bootstrap Lambda fires:
      → Reads project metadata from RDS
      → Invokes Strands agent session on AgentCore

5.  Orchestrator agent starts:
      → Reads project type + compliance flags from RDS
      → Detects compliance keywords in SOW via KB query
      → Delegates to product-analyst

6.  product-analyst runs:
      → Queries KB: SOW, transcripts, CASDM, SRS template
      → Generates Preliminary SRS with H1 self-audit
      → Calls MCP record_progress (micro x2)
      → Returns SRS to STM

7.  Orchestrator routes SRS to aws-architect

8.  aws-architect reviews:
      → Queries KB for source verification
      → Runs §15 checklist
      → Returns ReviewResult to STM

9.  If REJECTED (round ≤ 4):
      → Orchestrator passes findings back to product-analyst
      → Go to step 6

10. If REJECTED (round 4 exhausted):
      → Orchestrator calls notify_slack: escalation message
      → Pipeline pauses

11. If APPROVED:
      → Orchestrator calls GitHub API:
          → Commits docs/phase1/srs.md to project repo
          → Updates docs/project-progress.md (checks off Phase 0 items)
      → Uploads approved SRS back to S3 /projects/<id>/approved-srs.md
      → Triggers KB re-sync (so downstream phases can retrieve it)
      → Calls MCP record_progress:
          type=macro, gate="Preliminary SRS validated", phase="Phase 0"
      → Calls MCP notify_slack:
          "#proj-<name>: Phase 0 complete — Preliminary SRS approved and committed"

12. DeliverPro CR-16 (sync-gates Lambda) fires on GitHub commit:
      → Reads docs/project-progress.md from new repo
      → Sets macro_checkpoints.reached_at for "Discovery outputs validated"
      → Sets macro_checkpoints.reached_at for "Preliminary SRS validated"

13. DeliverPro gate view shows Phase 0 = green for this project
```

---

## 6. Infrastructure Components

### 6.1 New components (to be built)

| Component | Type | Purpose |
|---|---|---|
| KB Provisioning Lambda | Python Lambda | Creates Bedrock KB + triggers sync per project |
| Phase 0 Bootstrap Lambda | Python Lambda | Invokes Strands agent session |
| Strands Agent Runtime | AgentCore (Bedrock managed) | Runs all 4 agents |
| OpenSearch Managed Cluster | `t3.small.search`, 1 node | Shared vector store for all project KBs |
| S3 Bucket: cloudelligent-governance-kb | S3 | Holds shared docs + per-project documents |
| EventBridge Rules | 2 rules | project.created → KB Lambda; kb.ready → Bootstrap Lambda |

### 6.2 Existing components reused (no changes)

| Component | Reused As |
|---|---|
| EC2 MCP Server (44.219.249.6:443) | record_progress + notify_slack tool target |
| RDS PostgreSQL | projects table, governance_events table, macro_checkpoints table |
| DeliverPro POST /api/projects Lambda | Extended with GitHub/Jira/Clockify/Slack/S3/EventBridge calls |
| DeliverPro CR-16 sync-gates Lambda | Reads project-progress.md, updates macro_checkpoints |
| Slack bot token (SSM) | Channel provisioning + notifications |
| GitHub token (SSM) | Repo creation + file commits |

### 6.3 Lambda execution time concern

The full agent loop (4 agents, up to 4 rounds, LLM calls) could exceed Lambda's 15-minute timeout. Mitigation options:

- **Option A (preferred for POC):** Run as a single Lambda with 15-min timeout. Empirically, 1–2 review rounds with sonnet/opus models complete in 3–6 minutes total. Only pathological cases hit 4 rounds.
- **Option B (if needed at scale):** Wrap in Step Functions Express Workflow. Each agent turn is a separate Lambda invocation. STM is passed as Step Functions state. Adds complexity but removes the timeout constraint entirely.

Start with Option A. Move to Option B only if timeouts are observed in production.

---

## 7. Data Stores Summary

| Store | What lives here | Why |
|---|---|---|
| RDS PostgreSQL | projects, governance_events, macro_checkpoints | Source of truth for DeliverPro app |
| S3 /shared/ | CASDM methodology, steering files, SRS template | Shared KB data source — same for every project |
| S3 /projects/<id>/ | SOW, transcripts, approved SRS (written back) | Per-project KB data source |
| OpenSearch Managed (`t3.small`) | Bedrock KB vector embeddings for all projects | One shared cluster, one index per project KB |
| GitHub (Cloudelligent org) | docs/phase1/srs.md, docs/project-progress.md, .kiro/ structure | Source of truth for Kiro agents + CR-16 sync |

---

## 8. IP Protection Rules (Enforced by DeliverPro)

These rules come directly from Tariq + Chris's discussion on IP leakage:

**App Dev projects:**
- GitHub repo created on Cloudelligent's internal org (not customer's org)
- `.kiro/` folder committed with `.gitignore` that excludes it from any future customer repo transfer
- At project closure, only the `packages/` and `src/` code is transferred — never the `.kiro/` folder

**App Mod projects:**
- Customer repo already exists on customer's org
- DeliverPro creates a **separate internal repo** on Cloudelligent org for Kiro agents to work in
- The internal repo clones/mirrors the customer repo content for context
- `.kiro/` folder never exists in the customer's repo — only in the internal mirror
- At project closure, merged code is transferred; `.kiro/` stays internal

DeliverPro enforces this at repo creation time — not relying on engineers to remember.

---

## 9. Cost Estimate

| Component | Monthly Cost | Notes |
|---|---|---|
| OpenSearch `t3.small.search` | ~$25/mo | Shared across all project KBs |
| Bedrock KB (Amazon Titan Embeddings v2) | ~$0.02 per 1M tokens | One-time at sync; ~$0.01/project for typical SOW+transcripts |
| Bedrock AgentCore (claude-sonnet-4-5) | ~$0.003/1K input tokens | product-analyst + orchestrator turns |
| Bedrock AgentCore (claude-opus-4-5) | ~$0.015/1K input tokens | aws-architect + plan-reviewer turns |
| Lambda (KB provisioning + bootstrap) | <$1/mo | Low invocation count |
| EventBridge | <$0.01/mo | 2 rules, low event volume |
| S3 (shared + per-project docs) | ~$0.02/mo | Minimal storage |
| **Total new cost** | **~$27–30/mo** | For up to ~50 active projects |

Compare to OpenSearch Serverless: minimum ~$700/mo (2 OCUs always on). The managed `t3.small` saves ~$670/mo.

---

## 10. Open Decisions (Need Input Before Implementation)

| # | Decision | Options | Impact |
|---|---|---|---|
| D1 | Strands execution: Lambda vs Step Functions | Lambda (simpler), Step Functions (timeout-safe) | Architecture complexity |
| D2 | KB per project vs shared KB with metadata filter | Per-project (chosen here), shared (cheaper) | Isolation vs cost |
| D3 | Avoma auto-fetch at project creation | Auto-pull via Avoma API, or manual upload | Scope of this feature |
| D4 | Clockify integration scope | Create project only, or also pull hours for burn-rate reporting | Scope |
| D5 | plan-reviewer in Phase 0 | Only after Phase 2.1 domain decomp, or also validate SRS structure | Agent count |
| D6 | FusionAuth for MCP OIDC | Required now (Tariq's recommendation) or deferred | Security posture |

---

## 11. What Is NOT in This Plan

- Phase 1 automation (architecture docs, security gate, data model)
- Phase 2 automation (sprint planning, backlog generation)
- Phase 3/4 automation (spec generation, code review)
- Avoma auto-ingestion (transcripts fetched automatically without PM input)
- Oscar pre-sales tie-in (same agent pipeline at SOW creation)
- Teams/SharePoint document governance layer (Qasim's request — separate feature)
- QuickSight reporting layer (Phase 3 of original roadmap)
