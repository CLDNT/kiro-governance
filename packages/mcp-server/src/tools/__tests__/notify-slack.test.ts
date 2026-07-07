import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { SSMClient } from '@aws-sdk/client-ssm';

// Mock the Slack + Postgres service layers — no real AWS/DB/Slack calls are made.
jest.mock('../../services/slack.service', () => {
  class SlackServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = 'SlackServiceError';
    }
  }
  return {
    SlackServiceError,
    getBotToken: jest.fn(),
    postMessageToChannel: jest.fn(),
  };
});

jest.mock('../../services/postgres.service', () => ({
  resolveProject: jest.fn(),
}));

import { handleNotifySlack } from '../notify-slack';
import { getBotToken, postMessageToChannel, SlackServiceError } from '../../services/slack.service';
import { resolveProject } from '../../services/postgres.service';

const mockGetBotToken = getBotToken as jest.MockedFunction<typeof getBotToken>;
const mockPostMessage = postMessageToChannel as jest.MockedFunction<typeof postMessageToChannel>;
const mockResolveProject = resolveProject as jest.MockedFunction<typeof resolveProject>;

const SECRET_TOKEN = 'xoxb-SECRET-TOKEN-abc123';
const MICRO_CHANNEL = 'C0000MICRO';
const MACRO_CHANNEL = 'C0000MACRO';

// A stand-in SSMClient — never actually used because getBotToken is mocked.
const ssm = {} as unknown as SSMClient;

function linkedProject(overrides: Partial<{
  jira_key: string;
  slack_micro_channel_id: string | null;
  slack_macro_channel_id: string | null;
}> = {}) {
  return {
    jira_key: 'DP-001',
    slack_micro_channel_id: MICRO_CHANNEL,
    slack_macro_channel_id: MACRO_CHANNEL,
    ...overrides,
  };
}

describe('notify_slack — dual-channel bot-token routing (CR-09)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBotToken.mockResolvedValue(SECRET_TOKEN);
    mockPostMessage.mockResolvedValue(undefined);
  });

  it('routes a MICRO event to the project micro channel', async () => {
    mockResolveProject.mockResolvedValue(linkedProject());

    const result = await handleNotifySlack(
      { project_id: 'deliverpro', message: 'Domain decomposition done', event_type: 'micro' },
      ssm,
    );

    expect(result).toEqual({ notified: true });
    expect(mockResolveProject).toHaveBeenCalledWith('deliverpro');
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const [token, channel] = mockPostMessage.mock.calls[0] as [string, string, string];
    expect(token).toBe(SECRET_TOKEN);
    expect(channel).toBe(MICRO_CHANNEL);
  });

  it('routes a MACRO event to the project macro channel', async () => {
    mockResolveProject.mockResolvedValue(linkedProject());

    const result = await handleNotifySlack(
      { project_id: 'deliverpro', message: 'SRS approved', event_type: 'macro' },
      ssm,
    );

    expect(result).toEqual({ notified: true });
    const [, channel] = mockPostMessage.mock.calls[0] as [string, string, string];
    expect(channel).toBe(MACRO_CHANNEL);
  });

  it('gracefully skips when no project matches the repo (no_matching_project)', async () => {
    mockResolveProject.mockResolvedValue(null);

    const result = await handleNotifySlack(
      { project_id: 'unknown-repo', message: 'hi', event_type: 'macro' },
      ssm,
    );

    expect(result).toEqual({ notified: false, reason: 'no_matching_project' });
    expect(mockPostMessage).not.toHaveBeenCalled();
    expect(mockGetBotToken).not.toHaveBeenCalled();
  });

  it('gracefully skips when the event_type channel is unconfigured (channel_not_configured)', async () => {
    // Macro channel is null → a macro event has nowhere to go.
    mockResolveProject.mockResolvedValue(linkedProject({ slack_macro_channel_id: null }));

    const result = await handleNotifySlack(
      { project_id: 'deliverpro', message: 'SRS approved', event_type: 'macro' },
      ssm,
    );

    expect(result).toEqual({ notified: false, reason: 'channel_not_configured' });
    expect(mockPostMessage).not.toHaveBeenCalled();
    expect(mockGetBotToken).not.toHaveBeenCalled();
  });

  it('routes independently per event_type (micro configured, macro not)', async () => {
    mockResolveProject.mockResolvedValue(linkedProject({ slack_macro_channel_id: null }));

    const micro = await handleNotifySlack(
      { project_id: 'deliverpro', message: 'micro update', event_type: 'micro' },
      ssm,
    );

    expect(micro).toEqual({ notified: true });
    const [, channel] = mockPostMessage.mock.calls[0] as [string, string, string];
    expect(channel).toBe(MICRO_CHANNEL);
  });

  it('labels the message with the project jira_key, never the raw repo name', async () => {
    mockResolveProject.mockResolvedValue(linkedProject());

    await handleNotifySlack(
      { project_id: 'deliverpro', message: 'SRS approved', event_type: 'macro' },
      ssm,
    );

    const [, , text] = mockPostMessage.mock.calls[0] as [string, string, string];
    expect(text).toBe('[DP-001] SRS approved');
    expect(text).not.toContain('deliverpro');
  });

  it('sanitizes Slack broadcast/mention injection in the message body (SEC-L1)', async () => {
    mockResolveProject.mockResolvedValue(linkedProject());

    await handleNotifySlack(
      { project_id: 'deliverpro', message: 'ping <!channel> <@U123> <#C999>', event_type: 'micro' },
      ssm,
    );

    const [, , text] = mockPostMessage.mock.calls[0] as [string, string, string];
    // No live broadcast/mention tokens survive — angle brackets are escaped.
    expect(text).not.toContain('<!channel>');
    expect(text).not.toContain('<@U123>');
    expect(text).not.toContain('<#C999>');
    expect(text).toContain('&lt;!channel&gt;');
  });

  it('rejects a malformed channel id before posting (invalid_channel)', async () => {
    mockResolveProject.mockResolvedValue(linkedProject({ slack_micro_channel_id: 'not-a-channel' }));

    const result = await handleNotifySlack(
      { project_id: 'deliverpro', message: 'hi', event_type: 'micro' },
      ssm,
    );

    expect(result).toEqual({ notified: false, reason: 'invalid_channel' });
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('caps an over-long message to the Slack limit (no silent drop)', async () => {
    mockResolveProject.mockResolvedValue(linkedProject());

    const huge = 'x'.repeat(5000);
    const result = await handleNotifySlack(
      { project_id: 'deliverpro', message: huge, event_type: 'micro' },
      ssm,
    );

    expect(result).toEqual({ notified: true });
    const [, , text] = mockPostMessage.mock.calls[0] as [string, string, string];
    expect(text.length).toBeLessThanOrEqual(3000);
    expect(text.startsWith('[DP-001] ')).toBe(true);
    expect(text.endsWith('…')).toBe(true);
  });

  it('maps a Slack API error to a generic reason (no exception thrown)', async () => {
    mockResolveProject.mockResolvedValue(linkedProject());
    mockPostMessage.mockRejectedValue(new SlackServiceError('SLACK_API_ERROR', 'Slack API error: channel_not_found'));

    const result = await handleNotifySlack(
      { project_id: 'deliverpro', message: 'hi', event_type: 'macro' },
      ssm,
    );

    expect(result).toEqual({ notified: false, reason: 'slack_api_error' });
  });

  it('maps a bot-token retrieval failure to a generic reason', async () => {
    mockResolveProject.mockResolvedValue(linkedProject());
    mockGetBotToken.mockRejectedValue(new SlackServiceError('BOT_TOKEN_NOT_FOUND', 'Slack bot token is not configured'));

    const result = await handleNotifySlack(
      { project_id: 'deliverpro', message: 'hi', event_type: 'macro' },
      ssm,
    );

    expect(result).toEqual({ notified: false, reason: 'bot_token_not_found' });
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('gracefully skips when the project lookup fails (project_lookup_failed)', async () => {
    mockResolveProject.mockRejectedValue(new Error('connection reset'));

    const result = await handleNotifySlack(
      { project_id: 'deliverpro', message: 'hi', event_type: 'micro' },
      ssm,
    );

    expect(result).toEqual({ notified: false, reason: 'project_lookup_failed' });
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('never leaks the bot token in the tool output or any reason', async () => {
    // Success path.
    mockResolveProject.mockResolvedValue(linkedProject());
    const ok = await handleNotifySlack(
      { project_id: 'deliverpro', message: 'hi', event_type: 'macro' },
      ssm,
    );
    expect(JSON.stringify(ok)).not.toContain(SECRET_TOKEN);

    // Failure path.
    mockPostMessage.mockRejectedValue(new SlackServiceError('SLACK_TIMEOUT', 'Slack request timed out'));
    const fail = await handleNotifySlack(
      { project_id: 'deliverpro', message: 'hi', event_type: 'macro' },
      ssm,
    );
    expect(JSON.stringify(fail)).not.toContain(SECRET_TOKEN);
    expect(fail).toEqual({ notified: false, reason: 'slack_timeout' });
  });
});
