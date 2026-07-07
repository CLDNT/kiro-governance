/**
 * Handler test for GET /api/projects/{projectId}/gates — CR-03 macro app-owned guarantee.
 *
 * Verifies the governance_events -> macro_checkpoints auto-completion path has been REMOVED:
 * a pending checkpoint (reached_at IS NULL) stays pending in the gate view even if a matching
 * Phase 1 macro governance event exists, and the gate view never queries governance_events.
 * See docs/phase2/gates-architecture.md §5.3 (FR-P2-041, D-v3-4); jira-backlog CR-03.
 */
import { APIGatewayProxyEvent } from 'aws-lambda';

const mockQueryMany = jest.fn();

jest.mock('@kiro-governance/shared/db/pool', () => ({
  queryMany: (...a: unknown[]) => mockQueryMany(...a),
}));

// CR-12 T3: get-gates opportunistically reconciles Level-2 micro-artifacts on load. Mock it so
// these tests control whether it runs / fails without touching the DB.
const mockReconcile = jest.fn();
jest.mock('../../services/micro-artifact-reconcile.service', () => ({
  reconcileMicroArtifacts: (...a: unknown[]) => mockReconcile(...a),
}));

import { handler } from '../../handlers/get-gates';

const PENDING_CHECKPOINT = {
  id: 10,
  phase: 'Phase 1',
  phase_name: 'Discover & Align',
  checkpoint_name: 'Working SRS reviewed by SA',
  checkpoint_type: 'human_review',
  occurred: null,
  meeting_date: null,
  meeting_link: null,
  result_detail: null,
  reviewed_by: null,
  reviewed_at: null,
  reached_at: null, // NOT completed in-app
  analysis_result: null,
  analysis_run_at: null,
  evidence_count: 0,
  notes_count: 0,
};

function mockDb() {
  mockQueryMany.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes('FROM projects') && s.includes('jira_key = $1')) return [{ jira_key: 'DP-001' }];
    if (s.includes('FROM micro_artifacts')) return [];
    if (s.includes('FROM macro_checkpoints')) return [{ ...PENDING_CHECKPOINT }];
    if (s.includes('FROM casdm_config')) {
      return [
        {
          phase: 'Phase 1',
          config_type: 'macro_checkpoint',
          item_name: 'Working SRS reviewed by SA',
          is_mandatory: true,
          is_active: true,
        },
      ];
    }
    return [];
  });
}

function event(role: string): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/api/projects/DP-001/gates',
    pathParameters: { projectId: 'DP-001' },
    requestContext: {
      authorizer: { claims: { sub: `sub-${role}`, email: 'a@x.com', name: 'A', 'cognito:groups': [role] } },
    },
  } as unknown as APIGatewayProxyEvent;
}

const ctx = {} as never;

beforeEach(() => jest.clearAllMocks());

describe('GET gates — macro completion is app-owned (no governance auto-completion)', () => {
  it('leaves a pending checkpoint pending even when a matching macro governance event could exist', async () => {
    mockDb();
    const res = await handler(event('pm'), ctx, () => {});
    expect(res!.statusCode).toBe(200);

    const body = JSON.parse(res!.body);
    const phase1 = body.phases.find((p: { phase: string }) => p.phase === 'Phase 1');
    const cp = phase1.macro_checkpoints.find(
      (c: { checkpoint_name: string }) => c.checkpoint_name === 'Working SRS reviewed by SA',
    );

    // reached_at was NOT set from a governance event — it stays null (app-owned §4 state machine).
    expect(cp.reached_at).toBeNull();
    expect(cp.reviewed_by).toBeNull();
    // A mandatory, un-reached checkpoint keeps the phase incomplete.
    expect(phase1.phase_complete).toBe(false);
  });

  it('never queries governance_events when assembling the gate view', async () => {
    mockDb();
    await handler(event('sa'), ctx, () => {});
    const touchedGovernance = mockQueryMany.mock.calls.some((call) =>
      String(call[0]).toLowerCase().includes('governance_events'),
    );
    expect(touchedGovernance).toBe(false);
  });
});

describe('GET gates — CR-12 T3 opportunistic Level-2 reconcile on load', () => {
  function mockDbLinked(opts: { linked: boolean; artifacts?: unknown[] } = { linked: true }) {
    mockQueryMany.mockImplementation(async (sql: string) => {
      const s = String(sql);
      // First existence check + the T3 github_repo lookup both hit `FROM projects ... jira_key = $1`.
      if (s.includes('SELECT github_repo FROM projects')) {
        return [{ github_repo: opts.linked ? 'my-repo' : null }];
      }
      if (s.includes('FROM projects') && s.includes('jira_key = $1')) return [{ jira_key: 'DP-001' }];
      if (s.includes('FROM micro_artifacts')) return opts.artifacts ?? [];
      if (s.includes('FROM macro_checkpoints')) return [];
      if (s.includes('FROM casdm_config')) return [];
      return [];
    });
  }

  it('runs reconcile on load when the project is linked (github_repo set)', async () => {
    mockDbLinked({ linked: true });
    const res = await handler(event('pm'), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    expect(mockReconcile).toHaveBeenCalledWith('DP-001', 'system:gate-view');
  });

  it('does NOT reconcile when the project is unlinked (github_repo NULL)', async () => {
    mockDbLinked({ linked: false });
    const res = await handler(event('pm'), ctx, () => {});
    expect(res!.statusCode).toBe(200);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('the returned view reflects an auto-completed artifact (post-reconcile SELECT)', async () => {
    // Reconcile ran (in reality it completed the row); the subsequent micro_artifacts SELECT
    // returns the completed, kiro-attributed artifact.
    mockDbLinked({
      linked: true,
      artifacts: [
        {
          id: 7,
          phase: 'Phase 2',
          phase_name: 'Design & Review',
          artifact_name: 'Workstream Decomposition',
          status: 'complete',
          completed_at: '2026-07-05T10:00:00Z',
          completed_by: 'kiro:aws-architect',
          manual_override: false,
        },
      ],
    });
    const res = await handler(event('pm'), ctx, () => {});
    const body = JSON.parse(res!.body);
    const art = body.phases[0].micro_artifacts[0];
    expect(art.status).toBe('complete');
    expect(art.completed_by).toBe('kiro:aws-architect');
    expect(art.manual_override).toBe(false);
  });

  it('a reconcile failure does NOT break the gate view (still returns 200)', async () => {
    mockDbLinked({ linked: true });
    mockReconcile.mockRejectedValue(new Error('reconcile boom'));
    const res = await handler(event('pm'), ctx, () => {});
    expect(res!.statusCode).toBe(200);
  });
});
