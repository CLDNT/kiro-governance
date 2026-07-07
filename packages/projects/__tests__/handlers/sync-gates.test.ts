/**
 * Handler tests for POST /api/projects/{projectId}/sync-gates (CR-16).
 * Mocks the gate-sync service; uses the REAL GithubFetchError + NotFoundError so instanceof
 * mapping is exercised. Asserts: admin/leadership → 200 summary; pm/sa/engineer → 403; unknown
 * project → 404; GitHub rate-limit → 503 REPO_SYNC_UNAVAILABLE; response carries no secret.
 */
import { APIGatewayProxyEvent } from 'aws-lambda';

const mockSyncGatesFromRepo = jest.fn();
jest.mock('../../services/gate-sync.service', () => ({
  syncGatesFromRepo: (...a: unknown[]) => mockSyncGatesFromRepo(...a),
}));

import { handler } from '../../handlers/sync-gates';
import { GithubFetchError } from '../../services/github.service';
import { NotFoundError } from '@kiro-governance/shared/middleware/error-handler';

function event(role: string, projectId: string | undefined = 'DP-001'): APIGatewayProxyEvent {
  return {
    pathParameters: projectId ? { projectId } : {},
    body: null,
    requestContext: {
      authorizer: { claims: { sub: `sub-${role}`, email: 'actor@x.com', name: 'Actor', 'cognito:groups': [role] } },
    },
  } as unknown as APIGatewayProxyEvent;
}

const ctx = {} as never;

beforeEach(() => jest.clearAllMocks());

describe('sync-gates handler — authorization', () => {
  it.each(['admin', 'leadership'])('%s → 200 with the sync summary', async (role) => {
    mockSyncGatesFromRepo.mockResolvedValue({ project_id: 'DP-001', matched: 3, resolved: 2, skipped: 1 });
    const res = await handler(event(role), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    expect(JSON.parse(res!.body)).toEqual({ project_id: 'DP-001', matched: 3, resolved: 2, skipped: 1 });
    expect(mockSyncGatesFromRepo).toHaveBeenCalledWith('DP-001', `sub-${role}`);
  });

  it.each(['pm', 'sa', 'engineer'])('%s → 403 FORBIDDEN, service not called', async (role) => {
    const res = await handler(event(role), ctx, () => {});
    expect(res!.statusCode).toBe(403);
    expect(JSON.parse(res!.body).code).toBe('FORBIDDEN');
    expect(mockSyncGatesFromRepo).not.toHaveBeenCalled();
  });
});

describe('sync-gates handler — errors', () => {
  it('unknown project → 404 NOT_FOUND', async () => {
    mockSyncGatesFromRepo.mockRejectedValue(new NotFoundError('Project', 'NOPE-999'));
    const res = await handler(event('admin', 'NOPE-999'), ctx, () => {});
    expect(res!.statusCode).toBe(404);
    expect(JSON.parse(res!.body).code).toBe('NOT_FOUND');
  });

  it('GitHub rate-limit → 503 REPO_SYNC_UNAVAILABLE (secret-free)', async () => {
    mockSyncGatesFromRepo.mockRejectedValue(new GithubFetchError('GITHUB_RATE_LIMITED', 'rate limited'));
    const res = await handler(event('admin'), ctx, () => {});
    expect(res!.statusCode).toBe(503);
    expect(JSON.parse(res!.body).code).toBe('REPO_SYNC_UNAVAILABLE');
  });

  it('missing projectId path param → 400 VALIDATION_ERROR', async () => {
    mockSyncGatesFromRepo.mockReset();
    const noIdEvent = {
      pathParameters: {},
      body: null,
      requestContext: {
        authorizer: { claims: { sub: 'sub-admin', email: 'a@x.com', name: 'A', 'cognito:groups': ['admin'] } },
      },
    } as unknown as APIGatewayProxyEvent;
    const res = await handler(noIdEvent, ctx, () => {});
    expect(res!.statusCode).toBe(400);
    expect(JSON.parse(res!.body).code).toBe('VALIDATION_ERROR');
    expect(mockSyncGatesFromRepo).not.toHaveBeenCalled();
  });

  it('response never contains a token-like secret', async () => {
    mockSyncGatesFromRepo.mockResolvedValue({ project_id: 'DP-001', matched: 0, resolved: 0, skipped: 0 });
    const res = await handler(event('admin'), ctx, () => {});
    expect(res!.body).not.toMatch(/ghp_|xoxb-|Bearer /);
  });
});
