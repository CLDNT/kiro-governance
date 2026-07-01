/**
 * PATCH /api/projects/{projectId}/checklist/{itemId}
 * Mark/unmark an onboarding checklist item.
 * When all 9 items are completed, sets the 'Onboarding Checklist' checkpoint's reached_at.
 * See specs/api/projects.yaml for API documentation.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, ValidationError, NotFoundError } from '@kiro-governance/shared/middleware/error-handler';
import { getPool } from '@kiro-governance/shared/db/pool';
import { AuthContext } from '@kiro-governance/shared/types/auth';
import { OnboardingChecklistItem, UpdateChecklistInput } from '../types';

const UpdateChecklistInputSchema = z.object({
  completed: z.boolean(),
});

async function updateChecklistItem(
  projectId: string,
  itemId: number,
  input: UpdateChecklistInput,
  auth: AuthContext,
): Promise<OnboardingChecklistItem> {
  const pool = await getPool();

  // Verify item exists and belongs to project
  const itemCheck = await pool.query(
    `SELECT project_id FROM onboarding_checklist_items WHERE id = $1 AND project_id = $2`,
    [itemId, projectId],
  );

  if (itemCheck.rows.length === 0) {
    throw new NotFoundError('Checklist item', itemId.toString());
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

export const handler = withRoles(['pm', 'sa', 'leadership', 'admin'], async (event: APIGatewayProxyEvent, context: any): Promise<APIGatewayProxyResult> => {
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
      return handleError(new ValidationError('Invalid request body', {}));
    }
    return handleError(error);
  }
});
