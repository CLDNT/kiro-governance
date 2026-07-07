/**
 * Unit tests for the app-owned MACRO notify service (CR-10).
 *
 * Verifies:
 *  - on macro-gate approval, the app calls MCP notify_slack with event_type:'macro' and
 *    project_id = the project's github_repo (app builds no Slack client of its own);
 *  - when github_repo IS NULL (unlinked / feature switch OFF), notify_slack is SKIPPED entirely (PLAN-L3);
 *  - a notify_slack failure is swallowed — the service never throws (best-effort / non-blocking).
 *
 * Mocks the shared pg pool + the shared MCP client. See
 * change-requests/2026-07-02-github-slack-linkage-impact.md v3 §6.2; jira-backlog CR-10.
 */

const mockQueryOne = jest.fn();
const mockNotifySlack = jest.fn();

jest.mock('@kiro-governance/shared/db/pool', () => ({
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
}));

jest.mock('@kiro-governance/shared/mcp/mcp-client', () => ({
  notifySlack: (...a: unknown[]) => mockNotifySlack(...a),
}));

import { notifyMacroGateApproved } from '../../services/macro-notify.service';

beforeEach(() => jest.clearAllMocks());

describe('notifyMacroGateApproved — app-owned MACRO Slack notification', () => {
  it('calls notify_slack with event_type=macro and project_id=github_repo when the repo is linked', async () => {
    mockQueryOne.mockResolvedValue({ github_repo: 'deliverpro' });
    mockNotifySlack.mockResolvedValue({ notified: true });

    await notifyMacroGateApproved('DP-001', 'Working SRS reviewed by SA', 'sa@example.com');

    // Resolved github_repo from the project (by jira_key).
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(String(sql)).toContain('github_repo');
    expect(String(sql)).toContain('FROM projects');
    expect(params).toEqual(['DP-001']);

    // Notified via the centralized MCP tool — macro channel, project_id = repo name.
    expect(mockNotifySlack).toHaveBeenCalledTimes(1);
    const arg = mockNotifySlack.mock.calls[0][0];
    expect(arg.event_type).toBe('macro');
    expect(arg.project_id).toBe('deliverpro');
    expect(arg.message).toContain('Working SRS reviewed by SA');
    expect(arg.message).toContain('sa@example.com');
  });

  it('SKIPS notify_slack entirely when github_repo IS NULL (unlinked project — PLAN-L3)', async () => {
    mockQueryOne.mockResolvedValue({ github_repo: null });

    await notifyMacroGateApproved('DP-002', 'SRS approved', 'pm@example.com');

    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockNotifySlack).not.toHaveBeenCalled();
  });

  it('SKIPS notify_slack when the project row is missing (no linkage)', async () => {
    mockQueryOne.mockResolvedValue(null);

    await notifyMacroGateApproved('DP-003', 'Code approved', 'pm@example.com');

    expect(mockNotifySlack).not.toHaveBeenCalled();
  });

  it('does not throw when notify_slack rejects (best-effort / non-blocking)', async () => {
    mockQueryOne.mockResolvedValue({ github_repo: 'deliverpro' });
    mockNotifySlack.mockRejectedValue(new Error('MCP unreachable'));

    // Must resolve (not reject) — a notify failure cannot fail the approval.
    await expect(
      notifyMacroGateApproved('DP-001', 'UAT report approved', 'qa@example.com'),
    ).resolves.toBeUndefined();
  });

  it('does not throw when the project lookup itself fails', async () => {
    mockQueryOne.mockRejectedValue(new Error('db down'));

    await expect(
      notifyMacroGateApproved('DP-001', 'Runbooks approved', 'sa@example.com'),
    ).resolves.toBeUndefined();
    expect(mockNotifySlack).not.toHaveBeenCalled();
  });
});
