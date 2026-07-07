/**
 * Unit tests for the reporting timeline service (CR-03 repoint).
 * Verifies getReportingTimeline joins governance_events via projects.github_repo (with the
 * collision-safe interim fallback), keeps $1 as the jira_key, surfaces governance events for a
 * linked project, shows only DeliverPro-native events for an unlinked project, and never derives
 * macro_checkpoints.reached_at from a governance row.
 *
 * See docs/phase2/reporting-architecture.md §2.2/§5.3; gates-architecture.md §5.4; jira-backlog CR-03.
 */

const mockQueryMany = jest.fn();
const mockQueryOne = jest.fn();

jest.mock('@kiro-governance/shared/db/pool', () => ({
  queryMany: (...a: unknown[]) => mockQueryMany(...a),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
}));

import { getReportingTimeline } from '../../services/reporting.service';

// getReportingTimeline calls queryOne once (project metadata) then queryMany once (events).
function mockProject(exists: boolean) {
  mockQueryOne.mockResolvedValue(
    exists ? { jira_key: 'DP-001', title: 'Portal', current_phase: 'Phase 2' } : null,
  );
}

/** The events query SQL (the queryMany call that selects governance/checkpoint/evidence). */
function eventsSql(): string {
  const call = mockQueryMany.mock.calls.find((c) => String(c[0]).includes("'governance' as event_type"));
  expect(call).toBeDefined();
  return String(call![0]);
}

beforeEach(() => jest.clearAllMocks());

describe('getReportingTimeline — join repoint (CR-03)', () => {
  it('joins governance_events on projects.github_repo with the collision-safe fallback; $1 stays jira_key', async () => {
    mockProject(true);
    mockQueryMany.mockResolvedValue([]);

    await getReportingTimeline('DP-001', 100, null);

    const sql = eventsSql().replace(/\s+/g, ' ');
    expect(sql).toContain('FROM governance_events ge');
    expect(sql).toContain('JOIN projects p ON p.github_repo = ge.project_id');
    expect(sql).toContain('OR (p.github_repo IS NULL AND p.jira_key = ge.project_id)');
    expect(sql).toContain('WHERE p.jira_key = $1');
    // pre-repoint direct filter must be gone
    expect(sql).not.toContain('FROM governance_events WHERE project_id = $1');
  });

  it('throws when the project does not exist', async () => {
    mockProject(false);
    await expect(getReportingTimeline('NOPE', 100, null)).rejects.toThrow(/Project not found/);
  });
});

describe('getReportingTimeline — linked vs unlinked', () => {
  it('surfaces governance events for a linked project', async () => {
    mockProject(true);
    mockQueryMany.mockResolvedValue([
      {
        event_type: 'governance',
        event_id: 'ge-1',
        event_timestamp: '2026-07-02T10:00:00Z',
        phase: 'Phase 1',
        title: 'SRS approved',
        actor: 'aws-architect',
        detail: 'SRS approved',
      },
    ]);

    const res = await getReportingTimeline('DP-001', 100, null);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].event_type).toBe('governance');
  });

  it('shows only native events for an unlinked project (no governance rows returned)', async () => {
    mockProject(true);
    mockQueryMany.mockResolvedValue([
      {
        event_type: 'checkpoint',
        event_id: 'mc-5',
        event_timestamp: '2026-07-01T09:00:00Z',
        phase: 'Phase 1',
        title: 'Working SRS reviewed by SA',
        actor: 'jane',
        detail: null,
      },
    ]);

    const res = await getReportingTimeline('DP-UNLINKED', 100, null);
    expect(res.events.some((e) => e.event_type === 'governance')).toBe(false);
  });
});

describe('getReportingTimeline — macro app-owned (no auto-completion)', () => {
  it('macro checkpoint source stays gated on reached_at and no UPDATE is issued', async () => {
    mockProject(true);
    mockQueryMany.mockResolvedValue([]);
    await getReportingTimeline('DP-001', 100, null);

    const sql = eventsSql();
    expect(sql).toContain('reached_at IS NOT NULL');
    expect(sql.toUpperCase()).not.toContain('UPDATE MACRO_CHECKPOINTS');
  });
});
