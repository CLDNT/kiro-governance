/**
 * PATCH /api/projects/{projectId}/hours
 * Update hours_consumed on a project.
 * See specs/api/projects.yaml for API documentation.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, ValidationError, NotFoundError } from '@kiro-governance/shared/middleware/error-handler';
import { getPool } from '@kiro-governance/shared/db/pool';
import { AuthContext } from '@kiro-governance/shared/types/auth';
import { UpdateHoursResponse } from '../types';

const UpdateHoursInputSchema = z.object({
  hours_consumed: z.number().min(0),
});

async function updateHours(
  projectId: string,
  hoursConsumed: number,
  _auth: AuthContext,
): Promise<UpdateHoursResponse> {
  const pool = await getPool();

  const result = await pool.query(
    `UPDATE projects
     SET hours_consumed = $1
     WHERE jira_key = $2
     RETURNING sow_hours, hours_consumed`,
    [hoursConsumed, projectId],
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Project', projectId);
  }

  const row = result.rows[0];
  const burn_rate_pct = row.sow_hours && row.sow_hours > 0
    ? Math.round((row.hours_consumed / row.sow_hours) * 100 * 100) / 100
    : null;

  return {
    hours_consumed: row.hours_consumed,
    sow_hours: row.sow_hours,
    burn_rate_pct,
  };
}

export const handler = withRoles(['pm', 'leadership', 'admin'], async (event: APIGatewayProxyEvent, context: any): Promise<APIGatewayProxyResult> => {
  try {
    const projectId = event.pathParameters?.projectId;
    if (!projectId) {
      throw new Error('Missing projectId path parameter');
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const input = UpdateHoursInputSchema.parse(body);

    const result = await updateHours(projectId, input.hours_consumed, context.auth);

    return ok(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleError(new ValidationError('Invalid request body', {}));
    }
    return handleError(error);
  }
});
