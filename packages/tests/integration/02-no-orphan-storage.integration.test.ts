/**
 * CR-13 Level-1 integration test — NO-ORPHAN governance event storage.
 *
 * Source: change-requests/2026-07-02-github-slack-linkage-impact.md v3-8 CR-13;
 *         FR-P2-038 (No-Orphan Governance Event Storage), Decision G.
 *
 * Verifies through the REAL `handleRecordProgress` → REAL `resolveProject` / `writeGovernanceEvent`
 * (postgres.service) against the in-memory fake-pg harness:
 *   • record_progress for an UNMAPPED repo is NOT written and returns
 *     { written: false, reason: 'no_matching_project' } — nothing is persisted.
 *   • record_progress for a MAPPED repo IS written ({ written: true }) and lands in the table.
 *   • Resolve-or-reject applies to BOTH macro and micro events.
 *   • The rejection emits a dimensionless GovernanceEventRejected metric (repo is NOT a dimension).
 *
 * Only Postgres is faked; `handleRecordProgress`, `resolveProject`, `writeGovernanceEvent` and
 * `classifyEvent` all run for real.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

jest.mock("pg", () => require("./helpers/fake-pg").pgMock());
jest.mock("@aws-sdk/rds-signer", () =>
  require("./helpers/fake-pg").rdsSignerMock(),
);

import { resetStore, seedProjects, store } from "./helpers/fake-pg";
import { handleRecordProgress } from "../../mcp-server/src/tools/record-progress";

describe("CR-13 · NO-ORPHAN storage (FR-P2-038 / Decision G)", () => {
  let logSpy: jest.SpiedFunction<typeof console.log>;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    resetStore();
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("UNMAPPED repo → not written, reason no_matching_project, nothing persisted", async () => {
    seedProjects([{ jira_key: "DP-001", github_repo: "deliverpro" }]);

    const result = await handleRecordProgress({
      project_id: "unlinked-repo",
      update_text: "SRS approved",
      gate: "SRS approved",
      source_ref: "abc123",
      actor: "human",
    });

    expect(result).toEqual({ written: false, reason: "no_matching_project" });
    // Hard reject — the append-only table stays empty.
    expect(store.governance_events).toHaveLength(0);
  });

  it("MAPPED repo (macro) → written and persisted with the repo as project_id", async () => {
    seedProjects([{ jira_key: "DP-001", github_repo: "deliverpro" }]);

    const result = await handleRecordProgress({
      project_id: "deliverpro",
      update_text: "SRS approved",
      gate: "SRS approved",
      source_ref: "abc123",
      actor: "human",
    });

    expect(result).toEqual({ written: true });
    expect(store.governance_events).toHaveLength(1);
    const row = store.governance_events[0];
    expect(row.project_id).toBe("deliverpro"); // project_id stays the repo name (unchanged)
    expect(row.type).toBe("macro");
    expect(row.gate).toBe("srs approved"); // normalized lower-case gate
  });

  it("MAPPED repo (micro) → written; resolve-or-reject applies to micro too", async () => {
    seedProjects([{ jira_key: "DP-002", github_repo: "deliverpro" }]);

    const result = await handleRecordProgress({
      project_id: "deliverpro",
      update_text: "Domain decomposition done",
      type: "micro",
      source_ref: "docs/domain-decomposition.md",
      actor: "aws-architect",
    });

    expect(result).toEqual({ written: true });
    expect(store.governance_events).toHaveLength(1);
    expect(store.governance_events[0].type).toBe("micro");
  });

  it("UNMAPPED repo (micro) → also hard-rejected", async () => {
    seedProjects([{ jira_key: "DP-003", github_repo: "deliverpro" }]);

    const result = await handleRecordProgress({
      project_id: "unlinked-repo",
      update_text: "Feature list defined",
      type: "micro",
      source_ref: "docs/feature-list.md",
      actor: "aws-architect",
    });

    expect(result).toEqual({ written: false, reason: "no_matching_project" });
    expect(store.governance_events).toHaveLength(0);
  });

  it("rejection emits a dimensionless GovernanceEventRejected metric; repo only in the log", async () => {
    seedProjects([{ jira_key: "DP-001", github_repo: "deliverpro" }]);

    await handleRecordProgress({
      project_id: "secret-orphan-repo",
      update_text: "SRS approved",
      gate: "SRS approved",
      source_ref: "abc123",
      actor: "human",
    });

    const emfLine = logSpy.mock.calls
      .map((c) => String(c[0]))
      .find((line) => line.includes("GovernanceEventRejected"));
    expect(emfLine).toBeDefined();

    const emf = JSON.parse(emfLine as string);
    const metricDef = emf._aws.CloudWatchMetrics[0];
    expect(metricDef.Metrics[0].Name).toBe("GovernanceEventRejected");
    expect(emf.GovernanceEventRejected).toBe(1);
    // Dimensionless (SEC-H2) — no repo/caller dimension, repo name absent from the metric payload.
    expect(metricDef.Dimensions).toEqual([[]]);
    expect(emfLine).not.toContain("secret-orphan-repo");

    // Repo name is present only in the structured warn log.
    const warnedRepo = warnSpy.mock.calls.some((c) =>
      JSON.stringify(c).includes("secret-orphan-repo"),
    );
    expect(warnedRepo).toBe(true);
  });

  it('mapped write is idempotent — duplicate macro key returns { written:false, reason:"duplicate" }', async () => {
    seedProjects([{ jira_key: "DP-001", github_repo: "deliverpro" }]);

    const first = await handleRecordProgress({
      project_id: "deliverpro",
      update_text: "SRS approved",
      gate: "SRS approved",
      source_ref: "abc123",
      actor: "human",
    });
    const second = await handleRecordProgress({
      project_id: "deliverpro",
      update_text: "SRS approved",
      gate: "SRS approved",
      source_ref: "abc123",
      actor: "human",
    });

    expect(first).toEqual({ written: true });
    // Same macro gate + same day → same idempotency key → deduped in the DB layer.
    expect(second).toEqual({ written: false, reason: "duplicate" });
    expect(store.governance_events).toHaveLength(1);
  });
});
