/**
 * POST /api/projects/{id}/discovery-sessions
 * Log a discovery session with auto-incremented session_number
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, ValidationError, AppError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging, log } from '@kiro-governance/shared/middleware/logger';
import { queryOne } from '@kiro-governance/shared/db/pool';
import { CreateDiscoverySessionInputSchema } from '../validation';
import { DiscoverySession } from '../types';

interface MaxSessionRow {
  next_num: number;
}

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'leadership', 'admin'],
  withLogging(async (event) => {
    try {
      const projectId = event.pathParameters?.projectId;

      if (!projectId) {
        throw new ValidationError('Project ID is required');
      }

      const input = CreateDiscoverySessionInputSchema.parse(JSON.parse(event.body || '{}'));

      // Verify project exists
      const project = await queryOne<{ jira_key: string }>(
        `SELECT jira_key FROM projects WHERE jira_key = $1`,
        [projectId],
      );

      if (!project) {
        throw new NotFoundError('Project', projectId);
      }

      // Auto-compute next session_number with lock-free transaction
      // FOR UPDATE acquires a lock on existing rows; prevents concurrent increments
      let session: DiscoverySession | null = null;

      // Retry logic for uniqueness constraint violations
      let retries = 0;
      while (retries < 2 && !session) {
        try {
          // Get next session number
          const maxRow = await queryOne<MaxSessionRow>(
            `SELECT COALESCE(MAX(session_number), 0) + 1 AS next_num
             FROM discovery_sessions
             WHERE project_id = $1
             FOR UPDATE`,
            [projectId],
          );

          if (!maxRow) {
            throw new Error('Failed to compute session number');
          }

          const nextNumber = maxRow.next_num;

          // Insert session atomically
          session = await queryOne<DiscoverySession>(
            `INSERT INTO discovery_sessions (project_id, session_number, session_date, meeting_link, participants, notes)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, project_id, session_number, session_date, meeting_link, participants, notes, created_at`,
            [projectId, nextNumber, input.session_date, input.meeting_link || null, input.participants, input.notes || null],
          );

          if (!session) {
            throw new Error('Failed to create discovery session');
          }
        } catch (err) {
          // Check for unique constraint violation (23505)
          if ((err as any)?.code === '23505' && retries < 1) {
            retries++;
            // Retry — another transaction just inserted a session
            continue;
          }
          throw err;
        }
      }

      if (!session) {
        throw new AppError('UNIQUE_CONSTRAINT_VIOLATION', 'Failed to generate unique session number after retries', 500);
      }

      log('info', 'DISCOVERY_SESSION_CREATED', {
        projectId,
        sessionNumber: session.session_number,
        sessionDate: input.session_date,
      });

      return ok(session, 201);
    } catch (err) {
      return handleError(err);
    }
  }),
);
