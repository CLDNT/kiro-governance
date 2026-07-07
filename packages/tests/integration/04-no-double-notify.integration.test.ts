/**
 * CR-13 Level-1 integration test — NO DOUBLE-NOTIFY coexistence.
 *
 * Source: change-requests/2026-07-02-github-slack-linkage-impact.md v3-8 CR-13;
 *         FR-P2-041 (MACRO gate ownership), FR-P2-039 (routing), Decision F.
 *
 * The event-source split (v3 §0/§6): MICRO notifications originate ONLY from the CI/Kiro path
 * (scripts/governance-trigger.js → notify_slack event_type:'micro'); MACRO notifications originate
 * ONLY from the app (macro-notify.service → notify_slack event_type:'macro'). No single event ever
 * produces BOTH a micro and a macro notification.
 *
 * Verifies:
 *   1. The app MACRO path (`notifyMacroGateApproved`, real service) fires EXACTLY ONE notify, and it
 *      is event_type:'macro' — never a micro notify. On an UNLINKED project it fires NOTHING.
 *   2. The CI MICRO path (real `handleNotifySlack`, event_type:'micro') posts to the micro channel
 *      only — the macro channel is never touched. A single call = a single post (no double).
 *   3. Routed through the SAME notify_slack, a micro call and a macro call each hit exactly their
 *      own channel — the two channels never both receive a post for one event.
 *   4. The CLI display-only MACRO path (governance-trigger `buildRecordArgs` mode:'macro') writes a
 *      governance event but sets NO macro_checkpoints.reached_at (completion stays app-owned).
 *
 * Only Postgres and the external Slack/MCP transport are faked; the notify services run for real.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { SSMClient } from "@aws-sdk/client-ssm";

jest.mock("pg", () => require("./helpers/fake-pg").pgMock());
jest.mock("@aws-sdk/rds-signer", () =>
  require("./helpers/fake-pg").rdsSignerMock(),
);

// External Slack Web API (used by the MCP notify_slack tool) — mocked.
jest.mock("../../mcp-server/src/services/slack.service", () => {
  class SlackServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "SlackServiceError";
    }
  }
  return {
    SlackServiceError,
    getBotToken: jest.fn(),
    postMessageToChannel: jest.fn(),
  };
});

// MCP transport used by the APP macro path (macro-notify.service → mcp-client) — mocked so we can
// assert exactly what the app asks notify_slack to do, without a network hop.
jest.mock("@kiro-governance/shared/mcp/mcp-client", () => ({
  notifySlack: jest.fn(),
}));

import {
  resetStore,
  seedProjects,
  seedMacroCheckpoints,
  store,
} from "./helpers/fake-pg";
import { handleNotifySlack } from "../../mcp-server/src/tools/notify-slack";
import {
  getBotToken,
  postMessageToChannel,
} from "../../mcp-server/src/services/slack.service";
import { notifyMacroGateApproved } from "../../gates/services/macro-notify.service";
import { notifySlack } from "@kiro-governance/shared/mcp/mcp-client";
import { handleRecordProgress } from "../../mcp-server/src/tools/record-progress";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildRecordArgs } = require("../../../scripts/governance-trigger");

const mockGetBotToken = getBotToken as jest.MockedFunction<typeof getBotToken>;
const mockPostMessage = postMessageToChannel as jest.MockedFunction<
  typeof postMessageToChannel
>;
const mockNotifySlack = notifySlack as jest.MockedFunction<typeof notifySlack>;

const MICRO_CHANNEL = "C0000MICRO";
const MACRO_CHANNEL = "C0000MACRO";
const ssm = {} as unknown as SSMClient;

describe("CR-13 · NO DOUBLE-NOTIFY coexistence (FR-P2-041 / Decision F)", () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockGetBotToken.mockResolvedValue("xoxb-token");
    mockPostMessage.mockResolvedValue(undefined);
    mockNotifySlack.mockResolvedValue({ notified: true });
  });

  describe("APP MACRO path (macro-notify.service) — macro only, never micro", () => {
    it("a single macro approval fires EXACTLY ONE notify, event_type:macro", async () => {
      seedProjects([{ jira_key: "DP-001", github_repo: "deliverpro" }]);

      await notifyMacroGateApproved("DP-001", "SRS approved", "lead@x.com");

      expect(mockNotifySlack).toHaveBeenCalledTimes(1);
      const arg = mockNotifySlack.mock.calls[0][0];
      expect(arg.event_type).toBe("macro");
      expect(arg.project_id).toBe("deliverpro"); // repo name, resolved from jira_key
      // No micro notify was ever emitted by the app path.
      const microCalls = mockNotifySlack.mock.calls.filter(
        (c) => c[0].event_type === "micro",
      );
      expect(microCalls).toHaveLength(0);
    });

    it("UNLINKED project (github_repo NULL) → app fires NO notify at all (feature switch off)", async () => {
      seedProjects([{ jira_key: "DP-002", github_repo: null }]);

      await notifyMacroGateApproved("DP-002", "SRS approved", "lead@x.com");

      expect(mockNotifySlack).not.toHaveBeenCalled();
    });
  });

  describe("CI MICRO path (notify_slack event_type:micro) — micro only, never macro", () => {
    it("a single CI micro call posts once to the micro channel; the macro channel is untouched", async () => {
      seedProjects([
        {
          jira_key: "DP-001",
          github_repo: "deliverpro",
          slack_micro_channel_id: MICRO_CHANNEL,
          slack_macro_channel_id: MACRO_CHANNEL,
        },
      ]);

      const result = await handleNotifySlack(
        {
          project_id: "deliverpro",
          message: "progress update",
          event_type: "micro",
        },
        ssm,
      );

      expect(result).toEqual({ notified: true });
      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      const postedChannels = mockPostMessage.mock.calls.map((c) => c[1]);
      expect(postedChannels).toEqual([MICRO_CHANNEL]);
      expect(postedChannels).not.toContain(MACRO_CHANNEL);
    });
  });

  describe("COEXISTENCE — both paths through the SAME notify_slack, each to its own channel", () => {
    it("one micro event + one macro event = one post each, on distinct channels (no double)", async () => {
      seedProjects([
        {
          jira_key: "DP-001",
          github_repo: "deliverpro",
          slack_micro_channel_id: MICRO_CHANNEL,
          slack_macro_channel_id: MACRO_CHANNEL,
        },
      ]);

      // CI micro event
      await handleNotifySlack(
        {
          project_id: "deliverpro",
          message: "Domain decomposition done",
          event_type: "micro",
        },
        ssm,
      );
      // App macro event (the message notify_slack ultimately receives from the app path)
      await handleNotifySlack(
        {
          project_id: "deliverpro",
          message: "Macro gate reached: SRS approved",
          event_type: "macro",
        },
        ssm,
      );

      expect(mockPostMessage).toHaveBeenCalledTimes(2);
      const channels = mockPostMessage.mock.calls.map((c) => c[1]).sort();
      // Exactly one post per channel — neither event produced a post on BOTH channels.
      expect(channels).toEqual([MACRO_CHANNEL, MICRO_CHANNEL].sort());
    });
  });

  describe("CLI display-only MACRO path — writes a governance event, sets NO reached_at", () => {
    it("governance-trigger macro args are display-only and never complete a macro checkpoint", async () => {
      seedProjects([{ jira_key: "DP-001", github_repo: "deliverpro" }]);
      // A macro checkpoint that is NOT yet reached — the CLI macro path must not complete it.
      seedMacroCheckpoints([
        {
          id: 1,
          project_id: "DP-001",
          checkpoint_name: "SRS approved",
          phase: "Phase 1",
          reached_at: null,
        },
      ]);

      const args = buildRecordArgs({
        mode: "macro",
        projectId: "deliverpro",
        line: "- [x] 1.4 SRS approved",
        gate: "SRS approved",
        sourceRef: "abc123",
        actor: "octocat",
      });

      // The CLI args carry NO field that could complete a checkpoint.
      expect(args.type).toBe("macro");
      expect(args).not.toHaveProperty("reached_at");
      expect(args).not.toHaveProperty("occurred");
      expect(args).not.toHaveProperty("reviewed_by");

      const result = await handleRecordProgress(args);

      // Surfaces on the timeline (a governance_events row is written)...
      expect(result).toEqual({ written: true });
      expect(store.governance_events).toHaveLength(1);
      expect(store.governance_events[0].type).toBe("macro");
      // ...but macro completion stays app-owned — reached_at is untouched.
      expect(store.macro_checkpoints[0].reached_at).toBeNull();
    });
  });
});
