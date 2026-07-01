export interface Project {
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
}

export interface MicroArtifact {
  id: number;
  artifact_name: string;
  phase: string;
  phase_name: string;
  status: 'pending' | 'in_progress' | 'complete';
  completed_at: string | null;
  completed_by: string | null;
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
