# Agent Integration Architecture — F-02: Human-Approval Gate & Orchestrator Hook

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-07-02 | v1.3 | AWS Architect | GitHub↔Slack linkage CR (v3 Final Design of Record). `record_progress` may now return `{ written:false, reason:'no_matching_project' }` when the repo is not linked to a project — callers (orchestrator hook + sub-agent micro logging) **log and continue** (non-blocking), consistent with the existing best-effort micro-logging error handling. Micro sub-agent logging is otherwise unchanged; those events surface on the timeline (Level 1). `project_id ↔ github_repo` reconciliation: Phase 1 keys events by repo name and DeliverPro joins to `projects` via `github_repo`. Persistence is RDS PostgreSQL (2026-06-23 CR), not DynamoDB. See §0 overlay. |
| 2026-06-11 | v1.2 | AWS Architect | Security Gate 1 fixes: HTTPS URL (HIGH-1), .env gitignore rule (HIGH-2), cert fingerprint in mcp.json (HIGH-1). |
| 2026-06-11 | v1.1 | AWS Architect | Removed aspirational session-persistence claim for lost gate (FINDING-1), simplified update_text format (FINDING-2). |
| 2026-06-11 | v1.0 | AWS Architect | Initial architecture doc for F-02 from SRS v1.5, F-01 v1.1, F-04 v1.1, domain decomposition v1.0 |

---

## 0. v3 GitHub/Slack Linkage CR — Authoritative Behavior Overlay

> **AUTHORITATIVE (2026-07-02).** Under the linkage CR (`docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md`
> §v3-6), this doc's `record_progress`/`notify_slack` usage inherits the following. Where older prose
> assumes an always-successful write or DynamoDB persistence, **this section wins**.

- **`no_matching_project` return:** `record_progress` resolves the repo to a project (`projects.github_repo`) before writing. If the repo is unlinked, it returns `{ written:false, reason:'no_matching_project' }` and stores nothing. The orchestrator hook (FR-05) and sub-agent micro logging (FR-07) MUST treat this as non-blocking — log and continue (same best-effort posture the "Micro Logging" steering already prescribes). It is NOT an error for an unlinked repo to produce no governance event (optional-linkage feature switch, FR-P2-040).
- **Micro routing:** sub-agent `record_progress type:'micro'` events persist and surface on the project timeline (Level 1). They do NOT themselves call `notify_slack` (the CI script is the sole micro-Slack source — PLAN-I1). The orchestrator macro path (FR-05) is the app-owned MACRO notification source on human approval.
- **`project_id ↔ github_repo`:** Phase 1 keys `governance_events.project_id` by the GitHub **repo name**; DeliverPro reconciles to `jira_key` via `projects.github_repo`. Callers keep passing the repo name as `project_id`.
- **Persistence:** RDS PostgreSQL via the MCP server's `postgres.service.ts` (2026-06-23 DynamoDB→RDS CR). "DynamoDB" references below (incl. FR-07 summary) are stale doc-drift corrected by story P0/CR-11.
- **Append-only + shared-key:** governance writes are append-only at the DB layer (ownership reassignment — `mcp-server-core-architecture.md` §0.5); cross-project mis-attribution under the shared key is a recorded POC risk-accept with OIDC deferred (§0.6 there; `docs/phase2/srs.md` §NFR security).

---

**Domain:** Agent Integration
**Feature:** F-02 — Human-Approval Gate & Orchestrator Hook
**Purpose:** Add an explicit human-approval gate to Kiro app-dev agent workflows at each canonical macro gate, and wire orchestrator hooks that call the MCP server (F-01) to record governance events and notify Slack on approval.

**FRs Owned:**

| FR | Title | Summary |
|----|-------|---------|
| FR-05 | Orchestrator Hook — Macro Sign-Off Capture | On human approval, fire `record_progress` + `notify_slack` MCP tool calls |
| FR-06 | Human-Approval Gate in Kiro Agents | Pause agent workflow at macro gates, await human approve/reject |
| FR-07 | Micro Update Logging (No Human Gate) | Sub-agents log progress to DynamoDB via `record_progress` without human gate or Slack |

**Dependencies:**

| Dependency | Document | What F-02 Consumes |
|-----------|----------|-------------------|
| F-01 — MCP Server Core | `docs/phase1/mcp-server-core-architecture.md` v1.1 | Tool schemas: `record_progress`, `notify_slack` — exact input/output shapes |
| F-04 — Data & Persistence | `docs/phase1/data-persistence-architecture.md` v1.1 | `GovernanceEventRecord` type (for reference); DynamoDB is written to by F-01, not directly by F-02 |
| Kiro Agent Runtime | SRS A-02 | Native MCP support for remote servers |
| Existing Kiro app-dev agents | SRS FR-06 AC | Must pull latest before modifying |

---

## 2. Human-Approval Gate (FR-06)

### 2.1 Where in the Kiro Agent Workflow

The human-approval gate is inserted into the **orchestrator agent** workflow at every canonical macro gate defined in SRS §16. It fires **after** the validating sub-agent produces its artifact and **before** any downstream agent or commit action proceeds.

**Canonical macro gates requiring this gate (SRS §16):**

| # | Gate | Phase | Validating Sub-Agent |
|---|------|-------|---------------------|
| 1 | Discovery outputs validated | 0 — Internal Preparation | `product-analyst` |
| 2 | Preliminary SRS validated | 0 — Internal Preparation | `product-analyst` |
| 3 | SRS approved | 1 — Discover & Align | `product-analyst` |
| 4 | Design docs approved | 2 — Design & Review | `aws-architect` |
| 5 | Implementation plan approved | 2 — Design & Review | `plan-reviewer` |
| 6 | Spec strategy approved | 3 — Build & Implement | `executioner` |
| 7 | Code approved | 3 — Build & Implement | `code-reviewer` |
| 8 | UAT report approved | 3 — Build & Implement | `qa-agent` |
| 9 | Runbooks approved | 4 — Launch & Enable | `aws-architect` |
| 10 | Project documentation approved | 4 — Launch & Enable | `aws-architect` |

> Source: SRS §16 — "Canonical macro gates (from the methodology diagram)"

### 2.2 Gate Mechanism — How It Pauses and Awaits Human Input

Kiro agents run in a CLI environment where the agent can prompt the user for input. The gate uses the **`summary` tool with `resultType: "changes_needed"`** pattern (available in Kiro's tool set) to pause execution and present the artifact for review, combined with the agent prompting the user for approval.

**Implementation pattern in the orchestrator agent steering/prompt:**

```
When sub-agent [X] completes artifact [Y] for gate [Z]:
1. Present the artifact summary to the human operator
2. Ask: "Approve or reject [artifact] for gate [Z]? (approve/reject)"
3. WAIT for human response
4. If "approve" → proceed to orchestrator hook (§3)
5. If "reject" → return artifact to sub-agent with feedback for rework
```

> `Architect decision — not customer-specified:` The specific mechanism is the Kiro agent's native ability to prompt for user input during a chat session. In the Kiro CLI (`kiro-cli chat`), the agent outputs a question and waits for the user's typed response. No external approval system (e.g., GitHub PR approval, Slack button) is needed — the human is the one running the Kiro session.

### 2.3 What the Human Sees

When the gate fires, the orchestrator presents:

```
────────────────────────────────────────────
🏁 GOVERNANCE GATE: [Gate Name]
────────────────────────────────────────────
Artifact: [path/to/artifact]
Produced by: [sub-agent name]
Summary: [brief description of what was produced]

Please review the artifact and respond:
  • "approve" — signs off this gate, records to governance DB + Slack
  • "reject [reason]" — returns to sub-agent for rework
────────────────────────────────────────────
```

**Human inputs:**
- `approve` — triggers orchestrator hook (FR-05)
- `reject <feedback>` — artifact returns to validating sub-agent; no MCP calls fire

### 2.4 On Reject — Rework Flow

1. Orchestrator receives `reject` + optional feedback text
2. Orchestrator re-delegates to the validating sub-agent with the feedback
3. Sub-agent reworks the artifact
4. Gate re-fires (same gate, same presentation)
5. **No `record_progress` or `notify_slack` call fires on rejection** — only approvals are governance events

> Source: SRS §10 — "Human rejects artifact at macro gate → No MCP call fires; artifact returns to sub-agent for rework"

### 2.5 On Approve — Orchestrator Hook Fires

1. Orchestrator receives `approve`
2. Orchestrator hook logic (§3) executes
3. On successful MCP calls, workflow proceeds to next phase/gate

### 2.6 Delivery Strategy

**Delivery:** Branch + PR into the main app-dev agents repository.

> Source: SRS FR-06 AC — "Delivery: as a branch + PR into the main app-dev agents repository"

**Files to modify:**

| File | Change |
|------|--------|
| `.kiro/steering/orchestrator.md` | Add governance gate instructions + MCP hook logic |
| `.kiro/steering/{sub-agent}.md` (each sub-agent) | Add micro-update logging instructions (§4) |
| `.kiro/mcp.json` (or equivalent MCP config) | Add remote MCP server connection definition (§6) |

**Pre-requisite:** Must `git pull` latest Kiro agents before making changes.

> Source: SRS FR-06 AC — "Must pull latest Kiro agents before making changes"

---

## 3. Orchestrator Hook — Macro Sign-Off (FR-05)

### 3.1 MCP Tool Calls on Approval

When a human approves a macro gate, the orchestrator fires **two sequential MCP tool calls**:

**Call 1: `record_progress`** (write to DynamoDB)

```typescript
{
  project_id: "<resolved from env/config — see §3.2>",
  update_text: "<gate name> approved by <actor>",
  type: "macro",
  gate: "<canonical gate name from MACRO_GATES>",
  phase: "<phase number, e.g. 'Phase 1'>",
  source_ref: "<path to approved artifact>",
  actor: "<human approver identity — see §3.3>",
  flag_override: undefined  // let auto-classification confirm
}
```

> Source: F-01 §3.2 — `RecordProgressInputSchema` defines exactly these fields.

**Call 2: `notify_slack`** (only if `record_progress` returns `{ written: true }`)

```typescript
{
  project_id: "<same as above>",
  message: "<gate name> approved by <actor> — artifact: <source_ref>",
  event_type: "macro"
}
```

> Source: F-01 §3.1 — `NotifySlackInputSchema` defines exactly these fields.

**Sequencing rule:** If `record_progress` returns `{ written: false, reason: 'duplicate' }`, **do NOT call `notify_slack`**. This prevents duplicate Slack notifications when both trigger paths (agent hook + GitHub Actions) fire for the same event.

> Source: F-01 §5.4 — "the caller must not proceed with `notify_slack` on duplicate"

### 3.2 How `project_id` Is Resolved

`project_id` = GitHub repository name (e.g., `rainn`, `icvics`).

> Source: SRS OQ-02 resolution — "project_id = GitHub repository name. Source: Customer (Tariq Khan) — 2026-06-11"

**Resolution mechanism in agent context:**

| Method | Source | Priority |
|--------|--------|----------|
| Environment variable `KIRO_PROJECT_ID` | Set in agent environment or `.env` | 1 (highest) |
| Git remote URL parse: `git remote get-url origin` → extract repo name | Available in any git repo | 2 (fallback) |
| `.kiro/project.json` → `projectId` field | Project-level config file | 3 (fallback) |

> `Architect decision — not customer-specified:` Three-tier resolution provides robustness. The orchestrator hook tries method 1, falls back to 2, then 3. If all fail, the hook logs an error and **blocks** (does not proceed without a valid `project_id`).

**Orchestrator prompt instruction:**

```
To resolve project_id for governance MCP calls:
1. Check environment variable KIRO_PROJECT_ID
2. If not set, parse the GitHub repository name from `git remote get-url origin`
3. If neither available, read .kiro/project.json "projectId" field
4. If all fail, inform the user that governance recording cannot proceed without a project identifier.
```

### 3.3 How `actor` Is Captured

The `actor` field identifies the human who approved the gate.

| Method | Value | Source |
|--------|-------|--------|
| Git config | `git config user.name` — available in the terminal session | `Architect decision — not customer-specified` |
| Explicit input | Human types their name/ID during approval | Fallback |

> `Architect decision — not customer-specified:` The agent reads `git config user.name` from the local environment. This is the most reliable automatic identity source in a CLI-based workflow. If unavailable, the orchestrator asks: "Who is approving this gate? (name or ID)"

### 3.4 How `source_ref` Is Populated

The `source_ref` field points to the approved artifact.

| Scenario | Value | Example |
|----------|-------|---------|
| File artifact (most common) | Relative path from repo root | `docs/srs.md` |
| Committed artifact | Commit SHA | `a1b2c3d` |
| Multi-file artifact | Path to primary file | `docs/phase1/mcp-server-core-architecture.md` |

> `Architect decision — not customer-specified:` The orchestrator captures the path of the artifact that was presented at the gate. Since the sub-agent produces it as a file write, the file path is always available in the agent context.

### 3.5 Error Handling — MCP Call Failure

| Scenario | Behavior | Rationale |
|----------|----------|-----------|
| `record_progress` returns `{ written: true }` | Proceed to `notify_slack` | Normal flow |
| `record_progress` returns `{ written: false, reason: 'duplicate' }` | Skip `notify_slack`. Log info. Proceed with workflow. | Dedup — event already recorded (likely by GitHub Actions path) |
| `record_progress` throws / MCP connection error | **Log error and continue workflow**. Inform human: "⚠️ Governance recording failed — MCP server may be unreachable. Workflow will proceed but this gate is NOT recorded." | `Architect decision — not customer-specified` |
| `notify_slack` returns `{ notified: false }` | Log warning. **Do not block workflow.** | SRS NFR-02: "Failed Slack notifications shall not block DynamoDB writes" — by extension, failed notifications should not block workflow |
| `notify_slack` throws / MCP connection error | Log error. **Do not block workflow.** | Same rationale |

> `Architect decision — not customer-specified:` **Non-blocking on MCP failure.** The agent workflow is the primary deliverable; governance recording is supplementary. If the MCP server is down, the human has still approved the gate — the approval is valid. The GitHub Actions path (F-03) will pick up the event when `project-progress.md` is committed, providing a redundant recording path.

**Orchestrator message on failure:**

```
⚠️ Governance recording failed: [error description]
The gate approval is still valid. The event will be captured when project-progress.md is committed.
Proceeding with workflow...
```

---

## 4. Micro Update Logging (FR-07)

### 4.1 Which Sub-Agents Log Micro Updates

**All sub-agents** that produce intermediate deliverables log micro updates. These are progress markers — not gated, not Slack-notified.

| Sub-Agent | Micro Events | Source |
|-----------|-------------|--------|
| `product-analyst` | "Requirements gathering started", "Stakeholder interviews complete", "Draft SRS sections written" | SRS §5.2: "Micro = a sub-agent check (automated)" |
| `aws-architect` | "Domain decomposition done", "Feature architecture draft complete", "Data model draft ready" | SRS §3 step 6 example: "domain decomposition done" |
| `plan-reviewer` | "Architecture review started", "Review findings documented" | `Architect decision — not customer-specified` |
| `code-reviewer` | "Code review started", "Review comments added" | `Architect decision — not customer-specified` |
| `executioner` | "Spec file generation started", "Handler implementation complete" | `Architect decision — not customer-specified` |
| `qa-agent` | "Test plan created", "Test execution started" | `Architect decision — not customer-specified` |

### 4.2 When Sub-Agents Call `record_progress`

Sub-agents call `record_progress` at these lifecycle events:

1. **Task started** — when the sub-agent begins work on a delegated task
2. **Intermediate milestone** — when a significant subtask completes (e.g., "domain decomposition done")
3. **Task completed** (non-gate) — when the sub-agent finishes but the output is NOT a macro-gate artifact

> `Architect decision — not customer-specified:` Sub-agents do NOT log micro updates for trivial actions (file reads, searches, intermediate thinking). Only meaningful progress markers that a delivery lead would want to see in the timeline.

### 4.3 MCP Call Parameters for Micro Events

```typescript
{
  project_id: "<same resolution as §3.2>",
  update_text: "<human-readable description of what happened>",
  type: "micro",
  // gate: omitted — micro events have no gate
  // phase: optional — include if known
  source_ref: "<file path or 'N/A' if no artifact produced>",
  actor: "<sub-agent name, e.g. 'aws-architect'>",
  // flag_override: omitted
}
```

> Source: F-01 §3.2 — `type` is optional (auto-classified), but explicitly passing `"micro"` ensures correct classification even if `update_text` accidentally matches gate lingo.

### 4.4 What Micro Updates Do NOT Trigger

- ❌ No human gate / approval prompt
- ❌ No Slack notification (F-01 §3.1: micro → `{ notified: false, reason: 'micro_event' }`)
- ❌ No deduplication sentinel write (F-04 §4.2: micro uses ULID-based key, always unique)

### 4.5 Micro Events to Instrument (Mapped to SRS §4 / §5.2)

| # | Event | Actor | Trigger |
|---|-------|-------|---------|
| 1 | "Domain decomposition done" | `aws-architect` | Architecture sub-task complete |
| 2 | "Feature list defined" | `aws-architect` | Feature enumeration complete |
| 3 | "Data model draft complete" | `aws-architect` | Data model written |
| 4 | "Requirements gathering started" | `product-analyst` | Task delegation received |
| 5 | "Draft SRS sections written" | `product-analyst` | Intermediate SRS progress |
| 6 | "Architecture review started" | `plan-reviewer` | Review delegation received |
| 7 | "Review findings documented" | `plan-reviewer` | Review complete (before gate) |
| 8 | "Spec file generation started" | `executioner` | Spec task received |
| 9 | "Handler implementation complete" | `executioner` | Code written (before review) |
| 10 | "Test plan created" | `qa-agent` | QA task received |
| 11 | "Code review started" | `code-reviewer` | Review delegation received |

> Source: SRS §4.1 in-scope item "Micro events: Logged to DB via MCP call. No Slack notification. Example: 'domain decomposition done.'" — `Architect decision — not customer-specified` for the full list beyond the single SRS example.

---

## 5. Agent Prompt / Hook Modifications

### 5.1 Orchestrator Steering File Changes

**File:** `.kiro/steering/orchestrator.md`

**Addition — Governance Gate Instructions:**

```markdown
## Governance Gates (MANDATORY)

After each sub-agent completes a macro-gate artifact, you MUST:

1. Present the artifact to the human for review
2. Ask: "Approve or reject [artifact name] for gate [gate name]? (approve/reject)"
3. Wait for human response
4. On "approve":
   a. Resolve project_id (env KIRO_PROJECT_ID → git remote → .kiro/project.json)
   b. Resolve actor (git config user.name → ask human)
   c. Call MCP tool `record_progress` with:
      - project_id, update_text: "[gate] approved by [actor]",
        type: "macro", gate: "[canonical gate name]", phase: "[phase]",
        source_ref: "[artifact path]", actor: "[resolved actor]"
   d. If record_progress returns { written: true }:
      - Call MCP tool `notify_slack` with:
        project_id, message: "[gate] approved by [actor] — artifact: [source_ref]",
        event_type: "macro"
   e. If record_progress returns { written: false, reason: 'duplicate' }:
      - Log: "Gate already recorded (likely by GitHub Actions path). Proceeding."
      - Do NOT call notify_slack
   f. If MCP call fails (connection error, timeout):
      - Inform human: "⚠️ Governance recording failed. Gate approval is still valid."
      - Proceed with workflow
5. On "reject [feedback]":
   - Return artifact to sub-agent with the feedback
   - Do NOT call any MCP tools
   - Re-delegate the task

### Canonical Macro Gates

These are the 10 gates that require human approval:
1. Discovery outputs validated
2. Preliminary SRS validated
3. SRS approved
4. Design docs approved
5. Implementation plan approved
6. Spec strategy approved
7. Code approved
8. UAT report approved
9. Runbooks approved
10. Project documentation approved
```

### 5.2 Sub-Agent Steering File Changes

**Files:** `.kiro/steering/{product-analyst,aws-architect,plan-reviewer,code-reviewer,executioner,qa-agent}.md`

**Addition — Micro Update Logging (append to each sub-agent's steering file):**

```markdown
## Micro Update Logging (MANDATORY)

When you begin or complete a significant sub-task, log a micro update via MCP:

Call MCP tool `record_progress` with:
- project_id: (resolved from env KIRO_PROJECT_ID or git remote)
- update_text: "<brief description of what happened>"
- type: "micro"
- source_ref: "<file path if applicable, or 'N/A'>"
- actor: "<your agent name, e.g. 'aws-architect'>"

Rules:
- Do NOT log trivial actions (file reads, searches, thinking)
- DO log: task started, intermediate milestones, task completed (non-gate)
- Micro updates do NOT require human approval
- If MCP call fails, log a warning and continue — do NOT block your work
```

### 5.3 MCP Configuration File

**File:** `.kiro/mcp.json`

See §6 for full connection configuration.

### 5.4 PR Strategy

> `Architect decision — not customer-specified:` **Single PR** covering all agent changes.

**Rationale:**
1. All changes are interdependent — the orchestrator gate logic references sub-agent behavior and MCP config
2. Easier to review as a coherent unit
3. Lower merge conflict risk than multiple PRs touching the same steering structure
4. SRS FR-06 says "branch + PR" (singular)

**PR structure:**

```
Branch: feat/governance-gate-hooks
Files changed:
  .kiro/steering/orchestrator.md       (governance gate logic)
  .kiro/steering/product-analyst.md    (micro logging)
  .kiro/steering/aws-architect.md      (micro logging)
  .kiro/steering/plan-reviewer.md      (micro logging)
  .kiro/steering/code-reviewer.md      (micro logging)
  .kiro/steering/executioner.md        (micro logging)
  .kiro/steering/qa-agent.md           (micro logging)
  .kiro/mcp.json                       (MCP server connection)
```

---

## 6. MCP Server Connection

### 6.1 How the Kiro Agent Connects

Kiro has native MCP support for remote servers (SRS A-02). The agent connects to the MCP server via **HTTPS + SSE (Streamable HTTP over TLS)** transport — the same transport defined in F-01 §2.4.

**Connection URL:** `https://<ec2-elastic-ip>:443/mcp`
**Authentication:** `X-API-Key` header with shared secret
**TLS verification:** Pinned cert fingerprint (not system CA trust) — the self-signed certificate's SHA-256 fingerprint is compared against the `MCP_CERT_FINGERPRINT` environment variable.

> Source: F-01 §2.4 — "Transport: HTTPS + SSE", F-01 §8.2 — "Authentication: all clients include X-API-Key header"

> `Architect decision — not customer-specified:` Self-signed cert (Option B) chosen for POC to eliminate plaintext key transmission at zero additional cost. Upgrade to ACM+ALB for production.

### 6.2 MCP Configuration File

**File:** `.kiro/mcp.json`

```json
{
  "mcpServers": {
    "kiro-governance": {
      "type": "remote",
      "url": "${KIRO_GOV_MCP_URL}",
      "headers": {
        "X-API-Key": "${KIRO_GOV_MCP_API_KEY}"
      },
      "tlsCertFingerprint": "${MCP_CERT_FINGERPRINT}"
    }
  }
}
```

> `Architect decision — not customer-specified:` Environment variable interpolation syntax (`${VAR}`) is the standard pattern for Kiro MCP config. The actual URL, key, and cert fingerprint are never hardcoded. The `tlsCertFingerprint` field enables pinned certificate verification for the self-signed cert (bypasses system CA trust store).

### 6.3 Environment Variables for MCP Connection

| Variable | Value | Where Stored |
|----------|-------|-------------|
| `KIRO_GOV_MCP_URL` | `https://<elastic-ip>:443/mcp` | Agent environment (`.env` or shell profile) |
| `KIRO_GOV_MCP_API_KEY` | Shared secret (matches SSM `/kiro-governance/config/mcp-api-key`) | Agent environment (`.env` or shell profile) |
| `MCP_CERT_FINGERPRINT` | SHA-256 fingerprint of the MCP server's self-signed certificate | Agent environment (`.env` or shell profile) |
| `KIRO_PROJECT_ID` | GitHub repository name (e.g., `rainn`) | Agent environment — optional, auto-derived from git remote if absent |

> `Architect decision — not customer-specified:` `.env` file in the project root (gitignored) is the recommended location for local development. For CI/CD or shared environments, use OS-level environment variables.

> `Architect decision — not customer-specified:` Real secrets never committed; `.env.example` committed as reference.

**`.env` security rules:**
- The `.env` file **must** be listed in `.gitignore`. It contains the API key, server URL (with EC2 IP), and cert fingerprint.
- A `.env.example` file with placeholder values (no real secrets) is committed to the repository as a reference template:

```bash
# .env.example — copy to .env and fill in real values
KIRO_GOV_MCP_URL=https://<your-ec2-elastic-ip>:443/mcp
KIRO_GOV_MCP_API_KEY=<your-api-key-from-ssm>
MCP_CERT_FINGERPRINT=<sha256-fingerprint-from-ec2-cert>
KIRO_PROJECT_ID=<github-repo-name>
```

### 6.4 Available Tools After Connection

Once connected, the agent has access to:

| Tool Name | Purpose | Used By |
|-----------|---------|---------|
| `record_progress` | Write governance event to DynamoDB | Orchestrator (macro), Sub-agents (micro) |
| `notify_slack` | Send Slack notification | Orchestrator (macro only) |

---

## 7. TypeScript / Config Interfaces

All types below are consistent with F-01 §10 tool schemas. They are defined here for reference by the agent hook logic.

### 7.1 MCP Tool Call Parameter Types (from F-01)

```typescript
/** record_progress input — exact copy from F-01 §3.2 */
export interface RecordProgressInput {
  project_id: string;
  update_text: string;
  type?: 'macro' | 'micro';
  gate?: string;
  phase?: string;
  source_ref: string;
  actor: string;
  flag_override?: boolean;
}

/** record_progress output — exact copy from F-01 §3.2 */
export interface RecordProgressOutput {
  written: boolean;
  pk?: string;
  sk?: string;
  reason?: string;
}

/** notify_slack input — exact copy from F-01 §3.1 */
export interface NotifySlackInput {
  project_id: string;
  message: string;
  event_type: 'macro' | 'micro';
}

/** notify_slack output — exact copy from F-01 §3.1 */
export interface NotifySlackOutput {
  notified: boolean;
  reason?: string;
}
```

### 7.2 Agent Configuration Types

```typescript
/** Agent environment configuration for governance hooks */
export interface GovernanceAgentConfig {
  /** MCP server URL (from KIRO_GOV_MCP_URL env var) */
  mcpUrl: string;
  /** MCP server API key (from KIRO_GOV_MCP_API_KEY env var) */
  mcpApiKey: string;
  /** Project identifier — GitHub repo name (from KIRO_PROJECT_ID or git remote) */
  projectId: string;
  /** Human actor identity (from git config user.name) */
  actor: string;
}

/** Governance gate definition */
export interface GovernanceGate {
  /** Canonical gate name from MACRO_GATES */
  gate: string;
  /** Phase this gate belongs to */
  phase: string;
  /** Sub-agent that produces the artifact for this gate */
  validatingAgent: string;
  /** Path to the artifact that must be approved */
  artifactPath: string;
}

/** MCP server connection config (for .kiro/mcp.json) */
export interface McpServerConfig {
  mcpServers: {
    'kiro-governance': {
      type: 'remote';
      url: string;
      headers: {
        'X-API-Key': string;
      };
    };
  };
}
```

### 7.3 Canonical Gate Constants (shared with F-01)

```typescript
/**
 * Canonical macro gates — must match F-01 packages/shared/constants/macro-gates.ts exactly.
 * Duplicated here for reference only; the MCP server owns the source of truth.
 * Changelog: 2026-06-23 — 'Spec file approved' → 'Spec strategy approved'. CASDM phase alignment.
 */
export const MACRO_GATES = [
  'Discovery outputs validated',
  'Preliminary SRS validated',
  'SRS approved',
  'Design docs approved',
  'Implementation plan approved',
  'Spec strategy approved',
  'Code approved',
  'UAT report approved',
  'Runbooks approved',
  'Project documentation approved',
] as const;

export type MacroGate = typeof MACRO_GATES[number];

/** CASDM phase number for each gate. Source: Tariq Khan 2026-06-23. */
export const GATE_PHASES: Record<MacroGate, string> = {
  'Discovery outputs validated':    'Phase 0',
  'Preliminary SRS validated':      'Phase 0',
  'SRS approved':                   'Phase 1',
  'Design docs approved':           'Phase 2',
  'Implementation plan approved':   'Phase 2',
  'Spec strategy approved':         'Phase 3',
  'Code approved':                  'Phase 3',
  'UAT report approved':            'Phase 3',
  'Runbooks approved':              'Phase 4',
  'Project documentation approved': 'Phase 4',
};

/** CASDM phase name for each gate. Source: Tariq Khan 2026-06-23. */
export const GATE_PHASE_NAMES: Record<MacroGate, string> = {
  'Discovery outputs validated':    'Internal Preparation',
  'Preliminary SRS validated':      'Internal Preparation',
  'SRS approved':                   'Discover & Align',
  'Design docs approved':           'Design & Review',
  'Implementation plan approved':   'Design & Review',
  'Spec strategy approved':         'Build & Implement',
  'Code approved':                  'Build & Implement',
  'UAT report approved':            'Build & Implement',
  'Runbooks approved':              'Launch & Enable',
  'Project documentation approved': 'Launch & Enable',
};
```

> Source: SRS §16 — gate names and phase assignments.

---

## 8. Edge Cases

| # | Scenario | Handling | Source |
|---|----------|----------|--------|
| 1 | Human approval gate — no response (session closed) | Kiro CLI sessions do not timeout — the prompt remains open indefinitely until the user responds. A closed Kiro session results in a lost gate event. The governance record will not be written via the orchestrator path. The GitHub Actions path (FR-04) provides redundant capture if the artifact was committed to the repo. For the POC, this is acceptable. | `Architect decision — not customer-specified` |
| 2 | MCP server unreachable at approval time | Log error, inform human ("⚠️ Governance recording failed"), proceed with workflow. The GitHub Actions path provides redundancy when `project-progress.md` is committed. | `Architect decision — not customer-specified` — SRS NFR-02 principle extended |
| 3 | Agent running in environment without MCP server configured | If `KIRO_GOV_MCP_URL` is not set and `.kiro/mcp.json` has no `kiro-governance` server, the orchestrator logs a warning: "Governance MCP server not configured — gate approvals will not be recorded." Workflow proceeds without governance recording. | `Architect decision — not customer-specified` |
| 4 | Sub-agent micro update MCP call fails | **Non-blocking.** Log warning and continue. Micro updates are best-effort — they provide timeline visibility but are not critical to workflow correctness. | `Architect decision — not customer-specified` |
| 5 | `project_id` cannot be resolved (no env var, no git remote, no config) | Orchestrator informs human: "Cannot determine project_id for governance recording. Please set KIRO_PROJECT_ID environment variable." Workflow proceeds but gate is NOT recorded. | `Architect decision — not customer-specified` |
| 6 | Human approves same gate twice in same day (re-run) | `record_progress` returns `{ written: false, reason: 'duplicate' }`. Orchestrator logs "Already recorded" and skips Slack. Workflow proceeds normally. | F-01 §5.4 dedup behavior |
| 7 | Actor identity unavailable (`git config user.name` empty) | Orchestrator asks: "Who is approving this gate? (name or ID)". Uses response as `actor`. If no response given, uses `"unknown"`. | `Architect decision — not customer-specified` |
| 8 | Sub-agent crashes mid-task, micro update never sent | No impact — micro updates are best-effort observability markers. The absence of a micro update is not an error condition. | `Architect decision — not customer-specified` |

---

## 9. Hallucination Gate H2 — Self-Check

| Item | Value | Source |
|------|-------|--------|
| 10 canonical macro gates | Listed in §2.1 table | SRS §16 |
| `record_progress` tool name | `record_progress` | F-01 §3.2 (exact string) |
| `notify_slack` tool name | `notify_slack` | F-01 §3.1 (exact string) |
| `record_progress` input fields | `project_id`, `update_text`, `type`, `gate`, `phase`, `source_ref`, `actor`, `flag_override` | F-01 §3.2 `RecordProgressInputSchema` |
| `notify_slack` input fields | `project_id`, `message`, `event_type` | F-01 §3.1 `NotifySlackInputSchema` |
| `record_progress` output: `{ written, pk, sk, reason }` | — | F-01 §3.2 `RecordProgressOutput` |
| `notify_slack` output: `{ notified, reason }` | — | F-01 §3.1 `NotifySlackOutput` |
| project_id = GitHub repository name | — | SRS OQ-02 resolution, Customer (Tariq Khan) 2026-06-11 |
| MCP transport: HTTPS/SSE on port 443 | — | F-01 §2.4 |
| MCP endpoint: `POST /mcp` | — | F-01 §2.4 |
| Auth: `X-API-Key` header | — | F-01 §8.2, SRS NFR-03 |
| Delivery: branch + PR | — | SRS FR-06 AC |
| Non-blocking on MCP failure | — | `Architect decision — not customer-specified` |
| Micro updates: best-effort, non-blocking | — | `Architect decision — not customer-specified` |
| Actor from `git config user.name` | — | `Architect decision — not customer-specified` |
| project_id resolution: env → git remote → config file | — | `Architect decision — not customer-specified` |
| Phase assignments per gate | See §7.3 `GATE_PHASES` | SRS §16 phase column |
| Dedup skip: `{ written: false }` → no `notify_slack` | — | F-01 §5.4 |
| `.kiro/mcp.json` config file | — | `Architect decision — not customer-specified` |
| `KIRO_GOV_MCP_URL` env var | — | `Architect decision — not customer-specified` |
| `KIRO_GOV_MCP_API_KEY` env var | — | `Architect decision — not customer-specified` |
| `KIRO_PROJECT_ID` env var | — | `Architect decision — not customer-specified` |
| Single PR for all agent changes | — | `Architect decision — not customer-specified` |
| Kiro CLI session: no timeout on prompts | — | `Architect decision — not customer-specified` (observed behavior) |
| Micro event example: "domain decomposition done" | — | SRS §4.1 / §5.2 |

---

*End of Agent Integration Architecture v1.2*
