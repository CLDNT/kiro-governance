/**
 * Handler tests for GET /api/projects/{projectId}/timeline (CR-03).
 * Covers: 404 for unknown project, linked project surfaces governance events (source kiro_mcp),
 * unlinked project surfaces only DeliverPro-native events, and 400 on bad query params.
 * See docs/phase2/gates-architecture.md §2.8/§5.4.
 */
import { APIGatewayProxyEvent } from 'aws-lambda';

const mockQueryMany = jest.fn();
const mockQueryOne = jest.fn();

jest.mock('@kiro-governance/shared/db/pool', () => ({
  queryMany: (...a: unknown[]) => mockQueryMany(...a),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
}));

import { handler } from '../../handlers/project-timeline';

function event(
  role: string,
  projectId: string | undefined,
  query: Record<string, string> = {},
): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: `/api/projects/${projectId}/timeline`,
    pathParameters: projectId ? { projectId } : null,
    queryStringParameters: Object.keys(query).length ? query : null,
    requestContext: {
      authorizer: { claims: { sub: `sub-${role}`, email: 'a@x.com', name: 'A', 'cognito:groups': [role] } },
    },
  } as unknown as APIGatewayProxyEvent;
}

const ctx = {} as never;

beforeEach(() => jest.clearAllMocks());

describe('GET project-timeline — 404', () => {
  it('returns 404 PROJECT_NOT_FOUND when the project does not exist', async () => {
    mockQueryOne.mockResolvedValue(null); // projectExists -> false
    const res = await handler(event('pm', 'NOPE'), ctx, () => {});
    expect(res!.statusCode).toBe(404);
    expect(JSON.parse(res!.body).code).toBe('NOT_FOUND');
    // must not run the timeline query when the project is missing
    expect(mockQueryMany).not.toHaveBeenCalled();
  });
});

describe('GET project-timeline — linked project surfaces governance events', () => {
  it('returns governance rows (source kiro_mcp) merged with native rows', async () => {
    mockQueryOne.mockResolvedValue({ jira_key: 'DP-001' }); // projectExists -> true
    mockQueryMany.mockResolvedValue([
      {
        id: 'ge-1',
        event_type: 'governance_event',
        timestamp: '2026-07-02T10:00:00Z',
        phase: 'Phase 1',
        title: 'SRS approved',
        actor: 'aws-architect',
        detail: 'SRS approved',
        source: 'kiro_mcp',
      },
    ]);

    const res = await handler(event('leadership', 'DP-001'), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].source).toBe('kiro_mcp');
    expect(body.next_cursor).toBeNull();
  });
});

describe('GET project-timeline — unlinked project shows only native events', () => {
  it('returns only deliverpro-sourced rows and no error', async () => {
    mockQueryOne.mockResolvedValue({ jira_key: 'DP-UNLINKED' });
    mockQueryMany.mockResolvedValue([
      {
        id: 'mc-9',
        event_type: 'checkpoint_completed',
        timestamp: '2026-07-01T09:00:00Z',
        phase: 'Phase 0',
        title: '5 outputs reviewed by SA',
        actor: 'jane',
        detail: null,
        source: 'deliverpro',
      },
    ]);

    const res = await handler(event('pm', 'DP-UNLINKED'), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.events.every((e: { source: string }) => e.source === 'deliverpro')).toBe(true);
    expect(body.events.some((e: { event_type: string }) => e.event_type === 'governance_event')).toBe(false);
  });
});

describe('GET project-timeline — validation', () => {
  it('returns 400 when limit exceeds the max', async () => {
    mockQueryOne.mockResolvedValue({ jira_key: 'DP-001' });
    const res = await handler(event('pm', 'DP-001', { limit: '5000' }), ctx, () => {});
    expect(res!.statusCode).toBe(400);
    expect(JSON.parse(res!.body).code).toBe('VALIDATION_ERROR');
  });
});
