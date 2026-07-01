/**
 * PATCH /api/projects/{id}/checkpoints/{checkpointId}
 * Complete or enrich a macro checkpoint - append-only state machine
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, AppError, NotFoundError, ConflictError, ValidationError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging, log } from '@kiro-governance/shared/middleware/logger';
import { queryOne, queryMany } from '@kiro-governance/shared/db/pool';
import { UpdateCheckpointInputSchema } from '../validation';
import { MacroCheckpointDetail } from '../types';

interface CheckpointRow {
  id: number;
  checkpoint_type: string;
  phase: string;
  phase_name: string;
  checkpoint_name: string;
  occurred: boolean | null;
  meeting_date: string | null;
  meeting_link: string | null;
  result_detail: string | null;
  reviewed_by: string | null;
  reached_at: string | null;
  analysis_result: Record<string, unknown> | null;
  analysis_run_at: string | null;
}

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'sa', 'leadership', 'admin'],
  withLogging(async (event) => {
    try {
      const projectId = event.pathParameters?.id;
      const checkpointId = event.pathParameters?.checkpointId;

      if (!projectId || !checkpointId) {
        throw new ValidationError('Project ID and checkpoint ID are required');
      }

      const input = UpdateCheckpointInputSchema.parse(JSON.parse(event.body || '{}'));

      // Load checkpoint
      const checkpoint = await queryOne<CheckpointRow>(
        `SELECT id, checkpoint_type, phase, phase_name, checkpoint_name, occurred, meeting_date, 
                meeting_link, result_detail, reviewed_by, reached_at, analysis_result, analysis_run_at
         FROM macro_checkpoints
         WHERE id = $1 AND project_id = $2`,
        [checkpointId, projectId],
      );

      if (!checkpoint) {
        throw new NotFoundError('Checkpoint', checkpointId);
      }

      // --- State Machine: Type-specific completion logic ---

      if (checkpoint.checkpoint_type === 'checklist') {
        throw new ValidationError('Checklist checkpoints are auto-completed when all child items are done.');
      }

      // human_review: role-based access + reviewed_by field
      if (checkpoint.checkpoint_type === 'human_review') {
        if (!['sa', 'leadership', 'admin'].includes(event.requestContext?.authorizer?.claims?.['cognito:groups']?.[0] || 'pm')) {
          throw new AppError('FORBIDDEN', 'Only SA, Leadership, or Admin can complete human_review checkpoints', 403);
        }

        if (input.reviewed_by && checkpoint.reached_at !== null) {
          throw new ConflictError('CHECKPOINT_ALREADY_COMPLETE', 'This checkpoint is already completed and cannot be modified');
        }

        if (input.reviewed_by) {
          await queryOne(
            `UPDATE macro_checkpoints
             SET reviewed_by = $1, reached_at = COALESCE(reached_at, now())
             WHERE id = $2
             RETURNING *`,
            [input.reviewed_by, checkpointId],
          );
          log('CHECKPOINT_COMPLETED', { checkpointId, type: 'human_review', reviewedBy: input.reviewed_by });
        } else if (input.result_detail && checkpoint.reached_at !== null) {
          // Enrichment: allowed after completion
          await queryOne(
            `UPDATE macro_checkpoints SET result_detail = $1 WHERE id = $2 RETURNING *`,
            [input.result_detail, checkpointId],
          );
          log('CHECKPOINT_ENRICHED', { checkpointId, type: 'human_review' });
        }
      }

      // meeting: occurred flag + enrichment fields
      if (checkpoint.checkpoint_type === 'meeting') {
        if (checkpoint.occurred === true) {
          throw new ConflictError('CHECKPOINT_ALREADY_COMPLETE', 'Meeting checkpoint already marked as occurred');
        }

        if (input.occurred === true) {
          await queryOne(
            `UPDATE macro_checkpoints
             SET occurred = true, reached_at = COALESCE(reached_at, now()),
                 meeting_date = COALESCE($1, meeting_date),
                 meeting_link = COALESCE($2, meeting_link),
                 result_detail = COALESCE($3, result_detail)
             WHERE id = $4
             RETURNING *`,
            [input.meeting_date || null, input.meeting_link || null, input.result_detail || null, checkpointId],
          );
          log('CHECKPOINT_COMPLETED', { checkpointId, type: 'meeting', meetingDate: input.meeting_date });
        } else if (input.meeting_date || input.meeting_link || input.result_detail) {
          // Enrichment: allowed anytime
          await queryOne(
            `UPDATE macro_checkpoints
             SET meeting_date = COALESCE($1, meeting_date),
                 meeting_link = COALESCE($2, meeting_link),
                 result_detail = COALESCE($3, result_detail)
             WHERE id = $4
             RETURNING *`,
            [input.meeting_date || null, input.meeting_link || null, input.result_detail || null, checkpointId],
          );
          log('CHECKPOINT_ENRICHED', { checkpointId, type: 'meeting' });
        }
      }

      // transcript_analysis: pre-condition check + read-only for API
      if (checkpoint.checkpoint_type === 'transcript_analysis') {
        if (input.occurred || input.reviewed_by) {
          throw new ValidationError('Transcript analysis checkpoints are completed by the analysis domain only');
        }

        // Pre-condition: meeting_link evidence must exist
        const evidence = await queryMany<{ id: number }>(
          `SELECT id FROM gate_evidence 
           WHERE project_id = $1 AND checkpoint_name = $2 AND evidence_type = 'meeting_link'
           LIMIT 1`,
          [projectId, checkpoint.checkpoint_name],
        );

        if (evidence.length === 0) {
          throw new ValidationError('Meeting link evidence required before analysis can run');
        }

        if (input.result_detail && checkpoint.reached_at === null) {
          // Only allow result_detail from analysis domain (should not come via API)
          await queryOne(
            `UPDATE macro_checkpoints
             SET result_detail = $1
             WHERE id = $2
             RETURNING *`,
            [input.result_detail, checkpointId],
          );
        }
      }

      // Load updated checkpoint
      const updated = await queryOne<CheckpointRow>(
        `SELECT id, checkpoint_type, phase, phase_name, checkpoint_name, occurred, meeting_date, 
                meeting_link, result_detail, reviewed_by, reached_at, analysis_result, analysis_run_at
         FROM macro_checkpoints
         WHERE id = $1`,
        [checkpointId],
      );

      if (!updated) {
        throw new Error('Failed to load updated checkpoint');
      }

      // Compute evidence and notes counts
      const counts = await queryOne<{ evidence_count: number; notes_count: number }>(
        `SELECT 
          COALESCE((SELECT COUNT(*) FROM gate_evidence WHERE project_id = $1 AND checkpoint_name = $2), 0)::int AS evidence_count,
          COALESCE((SELECT COUNT(*) FROM checkpoint_notes WHERE project_id = $1 AND checkpoint_name = $2), 0)::int AS notes_count`,
        [projectId, checkpoint.checkpoint_name],
      );

      const response: MacroCheckpointDetail = {
        id: updated.id,
        checkpoint_name: updated.checkpoint_name,
        checkpoint_type: updated.checkpoint_type as any,
        occurred: updated.occurred,
        meeting_date: updated.meeting_date,
        meeting_link: updated.meeting_link,
        result_detail: updated.result_detail,
        reviewed_by: updated.reviewed_by,
        reached_at: updated.reached_at,
        analysis_result: updated.analysis_result,
        analysis_run_at: updated.analysis_run_at,
        evidence_count: counts?.evidence_count || 0,
        notes_count: counts?.notes_count || 0,
      };

      return ok(response);
    } catch (err) {
      return handleError(err);
    }
  }),
);
