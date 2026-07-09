/**
 * Handler test for PATCH /api/projects/{id}/checkpoints/{checkpointId} — CR-10 app-owned MACRO notify.
 *
 * Verifies:
 *  - completing a macro checkpoint in-app fires the app-owned MACRO notification (notifyMacroGateApproved);
 *  - a notify failure does NOT fail the approval (approval still returns 200 — best-effort / non-blocking).
 *
 * The MACRO notification originates ONLY from the app (no-double-notify boundary — MICRO is CI-owned).
 * Mocks the shared pg pool + the macro-notify service. See jira-backlog CR-10; v3 §6.2.
 */
import { APIGatewayProxyEvent } from 'aws-lambda';

const mockQueryOne = jest.fn();
const mockQueryMany = jest.fn();
const mockNotifyMacroGateApproved = jest.fn();

jest.mock('@kiro-governance/shared/db/pool', () => ({
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  queryMany: (...a: unknown[]) => mockQueryMany(...a),
}));

jest.mock('../../services/macro-notify.service', () => ({
  notifyMacroGateApproved: (...a: unknown[]) => mockNotifyMacroGateApproved(...a),
}));

import { handler } from '../../handlers/complete-checkpoint';

const BASE_CP = {
  id: 10,
  checkpoint_type: 'human_review',
  phase: 'Phase 1',
  phase_name: 'Discover & Align',
  checkpoint_name: 'Working SRS reviewed by SA',
  occurred: null,
  meeting_date: null,
  meeting_link: null,
  result_detail: null,
  reviewed_by: null,
  reached_at: null,
  analysis_result: null,
  analysis_run_at: null,
};

/** Wire the queryOne sequence for a successful human_review completion. */
function mockCompletionDb() {
  mockQueryOne.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes('UPDATE macro_checkpoints')) {
      return { ...BASE_CP, reviewed_by: 'sa@example.com', reached_at: '2026-07-03T00:00:00Z' };
    }
    // Initial load (has project_id = $2) — checkpoint not yet completed.
    if (s.includes('FROM macro_checkpoints') && s.includes('project_id = $2')) {
      return { ...BASE_CP };
    }
    // Reload after update (WHERE id = $1 only) — now completed.
    if (s.includes('FROM macro_checkpoints') && s.includes('WHERE id = $1')) {
      return { ...BASE_CP, reviewed_by: 'sa@example.com', reached_at: '2026-07-03T00:00:00Z' };
    }
    if (s.includes('evidence_count')) {
      return { evidence_count: 0, notes_count: 0 };
    }
    return null;
  });
}

function event(role: string, body: Record<string, unknown>): APIGatewayProxyEvent {
  return {
    httpMethod: 'PATCH',
    path: '/api/projects/DP-001/checkpoints/10',
    pathParameters: { projectId: 'DP-001', checkpointId: '10' },
    body: JSON.stringify(body),
    requestContext: {
      authorizer: {
        claims: { sub: `sub-${role}`, email: `${role}@example.com`, name: role, 'cognito:groups': [role] },
      },
    },
  } as unknown as APIGatewayProxyEvent;
}

/**
 * Event whose cognito:groups is a comma-separated STRING — exactly how API Gateway
 * delivers the claim (the array form in `event()` above masked the original bug).
 */
function eventWithGroupsString(groups: string, body: Record<string, unknown>): APIGatewayProxyEvent {
  const primary = groups.split(',')[0]!.trim();
  return {
    httpMethod: 'PATCH',
    path: '/api/projects/DP-001/checkpoints/10',
    pathParameters: { projectId: 'DP-001', checkpointId: '10' },
    body: JSON.stringify(body),
    requestContext: {
      authorizer: {
        claims: { sub: `sub-${primary}`, email: `${primary}@example.com`, name: primary, 'cognito:groups': groups },
      },
    },
  } as unknown as APIGatewayProxyEvent;
}

const ctx = {} as never;

beforeEach(() => jest.clearAllMocks());

describe('PATCH checkpoint — app-owned MACRO notify (CR-10)', () => {
  it('fires notifyMacroGateApproved when a human_review checkpoint is completed', async () => {
    mockCompletionDb();
    mockNotifyMacroGateApproved.mockResolvedValue(undefined);

    const res = await handler(event('sa', { reviewed_by: 'sa@example.com' }), ctx, () => {});
    expect(res!.statusCode).toBe(200);

    expect(mockNotifyMacroGateApproved).toHaveBeenCalledTimes(1);
    const [projectId, checkpointName, actor] = mockNotifyMacroGateApproved.mock.calls[0];
    expect(projectId).toBe('DP-001');
    expect(checkpointName).toBe('Working SRS reviewed by SA');
    expect(actor).toBe('sa@example.com');
  });

  it('does NOT fail the approval when the notify throws (best-effort / non-blocking)', async () => {
    mockCompletionDb();
    mockNotifyMacroGateApproved.mockRejectedValue(new Error('MCP unreachable'));

    const res = await handler(event('sa', { reviewed_by: 'sa@example.com' }), ctx, () => {});

    // Approval is committed and returns 200 despite the notify failure.
    expect(res!.statusCode).toBe(200);
    expect(mockNotifyMacroGateApproved).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire the notify when nothing is completed (enrichment-only / no reached_at)', async () => {
    // reviewed_by omitted and result_detail without prior completion -> no completion, no notify.
    mockQueryOne.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('FROM macro_checkpoints') && s.includes('project_id = $2')) return { ...BASE_CP };
      if (s.includes('FROM macro_checkpoints') && s.includes('WHERE id = $1')) return { ...BASE_CP };
      if (s.includes('evidence_count')) return { evidence_count: 0, notes_count: 0 };
      return null;
    });

    const res = await handler(event('sa', {}), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    expect(mockNotifyMacroGateApproved).not.toHaveBeenCalled();
  });
});

describe('PATCH checkpoint — human_review role parsing (cognito:groups as STRING)', () => {
  it('allows completion when cognito:groups is a plain string role (e.g. "sa")', async () => {
    mockCompletionDb();
    mockNotifyMacroGateApproved.mockResolvedValue(undefined);

    const res = await handler(eventWithGroupsString('sa', { reviewed_by: 'sa@example.com' }), ctx, () => {});

    // Before the fix this returned 403: "sa"[0] === "s", which is not an allowed role.
    expect(res!.statusCode).toBe(200);
    expect(mockNotifyMacroGateApproved).toHaveBeenCalledTimes(1);
  });

  it('allows completion when cognito:groups is a comma-separated string (e.g. "admin,pm")', async () => {
    mockCompletionDb();
    mockNotifyMacroGateApproved.mockResolvedValue(undefined);

    const res = await handler(eventWithGroupsString('admin,pm', { reviewed_by: 'admin@example.com' }), ctx, () => {});

    expect(res!.statusCode).toBe(200);
    expect(mockNotifyMacroGateApproved).toHaveBeenCalledTimes(1);
  });

  it('allows leadership via string claim', async () => {
    mockCompletionDb();
    mockNotifyMacroGateApproved.mockResolvedValue(undefined);

    const res = await handler(eventWithGroupsString('leadership', { reviewed_by: 'lead@example.com' }), ctx, () => {});

    expect(res!.statusCode).toBe(200);
  });

  it('forbids a non-privileged role (pm) from completing a human_review checkpoint', async () => {
    mockCompletionDb();

    const res = await handler(eventWithGroupsString('pm', { reviewed_by: 'pm@example.com' }), ctx, () => {});

    expect(res!.statusCode).toBe(403);
    expect(JSON.parse(res!.body).code).toBe('FORBIDDEN');
    expect(mockNotifyMacroGateApproved).not.toHaveBeenCalled();
  });
});
