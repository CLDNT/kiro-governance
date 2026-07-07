/**
 * Handler tests for POST /api/projects — CR-02 linkage on create.
 * Covers: linkage authz 403, validation 400, uniqueness 409, and the create-path
 * audit precondition (updated_by set on INSERT so the AFTER INSERT trigger attributes actor).
 * See specs/phase2/CR-02-projects-api-linkage-spec.md §6.2, §10.
 */
import { APIGatewayProxyEvent } from 'aws-lambda';

const mockGetPool = jest.fn();
jest.mock('@kiro-governance/shared/db/pool', () => ({ getPool: (...a: unknown[]) => mockGetPool(...a) }));

import { handler } from '../../handlers/create-project';

const INSERTED_ROW = {
  id: 1,
  jira_key: 'DP-010',
  jira_id: null,
  jira_link: null,
  title: 'T',
  description: null,
  project_type: 'AppDev',
  status: 'Active',
  account_executive: null,
  solution_architect: 'sa@x.com',
  project_manager: 'pm@x.com',
  engineers_assigned: null,
  planned_kickoff_date: null,
  expected_completion_date: null,
  resource_assignment_date: null,
  sow_hours: null,
  hours_consumed: 0,
  sow_link: null,
  created_at: '2026-07-02T00:00:00Z',
  github_repo: 'my-repo',
  github_url: null,
  slack_micro_channel_id: null,
  slack_macro_channel_id: null,
  updated_by: 'sub-admin',
  updated_at: '2026-07-02T00:00:00Z',
};

interface ClientOpts {
  collision?: boolean;
  insertThrows?: unknown;
}

function makeClient(opts: ClientOpts = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const s = sql.trim();
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
    if (s.includes('LIMIT 1')) return { rows: opts.collision ? [{ col: 1 }] : [] };
    if (s.includes('next_key')) return { rows: [{ next_key: 'DP-010' }] };
    if (s.startsWith('INSERT INTO projects')) {
      if (opts.insertThrows) throw opts.insertThrows;
      return { rows: [INSERTED_ROW] };
    }
    if (s.includes('FROM casdm_config')) {
      return {
        rows: [
          { config_type: 'micro_artifact', phase: 'Phase 0', phase_name: 'Discovery', item_name: 'M', item_type: null },
          { config_type: 'macro_checkpoint', phase: 'Phase 0', phase_name: 'Discovery', item_name: 'C', item_type: 'gate' },
        ],
      };
    }
    return { rows: [] }; // micro/macro/onboarding inserts
  });
  const client = { query, release: jest.fn() };
  mockGetPool.mockResolvedValue({ connect: jest.fn().mockResolvedValue(client) });
  return { query, calls, client };
}

function event(role: string, body: unknown): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { claims: { sub: `sub-${role}`, email: 'actor@x.com', name: 'Actor', 'cognito:groups': [role] } },
    },
  } as unknown as APIGatewayProxyEvent;
}

const BASE = { title: 'T', project_type: 'AppDev', project_manager: 'pm@x.com', solution_architect: 'sa@x.com' };
const ctx = {} as never;

beforeEach(() => jest.clearAllMocks());

describe('POST create-project — linkage authz (403)', () => {
  it('pm supplying github_repo → 403 FORBIDDEN, no DB connection', async () => {
    makeClient();
    const res = await handler(event('pm', { ...BASE, github_repo: 'my-repo' }), ctx, () => {});
    expect(res!.statusCode).toBe(403);
    expect(JSON.parse(res!.body).code).toBe('FORBIDDEN');
    expect(mockGetPool).not.toHaveBeenCalled();
  });

  it('admin supplying linkage → 201 (allowed)', async () => {
    makeClient();
    const res = await handler(event('admin', { ...BASE, github_repo: 'my-repo' }), ctx, () => {});
    expect(res!.statusCode).toBe(201);
  });

  it('pm creating WITHOUT linkage → 201 (gate not triggered)', async () => {
    makeClient();
    const res = await handler(event('pm', BASE), ctx, () => {});
    expect(res!.statusCode).toBe(201);
  });
});

describe('POST create-project — validation (400)', () => {
  it('invalid github_url → 400 with field detail', async () => {
    makeClient();
    const res = await handler(event('admin', { ...BASE, github_url: 'http://github.com/x' }), ctx, () => {});
    expect(res!.statusCode).toBe(400);
    const b = JSON.parse(res!.body);
    expect(b.code).toBe('VALIDATION_ERROR');
    expect(b.details.github_url).toBeDefined();
  });

  it('slack channel with disallowed char → 400', async () => {
    makeClient();
    const res = await handler(event('admin', { ...BASE, slack_micro_channel_id: 'C-123' }), ctx, () => {});
    expect(res!.statusCode).toBe(400);
    expect(JSON.parse(res!.body).details.slack_micro_channel_id).toBeDefined();
  });
});

describe('POST create-project — uniqueness (409)', () => {
  it('PG 23505 on INSERT → 409 DUPLICATE_GITHUB_REPO', async () => {
    makeClient({ insertThrows: { code: '23505', constraint: 'uq_projects_github_repo' } });
    const res = await handler(event('admin', { ...BASE, github_repo: 'taken' }), ctx, () => {});
    expect(res!.statusCode).toBe(409);
    expect(JSON.parse(res!.body).code).toBe('DUPLICATE_GITHUB_REPO');
  });

  it('github_repo colliding with existing jira_key → 409 (SEC-M4), no INSERT', async () => {
    const { calls } = makeClient({ collision: true });
    const res = await handler(event('admin', { ...BASE, github_repo: 'DP-002' }), ctx, () => {});
    expect(res!.statusCode).toBe(409);
    expect(calls.some((c) => c.sql.trim().startsWith('INSERT INTO projects'))).toBe(false);
  });
});

describe('POST create-project — create-path audit precondition', () => {
  it('linked create sets updated_by = auth.userId in the INSERT params', async () => {
    const { calls } = makeClient();
    const res = await handler(event('admin', { ...BASE, github_repo: 'my-repo' }), ctx, () => {});
    expect(res!.statusCode).toBe(201);
    const insert = calls.find((c) => c.sql.trim().startsWith('INSERT INTO projects'))!;
    expect(insert.params).toContain('my-repo');
    expect(insert.params).toContain('sub-admin'); // updated_by = Cognito sub
  });

  it('unlinked create sets updated_by NULL', async () => {
    const { calls } = makeClient();
    const res = await handler(event('admin', BASE), ctx, () => {});
    expect(res!.statusCode).toBe(201);
    const insert = calls.find((c) => c.sql.trim().startsWith('INSERT INTO projects'))!;
    // last positional param is updated_by; with no linkage it must be null
    expect(insert.params[insert.params.length - 1]).toBeNull();
  });

  it('response includes linkage fields', async () => {
    makeClient();
    const res = await handler(event('admin', { ...BASE, github_repo: 'my-repo' }), ctx, () => {});
    const b = JSON.parse(res!.body);
    expect(b.project.github_repo).toBe('my-repo');
    expect(b.project).toHaveProperty('updated_by', 'sub-admin');
    // no Slack token/secret leaked — only channel ids present
    expect(JSON.stringify(b)).not.toMatch(/xoxb-|xapp-/);
  });
});
