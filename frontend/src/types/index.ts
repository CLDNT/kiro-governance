export interface Project {
  id: number;
  jira_key: string;
  jira_link: string | null;
  title: string;
  description: string | null;
  project_type: string | null;
  status: string | null;
  project_manager: string | null;
  solution_architect: string | null;
  current_phase: string;
  sow_hours: number | null;
  hours_consumed: number;
  burn_rate_pct: number | null;
  planned_kickoff_date: string | null;
  expected_completion_date: string | null;
  // --- CR-02 / CR-15: GitHub ↔ dual-Slack linkage (V004). All nullable — feature switch. ---
  github_repo: string | null;
  github_url: string | null;
  slack_micro_channel_id: string | null;
  slack_macro_channel_id: string | null;
  // Read-only audit metadata for the last linkage mutation. Never a secret.
  updated_by: string | null;
  updated_at: string | null;
}

/**
 * The four optional GitHub/Slack linkage fields shared by create + edit forms.
 * All values are non-secret. A Slack bot token / webhook URL is NEVER represented here.
 */
export interface ProjectLinkageInput {
  github_repo?: string | null;
  github_url?: string | null;
  slack_micro_channel_id?: string | null;
  slack_macro_channel_id?: string | null;
}

export interface CreateProjectInput extends ProjectLinkageInput {
  title: string;
  project_type: string;
  description?: string;
  project_manager?: string;
  solution_architect?: string;
  sow_hours?: number;
  planned_kickoff_date?: string;
}

export interface UpdateProjectInput extends ProjectLinkageInput {
  title?: string;
  description?: string;
  status?: string;
  project_manager?: string;
  solution_architect?: string;
  sow_hours?: number | null;
}

/** Response for POST /api/projects/{projectId}/slack/provision (CR-05, FR-P2-039). Non-secret ids only. */
export interface ProvisionSlackChannelsResponse {
  project_id: string;
  slack_micro_channel_id: string;
  slack_macro_channel_id: string;
  provisioned: {
    micro: { channel_id: string; created: boolean };
    macro: { channel_id: string; created: boolean };
  };
  persisted: boolean;
}

export interface ProjectSummary {
  id: number;
  jira_key: string;
  title: string;
  description: string | null;
  project_type: string | null;
  status: string | null;
  project_manager: string | null;
  solution_architect: string | null;
  current_phase: string;
  sow_hours: number | null;
  hours_consumed: number;
  burn_rate_pct: number | null;
  planned_kickoff_date: string | null;
  expected_completion_date: string | null;
}

export interface ProjectListResponse {
  projects: ProjectSummary[];
  next_cursor: string | null;
  total_count: number;
}

export interface OnboardingChecklistItem {
  id: number;
  project_id: string;
  item_name: string;
  completed: boolean;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ChecklistResponse {
  items: OnboardingChecklistItem[];
  completed_count: number;
  total_count: number;
}

export interface MacroCheckpoint {
  id: number;
  checkpoint_name: string;
  checkpoint_type: 'human_review' | 'meeting' | 'transcript_analysis' | 'checklist';
  occurred: boolean | null;
  meeting_date: string | null;
  meeting_link: string | null;
  result_detail: string | null;
  reviewed_by: string | null;
  reached_at: string | null;
  evidence_count: number;
  notes_count: number;
  // --- transcript_analysis checkpoints (Phase 2 analysis domain) ---
  // NOTE: get-gates returns analysis_result + analysis_run_at but NOT transcript_url,
  // so the "transcript fetched" state is tracked in component state after a fetch.
  // transcript_url is kept optional here for forward-compatibility if the gate view adds it.
  transcript_url?: string | null;
  analysis_result?: TranscriptAnalysisResult | null;
  analysis_run_at?: string | null;
}

/**
 * Structured result of a transcript analysis run.
 * Source: packages/analysis/types.ts (backend contract), analysis-architecture.md §6.
 */
export interface TranscriptAnalysisResult {
  topics_covered: string[];
  topics_missing: string[];
  key_points: string[];
  disagreements: string[];
  passed: boolean;
  confidence: number; // 0.0 – 1.0
}

/** Response for POST /api/projects/{projectId}/checkpoints/{checkpointId}/fetch-transcript */
export interface FetchTranscriptResponse {
  transcript_url: string;
  char_count: number;
}

/** Response for POST /api/projects/{projectId}/checkpoints/{checkpointId}/analyze */
export interface AnalysisResponse {
  analysis_result: TranscriptAnalysisResult;
  analysis_run_at: string; // ISO 8601
  result_detail: string; // human-readable summary
  transcript_s3_key: string;
}

export interface MicroArtifact {
  id: number;
  artifact_name: string;
  phase: string;
  phase_name: string;
  status: 'pending' | 'in_progress' | 'complete';
  completed_at: string | null;
  // 'kiro:<actor>' when auto-completed by the Level-2 reconciler (UI shows a 'kiro' badge);
  // a user email when completed manually. See lib/artifacts.ts.
  completed_by: string | null;
  // CR-12 / FR-P2-042: true when a human set the status via PATCH /artifacts — the reconciler
  // will not auto-complete or clobber this row until reset_to_auto clears it.
  manual_override: boolean;
}

/**
 * Body for PATCH /api/projects/{projectId}/artifacts/{artifactId} (CR-12).
 * Any human status change sets manual_override=true server-side. reset_to_auto (admin/leadership
 * only) clears manual_override so the row becomes Kiro auto-eligible again.
 */
export interface UpdateArtifactInput {
  status: 'pending' | 'in_progress' | 'complete';
  reset_to_auto?: boolean;
}

/**
 * Response for POST /api/projects/{projectId}/sync-artifacts (CR-12 / FR-P2-042).
 * Non-secret counts of the Level-2 micro-artifact reconcile run. Idempotent — completed is 0 on
 * re-sync; all-zero for an unlinked project.
 */
export interface SyncArtifactsResponse {
  project_id: string;
  matched: number;
  completed: number;
  skipped: number;
}

/**
 * Response for POST /api/projects/{projectId}/sync-gates (CR-16). Mirrors the backend
 * `SyncGatesResponse` (packages/projects/types.ts, specs/api/projects.yaml). Non-secret counts of
 * the repo → macro-gate sync run:
 *  - matched:  resolved repo gates that map to a checkpoint AND have a row for the project;
 *  - resolved: of matched, those newly completed by this run (idempotent — 0 on re-sync);
 *  - skipped:  unmapped gates, mapped-but-missing rows, or already-resolved checkpoints.
 * An unlinked project returns all-zero. The GitHub token never appears in the response.
 */
export interface SyncGatesResponse {
  project_id: string;
  matched: number;
  resolved: number;
  skipped: number;
}

export interface PhaseGateView {
  phase: string;
  phase_name: string;
  micro_artifacts: MicroArtifact[];
  macro_checkpoints: MacroCheckpoint[];
  phase_complete: boolean;
}

export interface GateStatusResponse {
  project_id: string;
  phases: PhaseGateView[];
}

export interface EvidenceItem {
  id: number;
  checkpoint_name: string;
  evidence_type: 'meeting_link' | 'url' | 'file_upload' | 'ai_analysis';
  label: string | null;
  value: string;
  uploaded_by: string;
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

// ─── Meetings Domain ────────────────────────────────────────────────────────

export interface Escalation {
  id: number;
  project_id: string;
  raised_date: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  raised_by: string;
  resolved_date: string | null;
  resolution_notes: string | null;
  status: 'open' | 'resolved';
  created_at: string;
}

export interface DiscoverySession {
  id: number;
  project_id: string;
  session_number: number;
  session_date: string;
  meeting_link: string | null;
  participants: string;
  notes: string | null;
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

// ─── Reporting Domain ──────────────────────────────────────────────────────

export interface PhaseCount {
  phase: string;
  phase_name: string;
  count: number;
}

export interface StalledProject {
  jira_key: string;
  title: string;
  project_manager: string | null;
  current_phase: string;
  last_activity_at: string | null;
  days_stalled: number;
}

export interface GateCompletionRate {
  checkpoint_name: string;
  total_projects: number;
  completed_count: number;
  completion_pct: number;
}

export interface ReportingSummaryResponse {
  total_active_projects: number;
  projects_by_phase: PhaseCount[];
  stalled_projects: StalledProject[];
  gate_completion_rates: GateCompletionRate[];
  generated_at: string;
}

// ─── Users Domain ────────────────────────────────────────────────────────

/** A selectable user in the reviewer directory. `email` is the stable unique identifier. */
export interface UserSummary {
  email: string;
  name: string;
  role?: string;
}

/** Response for GET /api/users — the directory used to populate reviewer selection. */
export interface UsersListResponse {
  users: UserSummary[];
}
