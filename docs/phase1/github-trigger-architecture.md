# GitHub Trigger Architecture — F-03: GitHub Actions Governance Trigger

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-07-02 | v1.4 | AWS Architect | GitHub↔Slack linkage CR (v3 Final Design of Record). CI script now owns the **MICRO** path: `record_progress` with `type:'micro'` + `flag_override:true` + a **non-gate** `update_text`, and `notify_slack` with `event_type:'micro'` (micro channel). Unlinked repos are **hard-rejected** by `record_progress` (`no_matching_project`) — the script logs and continues (feature switch). Gate-name matching, if retained, builds a human-readable label ONLY and no longer implies `type:'macro'`. Retained **CLI-macro path** (PLAN-H2, gated on the 2026-07-02 go-ahead) for pure-Kiro-CLI repos with no in-app approver: emits a display-only macro event + macro-channel notify. GitHub OIDC per-repo identity (SEC-H2/H3) is **deferred** from this build. See §0 overlay. |
| 2026-06-11 | v1.3 | AWS Architect | Security Gate 1 NEW-1: replaced fetch()+NODE_TLS_REJECT_UNAUTHORIZED=0 with https.request()+checkServerIdentity fingerprint pinning. Removed unauthenticated TLS bypass. |
| 2026-06-11 | v1.2 | AWS Architect | Security Gate 1 fixes: HTTPS call (HIGH-1), cert fingerprint secret (HIGH-1), permissions block (MED-6). |
| 2026-06-11 | v1.1 | AWS Architect | Added npm run build step to workflow YAML (FINDING-1), clarified type parameter pass-through (FINDING-2). |
| 2026-06-11 | v1.0 | AWS Architect | Initial architecture doc for F-03 from SRS v1.5, F-01 v1.1, F-04 v1.1, domain decomposition v1.0 |

---

## 0. v3 GitHub/Slack Linkage CR — Authoritative Behavior Overlay

> **AUTHORITATIVE (2026-07-02).** Under the linkage CR (`docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md`
> §v3-6.1), the CI/GitHub-Actions path becomes the **MICRO** notification source (the DeliverPro app
> owns MACRO — no double-notify). Where the older §3–§4 prose says `type:'macro'` / `event_type:'macro'`,
> **this section wins**; the §3.4 script and §4.2/§4.3 param tables are updated to match.

### 0.1 CI script → MICRO (Decision F)

- `record_progress` call changes from `type:'macro'` to **`type:'micro'`**, and MUST also pass
  **`flag_override: true`** and build `update_text` from a **non-gate label** (e.g. `"Progress update: <file> changed"`, NOT the canonical gate name). Both safeguards are required so the event persists as `type='micro'`: (a) the `classifyEvent` fix (mcp-server-core §0.3/§4.2) makes an explicit `type` authoritative; (b) a non-gate `update_text` + `flag_override:true` prevents any accidental substring re-classification. A stored `type='macro'` from the CI path is a defect (FR-P2-040 AC).
- `notify_slack` call changes from `event_type:'macro'` to **`event_type:'micro'`** → routes to `slack_micro_channel_id`.
- The gate-name match, if retained, is used ONLY to build a human-readable message label — it no longer implies `type:'macro'` and never drives macro completion.

### 0.2 No-orphan (Decision G)

If `PROJECT_ID` (the repo name) does not resolve to a linked project, `record_progress` returns `{ written:false, reason:'no_matching_project' }`; the script logs and **continues** (non-blocking) — consistent with the optional-linkage feature switch (unlinked repos produce nothing). Do not fail the workflow on `no_matching_project`.

### 0.3 CLI-macro backward-compat path (PLAN-H2 — retained per 2026-07-02 go-ahead)

For a linked repo that has **no in-app macro approver** (pure Kiro-CLI), the CI script MAY emit a macro governance event (`type:'macro'`, `flag_override:true`) that is **display-only** — it surfaces on the timeline and triggers the **macro-channel** notification (`notify_slack event_type:'macro'`) but does NOT set `macro_checkpoints.reached_at` (macro completion stays app-owned — `gates-architecture.md` §5.3). This preserves the demoed "progress-MD → gate → Slack" behaviour for CLI-only repos.

### 0.4 Micro Slack source is the CI script only (PLAN-I1)

Only the adapted CI script triggers a micro Slack post. Kiro sub-agents that call `record_progress type:'micro'` directly (per the steering "Micro Logging" sections) persist the event and surface it on the timeline (Level 1) but do NOT themselves call `notify_slack` — they do not post to the micro channel. A curated notify subset for direct sub-agent events is a separate future change (OQ-CR-16).

### 0.5 Identity — deferred (SEC-H2/H3)

GitHub OIDC per-repo identity (which would let the MCP verify the asserted repo == the authenticated repository, closing cross-project mis-attribution) is **deferred** from this build. Level 1 ships under the recorded POC risk-accept (see `mcp-server-core-architecture.md` §0.6 and `docs/phase2/srs.md` §NFR security). Under the shared API key + `X-API-Key` model, treat `PROJECT_ID` as caller-asserted.

---

**Domain:** GitHub Trigger
**Feature:** F-03 — GitHub Actions Governance Trigger
**Purpose:** Detect `project-progress.md` changes on push to `main`, parse diffs for macro-gate lingo, and invoke MCP server tools (`record_progress` + `notify_slack`) for matching events. This provides a redundant governance capture path alongside the orchestrator hook (F-02).

**FRs Owned:**

| FR | Title | Summary |
|----|-------|---------|
| FR-04 | GitHub Actions Workflow — Parse `project-progress.md` on Commit | Diff file, match macro-gate lingo, call MCP server for macro events only |

> Source: SRS §8 FR-04, Project Brief §3 step 5

**Dependencies:**

| Dependency | Document | What F-03 Consumes |
|-----------|----------|-------------------|
| F-01 — MCP Server Core | `docs/phase1/mcp-server-core-architecture.md` v1.1 | Tool schemas: `record_progress`, `notify_slack` — exact input/output shapes; shared gate list (`MACRO_GATES`, `MACRO_GATE_ALIASES`); classification algorithm (case-insensitive substring) |
| F-04 — Data & Persistence | `docs/phase1/data-persistence-architecture.md` v1.1 | Conditional PutItem dedup pattern — F-03 does NOT implement its own dedup |

---

## 2. GitHub Actions Workflow Design

### 2.1 Workflow File

**File:** `.github/workflows/governance-trigger.yml`

### 2.2 Trigger Configuration

| Property | Value | Source |
|----------|-------|--------|
| Event | `push` | SRS FR-04: "commit/merge to main branch" |
| Branch | `main` | SRS FR-04 AC |
| Path filter | `docs/project-progress.md` | SRS FR-04: "triggers when `project-progress.md` is committed" |
| `fetch-depth` | `2` | `Architect decision — not customer-specified` — minimum depth for single-commit diff |

### 2.3 Complete Workflow YAML

```yaml
name: Governance Trigger

on:
  push:
    branches: [main]
    paths: ['docs/project-progress.md']

permissions:
  contents: read

jobs:
  governance-check:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout with history for diff
        uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci
        working-directory: packages/shared

      - name: Build shared package
        run: npm run build
        working-directory: packages/shared

      - name: Extract diff and process macro gates
        id: process
        env:
          MCP_SERVER_URL: ${{ secrets.MCP_SERVER_URL }}
          MCP_API_KEY: ${{ secrets.MCP_API_KEY }}
          MCP_CERT_FINGERPRINT: ${{ secrets.MCP_CERT_FINGERPRINT }}
          PROJECT_ID: ${{ github.event.repository.name }}
          ACTOR: ${{ github.actor }}
          SOURCE_REF: ${{ github.sha }}
        run: node scripts/governance-trigger.js
```

> Source: SRS FR-04 AC — "Extract the diff (new/changed lines)", "For macro entries: call MCP server Slack tool (FR-01) AND DynamoDB tool (FR-02)". `Architect decision — not customer-specified:` workflow structure.

> `Architect decision — not customer-specified:` Explicit least-privilege `permissions: contents: read` block prevents permission inheritance from repo defaults. The workflow only reads the repo (checkout + diff).

---

## 3. Diff Parsing Logic

### 3.1 Extraction Strategy

The script extracts only **new lines** from the diff of `docs/project-progress.md`:

1. Run `git diff HEAD~1 HEAD -- docs/project-progress.md`
2. Read stdout line by line
3. **Include** lines starting with `+` (added lines)
4. **Skip** lines starting with `+++` (file metadata)
5. **Skip** lines starting with `-` (removed lines)
6. **Skip** lines starting with `@@` (hunk headers)
7. **Skip** blank/whitespace-only lines after stripping the leading `+`

### 3.2 Gate Matching

Uses the **same algorithm** as F-01 §4.2: **case-insensitive substring matching** against the canonical `MACRO_GATES` list and `MACRO_GATE_ALIASES`.

> Source: F-01 §4.2 — "Case-insensitive substring matching chosen over regex or exact match."

**Matching rule:** For each extracted line, check if `line.toLowerCase()` contains any `gate.toLowerCase()` from `MACRO_GATES`, or any alias key from `MACRO_GATE_ALIASES`. First match wins.

### 3.3 Implementation

> `Architect decision — not customer-specified:` **Node.js script** (JavaScript) in `scripts/governance-trigger.js` over inline bash.

**Justification:**

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| Inline bash | Zero dependencies; simple for trivial logic | String matching in bash is fragile; cannot import shared constants from TypeScript modules; poor error handling | ❌ Rejected |
| **Node.js script** | Can `require()` the shared gate constants from `packages/shared`; proper error handling; testable; matches MCP server language (TypeScript/Node.js) | Requires `npm ci` step in workflow | ✅ Selected |

### 3.4 Script Implementation

**File:** `scripts/governance-trigger.js`

```javascript
#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const { MACRO_GATES, MACRO_GATE_ALIASES } = require('../packages/shared/dist/constants/macro-gates');

const MCP_SERVER_URL = process.env.MCP_SERVER_URL;
const MCP_API_KEY = process.env.MCP_API_KEY;
const PROJECT_ID = process.env.PROJECT_ID;
const ACTOR = process.env.ACTOR;
const SOURCE_REF = process.env.SOURCE_REF;

if (!MCP_SERVER_URL || !MCP_API_KEY || !PROJECT_ID) {
  console.error('Missing required environment variables: MCP_SERVER_URL, MCP_API_KEY, PROJECT_ID');
  process.exit(1);
}

/**
 * Extract added lines from git diff of project-progress.md.
 */
function extractAddedLines() {
  let diff;
  try {
    diff = execSync('git diff HEAD~1 HEAD -- docs/project-progress.md', { encoding: 'utf8' });
  } catch {
    console.log('No diff available or file does not exist. Exiting cleanly.');
    process.exit(0);
  }

  return diff
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .map(line => line.slice(1).trim())
    .filter(line => line.length > 0);
}

/**
 * Match a line against canonical macro gates (case-insensitive substring).
 * Returns the canonical gate name or null.
 */
function matchGate(line) {
  const lower = line.toLowerCase();

  for (const gate of MACRO_GATES) {
    if (lower.includes(gate.toLowerCase())) {
      return gate;
    }
  }

  for (const [alias, canonical] of Object.entries(MACRO_GATE_ALIASES)) {
    if (lower.includes(alias.toLowerCase())) {
      return canonical;
    }
  }

  return null;
}

/**
 * Call MCP server tool via HTTPS POST with pinned certificate fingerprint verification.
 */
async function callMcpTool(toolName, params) {
  const certFingerprint = process.env.MCP_CERT_FINGERPRINT; // SHA-256 hex, e.g. "AA:BB:CC:..."
  const apiKey = MCP_API_KEY;
  const [host, port] = MCP_SERVER_URL.replace('https://', '').split(':');
  const body = JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: toolName, arguments: params },
    id: `${toolName}-${Date.now()}`,
  });

  const https = require('https');

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        port: port ?? 443,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          'Content-Length': Buffer.byteLength(body),
        },
        checkServerIdentity: (_host, cert) => {
          // Verify against pinned SHA-256 fingerprint (colon-delimited hex)
          const actual = cert.fingerprint256; // Node format: 'AA:BB:CC:...'
          if (actual !== certFingerprint) {
            return new Error(`TLS cert fingerprint mismatch: expected ${certFingerprint}, got ${actual}`);
          }
          return undefined; // OK
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(JSON.parse(data)));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const addedLines = extractAddedLines();

  if (addedLines.length === 0) {
    console.log('No new lines in project-progress.md. Exiting cleanly.');
    process.exit(0);
  }

  const macroEntries = [];
  for (const line of addedLines) {
    const gate = matchGate(line);
    if (gate) {
      macroEntries.push({ line, gate });
    }
  }

  if (macroEntries.length === 0) {
    console.log('No macro-gate entries detected. Exiting cleanly.');
    process.exit(0);
  }

  console.log(`Found ${macroEntries.length} macro-gate entries.`);

  let failures = 0;
  for (const { line, gate } of macroEntries) {
    console.log(`Processing gate: "${gate}" from line: "${line}"`);

    try {
      // Call record_progress — MICRO path (v3 §0.1). Explicit type:'micro' + flag_override:true +
      // a NON-GATE update_text so no substring re-classifies it to macro. `gate` is passed only to
      // build the human-readable label; it does NOT imply macro.
      const recordResult = await callMcpTool('record_progress', {
        project_id: PROJECT_ID,
        update_text: `Progress update: docs/project-progress.md — ${gate}`, // non-gate-leading label
        type: 'micro',
        flag_override: true,
        gate,
        source_ref: SOURCE_REF,
        actor: ACTOR,
      });

      const content = recordResult?.result?.content?.[0]?.text;
      const parsed = content ? JSON.parse(content) : {};

      // No-orphan (v3 §0.2): unlinked repo → not stored; log and continue (non-blocking).
      if (parsed.reason === 'no_matching_project') {
        console.log(`  → Repo "${PROJECT_ID}" not linked to a project. Skipping (feature switch off).`);
        continue;
      }
      if (parsed.written === false) {
        console.log(`  → Duplicate (already recorded). Skipping notify_slack.`);
        continue;
      }

      // Call notify_slack (MICRO channel) only if record_progress succeeded with written: true.
      await callMcpTool('notify_slack', {
        project_id: PROJECT_ID,
        message: `${gate} — committed by ${ACTOR} (ref: ${SOURCE_REF.slice(0, 7)})`,
        event_type: 'micro',
      });

      console.log(`  → Recorded (micro) and notified micro channel.`);
    } catch (err) {
      console.error(`  → ERROR: ${err.message}`);
      failures++;
    }
  }

  if (failures > 0) {
    console.error(`${failures} MCP call(s) failed.`);
    process.exit(1);
  }
}

main();
```

---

## 4. MCP Server Calls

### 4.1 Call Sequence

For each matched macro entry in the diff:

1. **Call `record_progress`** → write governance event to DynamoDB
2. **If `written: true`** → Call `notify_slack` → send Slack notification
3. **If `written: false` (duplicate)** → Skip `notify_slack`, continue to next entry

> Source: F-01 §5.4 — "the caller must not proceed with `notify_slack` on duplicate"

### 4.2 `record_progress` Parameters

```json
{
  "project_id": "${{ github.event.repository.name }}",
  "update_text": "<raw line from diff>",
  "type": "macro",
  "gate": "<matched canonical gate name>",
  "source_ref": "${{ github.sha }}",
  "actor": "${{ github.actor }}"
}
```

| Parameter | Value Source | Notes |
|-----------|-------------|-------|
| `project_id` | `github.event.repository.name` | SRS OQ-02: "project_id = GitHub repository name". Source: Customer (Tariq Khan) 2026-06-11 |
| `update_text` | Raw added line from diff | The actual text from `project-progress.md` |
| `type` | `"macro"` (hardcoded) | Workflow only processes macro matches |
| `gate` | Canonical gate name from `MACRO_GATES` | Resolved by matching algorithm |
| `source_ref` | `github.sha` | Commit SHA that triggered the workflow |
| `actor` | `github.actor` | GitHub username of the committer |

> `Architect decision — not customer-specified:` The `type: 'macro'` parameter is passed as a documentation aid. F-01 re-classifies from `update_text` internally (`flag_override` is absent). The result is always `'macro'` since the workflow only processes matched gate entries. Omitting `type` is also valid.

### 4.3 `notify_slack` Parameters

```json
{
  "project_id": "${{ github.event.repository.name }}",
  "message": "<gate name> — committed by <actor> (ref: <short SHA>)",
  "event_type": "macro"
}
```

> Source: F-01 §3.1 — `NotifySlackInputSchema` requires `project_id`, `message`, `event_type`.

### 4.4 HTTP Transport

| Property | Value | Source |
|----------|-------|--------|
| URL | `${MCP_SERVER_URL}` (resolves to `https://<elastic-ip>:443/mcp`) | F-01 §2.4 |
| Method | `POST` | MCP Streamable HTTP spec |
| Auth header | `X-API-Key: ${MCP_API_KEY}` | F-01 §8.2, SRS NFR-03 |
| Content-Type | `application/json` | MCP protocol |
| Body format | JSON-RPC 2.0 with `tools/call` method | MCP Streamable HTTP spec |
| TLS | Self-signed cert on EC2; `https.request()` with `checkServerIdentity` performs pinned fingerprint verification | `Architect decision — not customer-specified` |
| Cert verification | `checkServerIdentity` callback in `callMcpTool()` (§3.4) verifies server cert SHA-256 fingerprint against `MCP_CERT_FINGERPRINT` env var at connection time | `Architect decision — not customer-specified` |

> `Architect decision — not customer-specified:` fetch() cannot perform per-cert fingerprint pinning without third-party libraries. https.request() with checkServerIdentity is used instead. MCP_CERT_FINGERPRINT must be the SHA-256 fingerprint in Node.js colon-delimited hex format (e.g. AA:BB:CC:...), obtainable via: `openssl x509 -in cert.pem -noout -fingerprint -sha256`

> `Architect decision — not customer-specified:` Self-signed cert (Option B) chosen for POC to eliminate plaintext key transmission at zero additional cost. Upgrade to ACM+ALB for production.

### 4.5 Secret Sources

| Secret | GitHub Config Type | Purpose |
|--------|-------------------|---------|
| `MCP_API_KEY` | GitHub Encrypted Secret | Authenticates to MCP server; matches SSM `/kiro-governance/config/mcp-api-key` |
| `MCP_SERVER_URL` | GitHub Encrypted Secret | MCP server endpoint URL (contains IP, treat as sensitive) |
| `MCP_CERT_FINGERPRINT` | GitHub Encrypted Secret | SHA-256 fingerprint of the MCP server's self-signed TLS certificate; used for pinned cert verification |

> `Architect decision — not customer-specified:` `MCP_SERVER_URL` stored as a secret (not a variable) because it contains the EC2 Elastic IP which should not be exposed in workflow logs. `MCP_CERT_FINGERPRINT` stored as a secret to prevent an attacker from knowing the expected fingerprint.

### 4.6 Error Handling

> `Architect decision — not customer-specified:` **Fail the workflow** if any MCP call fails.

| Option | Behavior | Verdict |
|--------|----------|---------|
| Fail on error | Workflow exits with non-zero status; visible red ✗ in GitHub Actions UI; team investigates | ✅ Selected |
| Log and pass | Workflow succeeds silently; governance gaps go unnoticed | ❌ Rejected |

**Justification:** The GitHub Actions path is a redundant governance capture mechanism. If it fails, the team must be alerted so they can verify the orchestrator path captured the event. A green checkmark on a failed governance write gives false confidence.

---

## 5. Shared Gate List

### 5.1 Source of Truth

The canonical gate list lives in:

```
packages/shared/constants/macro-gates.ts
```

This module exports `MACRO_GATES` (10-element readonly array) and `MACRO_GATE_ALIASES` (3-entry mapping). See F-01 §4.1 for exact content.

> Source: F-01 §4.4 — "Location: packages/shared/constants/macro-gates.ts"

### 5.2 How the Workflow Accesses It

> `Architect decision — not customer-specified:` **Option (c) — monorepo import.** The workflow script lives in the same repository as the MCP server and imports the shared module directly.

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| (a) Inline constant in script | Zero dependencies; self-contained | Duplicates the gate list; divergence risk; violates DRY | ❌ Rejected |
| (b) Fetch from shared config file (JSON) | Language-agnostic | Extra I/O; config file must be kept in sync with TypeScript module | ❌ Rejected |
| **(c) Monorepo import** | Single source of truth; zero duplication; TypeScript module is the canonical list per F-01 §4.4 | Requires `npm ci` in workflow to resolve module | ✅ Selected |

**Justification:** The domain decomposition (§6 Note 5) explicitly states: "The source-of-truth gate list must be shared." The monorepo structure already exists (`packages/shared/constants/macro-gates.ts`). The `npm ci` step is a ~5s cost for correctness guarantee.

### 5.3 Module Resolution

The script uses `require('../packages/shared/dist/constants/macro-gates.js')`. This requires:
1. The `packages/shared` directory has a `package.json` with a valid build script
2. The workflow runs `npm ci` followed by `npm run build` in `packages/shared` before executing the script
3. The TypeScript source (`macro-gates.ts`) is compiled to `dist/constants/macro-gates.js` at CI time

> `Architect decision — not customer-specified:` The workflow builds the shared package at CI time; the script imports the compiled `dist/constants/macro-gates.js`. This ensures the canonical gate list is always sourced from the TypeScript module without requiring a runtime TypeScript compiler in the workflow.

---

## 6. Security

### 6.1 Secrets Management

| Secret | Storage | Access |
|--------|---------|--------|
| MCP API key | GitHub Encrypted Secret `MCP_API_KEY` | Available to workflow via `${{ secrets.MCP_API_KEY }}` |
| MCP server URL | GitHub Encrypted Secret `MCP_SERVER_URL` | Available to workflow via `${{ secrets.MCP_SERVER_URL }}` |
| MCP cert fingerprint | GitHub Encrypted Secret `MCP_CERT_FINGERPRINT` | Available to workflow via `${{ secrets.MCP_CERT_FINGERPRINT }}` |

> Source: SRS NFR-03, OQ-04 — "GitHub Actions will use GitHub Encrypted Secrets for the MCP server API key."

**Secret lifecycle:**
- Set by repository admin via GitHub Settings → Secrets and variables → Actions
- `MCP_API_KEY` must match the value stored in SSM `/kiro-governance/config/mcp-api-key`
- `MCP_CERT_FINGERPRINT` must match the SHA-256 fingerprint of the cert on the EC2 instance (updated on cert rotation)
- Rotated by updating both GitHub Secret and SSM parameter (or EC2 cert) simultaneously

### 6.2 Network Security — EC2 Security Group

The MCP server EC2 security group (`kiro-gov-mcp-server-sg`) must allow inbound from GitHub Actions runner IPs:

| Rule | Protocol | Port | Source | Purpose |
|------|----------|------|--------|---------|
| Inbound | TCP | 443 | 0.0.0.0/0 | Workflow → MCP server HTTPS calls |

> Source: F-01 §2.5 — Security group allows inbound port 443 from 0.0.0.0/0 (GitHub Actions dynamic IPs make allowlisting impractical).

**GitHub Actions IP ranges** are published at `https://api.github.com/meta` under the `actions` key. For POC, allow the full CIDR list.

> `Architect decision — not customer-specified:` For production, consider GitHub Actions OIDC + VPC PrivateLink to eliminate public IP exposure.

### 6.3 API Key Authentication

Every HTTP request from the workflow to the MCP server includes:

```
X-API-Key: <value from MCP_API_KEY secret>
```

The MCP server validates this header against its cached API key (loaded from SSM at startup). Requests without a valid key receive HTTP 401.

> Source: F-01 §8.2 — "Authentication: GitHub Actions includes X-API-Key header"

### 6.4 Workflow Permissions

The workflow declares an explicit `permissions: contents: read` block (see §2.3). This scopes the GITHUB_TOKEN to read-only, preventing permission inheritance from repository defaults.

> `Architect decision — not customer-specified:` Explicit least-privilege permissions block prevents permission inheritance from repo defaults. The workflow only needs to read repository contents (for checkout and diff).

---

## 7. Deduplication Coordination with Orchestrator Path

### 7.1 How Dedup Works

Both trigger paths (F-02 orchestrator hook and F-03 GitHub Actions) call the same `record_progress` MCP tool. That tool implements the **conditional PutItem dedup sentinel pattern** (F-04 §4.2):

1. Build idempotency key: `<project_id>#<gate>#<YYYY-MM-DD>`
2. Attempt PutItem for `DEDUP#<key>` sentinel with `attribute_not_exists(pk)` condition
3. First writer wins; second gets `ConditionalCheckFailedException` → returns `{ written: false, reason: 'duplicate' }`

> Source: F-04 §4.2, F-01 §5.3

### 7.2 What F-03 Does NOT Do

**The workflow does NOT implement its own deduplication logic.** The MCP server (F-01) handles all dedup. The workflow simply:

1. Calls `record_progress`
2. Checks the `written` field in the response
3. Calls `notify_slack` only if `written: true`

> `Architect decision — not customer-specified:` This is a critical implementation note for developers. **Do not add dedup checks in the workflow** (no "check if already recorded before calling"). The MCP server's atomic conditional write is the single dedup enforcement point. Adding workflow-level dedup creates a race condition window between the check and the write.

### 7.3 Race Condition Handling

If both F-02 (agent hook) and F-03 (GitHub workflow) fire for the same gate on the same day:

- Both call `record_progress` with the same `project_id` + `gate` + date
- DynamoDB conditional write is atomic per item — exactly one succeeds
- The loser receives `{ written: false, reason: 'duplicate' }` and skips Slack
- Result: exactly one DynamoDB record and one Slack notification

> Source: F-04 §8.2 — "DynamoDB strongly consistent writes on same PK/SK guarantee no corruption."

---

## 8. Edge Cases

| # | Scenario | Handling | Source |
|---|----------|----------|--------|
| 1 | Commit has no new macro-gate lines | Script calls `extractAddedLines()`, finds no matches, logs "No macro-gate entries detected", exits with code 0 (workflow passes). | `Architect decision — not customer-specified` |
| 2 | MCP server unreachable (connection timeout/refused) | `https.request()` emits `error` event; caught in promise rejection; failure counter increments; after processing all entries, workflow exits with code 1 (red ✗ in GitHub UI). | `Architect decision — not customer-specified` |
| 3 | `project-progress.md` deleted or renamed | `git diff` returns empty output (file no longer exists at HEAD); script exits cleanly with code 0. Path filter in workflow prevents trigger if file path changes. | `Architect decision — not customer-specified` |
| 4 | Multiple macro events in one commit | Each matched line is processed sequentially. Each gets its own `record_progress` + `notify_slack` call pair. Dedup sentinel is per-gate-per-day, so different gates in the same commit all succeed. Same gate appearing multiple times: first write wins, subsequent are dedup'd. | F-04 §8.4, `Architect decision — not customer-specified` |
| 5 | GitHub Actions runner IP not allowlisted on EC2 | HTTP request to MCP server times out or receives connection refused. Workflow fails (exit code 1). **Resolution:** Update EC2 security group with current GitHub Actions CIDR ranges from `https://api.github.com/meta`. | `Architect decision — not customer-specified` |
| 6 | MCP server returns HTTP 401 (invalid API key) | Script throws on non-2xx response; logs error including status code; workflow fails. **Resolution:** Verify `MCP_API_KEY` GitHub Secret matches SSM `/kiro-governance/config/mcp-api-key`. | `Architect decision — not customer-specified` |
| 7 | Merge commit with multiple parents (squash/rebase) | `fetch-depth: 2` ensures `HEAD~1` is available. For squash merges, `HEAD~1` is the previous main branch tip — diff captures all squashed changes. | `Architect decision — not customer-specified` |
| 8 | `project-progress.md` has only removed lines (deletions) | `extractAddedLines()` filters for `+` prefix lines only; no added lines → no matches → clean exit. | `Architect decision — not customer-specified` |
| 9 | Concurrent workflow runs (rapid successive pushes to main) | GitHub Actions runs each push event independently. Each run processes its own commit's diff. Dedup sentinel prevents double-recording if both commits add the same gate entry. | `Architect decision — not customer-specified` |

---

## 9. Hallucination Gate H2 — Self-Check

| Item | Value | Source |
|------|-------|--------|
| Workflow file: `.github/workflows/governance-trigger.yml` | — | SRS FR-04: "`.github/workflows/governance-trigger.yml`" |
| Trigger: push to main, path filter `docs/project-progress.md` | — | SRS FR-04 AC |
| `fetch-depth: 2` | — | `Architect decision — not customer-specified` |
| `record_progress` tool name | `record_progress` | F-01 §3.2 (exact string) |
| `notify_slack` tool name | `notify_slack` | F-01 §3.1 (exact string) |
| `record_progress` parameters: `project_id`, `update_text`, `type`, `gate`, `source_ref`, `actor` | — | F-01 §3.2 `RecordProgressInputSchema` |
| `notify_slack` parameters: `project_id`, `message`, `event_type` | — | F-01 §3.1 `NotifySlackInputSchema` |
| `project_id` = `github.event.repository.name` | — | SRS OQ-02 resolution, Customer (Tariq Khan) 2026-06-11 |
| `actor` = `github.actor` | — | `Architect decision — not customer-specified` |
| `source_ref` = commit SHA (`github.sha`) | — | `Architect decision — not customer-specified` |
| MCP server URL from GitHub Secret `MCP_SERVER_URL` | — | `Architect decision — not customer-specified` |
| API key from GitHub Secret `MCP_API_KEY` | — | SRS NFR-03, OQ-04 |
| Auth header: `X-API-Key` | — | F-01 §8.2 |
| MCP endpoint: `POST /mcp` | — | F-01 §2.4 |
| Transport: HTTPS/JSON-RPC 2.0 (self-signed TLS) | — | F-01 §2.4, MCP Streamable HTTP spec |
| Shared gate list: `packages/shared/constants/macro-gates.ts` | — | F-01 §4.4 |
| 10 canonical macro gates | Listed in F-01 §4.1 | SRS §16 |
| Matching algorithm: case-insensitive substring | — | F-01 §4.2 (`Architect decision`) |
| Gate aliases (3 alternates) | — | F-01 §4.1, SRS §16 slash-separated variants |
| Dedup handled by MCP server, not workflow | — | F-01 §5.4, F-04 §4.2 |
| Dedup key: `<project_id>#<gate>#<YYYY-MM-DD>` | — | SRS FR-09, F-04 §4.1 |
| Duplicate response: `{ written: false, reason: 'duplicate' }` → skip `notify_slack` | — | F-01 §5.4 |
| Workflow fails on MCP error (non-silent) | — | `Architect decision — not customer-specified` |
| Workflow processes macro events only | — | SRS FR-04 AC, SRS §11 resolved decision |
| GitHub Actions IP allowlist on EC2 SG | — | F-01 §2.5 |
| EC2 port 443 | — | F-01 §2.4 |
| Node.js 20 runtime in workflow | — | `Architect decision — not customer-specified` (matches F-01 §2.1) |

---

*End of GitHub Trigger Architecture v1.3*
