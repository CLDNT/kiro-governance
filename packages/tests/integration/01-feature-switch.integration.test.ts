/**
 * CR-13 Level-1 integration test — FEATURE SWITCH (optional GitHub linkage).
 *
 * Source: change-requests/2026-07-02-github-slack-linkage-impact.md v3-8 CR-13;
 *         FR-P2-036 (MICRO surfacing / MACRO display-only), FR-P2-040 (optional linkage switch).
 *
 * Verifies through the REAL gates timeline service (`getProjectTimeline`) against the in-memory
 * fake-pg harness:
 *   • A project WITH `github_repo` set surfaces Kiro governance (micro) events on its timeline,
 *     tagged `source: 'kiro_mcp'`, joined via `projects.github_repo = governance_events.project_id`.
 *   • A project WITHOUT `github_repo` (feature switch OFF) shows ONLY DeliverPro-native events
 *     (source `deliverpro`) and raises no error — identical to pre-linkage behaviour.
 *   • An event whose repo matches NO project never leaks onto any timeline.
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
  seedGovernanceEvents,
  seedMacroCheckpoints,
} from "./helpers/fake-pg";
import {
  getProjectTimeline,
  projectExists,
} from "../../gates/services/timeline.service";

const T = (s: string) => new Date(`2026-07-01T${s}Z`).toISOString();

describe("CR-13 · FEATURE SWITCH — optional GitHub linkage (FR-P2-036 / FR-P2-040)", () => {
  beforeEach(() => {
    resetStore();
  });

  it("LINKED project (github_repo set) surfaces Kiro governance micro events (source kiro_mcp)", async () => {
    seedProjects([{ jira_key: "DP-001", github_repo: "deliverpro" }]);
    seedGovernanceEvents([
      {
        project_id: "deliverpro", // keyed by repo name — resolves via github_repo join
        update_text: "Domain decomposition done",
        type: "micro",
        source_ref: "docs/domain-decomposition.md",
        actor: "aws-architect",
        idempotency_key: "deliverpro#micro#01",
        created_at: T("10:00:00"),
      },
    ]);
    // A DeliverPro-native completion also exists on the same project.
    seedMacroCheckpoints([
      {
        id: 1,
        project_id: "DP-001",
        checkpoint_name: "SRS approved",
        phase: "Phase 1",
        reviewed_by: "lead@x.com",
        reached_at: T("11:00:00"),
      },
    ]);

    const { events } = await getProjectTimeline("DP-001", 50);

    const governance = events.filter((e) => e.source === "kiro_mcp");
    expect(governance).toHaveLength(1);
    expect(governance[0].event_type).toBe("governance_event");
    expect(governance[0].title).toBe("Domain decomposition done");
    // Both the Kiro micro event and the native completion appear on the linked timeline.
    expect(
      events.some(
        (e) =>
          e.source === "deliverpro" && e.event_type === "checkpoint_completed",
      ),
    ).toBe(true);
    // Ordered chronologically (DESC): the 11:00 completion precedes the 10:00 governance event.
    expect(events[0].source).toBe("deliverpro");
    expect(events[events.length - 1].source).toBe("kiro_mcp");
  });

  it("UNLINKED project (github_repo NULL) shows ONLY DeliverPro-native events, no error", async () => {
    seedProjects([{ jira_key: "DP-002", github_repo: null }]);
    // Governance events exist in the table, keyed to a repo — but this project is not linked.
    seedGovernanceEvents([
      {
        project_id: "some-other-repo",
        update_text: "Feature list defined",
        type: "micro",
        source_ref: "docs/feature-list.md",
        actor: "aws-architect",
        idempotency_key: "some-other-repo#micro#01",
        created_at: T("10:00:00"),
      },
    ]);
    seedMacroCheckpoints([
      {
        id: 2,
        project_id: "DP-002",
        checkpoint_name: "SRS approved",
        phase: "Phase 1",
        reviewed_by: "lead@x.com",
        reached_at: T("12:00:00"),
      },
    ]);

    // Unlinked is NOT an error — the project still exists and the call succeeds.
    await expect(projectExists("DP-002")).resolves.toBe(true);
    const { events } = await getProjectTimeline("DP-002", 50);

    expect(events.every((e) => e.source === "deliverpro")).toBe(true);
    expect(events.some((e) => e.source === "kiro_mcp")).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("checkpoint_completed");
  });

  it("an event whose repo matches no project never surfaces on any timeline", async () => {
    seedProjects([{ jira_key: "DP-003", github_repo: "deliverpro" }]);
    seedGovernanceEvents([
      {
        project_id: "orphan-repo", // matches no project's github_repo
        update_text: "Data model draft complete",
        type: "micro",
        source_ref: "docs/data-model.md",
        actor: "aws-architect",
        idempotency_key: "orphan-repo#micro#01",
        created_at: T("10:00:00"),
      },
    ]);

    const { events } = await getProjectTimeline("DP-003", 50);
    expect(events).toHaveLength(0);
  });

  it("re-pointing github_repo changes which historical events surface (join on current repo)", async () => {
    // Same governance history keyed to 'repo-old'; project currently linked to 'repo-new'.
    seedGovernanceEvents([
      {
        project_id: "repo-old",
        update_text: "Old-repo event",
        type: "micro",
        source_ref: "ref",
        actor: "ci",
        idempotency_key: "repo-old#micro#01",
        created_at: T("09:00:00"),
      },
    ]);

    seedProjects([{ jira_key: "DP-004", github_repo: "repo-new" }]);
    let res = await getProjectTimeline("DP-004", 50);
    expect(res.events.filter((e) => e.source === "kiro_mcp")).toHaveLength(0);

    // Re-point to the old repo → the historical event surfaces immediately (read-side join).
    store_repoint("DP-004", "repo-old");
    res = await getProjectTimeline("DP-004", 50);
    expect(res.events.filter((e) => e.source === "kiro_mcp")).toHaveLength(1);
    expect(res.events[0].title).toBe("Old-repo event");
  });
});

/** Local helper: mutate a project's github_repo in the fake store (simulates a re-point). */
function store_repoint(jiraKey: string, repo: string | null): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { store } = require("./helpers/fake-pg");
  const p = store.projects.find(
    (x: { jira_key: string }) => x.jira_key === jiraKey,
  );
  if (p) p.github_repo = repo;
}
