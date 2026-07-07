import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock the DB pool — reconcile uses getPool().query(...).
const mockQuery = jest.fn();
jest.mock('@kiro-governance/shared/db/pool', () => ({
  getPool: jest.fn(async () => ({ query: mockQuery })),
}));

import {
  reconcileMicroArtifacts,
  triggerMicroArtifactReconcile,
  ARTIFACT_SYNC_ACTOR,
} from '../../services/micro-artifact-reconcile.service';

interface CountRow {
  total_candidates: number;
  matched: number;
}
interface UpdatedRow {
  id: number;
  phase: string;
  artifact_name: string;
  old_status: string;
  event_code: string;
  event_actor: string;
  created_at: string;
}

interface Scenario {
  project?: { jira_key: string; github_repo: string | null; project_type: string } | null;
  updated?: UpdatedRow[];
  count?: CountRow;
}

const auditCalls: unknown[][] = [];

function setup(sc: Scenario) {
  auditCalls.length = 0;
  mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const s = String(sql);
    if (s.includes('INSERT INTO micro_artifact_audit')) {
      auditCalls.push(params);
      return { rows: [] };
    }
    if (s.includes('total_candidates')) {
      return { rows: [sc.count ?? { total_candidates: 0, matched: 0 }] };
    }
    if (s.includes('UPDATE micro_artifacts')) {
      return { rows: sc.updated ?? [] };
    }
    if (s.includes('FROM projects')) {
      return { rows: sc.project === undefined ? [{ jira_key: 'DP-001', github_repo: 'my-repo', project_type: 'default' }] : sc.project ? [sc.project] : [] };
    }
    return { rows: [] };
  });
}

const ROW = (over: Partial<UpdatedRow> = {}): UpdatedRow => ({
  id: 7,
  phase: 'Phase 2',
  artifact_name: 'Workstream Decomposition',
  old_status: 'pending',
  event_code: 'casdm.p2.workstream_decomposition',
  event_actor: 'aws-architect',
  created_at: '2026-07-05T10:00:00Z',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('reconcileMicroArtifacts — happy path', () => {
  it('completes a mapped micro event and returns the summary', async () => {
    setup({ updated: [ROW()], count: { total_candidates: 1, matched: 1 } });

    const res = await reconcileMicroArtifacts('DP-001', 'admin-sub');

    expect(res).toEqual({ project_id: 'DP-001', matched: 1, completed: 1, skipped: 0 });
  });

  it('sets completed_by=kiro:<actor> and completed_at=event.created_at in the UPDATE', async () => {
    setup({ updated: [ROW()], count: { total_candidates: 1, matched: 1 } });

    await reconcileMicroArtifacts('DP-001', 'admin-sub');

    const updateCall = mockQuery.mock.calls.find((c) => String(c[0]).includes('UPDATE micro_artifacts'));
    const sql = String(updateCall![0]);
    expect(sql).toMatch(/completed_by\s*=\s*'kiro:'\s*\|\|\s*t\.event_actor/);
    expect(sql).toMatch(/completed_at\s*=\s*t\.created_at/);
  });

  it('is own-repo-scoped — the candidate CTE keys on ge.project_id = github_repo ($3)', async () => {
    setup({ updated: [], count: { total_candidates: 0, matched: 0 }, project: { jira_key: 'DP-001', github_repo: 'my-repo', project_type: 'default' } });

    await reconcileMicroArtifacts('DP-001', 'admin-sub');

    const updateCall = mockQuery.mock.calls.find((c) => String(c[0]).includes('UPDATE micro_artifacts'));
    expect(String(updateCall![0])).toMatch(/ge\.project_id\s*=\s*\$3/);
    expect((updateCall![1] as unknown[])[2]).toBe('my-repo'); // $3 = github_repo, never request input
  });

  it('earliest-event-wins + deterministic (DISTINCT ON ... ORDER BY created_at ASC, allow-list is_active)', async () => {
    setup({ updated: [ROW()], count: { total_candidates: 1, matched: 1 } });

    await reconcileMicroArtifacts('DP-001', 'admin-sub');

    const updateCall = mockQuery.mock.calls.find((c) => String(c[0]).includes('UPDATE micro_artifacts'));
    const sql = String(updateCall![0]);
    expect(sql).toMatch(/DISTINCT ON \(m\.phase, m\.artifact_name\)/);
    expect(sql).toMatch(/ORDER BY m\.phase, m\.artifact_name, ge\.created_at ASC/);
    expect(sql).toMatch(/m\.is_active\s*=\s*true/);
  });

  it('writes an append-only audit row per completion', async () => {
    setup({ updated: [ROW()], count: { total_candidates: 1, matched: 1 } });

    await reconcileMicroArtifacts('DP-001', 'admin-sub');

    expect(auditCalls).toHaveLength(1);
    // params: project_id, artifact_id, phase, artifact_name, event_code, event_actor, old_status, actor
    const p = auditCalls[0];
    expect(p[0]).toBe('DP-001');
    expect(p[1]).toBe(7);
    expect(p[4]).toBe('casdm.p2.workstream_decomposition');
    expect(p[5]).toBe('aws-architect');
    expect(p[7]).toBe(ARTIFACT_SYNC_ACTOR);
    const auditSql = String(mockQuery.mock.calls.find((c) => String(c[0]).includes('INSERT INTO micro_artifact_audit'))![0]);
    expect(auditSql).toMatch(/'auto_complete'/);
  });
});

describe('reconcileMicroArtifacts — idempotency & guards', () => {
  it('is idempotent — a re-run with no newly-completable rows returns completed:0 and writes no audit', async () => {
    setup({ updated: [], count: { total_candidates: 1, matched: 1 } });

    const res = await reconcileMicroArtifacts('DP-001', 'admin-sub');

    expect(res.completed).toBe(0);
    expect(res.matched).toBe(1);
    expect(res.skipped).toBe(1); // resolved candidate, already complete → surfaced as skipped
    expect(auditCalls).toHaveLength(0);
  });

  it('manual_override / already-complete rows are skipped (UPDATE excludes them → completed:0)', async () => {
    // count reports the candidate has a target row (matched:1); the guarded UPDATE returns nothing.
    setup({ updated: [], count: { total_candidates: 1, matched: 1 } });

    const res = await reconcileMicroArtifacts('DP-001', 'admin-sub');

    expect(res.completed).toBe(0);
    expect(res.skipped).toBe(1);
    const updateSql = String(mockQuery.mock.calls.find((c) => String(c[0]).includes('UPDATE micro_artifacts'))![0]);
    expect(updateSql).toMatch(/ma\.status\s*<>\s*'complete'/); // idempotent guard
    expect(updateSql).toMatch(/ma\.manual_override\s*=\s*false/); // never clobber a human decision
  });

  it('unmapped / inactive code is a no-op — not a candidate, no mutation, no audit', async () => {
    setup({ updated: [], count: { total_candidates: 0, matched: 0 } });

    const res = await reconcileMicroArtifacts('DP-001', 'admin-sub');

    expect(res).toEqual({ project_id: 'DP-001', matched: 0, completed: 0, skipped: 0 });
    expect(auditCalls).toHaveLength(0);
  });

  it('unlinked project (github_repo NULL) → all-zero, never runs the UPDATE', async () => {
    setup({ project: { jira_key: 'DP-002', github_repo: null, project_type: 'default' } });

    const res = await reconcileMicroArtifacts('DP-002', 'admin-sub');

    expect(res).toEqual({ project_id: 'DP-002', matched: 0, completed: 0, skipped: 0 });
    const ranUpdate = mockQuery.mock.calls.some((c) => String(c[0]).includes('UPDATE micro_artifacts'));
    expect(ranUpdate).toBe(false);
  });

  it('unknown project → NotFoundError (endpoint maps to 404)', async () => {
    setup({ project: null });

    await expect(reconcileMicroArtifacts('NOPE', 'admin-sub')).rejects.toThrow(/not found/i);
  });

  it('never mutates governance_events (no UPDATE/INSERT/DELETE against it)', async () => {
    setup({ updated: [ROW()], count: { total_candidates: 1, matched: 1 } });

    await reconcileMicroArtifacts('DP-001', 'admin-sub');

    const touchedEventsWrite = mockQuery.mock.calls.some((c) => {
      const s = String(c[0]);
      return /(UPDATE|INSERT INTO|DELETE FROM)\s+governance_events/i.test(s);
    });
    expect(touchedEventsWrite).toBe(false);
  });
});

describe('triggerMicroArtifactReconcile — always resolves (best-effort)', () => {
  it('resolves even when reconcile throws (failure never fails the caller)', async () => {
    mockQuery.mockRejectedValue(new Error('db down') as never);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(triggerMicroArtifactReconcile('DP-001', 'admin-sub')).resolves.toBeUndefined();
  });
});
