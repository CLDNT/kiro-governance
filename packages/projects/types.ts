/**
 * Projects domain TypeScript interfaces.
 * Shared between frontend and backend.
 */

export interface Project {
  id: number;
  jira_key: string;
  jira_id: string | null;
  jira_link: string | null;
  title: string;
  description: string | null;
  project_type: string | null;
  status: string | null;
  account_executive: string | null;
  solution_architect: string | null;
  project_manager: string | null;
  engineers_assigned: string | null;
  planned_kickoff_date: string | null;
  expected_completion_date: string | null;
  resource_assignment_date: string | null;
  sow_hours: number | null;
  hours_consumed: number;
  sow_link: string | null;
  current_phase: string;
  created_at: string;
}

export interface ProjectDetail extends Project {}

export interface CreateProjectInput {
  title: string;
  project_type: string;
  project_manager: string;
  solution_architect: string;
  account_executive?: string;
  engineers_assigned?: string;
  sow_hours?: number;
  planned_kickoff_date?: string;
  expected_completion_date?: string;
  description?: string;
}

export interface UpdateProjectInput {
  title?: string;
  description?: string;
  status?: string;
  project_manager?: string;
  solution_architect?: string;
  account_executive?: string;
  engineers_assigned?: string;
  planned_kickoff_date?: string | null;
  expected_completion_date?: string | null;
  sow_hours?: number | null;
}

export interface ProjectSummary {
  id: number;
  jira_key: string;
  title: string;
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

export interface UpdateChecklistInput {
  completed: boolean;
}

export interface UpdateHoursInput {
  hours_consumed: number;
}

export interface UpdateHoursResponse {
  hours_consumed: number;
  sow_hours: number | null;
  burn_rate_pct: number | null;
}

export interface ImportJiraInput {
  jira_base_url: string;
  project_key: string;
}

export interface ImportJiraResponse {
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ jira_key: string; reason: string }>;
}

export interface CreateProjectResponse {
  project: Project;
  seeded: {
    micro_artifacts: number;
    macro_checkpoints: number;
    onboarding_items: number;
  };
}
