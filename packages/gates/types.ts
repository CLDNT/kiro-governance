/**
 * Gates domain types — gate status, checkpoints, artifacts, evidence
 */

// ─── Domain Models ──────────────────────────────────────────────────────────

export interface MacroCheckpointDetail {
  id: number;
  checkpoint_name: string;
  checkpoint_type: 'human_review' | 'meeting' | 'transcript_analysis' | 'checklist';
  phase: string;
  phase_name: string;
  occurred: boolean | null;
  meeting_date: string | null;
  meeting_link: string | null;
  result_detail: string | null;
  reviewed_by: string | null;
  reached_at: string | null;
  analysis_result: Record<string, unknown> | null;
  analysis_run_at: string | null;
  evidence_count: number;
  notes_count: number;
}

export interface MicroArtifactDetail {
  id: number;
  artifact_name: string;
  phase: string;
  phase_name: string;
  status: 'pending' | 'in_progress' | 'complete';
  completed_at: string | null;
  completed_by: string | null;
  /** CR-12: true when a human set the status via PATCH /artifacts — the reconciler will not
   *  auto-complete or clobber this row until it is reset_to_auto. */
  manual_override: boolean;
}

/**
 * Response for POST /api/projects/{projectId}/sync-artifacts (CR-12 / FR-P2-042).
 * Non-secret counts of the Level-2 micro-artifact reconcile run:
 *  - matched:   mapping-resolved micro events that have a target micro_artifacts row;
 *  - completed: of matched, those newly set complete by this run (idempotent — 0 on re-sync);
 *  - skipped:   resolved candidates that did not complete (already complete | manual_override |
 *               no target row).
 */
export interface SyncArtifactsResponse {
  project_id: string;
  matched: number;
  completed: number;
  skipped: number;
}

export interface PhaseGateView {
  phase: string;
  phase_name: string;
  micro_artifacts: MicroArtifactDetail[];
  macro_checkpoints: MacroCheckpointDetail[];
  phase_complete: boolean;
}

export interface GateStatusResponse {
  project_id: string;
  phases: PhaseGateView[];
}

export interface EvidenceItem {
  id: number;
  project_id: string;
  checkpoint_name: string;
  evidence_type: 'meeting_link' | 'url' | 'file_upload' | 'ai_analysis';
  label: string | null;
  value: string;
  link_metadata: { title?: string; date?: string; duration_minutes?: number | null } | null;
  uploaded_by: string;
  created_at: string;
}

export interface GateNote {
  id: number;
  project_id: string;
  checkpoint_name: string;
  note_text: string;
  author: string;
  created_at: string;
}

export interface TimelineEvent {
  id: string;
  event_type: 'governance_event' | 'checkpoint_completed' | 'evidence_attached';
  timestamp: string;
  phase: string | null;
  title: string;
  actor: string | null;
  detail: string | null;
  source: 'kiro_mcp' | 'deliverpro';
}

export interface TimelineResponse {
  events: TimelineEvent[];
  next_cursor: string | null;
}

// ─── Input Types ────────────────────────────────────────────────────────────

export interface UpdateCheckpointInput {
  occurred?: boolean;
  meeting_date?: string;
  meeting_link?: string;
  reviewed_by?: string;
  result_detail?: string;
}

export interface UpdateArtifactInput {
  status: 'pending' | 'in_progress' | 'complete';
  /** CR-12: admin/leadership-only. When true, clears manual_override so the row becomes
   *  auto-eligible again (a subsequent reconcile may re-complete it). Audited as 'reverse'. */
  reset_to_auto?: boolean;
}

export interface AttachEvidenceInput {
  evidence_type: 'meeting_link' | 'url' | 'file_upload' | 'ai_analysis';
  label?: string;
  value: string;
  link_metadata?: { title?: string; date?: string; duration_minutes?: number | null };
}

export interface AddNoteInput {
  note_text: string;
}

export interface ListEvidenceResponse {
  evidence: EvidenceItem[];
  total_count: number;
}

export interface ListNotesResponse {
  notes: GateNote[];
  total_count: number;
}
