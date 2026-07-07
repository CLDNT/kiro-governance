/**
 * Handler tests for POST /api/projects/{projectId}/slack/provision (CR-05, FR-P2-039).
 * Covers:
 *  - admin/leadership resolve existing channels → 200, no create, persists via audited path;
 *  - creates missing channels → 200, persists ids + updated_by (Cognito sub) + updated_at;
 *  - idempotent re-run (stored ids already match) → 200, NO projects UPDATE (no dup audit);
 *  - non-admin/leadership (pm/sa/engineer) → 403 FORBIDDEN, no Slack call, no write;
 *  - missing project → 404;
 *  - provisioning token never appears in the response body.
 * Mocks getPool + the provisioning service. See projects-architecture.md §12.1, §12.4.
 */
import { APIGatewayProxyEvent } from 'aws-lambda';

const mockGetPool = jest.fn();
jest.mock('@kiro-governance/shared/db/pool', () => ({ getPool: (...a: unknown[]) => mockGetPool(...a) }));

const mockGetProvisioningToken = jest.fn();
const mockResolveOrCreateChannel = jest.fn();
jest.mock('../../services/slack-provisioning.service', () => {
  const actual = jest.requireActual('../../services/slack-provisioning.service');
  return {
    SlackProvisioningError: actual.SlackProvisioningError,
    getProvisioningToken: (...a: unknown[]) => mockGetProvisioningToken(...a),
    resolveOrCreateChannel: (...a: unknown[]) => mockResolveOrCreateChannel(...a),
    microChannelName: (k: string) => `${k.toLowerCase()}-micro`,
    macroChannelName: (k: string) => `${k.toLowerCase()}-macro`,
  };
});

import { handler } from '../../handlers/provision-slack-channels';
import { SlackProvisioningError } from '../../services/slack-provisioning.service';

const PROV_TOKEN = 'xoxb-PROVISIONING-SECRET-zzz999';

interface PoolOpts {
  missing?: boolean;
  microStored?: string | null;
  macroStored?: string | null;
}

function makePool(opts: PoolOpts = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const s = sql.trim();
    if (s.startsWith('SELECT')) {
      if (opts.missing) return { rows: [] };
      return {
        rows: [
          {
            jira_key: 'DP-001',
            slack_micro_channel_id: opts.microStored ?? null,
            slack_macro_channel_id: opts.macroStored ?? null,
          },
        ],
      };
    }
    return { rows: [] };
  });
  mockGetPool.mockResolvedValue({ query });
  return { calls, query };
}

function event(role: string, projectId = 'DP-001'): APIGatewayProxyEvent {
  return {
    pathParameters: { projectId },
    body: null,
    requestContext: {
      authorizer: { claims: { sub: `sub-${role}`, email: 'actor@x.com', name: 'Actor', 'cognito:groups': [role] } },
    },
  } as unknown as APIGatewayProxyEvent;
}

const ctx = {} as never;
const projectsUpdate = (calls: Array<{ sql: string; params: unknown[] }>) =>
  calls.find((c) => c.sql.trim().startsWith('UPDATE projects'));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetProvisioningToken.mockResolvedValue(PROV_TOKEN);
});

describe('provision endpoint — resolve existing channels', () => {
  it('admin resolves existing micro+macro → 200, no create, persists via audited path', async () => {
    const { calls } = makePool();
    mockResolveOrCreateChannel
      .mockResolvedValueOnce({ id: 'C_MICRO', created: false })
      .mockResolvedValueOnce({ id: 'C_MACRO', created: false });

    const res = await handler(event('admin'), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.slack_micro_channel_id).toBe('C_MICRO');
    expect(body.slack_macro_channel_id).toBe('C_MACRO');
    expect(body.provisioned.micro.created).toBe(false);
    expect(body.provisioned.macro.created).toBe(false);
    expect(body.persisted).toBe(true);

    // Persisted via the audited linkage path: cols + updated_by (Cognito sub) + updated_at.
    const upd = projectsUpdate(calls)!;
    expect(upd).toBeDefined();
    expect(upd.sql).toContain('slack_micro_channel_id = $');
    expect(upd.sql).toContain('slack_macro_channel_id = $');
    expect(upd.sql).toContain('updated_by = $');
    expect(upd.sql).toContain('updated_at = now()');
    expect(upd.sql).toContain('WHERE jira_key = $');
    expect(upd.params).toEqual(['C_MICRO', 'C_MACRO', 'sub-admin', 'DP-001']);
  });
});

describe('provision endpoint — create missing channels', () => {
  it('leadership creates missing channels → 200, created flags true, persists ids', async () => {
    const { calls } = makePool();
    mockResolveOrCreateChannel
      .mockResolvedValueOnce({ id: 'C_NEW_MICRO', created: true })
      .mockResolvedValueOnce({ id: 'C_NEW_MACRO', created: true });

    const res = await handler(event('leadership'), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.provisioned.micro.created).toBe(true);
    expect(body.provisioned.macro.created).toBe(true);
    expect(body.persisted).toBe(true);

    const upd = projectsUpdate(calls)!;
    expect(upd.params).toEqual(['C_NEW_MICRO', 'C_NEW_MACRO', 'sub-leadership', 'DP-001']);
    // Channel names are derived from the jira_key.
    expect(mockResolveOrCreateChannel).toHaveBeenNthCalledWith(1, PROV_TOKEN, 'dp-001-micro');
    expect(mockResolveOrCreateChannel).toHaveBeenNthCalledWith(2, PROV_TOKEN, 'dp-001-macro');
  });
});

describe('provision endpoint — idempotent re-run', () => {
  it('stored ids already match resolved ids → 200, NO projects UPDATE (no dup audit)', async () => {
    const { calls } = makePool({ microStored: 'C_MICRO', macroStored: 'C_MACRO' });
    mockResolveOrCreateChannel
      .mockResolvedValueOnce({ id: 'C_MICRO', created: false })
      .mockResolvedValueOnce({ id: 'C_MACRO', created: false });

    const res = await handler(event('admin'), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.slack_micro_channel_id).toBe('C_MICRO');
    expect(body.slack_macro_channel_id).toBe('C_MACRO');
    expect(body.persisted).toBe(false);
    // No write on a no-op re-run.
    expect(projectsUpdate(calls)).toBeUndefined();
  });

  it('writes when only one id changed (e.g. macro backfilled)', async () => {
    const { calls } = makePool({ microStored: 'C_MICRO', macroStored: null });
    mockResolveOrCreateChannel
      .mockResolvedValueOnce({ id: 'C_MICRO', created: false })
      .mockResolvedValueOnce({ id: 'C_MACRO', created: true });

    const res = await handler(event('admin'), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    expect(JSON.parse(res!.body).persisted).toBe(true);
    expect(projectsUpdate(calls)).toBeDefined();
  });
});

describe('provision endpoint — authorization (admin/leadership only)', () => {
  it.each(['pm', 'sa', 'engineer'])('%s → 403 FORBIDDEN, no Slack call, no write', async (role) => {
    const { calls } = makePool();
    const res = await handler(event(role), ctx, () => {});
    expect(res!.statusCode).toBe(403);
    expect(JSON.parse(res!.body).code).toBe('FORBIDDEN');
    expect(mockResolveOrCreateChannel).not.toHaveBeenCalled();
    expect(mockGetProvisioningToken).not.toHaveBeenCalled();
    expect(calls.some((c) => c.sql.trim().startsWith('UPDATE'))).toBe(false);
  });
});

describe('provision endpoint — not found', () => {
  it('missing project → 404, no Slack call', async () => {
    makePool({ missing: true });
    const res = await handler(event('admin'), ctx, () => {});
    expect(res!.statusCode).toBe(404);
    expect(mockResolveOrCreateChannel).not.toHaveBeenCalled();
  });
});

describe('provision endpoint — no secret leak', () => {
  it('provisioning token never appears in the response body', async () => {
    makePool();
    mockResolveOrCreateChannel
      .mockResolvedValueOnce({ id: 'C_MICRO', created: false })
      .mockResolvedValueOnce({ id: 'C_MACRO', created: false });

    const res = await handler(event('admin'), ctx, () => {});
    expect(res!.body).not.toContain(PROV_TOKEN);
    expect(res!.body).not.toContain('xoxb-');
  });
});

describe('provision endpoint — upstream Slack/SSM failure', () => {
  it('missing provisioning credential → 502, secret-free code, token absent from body', async () => {
    makePool();
    mockGetProvisioningToken.mockRejectedValue(
      new SlackProvisioningError('PROVISIONING_TOKEN_NOT_FOUND', 'Slack provisioning credential is not configured'),
    );

    const res = await handler(event('admin'), ctx, () => {});
    expect(res!.statusCode).toBe(502);
    const body = JSON.parse(res!.body);
    expect(body.code).toBe('PROVISIONING_TOKEN_NOT_FOUND');
    expect(res!.body).not.toContain(PROV_TOKEN);
  });

  it('Slack API error during resolve/create → 502 with the (secret-free) Slack code', async () => {
    makePool();
    mockResolveOrCreateChannel.mockRejectedValue(
      new SlackProvisioningError('SLACK_API_ERROR', 'Slack API error: invalid_auth'),
    );

    const res = await handler(event('admin'), ctx, () => {});
    expect(res!.statusCode).toBe(502);
    expect(JSON.parse(res!.body).code).toBe('SLACK_API_ERROR');
  });
});
