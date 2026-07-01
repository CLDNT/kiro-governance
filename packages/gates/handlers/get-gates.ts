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

const GATE_TO_CHECKPOINT: Record<string, string> = {
  'discovery outputs validated': '5 outputs reviewed by SA',
  'preliminary srs validated': 'Working SRS reviewed by SA',
  'srs approved': 'Working SRS reviewed by SA',
  'design docs approved': 'Technically validate 6 design docs with spec strategy by SA',
  'implementation plan approved': 'Implementation Plan Review (Transcript Analysis)',
  'spec strategy approved': 'Review 3 generated outputs by Tech Lead',
  'code approved': 'Validate performance, security, compliance by Tech Lead',
  'uat report approved': 'UAT Review with Client (SA Support)',
  'runbooks approved': 'Validate customer documentation by Tech Lead',
  'project documentation approved': 'Validate customer documentation by Tech Lead',
};

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
}

interface CasdmConfigRow {
  phase: string;
  config_type: string;
  item_name: string;
  is_mandatory: boolean;
  is_active: boolean;
}

interface GovernanceEventRow {
  gate: string;
  actor: string;
  created_at: string;
  project_id: string;
}

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'sa', 'engineer', 'leadership', 'admin'],
  withLogging(async (event) => {
    try {
      const projectId = event.pathParameters?.id;
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

      // Load micro artifacts
      const artifacts = await queryMany<MicroArtifactRow>(
        `SELECT id, phase, phase_name, artifact_name, status, completed_at, completed_by
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

      // Reconcile with governance_events (Phase 1 integration)
      const governanceEvents = await queryMany<GovernanceEventRow>(
        `SELECT ge.gate, ge.actor, ge.created_at, ge.project_id
         FROM governance_events ge
         WHERE ge.project_id = $1 AND ge.type = 'macro'
         ORDER BY ge.created_at ASC`,
        [projectId],
      );

      // Auto-complete checkpoints from governance_events (earliest event wins)
      for (const event of governanceEvents) {
        const checkpointName = GATE_TO_CHECKPOINT[event.gate.toLowerCase().trim()];
        if (!checkpointName) continue;

        const checkpoint = checkpoints.find(
          (cp) => cp.checkpoint_name === checkpointName && cp.reached_at === null,
        );
        if (checkpoint) {
          checkpoint.reached_at = event.created_at;
          checkpoint.reviewed_by = event.actor;
        }
      }

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

      log('GATE_VIEW_LOADED', { projectId, phaseCount: response.phases.length });

      return ok(response);
    } catch (err) {
      return handleError(err);
    }
  }),
);
