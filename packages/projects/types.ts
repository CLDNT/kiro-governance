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
  // --- CR-02: GitHub ↔ dual-Slack linkage (V004). All nullable — feature switch. ---
  github_repo: string | null;
  github_url: string | null;
  slack_micro_channel_id: string | null;
  slack_macro_channel_id: string | null;
  updated_by: string | null; // Cognito sub of last linkage mutator (read-only)
  updated_at: string | null; // ISO timestamp of last linkage mutation (read-only)
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
  // --- CR-02 linkage (all optional; admin/leadership-only, enforced in handler) ---
  github_repo?: string;
  github_url?: string;
  slack_micro_channel_id?: string;
  slack_macro_channel_id?: string;
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
  project_type?: string; // Immutable after creation — present only so the 422 guard is type-safe.
  // --- CR-02 linkage (nullable to allow clearing / re-pointing, §12.5) ---
  github_repo?: string | null;
  github_url?: string | null;
  slack_micro_channel_id?: string | null;
  slack_macro_channel_id?: string | null;
}

/** The four audited linkage columns. Order is stable for iteration. */
export const LINKAGE_FIELDS = [
  'github_repo',
  'github_url',
  'slack_micro_channel_id',
  'slack_macro_channel_id',
] as const;

export type LinkageField = (typeof LINKAGE_FIELDS)[number];

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
  // --- CR-04: soft-capture of non-secret Slack channel ids when completing the
  // 'Set up Slack/Teams channel' onboarding item. Both optional — completion is
  // NEVER blocked when omitted (soft capture, OQ-CR-15 default). Setting either is a
  // linkage mutation (admin/leadership only) persisted via the audited linkage path.
  // Only non-secret channel ids are accepted — never a bot token or webhook URL. ---
  slack_micro_channel_id?: string;
  slack_macro_channel_id?: string;
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

/**
 * Response for POST /api/projects/{projectId}/sync-gates (CR-16).
 * Non-secret counts of the repo → macro-gate sync run:
 *  - matched:  resolved gates that map to a checkpoint AND have a row for the project;
 *  - resolved: of matched, those newly completed by this run (idempotent — 0 on re-sync);
 *  - skipped:  unmapped gates, mapped-but-missing rows, or already-resolved checkpoints.
 */
export interface SyncGatesResponse {
  project_id: string;
  matched: number;
  resolved: number;
  skipped: number;
}

/** One provisioned channel result (non-secret id + whether this call created it). */
export interface ProvisionedChannel {
  channel_id: string;
  created: boolean;
}

/**
 * Response for POST /api/projects/{projectId}/slack/provision (CR-05, FR-P2-039).
 * Carries only non-secret channel ids — never the provisioning token.
 * `persisted` is false on an idempotent no-op re-run (ids already stored).
 */
export interface ProvisionSlackChannelsResponse {
  project_id: string;
  slack_micro_channel_id: string;
  slack_macro_channel_id: string;
  provisioned: {
    micro: ProvisionedChannel;
    macro: ProvisionedChannel;
  };
  persisted: boolean;
}
