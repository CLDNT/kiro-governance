/**
 * Unit tests for the CR-05 Slack provisioning service (SEC-M1 two-token split).
 * Covers:
 *  - provisioning token read from its OWN SSM path (distinct from the runtime bot-token path);
 *  - token cached in-memory (no repeated SSM hits);
 *  - resolveOrCreateChannel: resolves an existing channel (no create), creates a missing one,
 *    idempotent re-run resolves (no duplicate), and races (name_taken) re-resolve;
 *  - the provisioning token never leaks into an error message;
 *  - deterministic channel naming.
 * Mocks SSM + the global fetch (Slack Web API). See docs/phase2/projects-architecture.md §12.4.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { SSMClient } from '@aws-sdk/client-ssm';
import { ParameterNotFound } from '@aws-sdk/client-ssm';
import {
  getProvisioningToken,
  resolveOrCreateChannel,
  microChannelName,
  macroChannelName,
  PROVISIONING_TOKEN_SSM_PATH,
  SlackProvisioningError,
  __resetProvisioningTokenCache,
} from '../../services/slack-provisioning.service';

// The runtime bot-token path (packages/mcp-server slack.service BOT_TOKEN_SSM_PATH) —
// asserted as a literal so this test does not import across package boundaries.
const RUNTIME_BOT_TOKEN_SSM_PATH = '/kiro-governance/slack/bot-token';

// Sentinel provisioning secret used to prove it never surfaces in an error/log.
const PROV_TOKEN = 'xoxb-PROVISIONING-SECRET-zzz999';

function mockSsm(): { client: SSMClient; send: jest.Mock } {
  const send = jest.fn() as jest.Mock;
  return { client: { send } as unknown as SSMClient, send };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('slack-provisioning.service', () => {
  beforeEach(() => {
    __resetProvisioningTokenCache();
    jest.restoreAllMocks();
  });
  afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  describe('getProvisioningToken (two-token split)', () => {
    it('reads the provisioning token from its OWN SSM SecureString path', async () => {
      const { client, send } = mockSsm();
      send.mockResolvedValue({ Parameter: { Value: PROV_TOKEN } } as never);

      const token = await getProvisioningToken(client);

      expect(token).toBe(PROV_TOKEN);
      const command = send.mock.calls[0][0] as { input: { Name: string; WithDecryption: boolean } };
      expect(command.input.Name).toBe(PROVISIONING_TOKEN_SSM_PATH);
      expect(command.input.WithDecryption).toBe(true);
    });

    it('uses a DIFFERENT path than the runtime chat:write bot token', () => {
      expect(PROVISIONING_TOKEN_SSM_PATH).not.toBe(RUNTIME_BOT_TOKEN_SSM_PATH);
    });

    it('caches the token and does not re-hit SSM within the TTL', async () => {
      const { client, send } = mockSsm();
      send.mockResolvedValue({ Parameter: { Value: PROV_TOKEN } } as never);

      await getProvisioningToken(client);
      await getProvisioningToken(client);

      expect(send).toHaveBeenCalledTimes(1);
    });

    it('throws PROVISIONING_TOKEN_NOT_FOUND when the parameter is missing', async () => {
      const { client, send } = mockSsm();
      send.mockRejectedValue(new ParameterNotFound({ message: 'no', $metadata: {} }) as never);

      await expect(getProvisioningToken(client)).rejects.toMatchObject({
        code: 'PROVISIONING_TOKEN_NOT_FOUND',
      });
    });

    it('throws PROVISIONING_TOKEN_NOT_FOUND when the value is empty', async () => {
      const { client, send } = mockSsm();
      send.mockResolvedValue({ Parameter: { Value: '' } } as never);

      await expect(getProvisioningToken(client)).rejects.toBeInstanceOf(SlackProvisioningError);
      await expect(getProvisioningToken(client)).rejects.toMatchObject({
        code: 'PROVISIONING_TOKEN_NOT_FOUND',
      });
    });

    it('throws SSM_ERROR on an unexpected SSM failure (no secret in message)', async () => {
      const { client, send } = mockSsm();
      send.mockRejectedValue(new Error('throttled') as never);

      await expect(getProvisioningToken(client)).rejects.toMatchObject({ code: 'SSM_ERROR' });
    });
  });

  describe('channel naming', () => {
    it('derives deterministic, Slack-safe channel names from the jira_key', () => {
      expect(microChannelName('DP-001')).toBe('dp-001-micro');
      expect(macroChannelName('DP-001')).toBe('dp-001-macro');
    });

    it('sanitizes spaces/periods/uppercase into a valid channel name', () => {
      expect(microChannelName('Acme Corp.Prod')).toBe('acme-corp-prod-micro');
    });
  });

  describe('resolveOrCreateChannel — resolve existing (no create)', () => {
    it('returns the existing channel id from conversations.list and does NOT create', async () => {
      const fetchMock = jest.fn(async (url: string) => {
        expect(String(url)).toContain('conversations.list');
        return jsonResponse(200, {
          ok: true,
          channels: [
            { id: 'C_OTHER', name: 'random' },
            { id: 'C_MICRO', name: 'dp-001-micro' },
          ],
          response_metadata: { next_cursor: '' },
        });
      });
      (globalThis as { fetch?: unknown }).fetch = fetchMock as unknown;

      const res = await resolveOrCreateChannel(PROV_TOKEN, 'dp-001-micro');

      expect(res).toEqual({ id: 'C_MICRO', created: false });
      // Only the list call — never conversations.create.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).not.toContain('conversations.create');
    });

    it('paginates conversations.list via next_cursor to find the channel', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(200, {
            ok: true,
            channels: [{ id: 'C_A', name: 'alpha' }],
            response_metadata: { next_cursor: 'PAGE2' },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse(200, {
            ok: true,
            channels: [{ id: 'C_MACRO', name: 'dp-001-macro' }],
            response_metadata: { next_cursor: '' },
          }),
        );
      (globalThis as { fetch?: unknown }).fetch = fetchMock as unknown;

      const res = await resolveOrCreateChannel(PROV_TOKEN, 'dp-001-macro');

      expect(res).toEqual({ id: 'C_MACRO', created: false });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[1][0])).toContain('cursor=PAGE2');
    });
  });

  describe('resolveOrCreateChannel — create missing', () => {
    it('creates the channel when conversations.list finds none', async () => {
      const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('conversations.list')) {
          return jsonResponse(200, { ok: true, channels: [], response_metadata: { next_cursor: '' } });
        }
        // conversations.create
        expect(String(url)).toContain('conversations.create');
        const body = JSON.parse(String(init?.body));
        expect(body.name).toBe('dp-001-micro');
        return jsonResponse(200, { ok: true, channel: { id: 'C_NEW', name: 'dp-001-micro' } });
      });
      (globalThis as { fetch?: unknown }).fetch = fetchMock as unknown;

      const res = await resolveOrCreateChannel(PROV_TOKEN, 'dp-001-micro');

      expect(res).toEqual({ id: 'C_NEW', created: true });
      expect(fetchMock).toHaveBeenCalledTimes(2); // list (miss) + create
    });

    it('re-resolves on a name_taken create race (no duplicate)', async () => {
      const fetchMock = jest
        .fn()
        // 1st list: not found
        .mockResolvedValueOnce(jsonResponse(200, { ok: true, channels: [], response_metadata: {} }))
        // create: lost the race
        .mockResolvedValueOnce(jsonResponse(200, { ok: false, error: 'name_taken' }))
        // re-list: now present
        .mockResolvedValueOnce(
          jsonResponse(200, {
            ok: true,
            channels: [{ id: 'C_RACED', name: 'dp-001-micro' }],
            response_metadata: {},
          }),
        );
      (globalThis as { fetch?: unknown }).fetch = fetchMock as unknown;

      const res = await resolveOrCreateChannel(PROV_TOKEN, 'dp-001-micro');

      expect(res).toEqual({ id: 'C_RACED', created: false });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('resolveOrCreateChannel — error handling & secret safety', () => {
    it('maps a Slack {ok:false} list error to SLACK_API_ERROR without leaking the token', async () => {
      const fetchMock = jest.fn(async () => jsonResponse(200, { ok: false, error: 'invalid_auth' }));
      (globalThis as { fetch?: unknown }).fetch = fetchMock as unknown;

      let thrown: unknown;
      try {
        await resolveOrCreateChannel(PROV_TOKEN, 'dp-001-micro');
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(SlackProvisioningError);
      expect((thrown as SlackProvisioningError).code).toBe('SLACK_API_ERROR');
      // The Slack error CODE is safe to surface, but the token must never be present.
      expect((thrown as SlackProvisioningError).message).not.toContain(PROV_TOKEN);
    });

    it('sends the provisioning token in the Authorization header (Bearer), never in the URL/body', async () => {
      const fetchMock = jest.fn(async () =>
        jsonResponse(200, { ok: true, channels: [{ id: 'C1', name: 'dp-001-micro' }], response_metadata: {} }),
      );
      (globalThis as { fetch?: unknown }).fetch = fetchMock as unknown;

      await resolveOrCreateChannel(PROV_TOKEN, 'dp-001-micro');

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(String(url)).not.toContain(PROV_TOKEN);
      expect(JSON.stringify(init.body ?? '')).not.toContain(PROV_TOKEN);
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${PROV_TOKEN}`);
    });
  });
});
