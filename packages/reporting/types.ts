/**
 * Reporting domain types — leadership dashboard views.
 * See docs/phase2/reporting-architecture.md for complete specs.
 */

export interface ProjectSummary {
  jira_key: string;
  title: string;
  status: string;
  current_phase: string | null;
  last_activity: string | null;
}

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

export interface ReportingSummary {
  total_active_projects: number;
  projects_by_phase: PhaseCount[];
  stalled_projects: StalledProject[];
  gate_completion_rates: GateCompletionRate[];
  generated_at: string;
}

export interface TimelineEvent {
  event_id: string;
  event_type: 'governance' | 'checkpoint' | 'evidence';
  event_timestamp: string;
  phase: string | null;
  title: string;
  actor: string | null;
  detail: string | null;
}

export interface TimelineResponse {
  project_id: string;
  project_title: string;
  current_phase: string;
  events: TimelineEvent[];
  next_cursor: string | null;
}
