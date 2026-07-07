/**
 * fake-pg.ts — in-memory PostgreSQL harness for CR-13 Level-1 integration tests.
 *
 * Why this exists
 * ---------------
 * CR-13 verifies the GitHub/Slack linkage feature END-TO-END through the REAL handler code
 * (`handleRecordProgress`, `handleNotifySlack`, `resolveProject`, `getProjectTimeline`,
 * `notifyMacroGateApproved`) — NOT by mocking those functions. To do that without a live RDS
 * cluster we mock ONE layer lower than the existing unit tests: the `pg` `Pool` and the
 * `@aws-sdk/rds-signer` `Signer`. Every service under test therefore runs its real SQL string
 * and real branching; only the database engine is swapped for this deterministic in-memory store.
 *
 * pg-mem (a true SQL engine) is NOT installed in this repo, so the router below reproduces the
 * DOCUMENTED semantics of the specific queries the code issues (see timeline.service.ts,
 * postgres.service.ts, macro-notify.service.ts and gates-architecture.md §5.1/§5.3/§5.4). The
 * router intentionally understands only those exact queries — an unrecognised query throws so a
 * drift between code and harness is loud, never silent.
 *
 * External Slack is always mocked separately (slack.service / mcp-client) — this harness only
 * stands in for Postgres.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Row types (mirror the columns the code reads) ────────────────────────────

export interface ProjectSeed {
  jira_key: string;
  github_repo: string | null;
  slack_micro_channel_id?: string | null;
  slack_macro_channel_id?: string | null;
}

export interface GovernanceEventSeed {
  id?: number;
  project_id: string; // the GitHub repo name (Phase-1 key)
  update_text: string;
  type: "macro" | "micro";
  flag_override?: boolean | null;
  gate?: string | null;
  phase?: string | null;
  phase_name?: string | null;
  source_ref: string;
  actor: string;
  idempotency_key: string;
  created_at: string;
}

export interface MacroCheckpointSeed {
  id: number;
  project_id: string; // jira_key
  checkpoint_name: string;
  checkpoint_type?: string;
  phase?: string | null;
  phase_name?: string | null;
  reviewed_by?: string | null;
  result_detail?: string | null;
  reached_at: string | null;
}

export interface GateEvidenceSeed {
  id: number;
  project_id: string; // jira_key
  checkpoint_name: string;
  evidence_type: string;
  label?: string | null;
  uploaded_by?: string | null;
  created_at: string;
}

interface Store {
  projects: ProjectSeed[];
  governance_events: GovernanceEventSeed[];
  macro_checkpoints: MacroCheckpointSeed[];
  gate_evidence: GateEvidenceSeed[];
}

// ── Singleton store (shared by the test file and the jest.mock factory) ──────
// jest returns the same module instance for a given path within a test file, so the mock
// factory (`require('.../fake-pg').pgMock()`) and the test's seed calls hit the SAME store.

export const store: Store = {
  projects: [],
  governance_events: [],
  macro_checkpoints: [],
  gate_evidence: [],
};

let govSeq = 0;

export function resetStore(): void {
  store.projects = [];
  store.governance_events = [];
  store.macro_checkpoints = [];
  store.gate_evidence = [];
  govSeq = 0;
}

export function seedProjects(rows: ProjectSeed[]): void {
  for (const r of rows) {
    store.projects.push({
      slack_micro_channel_id: null,
      slack_macro_channel_id: null,
      ...r,
    });
  }
}

export function seedGovernanceEvents(rows: GovernanceEventSeed[]): void {
  for (const r of rows) {
    store.governance_events.push({ id: ++govSeq, ...r });
  }
}

export function seedMacroCheckpoints(rows: MacroCheckpointSeed[]): void {
  store.macro_checkpoints.push(...rows);
}

export function seedGateEvidence(rows: GateEvidenceSeed[]): void {
  store.gate_evidence.push(...rows);
}

// ── Query router ─────────────────────────────────────────────────────────────

interface FakeResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

function norm(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/**
 * Route a single SQL statement against the in-memory store, reproducing the documented
 * semantics of the exact queries the production code issues.
 */
export function routeQuery(rawSql: string, params: unknown[] = []): FakeResult {
  const sql = norm(rawSql);

  // 1) writeGovernanceEvent — INSERT ... ON CONFLICT (idempotency_key) DO NOTHING
  if (sql.startsWith("INSERT INTO governance_events")) {
    const [
      project_id,
      update_text,
      type,
      flag_override,
      gate,
      phase,
      phase_name,
      source_ref,
      actor,
      idempotency_key,
      created_at,
    ] = params as (string | boolean | null)[];

    const dup = store.governance_events.some(
      (e) => e.idempotency_key === idempotency_key,
    );
    if (dup) {
      return { rows: [], rowCount: 0 }; // ON CONFLICT DO NOTHING
    }
    store.governance_events.push({
      id: ++govSeq,
      project_id: project_id as string,
      update_text: update_text as string,
      type: type as "macro" | "micro",
      flag_override: (flag_override as boolean | null) ?? null,
      gate: (gate as string | null) ?? null,
      phase: (phase as string | null) ?? null,
      phase_name: (phase_name as string | null) ?? null,
      source_ref: source_ref as string,
      actor: actor as string,
      idempotency_key: idempotency_key as string,
      created_at: created_at as string,
    });
    return { rows: [], rowCount: 1 };
  }

  // 2) getProjectTimeline — the WITH timeline_events CTE (gates-architecture.md §5.4)
  if (
    sql.includes("WITH timeline_events AS") &&
    sql.includes("governance_events ge")
  ) {
    const jiraKey = params[0] as string;
    const limit = params[1] as number;
    const cursor = (params[2] as string | null) ?? null;
    return runTimeline(jiraKey, limit, cursor);
  }

  // 3) macro-notify.service — SELECT github_repo FROM projects WHERE jira_key = $1
  if (sql.startsWith("SELECT github_repo FROM projects WHERE jira_key = $1")) {
    const jiraKey = params[0] as string;
    const p = store.projects.find((x) => x.jira_key === jiraKey);
    return p
      ? { rows: [{ github_repo: p.github_repo }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }

  // 4) resolveProject — SELECT jira_key, slack_micro_channel_id, slack_macro_channel_id
  //    FROM projects WHERE github_repo = $1 LIMIT 1
  if (sql.includes("FROM projects") && sql.includes("WHERE github_repo = $1")) {
    const repo = params[0] as string;
    const p = store.projects.find(
      (x) => x.github_repo !== null && x.github_repo === repo,
    );
    return p
      ? {
          rows: [
            {
              jira_key: p.jira_key,
              slack_micro_channel_id: p.slack_micro_channel_id ?? null,
              slack_macro_channel_id: p.slack_macro_channel_id ?? null,
            },
          ],
          rowCount: 1,
        }
      : { rows: [], rowCount: 0 };
  }

  // 5) projectExists — SELECT jira_key FROM projects WHERE jira_key = $1
  if (sql.startsWith("SELECT jira_key FROM projects WHERE jira_key = $1")) {
    const jiraKey = params[0] as string;
    const p = store.projects.find((x) => x.jira_key === jiraKey);
    return p
      ? { rows: [{ jira_key: p.jira_key }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }

  throw new Error(
    `fake-pg: unrecognised query (harness drift): ${sql.slice(0, 120)}`,
  );
}

/**
 * Reproduce the timeline CTE join semantics (timeline.service.ts):
 *   Source 1 governance_events joined via `p.github_repo = ge.project_id`
 *     OR interim `(p.github_repo IS NULL AND p.jira_key = ge.project_id)` — for the project
 *     identified by `p.jira_key = $1`. A LINKED project (github_repo set) therefore surfaces ONLY
 *     events keyed to its repo; an UNLINKED project (github_repo NULL) surfaces only jira_key-keyed
 *     rows (feature switch OFF → zero external governance rows in practice).
 *   Source 2 macro_checkpoints where project_id = $1 AND reached_at IS NOT NULL (app-owned).
 *   Source 3 gate_evidence where project_id = $1.
 * Then: drop null timestamps, apply keyset cursor (timestamp < cursor), ORDER BY timestamp DESC,
 * LIMIT.
 */
function runTimeline(
  jiraKey: string,
  limit: number,
  cursor: string | null,
): FakeResult {
  const project = store.projects.find((p) => p.jira_key === jiraKey);
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const events: Record<string, unknown>[] = [];

  if (project) {
    // Source 1 — governance events (kiro_mcp), joined per the documented predicate.
    for (const ge of store.governance_events) {
      const matches =
        (project.github_repo !== null &&
          project.github_repo === ge.project_id) ||
        (project.github_repo === null && project.jira_key === ge.project_id);
      if (!matches) continue;
      events.push({
        id: `ge-${ge.id}`,
        event_type: "governance_event",
        timestamp: ge.created_at,
        phase: ge.phase ?? null,
        title: ge.gate ?? ge.update_text,
        actor: ge.actor,
        detail: ge.update_text,
        source: "kiro_mcp",
      });
    }
  }

  // Source 2 — macro checkpoint completions (deliverpro, app-owned reached_at).
  for (const mc of store.macro_checkpoints) {
    if (mc.project_id !== jiraKey || mc.reached_at === null) continue;
    events.push({
      id: `mc-${mc.id}`,
      event_type: "checkpoint_completed",
      timestamp: mc.reached_at,
      phase: mc.phase ?? null,
      title: mc.checkpoint_name,
      actor: mc.reviewed_by ?? "system",
      detail: mc.result_detail ?? null,
      source: "deliverpro",
    });
  }

  // Source 3 — evidence attachments (deliverpro).
  for (const ev of store.gate_evidence) {
    if (ev.project_id !== jiraKey) continue;
    const phase =
      store.macro_checkpoints.find(
        (mc) =>
          mc.project_id === ev.project_id &&
          mc.checkpoint_name === ev.checkpoint_name,
      )?.phase ?? null;
    events.push({
      id: `ev-${ev.id}`,
      event_type: "evidence_attached",
      timestamp: ev.created_at,
      phase,
      title: `${ev.checkpoint_name} — ${ev.evidence_type}`,
      actor: ev.uploaded_by ?? null,
      detail: ev.label ?? null,
      source: "deliverpro",
    });
  }

  const filtered = events
    .filter((e) => e.timestamp != null)
    .filter((e) => cursor === null || String(e.timestamp) < cursor)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, safeLimit);

  return { rows: filtered, rowCount: filtered.length };
}

// ── pg / rds-signer mock factories ───────────────────────────────────────────

/** A fake `pg.Pool` whose `query` routes through the in-memory store. */
class FakePool {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(_config?: any) {
    /* config (host/ssl/token) is irrelevant — no real connection is made. */
  }

  async query(sql: string, params?: unknown[]): Promise<FakeResult> {
    return routeQuery(sql, params ?? []);
  }

  async end(): Promise<void> {
    /* no-op */
  }
}

/** Factory for `jest.mock('pg', () => require('.../fake-pg').pgMock())`. */
export function pgMock(): { Pool: typeof FakePool } {
  return { Pool: FakePool };
}

/** Factory for `jest.mock('@aws-sdk/rds-signer', () => require('.../fake-pg').rdsSignerMock())`. */
export function rdsSignerMock(): {
  Signer: new () => { getAuthToken: () => Promise<string> };
} {
  return {
    Signer: class {
      async getAuthToken(): Promise<string> {
        return "fake-iam-token";
      }
    },
  };
}

/**
 * Ensure the RDS CA bundle path the mcp-server postgres.service reads at pool creation points at a
 * real (dummy) file, so `readFileSync` does not throw when the (mocked) Pool is constructed.
 * Called once at module load.
 */
function ensureCaBundle(): void {
  if (!process.env.RDS_CA_BUNDLE_PATH) {
    const dir = mkdtempSync(join(tmpdir(), "kiro-gov-ca-"));
    const caPath = join(dir, "rds-ca-bundle.pem");
    writeFileSync(
      caPath,
      "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n",
    );
    process.env.RDS_CA_BUNDLE_PATH = caPath;
  }
  // Minimal env the pool constructors read (values are irrelevant — Pool is mocked).
  process.env.DB_ENDPOINT ??= "localhost";
  process.env.DB_PORT ??= "5432";
  process.env.DB_NAME ??= "kiro_governance";
  process.env.DB_USER ??= "kiro_mcp";
  process.env.AWS_REGION ??= "us-east-1";
}

ensureCaBundle();
