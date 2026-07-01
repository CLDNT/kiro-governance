/**
 * Meetings domain types — status logs, escalations, discovery sessions
 */

// ─── Domain Models ──────────────────────────────────────────────────────────

export interface WeeklyStatusLog {
  id: number;
  project_id: string;
  log_date: string; // YYYY-MM-DD
  meeting_link: string | null;
  topics_covered: string;
  demo_items: string | null;
  blockers: string | null;
  logged_by: string;
  created_at: string; // ISO 8601 timestamp
}

export interface Escalation {
  id: number;
  project_id: string;
  raised_date: string; // YYYY-MM-DD
  description: string;
  severity: EscalationSeverity;
  raised_by: string;
  resolved_date: string | null;
  resolution_notes: string | null;
  status: EscalationStatus;
  created_at: string; // ISO 8601 timestamp
}

export interface DiscoverySession {
  id: number;
  project_id: string;
  session_number: number;
  session_date: string; // YYYY-MM-DD
  meeting_link: string | null;
  participants: string;
  notes: string | null;
  created_at: string; // ISO 8601 timestamp
}

// ─── Enums ──────────────────────────────────────────────────────────────────

export type EscalationSeverity = 'low' | 'medium' | 'high' | 'critical';
export type EscalationStatus = 'open' | 'resolved';

// ─── Input Types ────────────────────────────────────────────────────────────

export interface CreateStatusLogInput {
  log_date: string;
  meeting_link?: string;
  topics_covered: string;
  demo_items?: string;
  blockers?: string;
}

export interface CreateEscalationInput {
  raised_date: string;
  description: string;
  severity: EscalationSeverity;
  raised_by: string;
}

export interface ResolveEscalationInput {
  resolved_date: string;
  resolution_notes?: string;
}

export interface CreateDiscoverySessionInput {
  session_date: string;
  meeting_link?: string;
  participants: string;
  notes?: string;
}

// ─── Response Types ─────────────────────────────────────────────────────────

export interface StatusLogListResponse {
  status_logs: WeeklyStatusLog[];
  next_cursor: string | null;
}

export interface EscalationListResponse {
  escalations: Escalation[];
  next_cursor: string | null;
}

export interface EscalationResolutionResponse extends Escalation {
  warning?: string;
}

export interface DiscoverySessionListResponse {
  sessions: DiscoverySession[];
  next_cursor: string | null;
}
