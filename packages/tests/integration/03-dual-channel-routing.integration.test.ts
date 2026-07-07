/**
 * CR-13 Level-1 integration test — DUAL-CHANNEL Slack routing + graceful skip.
 *
 * Source: change-requests/2026-07-02-github-slack-linkage-impact.md v3-8 CR-13;
 *         FR-P2-039 (App-Managed Slack Provisioning & Dual-Channel Routing), Decisions D/E/F.
 *
 * Verifies through the REAL `handleNotifySlack` → REAL `resolveProject` (postgres.service) against
 * the in-memory fake-pg harness, with ONLY the external Slack Web API layer mocked
 * (slack.service `getBotToken` / `postMessageToChannel`):
 *   • event_type 'micro' posts to the project's slack_micro_channel_id.
 *   • event_type 'macro' posts to the project's slack_macro_channel_id.
 *   • an unconfigured channel → graceful skip { notified:false, reason:'channel_not_configured' }.
 *   • an unmapped repo → graceful skip { notified:false, reason:'no_matching_project' }.
 *   • no bot token / SSM path / repo name is leaked in the result.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { SSMClient } from "@aws-sdk/client-ssm";

jest.mock("pg", () => require("./helpers/fake-pg").pgMock());
jest.mock("@aws-sdk/rds-signer", () =>
  require("./helpers/fake-pg").rdsSignerMock(),
);

// External Slack is always mocked — the harness only fakes Postgres, never Slack.
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

import { resetStore, seedProjects } from "./helpers/fake-pg";
import { handleNotifySlack } from "../../mcp-server/src/tools/notify-slack";
import {
  getBotToken,
  postMessageToChannel,
} from "../../mcp-server/src/services/slack.service";

const mockGetBotToken = getBotToken as jest.MockedFunction<typeof getBotToken>;
const mockPostMessage = postMessageToChannel as jest.MockedFunction<
  typeof postMessageToChannel
>;

const SECRET_TOKEN = "xoxb-SECRET-abc123";
const MICRO_CHANNEL = "C0000MICRO";
const MACRO_CHANNEL = "C0000MACRO";
const ssm = {} as unknown as SSMClient;

describe("CR-13 · DUAL-CHANNEL routing + graceful skip (FR-P2-039)", () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
    mockGetBotToken.mockResolvedValue(SECRET_TOKEN);
    mockPostMessage.mockResolvedValue(undefined);
  });

  it("event_type 'micro' → posts to the micro channel", async () => {
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
        message: "Domain decomposition done",
        event_type: "micro",
      },
      ssm,
    );

    expect(result).toEqual({ notified: true });
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const [token, channel, text] = mockPostMessage.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(token).toBe(SECRET_TOKEN);
    expect(channel).toBe(MICRO_CHANNEL);
    expect(text).toBe("[DP-001] Domain decomposition done");
  });

  it("event_type 'macro' → posts to the macro channel", async () => {
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
        message: "SRS approved",
        event_type: "macro",
      },
      ssm,
    );

    expect(result).toEqual({ notified: true });
    const [, channel] = mockPostMessage.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(channel).toBe(MACRO_CHANNEL);
  });

  it("unconfigured channel for the event_type → graceful skip (channel_not_configured)", async () => {
    // Macro channel is null → a macro event has nowhere to go, but micro still works.
    seedProjects([
      {
        jira_key: "DP-002",
        github_repo: "deliverpro",
        slack_micro_channel_id: MICRO_CHANNEL,
        slack_macro_channel_id: null,
      },
    ]);

    const macro = await handleNotifySlack(
      {
        project_id: "deliverpro",
        message: "SRS approved",
        event_type: "macro",
      },
      ssm,
    );
    expect(macro).toEqual({
      notified: false,
      reason: "channel_not_configured",
    });
    expect(mockPostMessage).not.toHaveBeenCalled();
    expect(mockGetBotToken).not.toHaveBeenCalled();

    // Micro on the SAME project still routes fine (independent per event_type).
    const micro = await handleNotifySlack(
      {
        project_id: "deliverpro",
        message: "micro update",
        event_type: "micro",
      },
      ssm,
    );
    expect(micro).toEqual({ notified: true });
    const [, channel] = mockPostMessage.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(channel).toBe(MICRO_CHANNEL);
  });

  it("unmapped repo → graceful skip (no_matching_project), no Slack call, no token fetch", async () => {
    seedProjects([
      {
        jira_key: "DP-001",
        github_repo: "deliverpro",
        slack_micro_channel_id: MICRO_CHANNEL,
      },
    ]);

    const result = await handleNotifySlack(
      { project_id: "unlinked-repo", message: "hi", event_type: "micro" },
      ssm,
    );

    expect(result).toEqual({ notified: false, reason: "no_matching_project" });
    expect(mockPostMessage).not.toHaveBeenCalled();
    expect(mockGetBotToken).not.toHaveBeenCalled();
  });

  it("labels with jira_key (never the repo) and never leaks the bot token", async () => {
    seedProjects([
      {
        jira_key: "DP-009",
        github_repo: "deliverpro",
        slack_micro_channel_id: MICRO_CHANNEL,
        slack_macro_channel_id: MACRO_CHANNEL,
      },
    ]);

    const result = await handleNotifySlack(
      {
        project_id: "deliverpro",
        message: "SRS approved",
        event_type: "macro",
      },
      ssm,
    );

    const [, , text] = mockPostMessage.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(text).toBe("[DP-009] SRS approved");
    expect(text).not.toContain("deliverpro");
    expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN);
  });
});
