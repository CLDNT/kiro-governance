/**
 * PostgreSQL record shape for governance_events table.
 * Single source of truth — unified-data-model.md §2.6
 */
export interface GovernanceEventRecord {
  /** Auto-incrementing primary key (populated by PostgreSQL) */
  id?: number;

  /** GitHub repository name */
  project_id: string;

  /** Human-readable event description (max 4096 chars) */
  update_text: string;

  /** Event classification */
  type: 'macro' | 'micro';

  /** True if type was manually overridden; undefined if auto-classified */
  flag_override?: boolean;

  /** Canonical macro gate name. Present for macro events, absent for micro. */
  gate?: string;

  /** CASDM phase number (e.g., "Phase 0", "Phase 1") */
  phase?: string;

  /** Human-readable phase name (e.g., "Internal Preparation", "Discover & Align") */
  phase_name?: string;

  /**
   * Level-2 stable event code (CR-14). Optional, rename-safe, language-agnostic
   * (casdm.<phase>.<artifact>). Present only on micro events that a Kiro agent tags for
   * micro-artifact auto-completion. Persisted as-is; unknown/absent codes never resolve
   * in Level-2 (timeline-only). Not part of the idempotency key.
   */
  event_code?: string;

  /** Provenance — commit SHA or file line reference */
  source_ref: string;

  /** Who emitted/approved (agent name or human name) */
  actor: string;

  /** ISO-8601 creation timestamp */
  created_at: string;

  /** Deduplication key */
  idempotency_key: string;
}
