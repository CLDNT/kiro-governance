/**
 * PATCH /api/projects/{projectId}/checklist/{itemId}
 * Mark/unmark an onboarding checklist item.
 * When all 9 items are completed, sets the 'Onboarding Checklist' checkpoint's reached_at.
 *
 * CR-04: completing the 'Set up Slack/Teams channel' item may OPTIONALLY carry
 * slack_micro_channel_id / slack_macro_channel_id. Capture is SOFT — completion is never
 * blocked when the ids are omitted. When supplied, the ids are persisted to the projects
 * columns through the SAME audited linkage path used by CR-02 (updated_by/updated_at set on
 * the UPDATE so the project_link_audit trigger records per-field rows), and the admin/leadership
 * linkage authorization is enforced. Only non-secret channel ids are accepted — a bot token or
 * webhook URL fails the channel-id format check and is rejected 400.
 * See specs/api/projects.yaml for API documentation.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import {
  ok,
  handleError,
  ValidationError,
  NotFoundError,
  zodToValidationError,
} from '@kiro-governance/shared/middleware/error-handler';
import { getPool } from '@kiro-governance/shared/db/pool';
import { AuthContext } from '@kiro-governance/shared/types/auth';
import { OnboardingChecklistItem, UpdateChecklistInput } from '../types';
import { SLACK_TEAMS_CHECKLIST_ITEM } from '../services/seed.service';
import { assertLinkageAuthz, touchesLinkage } from '../services/linkage.service';

/**
 * Non-secret Slack channel-id shape (e.g. `C0123ABCD`). Identical to the CR-02 linkage
 * validation in update-project.ts — a bot token (`xoxb-…`) or webhook URL
 * (`https://hooks.slack.com/…`) contains characters outside this class and is rejected.
 */
const SLACK_CHANNEL_RE = /^[A-Za-z0-9]{1,64}$/;

const UpdateChecklistInputSchema = z.object({
  completed: z.boolean(),
  slack_micro_channel_id: z
    .string()
    .regex(SLACK_CHANNEL_RE, 'slack_micro_channel_id must be a non-secret channel id matching ^[A-Za-z0-9]{1,64}$')
    .optional(),
  slack_macro_channel_id: z
    .string()
    .regex(SLACK_CHANNEL_RE, 'slack_macro_channel_id must be a non-secret channel id matching ^[A-Za-z0-9]{1,64}$')
    .optional(),
});

/** Build a linkage-only view of the parsed input (only the keys actually supplied). */
function linkageView(input: UpdateChecklistInput): Record<string, string> {
  const view: Record<string, string> = {};
  if (input.slack_micro_channel_id !== undefined) view.slack_micro_channel_id = input.slack_micro_channel_id;
  if (input.slack_macro_channel_id !== undefined) view.slack_macro_channel_id = input.slack_macro_channel_id;
  return view;
}

async function updateChecklistItem(
  projectId: string,
  itemId: number,
  input: UpdateChecklistInput,
  auth: AuthContext,
): Promise<OnboardingChecklistItem> {
  const pool = await getPool();

  // Verify item exists and belongs to project (also need item_name for the CR-04 capture guard)
  const itemCheck = await pool.query(
    `SELECT project_id, item_name FROM onboarding_checklist_items WHERE id = $1 AND project_id = $2`,
    [itemId, projectId],
  );

  if (itemCheck.rows.length === 0) {
    throw new NotFoundError('Checklist item', itemId.toString());
  }

  const itemName = itemCheck.rows[0].item_name as string;

  // --- CR-04 soft-capture guards (only when channel ids are supplied) ---
  const linkage = linkageView(input);
  const capturingChannels = touchesLinkage(linkage);

  if (capturingChannels) {
    // Linkage mutation is admin/leadership only (projects-architecture §12.1). A pm/sa may
    // still COMPLETE the item (soft) — but may not attach channel ids. 403 before any write.
    assertLinkageAuthz(linkage, auth);

    // Channel ids are only meaningful when COMPLETING the Slack/Teams channel item.
    if (itemName !== SLACK_TEAMS_CHECKLIST_ITEM) {
      throw new ValidationError('Slack channel ids may only be captured on the "Set up Slack/Teams channel" item', {
        slack_channel_capture: [`only allowed on the '${SLACK_TEAMS_CHECKLIST_ITEM}' item`],
      });
    }
    if (input.completed !== true) {
      throw new ValidationError('Slack channel ids may only be captured when completing the item', {
        slack_channel_capture: ['only allowed when completed=true'],
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update the item
    const updateResult = await client.query(
      `UPDATE onboarding_checklist_items
       SET completed = $1,
           completed_by = CASE WHEN $1::boolean THEN $2 ELSE NULL END,
           completed_at = CASE WHEN $1::boolean THEN now() ELSE NULL END
       WHERE id = $3
       RETURNING id, project_id, item_name, completed, completed_by, completed_at, created_at`,
      [input.completed, auth.email, itemId],
    );

    const updatedItem = updateResult.rows[0];

    // CR-04: persist supplied channel ids via the audited linkage path. updated_by/updated_at
    // are set so the BEFORE UPDATE `audit_project_linkage` trigger derives actor_sub from the
    // Cognito sub and writes one project_link_audit row per changed field. Only the columns
    // actually supplied are touched (no clearing via this path).
    if (capturingChannels) {
      const cols: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (input.slack_micro_channel_id !== undefined) {
        cols.push(`slack_micro_channel_id = $${i++}`);
        params.push(input.slack_micro_channel_id);
      }
      if (input.slack_macro_channel_id !== undefined) {
        cols.push(`slack_macro_channel_id = $${i++}`);
        params.push(input.slack_macro_channel_id);
      }
      cols.push(`updated_by = $${i++}`);
      params.push(auth.userId);
      cols.push(`updated_at = now()`);
      params.push(projectId);
      await client.query(`UPDATE projects SET ${cols.join(', ')} WHERE jira_key = $${i}`, params);
    }

    // Check if all 9 items are now completed
    const checklistCount = await client.query(
      `SELECT COUNT(*) FILTER (WHERE completed = true) as completed_count,
              COUNT(*) as total_count
       FROM onboarding_checklist_items
       WHERE project_id = $1`,
      [projectId],
    );

    const { completed_count, total_count } = checklistCount.rows[0];

    // If all items completed, mark the macro checkpoint as reached
    if (completed_count === total_count && total_count === 9) {
      await client.query(
        `UPDATE macro_checkpoints
         SET reached_at = now()
         WHERE project_id = $1
           AND checkpoint_name = 'Onboarding Checklist'
           AND checkpoint_type = 'checklist'`,
        [projectId],
      );
    } else if (input.completed === false) {
      // If item was just unchecked, clear the reached_at on the checkpoint
      await client.query(
        `UPDATE macro_checkpoints
         SET reached_at = NULL
         WHERE project_id = $1
           AND checkpoint_name = 'Onboarding Checklist'
           AND checkpoint_type = 'checklist'`,
        [projectId],
      );
    }

    await client.query('COMMIT');

    return updatedItem;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export const handler = withRoles(
  ['pm', 'sa', 'leadership', 'admin'],
  async (event: APIGatewayProxyEvent, context: any): Promise<APIGatewayProxyResult> => {
    try {
      const projectId = event.pathParameters?.projectId;
      const itemIdStr = event.pathParameters?.itemId;

      if (!projectId || !itemIdStr) {
        throw new Error('Missing path parameters');
      }

      const itemId = parseInt(itemIdStr, 10);
      if (isNaN(itemId)) {
        return handleError(new ValidationError('itemId must be a number', {}));
      }

      const body = event.body ? JSON.parse(event.body) : {};
      const input = UpdateChecklistInputSchema.parse(body);

      const result = await updateChecklistItem(projectId, itemId, input, context.auth);

      return ok(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return handleError(zodToValidationError(error));
      }
      return handleError(error);
    }
  },
);
