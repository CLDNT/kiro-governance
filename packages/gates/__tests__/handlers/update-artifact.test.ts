import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { APIGatewayProxyEvent } from 'aws-lambda';

const mockQueryOne = jest.fn();
const mockQuery = jest.fn();
jest.mock('@kiro-governance/shared/db/pool', () => ({
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  query: (...a: unknown[]) => mockQuery(...a),
}));

import { handler } from '../../handlers/update-artifact';

interface ArtifactRow {
  id: number;
  project_id: string;
  phase: string;
  phase_name: string;
  artifact_name: string;
  status: string;
  completed_at: string | null;
  completed_by: string | null;
  manual_override: boolean;
}

const BASE_ARTIFACT: ArtifactRow = {
  id: 7,
  project_id: 'DP-001',
  phase: 'Phase 2',
  phase_name: 'Design & Review',
  artifact_name: 'Workstream Decomposition',
  status: 'pending',
  completed_at: null,
  completed_by: null,
  manual_override: false,
};

function setup(loaded: Partial<ArtifactRow>, updated: Partial<ArtifactRow>) {
  const loadedRow = { ...BASE_ARTIFACT, ...loaded };
  const updatedRow = { ...BASE_ARTIFACT, ...updated };
  mockQueryOne.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes('UPDATE micro_artifacts')) return updatedRow;
    if (s.includes('FROM micro_artifacts')) return loadedRow;
    return null;
  });
  mockQuery.mockResolvedValue({ rows: [] });
}

function event(role: string, body: unknown): APIGatewayProxyEvent {
  return {
    httpMethod: 'PATCH',
    path: '/api/projects/DP-001/artifacts/7',
    pathParameters: { projectId: 'DP-001', artifactId: '7' },
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { claims: { sub: `sub-${role}`, email: `${role}@x.com`, name: role, 'cognito:groups': [role] } },
    },
  } as unknown as APIGatewayProxyEvent;
}

const ctx = {} as never;

function auditParams() {
  const call = mockQuery.mock.calls.find((c) => String(c[0]).includes('INSERT INTO micro_artifact_audit'));
  return call ? (call[1] as unknown[]) : undefined;
}
function updateParams() {
  const call = mockQueryOne.mock.calls.find((c) => String(c[0]).includes('UPDATE micro_artifacts'));
  return call![1] as unknown[];
}

beforeEach(() => jest.clearAllMocks());

describe('PATCH /artifacts — manual override sets the lock + audit', () => {
  it('a human status change sets manual_override=true and writes a manual_override audit row', async () => {
    setup({ status: 'pending' }, { status: 'complete', completed_by: 'pm@x.com', manual_override: true });

    const res = await handler(event('pm', { status: 'complete' }), ctx, () => {});
    expect(res!.statusCode).toBe(200);

    // UPDATE params: [status, userEmail, manual_override, artifactId]
    expect(updateParams()[2]).toBe(true);

    const audit = auditParams()!;
    expect(audit[4]).toBe('manual_override'); // action
    expect(audit[5]).toBe('pending'); // old_status
    expect(audit[6]).toBe('complete'); // new_status
    expect(audit[7]).toBe('pm@x.com'); // actor = auth email

    const body = JSON.parse(res!.body);
    expect(body.manual_override).toBe(true);
  });
});

describe('PATCH /artifacts — downgrade of a Kiro-auto-completed row is a reverse', () => {
  it('classifies the audit action as reverse and clears completed_* (CASE in SQL)', async () => {
    setup(
      { status: 'complete', completed_by: 'kiro:aws-architect', completed_at: '2026-07-05T10:00:00Z' },
      { status: 'pending', completed_by: null, completed_at: null, manual_override: true },
    );

    const res = await handler(event('sa', { status: 'pending' }), ctx, () => {});
    expect(res!.statusCode).toBe(200);

    const audit = auditParams()!;
    expect(audit[4]).toBe('reverse'); // downgrade of a kiro:-completed row
    expect(audit[5]).toBe('complete');
    expect(audit[6]).toBe('pending');

    // manual_override locked so the reconciler won't re-complete it.
    expect(updateParams()[2]).toBe(true);
    // The UPDATE clears completed_at/by for a non-complete status.
    const updSql = String(mockQueryOne.mock.calls.find((c) => String(c[0]).includes('UPDATE micro_artifacts'))![0]);
    expect(updSql).toMatch(/completed_by\s*=\s*CASE WHEN \$1 = 'complete'/);
  });
});

describe('PATCH /artifacts — reset_to_auto re-enables Kiro sync (admin/leadership only)', () => {
  it('admin + reset_to_auto clears manual_override and audits as reverse', async () => {
    setup(
      { status: 'complete', completed_by: 'kiro:aws-architect', manual_override: true },
      { status: 'pending', completed_by: null, manual_override: false },
    );

    const res = await handler(event('admin', { status: 'pending', reset_to_auto: true }), ctx, () => {});
    expect(res!.statusCode).toBe(200);

    expect(updateParams()[2]).toBe(false); // manual_override cleared → auto-eligible again
    expect(auditParams()![4]).toBe('reverse');
    expect(JSON.parse(res!.body).manual_override).toBe(false);
  });

  it('leadership may reset_to_auto', async () => {
    setup({ status: 'complete' }, { status: 'pending', manual_override: false });
    const res = await handler(event('leadership', { status: 'pending', reset_to_auto: true }), ctx, () => {});
    expect(res!.statusCode).toBe(200);
  });

  it('pm attempting reset_to_auto → 403, no DB write', async () => {
    setup({ status: 'complete' }, { status: 'pending', manual_override: false });
    const res = await handler(event('pm', { status: 'pending', reset_to_auto: true }), ctx, () => {});
    expect(res!.statusCode).toBe(403);
    expect(JSON.parse(res!.body).code).toBe('FORBIDDEN');
    // reset_to_auto authz fails before any UPDATE.
    const ranUpdate = mockQueryOne.mock.calls.some((c) => String(c[0]).includes('UPDATE micro_artifacts'));
    expect(ranUpdate).toBe(false);
  });
});
