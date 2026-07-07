/**
 * Unit tests for the gates timeline service (CR-03).
 * Verifies the governance join is repointed to projects.github_repo with the collision-safe
 * interim fallback, that governance events surface as source `kiro_mcp`, that macro checkpoints /
 * evidence surface as `deliverpro`, and that NO governance -> macro_checkpoints auto-completion
 * path exists (the query never writes/derives reached_at from a governance row).
 *
 * See docs/phase2/gates-architecture.md §5.1/§5.3/§5.4; jira-backlog CR-03.
 */

const mockQueryMany = jest.fn();
const mockQueryOne = jest.fn();

jest.mock('@kiro-governance/shared/db/pool', () => ({
  queryMany: (...a: unknown[]) => mockQueryMany(...a),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
}));

import { getProjectTimeline, projectExists } from '../../services/timeline.service';

beforeEach(() => jest.clearAllMocks());

/** The SQL string passed to queryMany by getProjectTimeline (first + only call). */
function timelineSql(): string {
  expect(mockQueryMany).toHaveBeenCalledTimes(1);
  return String(mockQueryMany.mock.calls[0][0]);
}

describe('getProjectTimeline — join repoint (CR-03)', () => {
  it('joins governance_events on projects.github_repo with the collision-safe fallback', async () => {
    mockQueryMany.mockResolvedValue([]);
    await getProjectTimeline('DP-001', 50, null);

    const sql = timelineSql().replace(/\s+/g, ' ');
    // Repointed strict join
    expect(sql).toContain('JOIN projects p ON p.github_repo = ge.project_id');
    // Interim collision-safe fallback branch
    expect(sql).toContain('OR (p.github_repo IS NULL AND p.jira_key = ge.project_id)');
    // $1 stays the jira_key (route param), not the repo
    expect(sql).toContain('WHERE p.jira_key = $1');
    // It must NOT use the pre-repoint direct project_id filter for the governance source
    expect(sql).not.toContain('FROM governance_events ge WHERE ge.project_id = $1');
  });

  it('passes projectId (jira_key), clamped limit, and cursor as bound params', async () => {
    mockQueryMany.mockResolvedValue([]);
    await getProjectTimeline('DP-001', 999, '2026-07-01T00:00:00Z'); // 999 clamps to 200
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), ['DP-001', 200, '2026-07-01T00:00:00Z']);
  });
});

describe('getProjectTimeline — linked project surfaces governance events', () => {
  it('returns Kiro governance rows as source kiro_mcp alongside DeliverPro-native rows', async () => {
    mockQueryMany.mockResolvedValue([
      {
        id: 'ge-1',
        event_type: 'governance_event',
        timestamp: '2026-07-02T10:00:00Z',
        phase: 'Phase 1',
        title: 'SRS approved',
        actor: 'aws-architect',
        detail: 'SRS approved by aws-architect',
        source: 'kiro_mcp',
      },
      {
        id: 'mc-5',
        event_type: 'checkpoint_completed',
        timestamp: '2026-07-01T09:00:00Z',
        phase: 'Phase 1',
        title: 'Working SRS reviewed by SA',
        actor: 'jane',
        detail: null,
        source: 'deliverpro',
      },
    ]);

    const res = await getProjectTimeline('DP-001', 50, null);

    expect(res.events).toHaveLength(2);
    const governance = res.events.find((e) => e.event_type === 'governance_event')!;
    expect(governance.source).toBe('kiro_mcp');
    expect(governance.id).toBe('ge-1');
    // DeliverPro-native checkpoint present with deliverpro source
    expect(res.events.find((e) => e.event_type === 'checkpoint_completed')!.source).toBe('deliverpro');
  });
});

describe('getProjectTimeline — unlinked project shows only native events', () => {
  it('returns only deliverpro-sourced rows when the repo is unlinked (no governance rows)', async () => {
    // Simulates the DB result for an unlinked project: the github_repo join yields no
    // governance rows, so only macro checkpoints / evidence come back.
    mockQueryMany.mockResolvedValue([
      {
        id: 'mc-5',
        event_type: 'checkpoint_completed',
        timestamp: '2026-07-01T09:00:00Z',
        phase: 'Phase 1',
        title: 'Working SRS reviewed by SA',
        actor: 'jane',
        detail: null,
        source: 'deliverpro',
      },
    ]);

    const res = await getProjectTimeline('DP-UNLINKED', 50, null);

    expect(res.events.every((e) => e.source === 'deliverpro')).toBe(true);
    expect(res.events.some((e) => e.event_type === 'governance_event')).toBe(false);
  });
});

describe('getProjectTimeline — macro app-owned (no auto-completion)', () => {
  it('never derives reached_at from a governance row — macro source stays gated on reached_at', async () => {
    mockQueryMany.mockResolvedValue([]);
    await getProjectTimeline('DP-001', 50, null);

    const sql = timelineSql();
    // The macro source only emits already-completed checkpoints; there is no UPDATE / write path.
    expect(sql).toContain('mc.reached_at IS NOT NULL');
    expect(sql.toUpperCase()).not.toContain('UPDATE MACRO_CHECKPOINTS');
    // The governance source's timestamp comes from ge.created_at, NOT from any checkpoint field.
    expect(sql.replace(/\s+/g, ' ')).toContain('ge.created_at AS timestamp');
  });
});

describe('projectExists', () => {
  it('is true when a row is returned', async () => {
    mockQueryOne.mockResolvedValue({ jira_key: 'DP-001' });
    await expect(projectExists('DP-001')).resolves.toBe(true);
  });

  it('is false when no row is returned', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(projectExists('NOPE')).resolves.toBe(false);
  });
});
