/**
 * Handler tests for PATCH /api/projects/{projectId} — CR-02 linkage retrofit.
 * Covers: linkage authz 403, validation 400, uniqueness 409, immutable 422,
 * and the audit precondition (updated_by/updated_at set on the UPDATE).
 * See specs/phase2/CR-02-projects-api-linkage-spec.md §10.
 */
import { APIGatewayProxyEvent } from 'aws-lambda';

const mockGetPool = jest.fn();
jest.mock('@kiro-governance/shared/db/pool', () => ({ getPool: (...a: unknown[]) => mockGetPool(...a) }));

import { handler } from '../../handlers/update-project';

const EXISTING = { project_type: 'AppDev', project_manager: 'owner@x.com', status: 'Active' };

const FULL_ROW = {
  id: 1,
  jira_key: 'DP-001',
  title: 'T',
  github_repo: 'my-repo',
  github_url: null,
  slack_micro_channel_id: null,
  slack_macro_channel_id: null,
  updated_by: 'sub-1',
  updated_at: '2026-07-02T00:00:00Z',
  current_phase: 'Phase 0',
};

interface PoolOpts {
  collision?: boolean; // step-2 returns a row
  updateThrows?: unknown; // UPDATE rejects with this
}

function makePool(opts: PoolOpts = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const s = sql.trim();
    if (s.startsWith('UPDATE')) {
      if (opts.updateThrows) throw opts.updateThrows;
      return { rows: [FULL_ROW] };
    }
    if (s.includes('LIMIT 1')) {
      return { rows: opts.collision ? [{ col: 1 }] : [] };
    }
    if (s.includes('project_type, project_manager')) {
      return { rows: [EXISTING] };
    }
    // final detail SELECT
    return { rows: [FULL_ROW] };
  });
  mockGetPool.mockResolvedValue({ query });
  return { query, calls };
}

function event(role: string, body: unknown, projectId = 'DP-001'): APIGatewayProxyEvent {
  return {
    pathParameters: { projectId },
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { claims: { sub: `sub-${role}`, email: 'actor@x.com', name: 'Actor', 'cognito:groups': [role] } },
    },
  } as unknown as APIGatewayProxyEvent;
}

const ctx = {} as never;

beforeEach(() => jest.clearAllMocks());

describe('PATCH update-project — linkage authz (403)', () => {
  it('pm setting github_repo → 403 FORBIDDEN, no UPDATE issued', async () => {
    const { calls } = makePool();
    const res = await handler(event('pm', { github_repo: 'my-repo' }), ctx, () => {});
    expect(res!.statusCode).toBe(403);
    const b = JSON.parse(res!.body);
    expect(b.code).toBe('FORBIDDEN');
    expect(b.message).toBe('Only admin or leadership may change project linkage');
    expect(calls.some((c) => c.sql.trim().startsWith('UPDATE'))).toBe(false);
  });

  it('pm clearing github_repo (null) → 403 (presence-keyed)', async () => {
    const { calls } = makePool();
    const res = await handler(event('pm', { github_repo: null }), ctx, () => {});
    expect(res!.statusCode).toBe(403);
    expect(calls.some((c) => c.sql.trim().startsWith('UPDATE'))).toBe(false);
  });

  it('sa setting a slack channel → 403 (blocked before reaching handler body)', async () => {
    makePool();
    const res = await handler(event('sa', { slack_micro_channel_id: 'C1' }), ctx, () => {});
    expect(res!.statusCode).toBe(403);
    expect(JSON.parse(res!.body).code).toBe('FORBIDDEN');
  });

  it('admin setting github_repo → 200 (allowed)', async () => {
    makePool();
    const res = await handler(event('admin', { github_repo: 'my-repo' }), ctx, () => {});
    expect(res!.statusCode).toBe(200);
  });

  it('leadership setting github_repo → 200 (allowed)', async () => {
    makePool();
    const res = await handler(event('leadership', { github_repo: 'my-repo' }), ctx, () => {});
    expect(res!.statusCode).toBe(200);
  });

  it('pm editing only title on an owned project → 200 (linkage gate not triggered)', async () => {
    makePool();
    // pm owns EXISTING (owner@x.com); event actor email is actor@x.com so use owner claim
    const ev = {
      pathParameters: { projectId: 'DP-001' },
      body: JSON.stringify({ title: 'New' }),
      requestContext: {
        authorizer: { claims: { sub: 'sub-pm', email: 'owner@x.com', name: 'PM', 'cognito:groups': ['pm'] } },
      },
    } as unknown as APIGatewayProxyEvent;
    const res = await handler(ev, ctx, () => {});
    expect(res!.statusCode).toBe(200);
  });
});

describe('PATCH update-project — validation (400)', () => {
  it.each([
    ['github_url', { github_url: 'http://github.com/x' }],
    ['github_url', { github_url: 'https://evil.com/github.com' }],
    ['github_repo', { github_repo: 'has space' }],
    ['github_repo', { github_repo: 'a'.repeat(101) }],
    ['slack_micro_channel_id', { slack_micro_channel_id: 'C-1/hook' }],
  ])('invalid %s → 400 with field detail', async (field, body) => {
    makePool();
    const res = await handler(event('admin', body), ctx, () => {});
    expect(res!.statusCode).toBe(400);
    const b = JSON.parse(res!.body);
    expect(b.code).toBe('VALIDATION_ERROR');
    expect(b.details[field]).toBeDefined();
  });

  it('valid github_url + github_repo passes validation (200)', async () => {
    makePool();
    const res = await handler(event('admin', { github_url: 'https://github.com/org/repo', github_repo: 'repo' }), ctx, () => {});
    expect(res!.statusCode).toBe(200);
  });
});

describe('PATCH update-project — uniqueness (409)', () => {
  it('PG 23505 on uq_projects_github_repo → 409 DUPLICATE_GITHUB_REPO', async () => {
    makePool({ updateThrows: { code: '23505', constraint: 'uq_projects_github_repo' } });
    const res = await handler(event('admin', { github_repo: 'taken' }), ctx, () => {});
    expect(res!.statusCode).toBe(409);
    expect(JSON.parse(res!.body).code).toBe('DUPLICATE_GITHUB_REPO');
  });

  it('github_repo equal to another project jira_key → 409 (SEC-M4), no UPDATE', async () => {
    const { calls } = makePool({ collision: true });
    const res = await handler(event('admin', { github_repo: 'DP-002' }), ctx, () => {});
    expect(res!.statusCode).toBe(409);
    expect(JSON.parse(res!.body).code).toBe('DUPLICATE_GITHUB_REPO');
    expect(calls.some((c) => c.sql.trim().startsWith('UPDATE'))).toBe(false);
  });
});

describe('PATCH update-project — immutable jira_key (422)', () => {
  it('body containing jira_key → 422 IMMUTABLE_FIELD', async () => {
    makePool();
    const res = await handler(event('admin', { jira_key: 'DP-999', title: 'x' }), ctx, () => {});
    expect(res!.statusCode).toBe(422);
    const b = JSON.parse(res!.body);
    expect(b.code).toBe('IMMUTABLE_FIELD');
    expect(b.details.field).toBe('jira_key');
  });
});

describe('PATCH update-project — audit precondition (updated_by/updated_at on UPDATE)', () => {
  it('linkage change sets updated_by = auth.userId and updated_at = now()', async () => {
    const { calls } = makePool();
    const res = await handler(event('admin', { github_repo: 'my-repo' }), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    const update = calls.find((c) => c.sql.trim().startsWith('UPDATE'))!;
    expect(update.sql).toContain('updated_by = $');
    expect(update.sql).toContain('updated_at = now()');
    expect(update.params).toContain('sub-admin'); // Cognito sub of the actor
  });

  it('two linkage fields in one call → both in the single UPDATE (two audit rows via trigger)', async () => {
    const { calls } = makePool();
    const res = await handler(event('admin', { github_repo: 'my-repo', slack_micro_channel_id: 'C123' }), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    const update = calls.find((c) => c.sql.trim().startsWith('UPDATE'))!;
    expect(update.sql).toContain('github_repo = $');
    expect(update.sql).toContain('slack_micro_channel_id = $');
    expect(update.sql).toContain('updated_by = $');
  });

  it('non-linkage-only edit does NOT set updated_by/updated_at', async () => {
    const { calls } = makePool();
    const res = await handler(event('admin', { title: 'New Title' }), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    const update = calls.find((c) => c.sql.trim().startsWith('UPDATE'))!;
    expect(update.sql).not.toContain('updated_by');
    expect(update.sql).not.toContain('updated_at');
  });
});
