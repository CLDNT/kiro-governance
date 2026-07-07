import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { SSMClient } from '@aws-sdk/client-ssm';
import { ParameterNotFound } from '@aws-sdk/client-ssm';
import {
  getBotToken,
  postMessageToChannel,
  SlackServiceError,
  BOT_TOKEN_SSM_PATH,
  __resetBotTokenCache,
} from '../slack.service';

// A sentinel secret used to prove it is never logged or surfaced in errors.
const SECRET_TOKEN = 'xoxb-SECRET-TOKEN-abc123';
const CHANNEL_ID = 'C0123ABCD';

/** Build a mock SSMClient whose send() is a jest mock. */
function mockSsm(): { client: SSMClient; send: jest.Mock } {
  const send = jest.fn() as jest.Mock;
  return { client: { send } as unknown as SSMClient, send };
}

/** Build a minimal fetch Response stand-in. */
function mockResponse(status: number, jsonBody: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => jsonBody,
  } as unknown as Response;
}

describe('slack.service — bot-token model (CR-05)', () => {
  beforeEach(() => {
    __resetBotTokenCache();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  describe('getBotToken', () => {
    it('reads the workspace bot token from the single SSM SecureString path', async () => {
      const { client, send } = mockSsm();
      send.mockResolvedValue({ Parameter: { Value: SECRET_TOKEN } } as never);

      const token = await getBotToken(client);

      expect(token).toBe(SECRET_TOKEN);
      expect(send).toHaveBeenCalledTimes(1);
      // The command carries the documented bot-token path with decryption.
      const command = send.mock.calls[0][0] as { input: { Name: string; WithDecryption: boolean } };
      expect(command.input.Name).toBe(BOT_TOKEN_SSM_PATH);
      expect(command.input.WithDecryption).toBe(true);
    });

    it('caches the token in-memory and does not re-hit SSM within the TTL', async () => {
      const { client, send } = mockSsm();
      send.mockResolvedValue({ Parameter: { Value: SECRET_TOKEN } } as never);

      const first = await getBotToken(client);
      const second = await getBotToken(client);

      expect(first).toBe(SECRET_TOKEN);
      expect(second).toBe(SECRET_TOKEN);
      expect(send).toHaveBeenCalledTimes(1); // second call served from cache
    });

    it('throws BOT_TOKEN_NOT_FOUND when the parameter is missing (ParameterNotFound)', async () => {
      const { client, send } = mockSsm();
      send.mockRejectedValue(
        new ParameterNotFound({ message: 'not found', $metadata: {} }) as never,
      );

      await expect(getBotToken(client)).rejects.toMatchObject({
        code: 'BOT_TOKEN_NOT_FOUND',
      });
    });

    it('throws BOT_TOKEN_NOT_FOUND when the parameter value is empty', async () => {
      const { client, send } = mockSsm();
      send.mockResolvedValue({ Parameter: { Value: '' } } as never);

      await expect(getBotToken(client)).rejects.toBeInstanceOf(SlackServiceError);
      await expect(getBotToken(client)).rejects.toMatchObject({ code: 'BOT_TOKEN_NOT_FOUND' });
    });

    it('throws SSM_ERROR on an unexpected SSM failure', async () => {
      const { client, send } = mockSsm();
      send.mockRejectedValue(new Error('throttled') as never);

      await expect(getBotToken(client)).rejects.toMatchObject({ code: 'SSM_ERROR' });
    });
  });

  describe('postMessageToChannel', () => {
    it('POSTs chat.postMessage with bearer auth and channel/text body on success', async () => {
      const fetchMock = jest.fn(async () => mockResponse(200, { ok: true })) as jest.Mock;
      (globalThis as { fetch?: unknown }).fetch = fetchMock;

      await expect(
        postMessageToChannel(SECRET_TOKEN, CHANNEL_ID, 'hello world'),
      ).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://slack.com/api/chat.postMessage');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET_TOKEN}`);
      expect(JSON.parse(init.body as string)).toEqual({ channel: CHANNEL_ID, text: 'hello world' });
    });

    it('throws SLACK_API_ERROR when Slack returns HTTP 200 with { ok: false }', async () => {
      const fetchMock = jest.fn(async () =>
        mockResponse(200, { ok: false, error: 'channel_not_found' }),
      ) as jest.Mock;
      (globalThis as { fetch?: unknown }).fetch = fetchMock;

      await expect(postMessageToChannel(SECRET_TOKEN, CHANNEL_ID, 'hi')).rejects.toMatchObject({
        code: 'SLACK_API_ERROR',
      });
    });

    it('surfaces the Slack error code (not the token) in the SLACK_API_ERROR message', async () => {
      const fetchMock = jest.fn(async () =>
        mockResponse(200, { ok: false, error: 'invalid_auth' }),
      ) as jest.Mock;
      (globalThis as { fetch?: unknown }).fetch = fetchMock;

      const err = await postMessageToChannel(SECRET_TOKEN, CHANNEL_ID, 'hi').catch((e) => e);
      expect(err).toBeInstanceOf(SlackServiceError);
      expect(err.message).toContain('invalid_auth');
      expect(err.message).not.toContain(SECRET_TOKEN);
    });

    it('throws SLACK_POST_FAILED on a non-2xx HTTP status', async () => {
      const fetchMock = jest.fn(async () => mockResponse(500, {})) as jest.Mock;
      (globalThis as { fetch?: unknown }).fetch = fetchMock;

      await expect(postMessageToChannel(SECRET_TOKEN, CHANNEL_ID, 'hi')).rejects.toMatchObject({
        code: 'SLACK_POST_FAILED',
      });
    });

    it('maps an aborted request to SLACK_TIMEOUT', async () => {
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      const fetchMock = jest.fn(async () => {
        throw abortErr;
      }) as jest.Mock;
      (globalThis as { fetch?: unknown }).fetch = fetchMock;

      await expect(postMessageToChannel(SECRET_TOKEN, CHANNEL_ID, 'hi')).rejects.toMatchObject({
        code: 'SLACK_TIMEOUT',
      });
    });

    it('maps a transport failure to SLACK_NETWORK_ERROR', async () => {
      const fetchMock = jest.fn(async () => {
        throw new Error('ENOTFOUND slack.com');
      }) as jest.Mock;
      (globalThis as { fetch?: unknown }).fetch = fetchMock;

      const err = await postMessageToChannel(SECRET_TOKEN, CHANNEL_ID, 'hi').catch((e) => e);
      expect(err).toMatchObject({ code: 'SLACK_NETWORK_ERROR' });
      // The underlying transport message must not be echoed back to the caller.
      expect(err.message).not.toContain('ENOTFOUND');
    });
  });

  describe('secret handling — the bot token is never logged', () => {
    it('does not write the token to any console method during retrieval or posting', async () => {
      const logged: string[] = [];
      const capture =
        () =>
        (...args: unknown[]) => {
          logged.push(args.map((a) => String(a)).join(' '));
        };
      jest.spyOn(console, 'log').mockImplementation(capture());
      jest.spyOn(console, 'info').mockImplementation(capture());
      jest.spyOn(console, 'warn').mockImplementation(capture());
      jest.spyOn(console, 'error').mockImplementation(capture());

      const { client, send } = mockSsm();
      send.mockResolvedValue({ Parameter: { Value: SECRET_TOKEN } } as never);
      const token = await getBotToken(client);

      // Force both a success and a failure path through the poster.
      const okFetch = jest.fn(async () => mockResponse(200, { ok: true })) as jest.Mock;
      (globalThis as { fetch?: unknown }).fetch = okFetch;
      await postMessageToChannel(token, CHANNEL_ID, 'msg');

      const failFetch = jest.fn(async () =>
        mockResponse(200, { ok: false, error: 'not_in_channel' }),
      ) as jest.Mock;
      (globalThis as { fetch?: unknown }).fetch = failFetch;
      await postMessageToChannel(token, CHANNEL_ID, 'msg').catch(() => undefined);

      expect(logged.some((line) => line.includes(SECRET_TOKEN))).toBe(false);
    });
  });
});
