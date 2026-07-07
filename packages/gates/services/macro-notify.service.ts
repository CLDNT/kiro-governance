/**
 * Macro-gate approval → MCP Slack notification (CR-10, app-owned MACRO path).
 *
 * When a human approves a macro gate in-app (the §4 state machine sets
 * `macro_checkpoints.reached_at`), the DeliverPro app notifies Slack by calling the SAME
 * centralized MCP `notify_slack` tool with `event_type:'macro'` and `project_id = github_repo`.
 * The app builds NO Slack client of its own — Slack is centralized in the MCP tool.
 * See change-requests/2026-07-02-github-slack-linkage-impact.md v3 §6.2 and
 * docs/phase1/github-trigger-architecture.md §0.
 *
 * NO-DOUBLE-NOTIFY BOUNDARY (v3 §0 / §6, Decision F):
 *   • MACRO notifications originate ONLY from the app — this service.
 *   • MICRO notifications originate ONLY from the CI script (scripts/governance-trigger.js).
 * The app never emits a micro Slack post; the CI script never drives macro completion
 * (its CLI display-only macro path is separate and does not set reached_at). Full end-to-end
 * verification of the boundary is CR-13.
 *
 * PLAN-L3: if the project has no `github_repo` (unlinked — the optional-linkage feature switch
 * is OFF), the `notify_slack` call is SKIPPED ENTIRELY. `notify_slack`'s `project_id` is
 * `z.string().min(1)`, so passing a null/empty repo would fail validation rather than skip
 * gracefully. Macro completion is still recorded in `macro_checkpoints` regardless.
 *
 * Best-effort / non-blocking: any failure (unlinked, MCP unreachable, Slack error, misconfig)
 * is logged and swallowed — it MUST NOT fail the checkpoint approval.
 */

import { queryOne } from '@kiro-governance/shared/db/pool';
import { notifySlack } from '@kiro-governance/shared/mcp/mcp-client';
import { log } from '@kiro-governance/shared/middleware/logger';

/**
 * Fire a best-effort MACRO Slack notification for an approved macro gate.
 * Never throws — always resolves. Safe to `await` inside a request handler.
 *
 * @param projectId  the project's jira_key (route param)
 * @param checkpointName human-readable macro checkpoint name
 * @param actor the approver (reviewer name / cognito identity)
 */
export async function notifyMacroGateApproved(
  projectId: string,
  checkpointName: string,
  actor: string,
): Promise<void> {
  try {
    // Resolve the repo linkage. project_id sent to MCP is the github_repo (MCP resolves the
    // project + macro channel from it), NOT the jira_key.
    const row = await queryOne<{ github_repo: string | null }>(
      'SELECT github_repo FROM projects WHERE jira_key = $1',
      [projectId],
    );
    const githubRepo = row?.github_repo ?? null;

    // PLAN-L3 — unlinked project: skip the notify_slack call entirely (feature switch OFF).
    if (!githubRepo) {
      log('info', 'MACRO_NOTIFY_SKIPPED', { projectId, reason: 'github_repo_null' });
      return;
    }

    const result = await notifySlack({
      project_id: githubRepo,
      message: `Macro gate reached: ${checkpointName} — approved by ${actor}`,
      event_type: 'macro',
    });

    log('info', 'MACRO_NOTIFY_RESULT', {
      projectId,
      notified: result.notified,
      reason: result.reason,
    });
  } catch (err) {
    // Best-effort: a notification failure MUST NOT fail the approval.
    log('warn', 'MACRO_NOTIFY_FAILED', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
