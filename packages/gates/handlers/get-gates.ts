/**
 * GET /api/projects/{id}/gates
 * Return full gate status view — all phases with micro artifacts, macro checkpoints
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, AppError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging, log } from '@kiro-governance/shared/middleware/logger';
import { queryMany } from '@kiro-governance/shared/db/pool';
import { GateStatusResponse, PhaseGateView } from '../types';
import { reconcileMicroArtifacts } from '../services/micro-artifact-reconcile.service';

interface MacroCheckpointRow {
  id: number;
  phase: string;
  phase_name: string;
  checkpoint_name: string;
  checkpoint_type: string;
  occurred: boolean | null;
  meeting_date: string | null;
  meeting_link: string | null;
  result_detail: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reached_at: string | null;
  analysis_result: Record<string, unknown> | null;
  analysis_run_at: string | null;
  evidence_count: number;
  notes_count: number;
}

interface MicroArtifactRow {
  id: number;
  phase: string;
  phase_name: string;
  artifact_name: string;
  status: string;
  completed_at: string | null;
  completed_by: string | null;
  manual_override: boolean;
}

interface CasdmConfigRow {
  phase: string;
  config_type: string;
  item_name: string;
  is_mandatory: boolean;
  is_active: boolean;
}

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'sa', 'engineer', 'leadership', 'admin'],
  withLogging(async (event) => {
    try {
      const projectId = event.pathParameters?.projectId;
      if (!projectId) {
        throw new AppError('VALIDATION_ERROR', 'Project ID is required', 400);
      }

      // Verify project exists
      const projectExists = await queryMany<{ jira_key: string }>(
        'SELECT jira_key FROM projects WHERE jira_key = $1',
        [projectId],
      );
      if (projectExists.length === 0) {
        throw new NotFoundError('Project', projectId);
      }

      // CR-12 T3: opportunistic, best-effort Level-2 reconcile on gate-view load, so a PM opening
      // the project sees fresh Kiro completions. Own-repo only (skipped when github_repo IS NULL).
      // NEVER throws — a reconcile failure must not break the gate view.
      try {
        const linked = await queryMany<{ github_repo: string | null }>(
          'SELECT github_repo FROM projects WHERE jira_key = $1',
          [projectId],
        );
        if (linked[0]?.github_repo) {
          await reconcileMicroArtifacts(projectId, 'system:gate-view');
        }
      } catch (err) {
        log('warn', 'ARTIFACT_SYNC_ON_VIEW_FAILED', {
          projectId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Load micro artifacts
      const artifacts = await queryMany<MicroArtifactRow>(
        `SELECT id, phase, phase_name, artifact_name, status, completed_at, completed_by, manual_override
         FROM micro_artifacts
         WHERE project_id = $1
         ORDER BY phase, id`,
        [projectId],
      );

      // Load macro checkpoints with evidence/notes counts
      const checkpoints = await queryMany<MacroCheckpointRow>(
        `SELECT
          mc.id, mc.phase, mc.phase_name, mc.checkpoint_name, mc.checkpoint_type,
          mc.occurred, mc.meeting_link, mc.reviewed_by, mc.reviewed_at,
          mc.meeting_date, mc.result_detail, mc.reached_at,
          mc.analysis_result, mc.analysis_run_at,
          COALESCE((SELECT COUNT(*) FROM gate_evidence ge WHERE ge.project_id = mc.project_id AND ge.checkpoint_name = mc.checkpoint_name), 0)::int AS evidence_count,
          COALESCE((SELECT COUNT(*) FROM checkpoint_notes cn WHERE cn.project_id = mc.project_id AND cn.checkpoint_name = mc.checkpoint_name), 0)::int AS notes_count
        FROM macro_checkpoints mc
        WHERE mc.project_id = $1
        ORDER BY mc.phase, mc.id`,
        [projectId],
      );

      // NOTE (CR-03 / §5.3): macro completion is APP-OWNED. macro_checkpoints.reached_at is set
      // ONLY by the in-app §4 state machine (human_review / meeting / transcript_analysis /
      // checklist). Phase 1 `governance_events` are display-only — they surface on the project
      // timeline (see packages/gates/handlers/project-timeline.ts) but MUST NOT complete a
      // checkpoint here. The previous governance_events -> macro_checkpoints auto-completion loop
      // was removed per FR-P2-041 (D-v3-4): no governance_events -> macro_checkpoints path exists.

      // Load CASDM config for phase completion logic
      const config = await queryMany<CasdmConfigRow>(
        `SELECT phase, config_type, item_name, is_mandatory, is_active
         FROM casdm_config
         WHERE is_active = true`,
        [],
      );

      // Build response with phase grouping and completion status
      const phases = new Map<string, PhaseGateView>();

      artifacts.forEach((artifact) => {
        if (!phases.has(artifact.phase)) {
          phases.set(artifact.phase, {
            phase: artifact.phase,
            phase_name: artifact.phase_name,
            micro_artifacts: [],
            macro_checkpoints: [],
            phase_complete: false,
          });
        }
        phases.get(artifact.phase)!.micro_artifacts.push({
          id: artifact.id,
          artifact_name: artifact.artifact_name,
          phase: artifact.phase,
          phase_name: artifact.phase_name,
          status: artifact.status as any,
          completed_at: artifact.completed_at,
          completed_by: artifact.completed_by,
          manual_override: artifact.manual_override,
        });
      });

      checkpoints.forEach((checkpoint) => {
        if (!phases.has(checkpoint.phase)) {
          phases.set(checkpoint.phase, {
            phase: checkpoint.phase,
            phase_name: checkpoint.phase_name,
            micro_artifacts: [],
            macro_checkpoints: [],
            phase_complete: false,
          });
        }
        phases.get(checkpoint.phase)!.macro_checkpoints.push({
          id: checkpoint.id,
          checkpoint_name: checkpoint.checkpoint_name,
          checkpoint_type: checkpoint.checkpoint_type as any,
          phase: checkpoint.phase,
          phase_name: checkpoint.phase_name,
          occurred: checkpoint.occurred,
          meeting_date: checkpoint.meeting_date,
          meeting_link: checkpoint.meeting_link,
          result_detail: checkpoint.result_detail,
          reviewed_by: checkpoint.reviewed_by,
          reached_at: checkpoint.reached_at,
          analysis_result: checkpoint.analysis_result,
          analysis_run_at: checkpoint.analysis_run_at,
          evidence_count: checkpoint.evidence_count,
          notes_count: checkpoint.notes_count,
        });
      });

      // Compute phase_complete for each phase
      phases.forEach((phase) => {
        const phaseConfig = config.filter((c) => c.phase === phase.phase && c.config_type === 'macro_checkpoint');
        const mandatoryGates = phaseConfig.filter((c) => c.is_mandatory);

        if (mandatoryGates.length === 0) {
          phase.phase_complete = true;
        } else {
          phase.phase_complete = mandatoryGates.every((gate) =>
            phase.macro_checkpoints.some((cp) => cp.checkpoint_name === gate.item_name && cp.reached_at !== null),
          );
        }
      });

      const response: GateStatusResponse = {
        project_id: projectId,
        phases: Array.from(phases.values()).sort((a, b) =>
          a.phase.localeCompare(b.phase, undefined, { numeric: true }),
        ),
      };

      log('info', 'GATE_VIEW_LOADED', { projectId, phaseCount: response.phases.length });

      return ok(response);
    } catch (err) {
      return handleError(err);
    }
  }),
);
