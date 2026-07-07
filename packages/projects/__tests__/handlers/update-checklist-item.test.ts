/**
 * Handler tests for PATCH /api/projects/{projectId}/checklist/{itemId} — CR-04 soft-capture.
 * Covers:
 *  - completion WITHOUT ids succeeds and is NOT blocked (soft capture), no projects UPDATE;
 *  - completion WITH ids (admin/leadership) persists to projects via the audited linkage path
 *    (slack columns + updated_by = Cognito sub + updated_at = now());
 *  - non-admin/leadership attaching ids → 403 FORBIDDEN, no writes;
 *  - secret-shaped input (bot token / webhook URL) → 400 VALIDATION_ERROR;
 *  - ids on a non-Slack item or with completed=false → 400;
 *  - item not found → 404.
 * See docs/phase2/projects-architecture.md §2.7, FR-P2-019 (soft capture), impact v3-3.
 */
import { APIGatewayProxyEvent } from 'aws-lambda';

const mockGetPool = jest.fn();
jest.mock('@kiro-governance/shared/db/pool', () => ({ getPool: (...a: unknown[]) => mockGetPool(...a) }));

import { handler } from '../../handlers/update-checklist-item';
import { SLACK_TEAMS_CHECKLIST_ITEM } from '../../services/seed.service';

const ITEM_ROW = {
  id: 10,
  project_id: 'DP-001',
  item_name: SLACK_TEAMS_CHECKLIST_ITEM,
  completed: true,
  completed_by: 'actor@x.com',
  completed_at: '2026-07-03T00:00:00Z',
  created_at: '2026-07-01T00:00:00Z',
};

interface PoolOpts {
  /** item_name returned by the existence check (defaults to the Slack/Teams item). */
  itemName?: string;
  /** when true, the existence check returns no rows → 404. */
  missing?: boolean;
}

function makePool(opts: PoolOpts = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];

  const clientQuery = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const s = sql.trim();
    if (s.startsWith('UPDATE onboarding_checklist_items')) {
      return { rows: [ITEM_ROW] };
    }
    if (s.includes('COUNT(*)')) {
      return { rows: [{ completed_count: 1, total_count: 9 }] };
    }
    return { rows: [] };
  });
  const client = { query: clientQuery, release: jest.fn() };

  const poolQuery = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    // item existence check
    if (opts.missing) return { rows: [] };
    return { rows: [{ project_id: 'DP-001', item_name: opts.itemName ?? SLACK_TEAMS_CHECKLIST_ITEM }] };
  });

  mockGetPool.mockResolvedValue({ query: poolQuery, connect: jest.fn().mockResolvedValue(client) });
  return { calls, clientQuery, poolQuery, client };
}

function event(role: string, body: unknown, projectId = 'DP-001', itemId = '10'): APIGatewayProxyEvent {
  return {
    pathParameters: { projectId, itemId },
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { claims: { sub: `sub-${role}`, email: 'actor@x.com', name: 'Actor', 'cognito:groups': [role] } },
    },
  } as unknown as APIGatewayProxyEvent;
}

const ctx = {} as never;

const projectsUpdate = (calls: Array<{ sql: string; params: unknown[] }>) =>
  calls.find((c) => c.sql.trim().startsWith('UPDATE projects'));

beforeEach(() => jest.clearAllMocks());

describe('PATCH checklist — soft capture (completion NOT blocked without ids)', () => {
  it('pm completes the Slack/Teams item WITHOUT ids → 200, no projects UPDATE', async () => {
    const { calls } = makePool();
    const res = await handler(event('pm', { completed: true }), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    expect(projectsUpdate(calls)).toBeUndefined();
  });

  it('sa completes a NON-Slack item WITHOUT ids → 200 (no capture involved)', async () => {
    const { calls } = makePool({ itemName: 'Set up Clockify' });
    const res = await handler(event('sa', { completed: true }), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    expect(projectsUpdate(calls)).toBeUndefined();
  });

  it('unchecking the item (completed=false) WITHOUT ids → 200', async () => {
    const { calls } = makePool();
    const res = await handler(event('pm', { completed: false }), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    expect(projectsUpdate(calls)).toBeUndefined();
  });
});

describe('PATCH checklist — capture WITH ids persists via audited linkage path', () => {
  it('admin completes Slack item with both ids → 200 and UPDATE projects sets cols + updated_by + updated_at', async () => {
    const { calls } = makePool();
    const res = await handler(
      event('admin', { completed: true, slack_micro_channel_id: 'C0MICRO01', slack_macro_channel_id: 'C0MACRO01' }),
      ctx,
      () => {},
    );
    expect(res!.statusCode).toBe(200);
    const upd = projectsUpdate(calls)!;
    expect(upd).toBeDefined();
    expect(upd.sql).toContain('slack_micro_channel_id = $');
    expect(upd.sql).toContain('slack_macro_channel_id = $');
    expect(upd.sql).toContain('updated_by = $');
    expect(upd.sql).toContain('updated_at = now()');
    expect(upd.sql).toContain('WHERE jira_key = $');
    // audited actor = Cognito sub (not email)
    expect(upd.params).toContain('sub-admin');
    expect(upd.params).toContain('C0MICRO01');
    expect(upd.params).toContain('C0MACRO01');
    expect(upd.params).toContain('DP-001');
  });

  it('leadership with only the micro id → 200, UPDATE touches micro but not macro', async () => {
    const { calls } = makePool();
    const res = await handler(event('leadership', { completed: true, slack_micro_channel_id: 'C0MICRO01' }), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    const upd = projectsUpdate(calls)!;
    expect(upd.sql).toContain('slack_micro_channel_id = $');
    expect(upd.sql).not.toContain('slack_macro_channel_id = $');
    expect(upd.sql).toContain('updated_by = $');
  });
});

describe('PATCH checklist — linkage authz (403) when non-privileged attaches ids', () => {
  it('pm attaching a channel id → 403 FORBIDDEN, no checklist or projects write', async () => {
    const { calls } = makePool();
    const res = await handler(event('pm', { completed: true, slack_micro_channel_id: 'C0MICRO01' }), ctx, () => {});
    expect(res!.statusCode).toBe(403);
    expect(JSON.parse(res!.body).code).toBe('FORBIDDEN');
    expect(calls.some((c) => c.sql.trim().startsWith('UPDATE'))).toBe(false);
  });

  it('sa attaching a channel id → 403 FORBIDDEN', async () => {
    makePool();
    const res = await handler(event('sa', { completed: true, slack_macro_channel_id: 'C0MACRO01' }), ctx, () => {});
    expect(res!.statusCode).toBe(403);
    expect(JSON.parse(res!.body).code).toBe('FORBIDDEN');
  });
});

describe('PATCH checklist — secret input is never accepted (400)', () => {
  it.each([
    ['bot token', { completed: true, slack_micro_channel_id: 'xoxb-123-abc' }, 'slack_micro_channel_id'],
    ['webhook host', { completed: true, slack_micro_channel_id: 'hooks.slack.com' }, 'slack_micro_channel_id'],
    ['webhook path', { completed: true, slack_macro_channel_id: 'T00/B00/XXXX' }, 'slack_macro_channel_id'],
  ])('%s rejected → 400 VALIDATION_ERROR with field detail', async (_label, body, field) => {
    const { calls } = makePool();
    const res = await handler(event('admin', body), ctx, () => {});
    expect(res!.statusCode).toBe(400);
    const b = JSON.parse(res!.body);
    expect(b.code).toBe('VALIDATION_ERROR');
    expect(b.details[field]).toBeDefined();
    // rejected before any DB write
    expect(calls.some((c) => c.sql.trim().startsWith('UPDATE'))).toBe(false);
  });
});

describe('PATCH checklist — capture-context guards (400)', () => {
  it('ids supplied on a NON-Slack item → 400 VALIDATION_ERROR, no writes', async () => {
    const { calls } = makePool({ itemName: 'Set up Clockify' });
    const res = await handler(event('admin', { completed: true, slack_micro_channel_id: 'C0MICRO01' }), ctx, () => {});
    expect(res!.statusCode).toBe(400);
    expect(JSON.parse(res!.body).code).toBe('VALIDATION_ERROR');
    expect(calls.some((c) => c.sql.trim().startsWith('UPDATE'))).toBe(false);
  });

  it('ids supplied with completed=false → 400 VALIDATION_ERROR', async () => {
    const { calls } = makePool();
    const res = await handler(event('admin', { completed: false, slack_micro_channel_id: 'C0MICRO01' }), ctx, () => {});
    expect(res!.statusCode).toBe(400);
    expect(JSON.parse(res!.body).code).toBe('VALIDATION_ERROR');
    expect(calls.some((c) => c.sql.trim().startsWith('UPDATE'))).toBe(false);
  });
});

describe('PATCH checklist — not found (404)', () => {
  it('missing item → 404', async () => {
    makePool({ missing: true });
    const res = await handler(event('admin', { completed: true, slack_micro_channel_id: 'C0MICRO01' }), ctx, () => {});
    expect(res!.statusCode).toBe(404);
  });
});
