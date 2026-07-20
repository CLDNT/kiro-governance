/**
 * Unit tests for the CR-16 gate-sync orchestrator (gate-sync.service).
 * Mocks getPool + github.service (fetchProgressFile). Uses the REAL parser + gate→checkpoint map.
 * Asserts: correct { matched, resolved, skipped }; idempotent re-run (resolved:0); a sibling
 * gate sharing an already-reached checkpoint and a missing checkpoint → skipped; already-resolved
 * → skipped; unlinked → all zero; unknown
 * project → NotFoundError; append-only project_link_audit row written only when resolved>0;
 * UPDATE uses `reached_at IS NULL` + reviewed_by='system:repo-sync'.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockGetPool = jest.fn();
jest.mock('@kiro-governance/shared/db/pool', () => ({
  getPool: (...a: unknown[]) => mockGetPool(...a),
}));

const mockFetchProgressFile = jest.fn();
jest.mock('../../services/github.service', () => {
  const actual = jest.requireActual('../../services/github.service');
  return {
    ...actual,
    fetchProgressFile: (...a: unknown[]) => mockFetchProgressFile(...a),
    isOwnerAllowlistConfigured: () => true,
  };
});

import { syncGatesFromRepo, REPO_SYNC_ACTOR } from '../../services/gate-sync.service';

interface Checkpoint {
  exists: boolean;
  reached: boolean;
}

interface Recorded {
  sql: string;
  params: unknown[];
}

function makePool(opts: { projectMissing?: boolean; checkpoints?: Record<string, Checkpoint> }) {
  const calls: Recorded[] = [];
  const state = new Map<string, Checkpoint>(Object.entries(opts.checkpoints ?? {}));

  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const s = sql.trim();

    if (s.startsWith('SELECT jira_key, github_repo, github_url FROM projects')) {
      if (opts.projectMissing) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            jira_key: params[0],
            github_repo: 'repo',
            github_url: 'https://github.com/acme/repo',
          },
        ],
        rowCount: 1,
      };
    }

    if (s.startsWith('UPDATE macro_checkpoints')) {
      const checkpointName = params[1] as string;
      const cp = state.get(checkpointName);
      if (cp && cp.exists && !cp.reached) {
        cp.reached = true; // idempotent guard: only first run sets it
        return { rows: [{ id: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (s.startsWith('SELECT 1 FROM macro_checkpoints')) {
      const checkpointName = params[1] as string;
      const cp = state.get(checkpointName);
      return {
        rows: cp?.exists ? [{ ok: 1 }] : [],
        rowCount: cp?.exists ? 1 : 0,
      };
    }

    if (s.startsWith('INSERT INTO project_link_audit')) {
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  });

  mockGetPool.mockResolvedValue({ query });
  return { calls, query };
}

const auditCall = (calls: Recorded[]) =>
  calls.find((c) => c.sql.trim().startsWith('INSERT INTO project_link_audit'));
const updateCalls = (calls: Recorded[]) =>
  calls.filter((c) => c.sql.trim().startsWith('UPDATE macro_checkpoints'));

const MARKDOWN = [
  '- [x] 1.4 SRS approved',
  '- [x] Design docs approved by Faraz',
  '- [x] spec file approved', // alias → 'Spec strategy approved' (shares Design docs checkpoint)
  '- [x] Code approved by Tech Lead', // maps to a checkpoint that is MISSING → skipped
].join('\n');

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchProgressFile.mockResolvedValue({
    content: MARKDOWN,
    reason: 'ok',
    owner: 'acme',
    repo: 'repo',
    contentRef: 'W/"etag123"',
  });
});

describe('syncGatesFromRepo — counting & apply', () => {
  it('resolves mapped+existing gates, matches an already-reached sibling, skips a missing-row gate', async () => {
    const { calls } = makePool({
      checkpoints: {
        'Working SRS reviewed by SA': { exists: true, reached: false },
        'Technically validate 6 design docs with spec strategy by SA': {
          exists: true,
          reached: false,
        },
        // 'Review 3 generated outputs by Tech Lead' (Code approved) intentionally absent → missing row
      },
    });

    const summary = await syncGatesFromRepo('DP-001', 'sub-admin');

    // SRS → matched+resolved. Design docs → matched+resolved (sets the shared checkpoint).
    // Spec strategy → SAME checkpoint, now already-reached → matched + skipped (cosmetic skip).
    // Code approved → checkpoint row missing → skipped.
    expect(summary).toEqual({
      project_id: 'DP-001',
      matched: 3,
      resolved: 2,
      skipped: 2,
    });

    // Idempotent, provenance-tagged UPDATE shape.
    const upd = updateCalls(calls)[0];
    expect(upd.sql).toContain('reached_at IS NULL');
    expect(upd.sql).toContain('reviewed_by');
    expect(upd.params[2]).toBe(REPO_SYNC_ACTOR);
    expect(REPO_SYNC_ACTOR).toBe('system:repo-sync');
  });

  it('CR16-H2: writes ONE append-only project_link_audit row when resolved>0 (actor + source + gates)', async () => {
    const { calls } = makePool({
      checkpoints: {
        'Working SRS reviewed by SA': { exists: true, reached: false },
      },
    });

    await syncGatesFromRepo('DP-001', 'sub-admin');

    const audit = auditCall(calls);
    expect(audit).toBeDefined();
    // field='gate_sync', old_value=source provenance, new_value=summary, actor_sub=actor
    expect(audit!.sql).toContain("'gate_sync'");
    const source = JSON.parse(audit!.params[1] as string);
    expect(source).toEqual({
      owner: 'acme',
      repo: 'repo',
      content_ref: 'W/"etag123"',
    });
    const summary = JSON.parse(audit!.params[2] as string);
    expect(summary.resolved_gates).toContain('SRS approved');
    expect(audit!.params[0]).toBe('DP-001');
    expect(audit!.params[3]).toBe('sub-admin');
  });
});

describe('syncGatesFromRepo — idempotency', () => {
  it('re-run over already-resolved checkpoints → resolved:0, matched preserved, NO audit row', async () => {
    const { calls } = makePool({
      checkpoints: {
        'Working SRS reviewed by SA': { exists: true, reached: true },
        'Technically validate 6 design docs with spec strategy by SA': {
          exists: true,
          reached: true,
        },
      },
    });

    const summary = await syncGatesFromRepo('DP-001', 'sub-admin');

    // SRS + Design docs + Spec strategy all resolve to existing-but-already-reached checkpoints
    // → matched + skipped. Code approved → checkpoint missing → skipped. resolved must be 0.
    expect(summary.resolved).toBe(0);
    expect(summary.matched).toBe(3);
    expect(summary.skipped).toBe(4);
    // No state change → no audit row.
    expect(auditCall(calls)).toBeUndefined();
  });
});

describe('syncGatesFromRepo — no-op & error paths', () => {
  it('unlinked project (fetch returns null content) → all zero, no UPDATE', async () => {
    mockFetchProgressFile.mockResolvedValue({
      content: null,
      reason: 'not_linked',
    });
    const { calls } = makePool({ checkpoints: {} });

    const summary = await syncGatesFromRepo('DP-001', 'sub-admin');
    expect(summary).toEqual({
      project_id: 'DP-001',
      matched: 0,
      resolved: 0,
      skipped: 0,
    });
    expect(updateCalls(calls)).toHaveLength(0);
  });

  it('owner_not_allowed (CR16-H1 fail-closed) → all zero, no UPDATE', async () => {
    mockFetchProgressFile.mockResolvedValue({
      content: null,
      reason: 'owner_not_allowed',
      owner: 'evil',
      repo: 'repo',
    });
    const { calls } = makePool({ checkpoints: {} });

    const summary = await syncGatesFromRepo('DP-001', 'sub-admin');
    expect(summary.resolved).toBe(0);
    expect(updateCalls(calls)).toHaveLength(0);
    expect(auditCall(calls)).toBeUndefined();
  });

  it('unknown project → NotFoundError (mapped to 404 by the handler)', async () => {
    makePool({ projectMissing: true });
    await expect(syncGatesFromRepo('NOPE-999', 'sub-admin')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('propagates a GithubFetchError (rate-limit) so the handler can 503', async () => {
    const { GithubFetchError } = jest.requireActual('../../services/github.service') as {
      GithubFetchError: new (c: string, m: string) => Error;
    };
    mockFetchProgressFile.mockRejectedValue(
      new GithubFetchError('GITHUB_RATE_LIMITED', 'rate limited'),
    );
    makePool({ checkpoints: {} });

    await expect(syncGatesFromRepo('DP-001', 'sub-admin')).rejects.toMatchObject({
      code: 'GITHUB_RATE_LIMITED',
    });
  });
});
