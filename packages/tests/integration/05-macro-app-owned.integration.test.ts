/**
 * CR-13 Level-1 integration test — MACRO gate ownership (app-owned completion).
 *
 * Source: change-requests/2026-07-02-github-slack-linkage-impact.md v3-8 CR-13;
 *         FR-P2-041 (MACRO Gate Ownership), FR-P2-036 (macro governance events are display-only).
 *
 * Invariant under test: a `governance_events` row of type='macro' (from Kiro) is DISPLAY-ONLY — it
 * surfaces on the project timeline (source 'kiro_mcp') but NEVER sets `macro_checkpoints.reached_at`.
 * Macro completion is set only by the in-app §4 state machine. There is no
 * governance_events → macro_checkpoints auto-completion path.
 *
 * Verified end-to-end: writing a macro governance event through the REAL `handleRecordProgress`
 * leaves every `macro_checkpoints.reached_at` untouched, and the REAL `getProjectTimeline` shows the
 * macro event as a display-only 'governance_event' — not a 'checkpoint_completed'.
 *
 * Only Postgres is faked; no function under test is mocked.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("pg", () => require("./helpers/fake-pg").pgMock());
jest.mock("@aws-sdk/rds-signer", () =>
  require("./helpers/fake-pg").rdsSignerMock(),
);

import {
  resetStore,
  seedProjects,
  seedMacroCheckpoints,
  store,
} from "./helpers/fake-pg";
import { handleRecordProgress } from "../../mcp-server/src/tools/record-progress";
import { getProjectTimeline } from "../../gates/services/timeline.service";

describe("CR-13 · MACRO app-owned — governance macro events never set reached_at (FR-P2-041)", () => {
  beforeEach(() => {
    resetStore();
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("a macro governance event does NOT set macro_checkpoints.reached_at", async () => {
    seedProjects([{ jira_key: "DP-001", github_repo: "deliverpro" }]);
    seedMacroCheckpoints([
      {
        id: 1,
        project_id: "DP-001",
        checkpoint_name: "SRS approved",
        phase: "Phase 1",
        reached_at: null, // NOT yet reached
      },
    ]);

    const result = await handleRecordProgress({
      project_id: "deliverpro",
      update_text: "SRS approved",
      type: "macro",
      flag_override: true,
      gate: "SRS approved",
      source_ref: "abc123",
      actor: "kiro-cli",
    });

    expect(result).toEqual({ written: true });
    // The macro governance event is persisted...
    expect(store.governance_events).toHaveLength(1);
    expect(store.governance_events[0].type).toBe("macro");
    // ...but the matching macro checkpoint is NOT completed by it.
    expect(store.macro_checkpoints[0].reached_at).toBeNull();
  });

  it("the macro governance event surfaces as display-only (governance_event, not checkpoint_completed)", async () => {
    seedProjects([{ jira_key: "DP-001", github_repo: "deliverpro" }]);
    seedMacroCheckpoints([
      {
        id: 1,
        project_id: "DP-001",
        checkpoint_name: "SRS approved",
        phase: "Phase 1",
        reached_at: null,
      },
    ]);

    await handleRecordProgress({
      project_id: "deliverpro",
      update_text: "SRS approved",
      type: "macro",
      flag_override: true,
      gate: "SRS approved",
      source_ref: "abc123",
      actor: "kiro-cli",
    });

    const { events } = await getProjectTimeline("DP-001", 50);

    // The macro event is on the timeline, tagged as a Kiro governance event (display-only)...
    const macroGov = events.filter((e) => e.source === "kiro_mcp");
    expect(macroGov).toHaveLength(1);
    expect(macroGov[0].event_type).toBe("governance_event");
    // ...and it produced NO 'checkpoint_completed' row (that only comes from an app-owned reached_at).
    expect(events.some((e) => e.event_type === "checkpoint_completed")).toBe(
      false,
    );
  });

  it("an app-owned completion (reached_at set) DOES surface as checkpoint_completed — proving the contrast", async () => {
    seedProjects([{ jira_key: "DP-001", github_repo: "deliverpro" }]);
    seedMacroCheckpoints([
      {
        id: 1,
        project_id: "DP-001",
        checkpoint_name: "SRS approved",
        phase: "Phase 1",
        reviewed_by: "lead@x.com",
        reached_at: new Date("2026-07-01T12:00:00Z").toISOString(), // app-owned completion
      },
    ]);

    const { events } = await getProjectTimeline("DP-001", 50);

    const completed = events.filter(
      (e) => e.event_type === "checkpoint_completed",
    );
    expect(completed).toHaveLength(1);
    expect(completed[0].source).toBe("deliverpro");
    expect(completed[0].actor).toBe("lead@x.com");
  });
});
