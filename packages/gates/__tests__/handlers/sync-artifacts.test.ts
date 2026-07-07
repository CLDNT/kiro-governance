import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { APIGatewayProxyEvent } from 'aws-lambda';

const mockReconcile = jest.fn();
jest.mock('../../services/micro-artifact-reconcile.service', () => ({
  reconcileMicroArtifacts: (...a: unknown[]) => mockReconcile(...a),
}));

import { NotFoundError } from '@kiro-governance/shared/middleware/error-handler';
import { handler } from '../../handlers/sync-artifacts';

function event(role: string, projectId = 'DP-001'): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: `/api/projects/${projectId}/sync-artifacts`,
    pathParameters: { projectId },
    requestContext: {
      authorizer: { claims: { sub: `sub-${role}`, email: `${role}@x.com`, name: role, 'cognito:groups': [role] } },
    },
  } as unknown as APIGatewayProxyEvent;
}

const ctx = {} as never;

beforeEach(() => jest.clearAllMocks());

describe('POST /sync-artifacts — RBAC', () => {
  it('admin → 200 with the reconcile summary', async () => {
    mockReconcile.mockResolvedValue({ project_id: 'DP-001', matched: 3, completed: 2, skipped: 1 });
    const res = await handler(event('admin'), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    expect(JSON.parse(res!.body)).toEqual({ project_id: 'DP-001', matched: 3, completed: 2, skipped: 1 });
    expect(mockReconcile).toHaveBeenCalledWith('DP-001', 'sub-admin');
  });

  it('leadership → 200', async () => {
    mockReconcile.mockResolvedValue({ project_id: 'DP-001', matched: 0, completed: 0, skipped: 0 });
    const res = await handler(event('leadership'), ctx, () => {});
    expect(res!.statusCode).toBe(200);
  });

  it.each(['pm', 'sa', 'engineer'])('%s → 403 FORBIDDEN, reconcile never called', async (role) => {
    const res = await handler(event(role), ctx, () => {});
    expect(res!.statusCode).toBe(403);
    expect(JSON.parse(res!.body).code).toBe('FORBIDDEN');
    expect(mockReconcile).not.toHaveBeenCalled();
  });
});

describe('POST /sync-artifacts — outcomes', () => {
  it('unknown project → 404', async () => {
    mockReconcile.mockRejectedValue(new NotFoundError('Project', 'NOPE'));
    const res = await handler(event('admin', 'NOPE'), ctx, () => {});
    expect(res!.statusCode).toBe(404);
    expect(JSON.parse(res!.body).code).toBe('NOT_FOUND');
  });

  it('unlinked project → 200 all-zero', async () => {
    mockReconcile.mockResolvedValue({ project_id: 'DP-003', matched: 0, completed: 0, skipped: 0 });
    const res = await handler(event('admin', 'DP-003'), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    expect(JSON.parse(res!.body)).toEqual({ project_id: 'DP-003', matched: 0, completed: 0, skipped: 0 });
  });
});
