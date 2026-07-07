/**
 * Level-2 CASDM micro-artifact event-code vocabulary (CR-14 / OQ-CR-13).
 *
 * The mapping ROWS live in micro_artifact_mapping (seeded by V008 — the DB is the runtime
 * source of truth). This constant is the typed, unit-testable mirror used by the shared
 * type, tests, and as the reference for the V008 seed. Import from here — never hardcode
 * event codes.
 *
 * Format: casdm.<phase-slug>.<artifact-slug> — lowercase, dot-delimited, [a-z0-9._], <= 64 chars.
 * Each artifact_name is copied VERBATIM from the V002 `__template__` micro_artifacts seed so the
 * reconcile join (micro_artifacts.artifact_name = micro_artifact_mapping.artifact_name) matches.
 *
 * Source: specs/phase2/CR-12-14-level2-spec.md §2; migrations/V002__projects_and_casdm_tracking.sql.
 */
export const MICRO_ARTIFACT_EVENT_CODES = {
  'casdm.p0.preliminary_srs': { phase: 'Phase 0', artifact_name: 'Preliminary SRS' },
  'casdm.p0.discovery_agenda': { phase: 'Phase 0', artifact_name: 'Discovery Meeting(s) Agenda + Questions' },
  'casdm.p0.project_plan': { phase: 'Phase 0', artifact_name: 'High-level Project Plan + Gantt Chart + RACI' },
  'casdm.p0.baseline_backlog': { phase: 'Phase 0', artifact_name: 'Baseline Jira Backlog' },
  'casdm.p0.kickoff_deck': { phase: 'Phase 0', artifact_name: 'Kickoff Deck Content/Slides' },
  'casdm.p1.working_srs': { phase: 'Phase 1', artifact_name: 'Working SRS' },
  'casdm.p2.workstream_decomposition': { phase: 'Phase 2', artifact_name: 'Workstream Decomposition' },
  'casdm.p2.spec_strategy': { phase: 'Phase 2', artifact_name: 'Spec Strategy per Workstream' },
  'casdm.p2.data_readiness': { phase: 'Phase 2', artifact_name: 'Data Readiness' },
  'casdm.p2.solution_architecture_design': { phase: 'Phase 2', artifact_name: 'Solution Architecture Design' },
  'casdm.p2.tco': { phase: 'Phase 2', artifact_name: 'TCO' },
  'casdm.p2.sprint_plan': { phase: 'Phase 2', artifact_name: 'Jira stories/sprint plan using validated SRS/design docs' },
  'casdm.p3.specs_per_story': { phase: 'Phase 3', artifact_name: 'Specs per story-id' },
  'casdm.p3.code': { phase: 'Phase 3', artifact_name: 'Code' },
  'casdm.p3.uat_report': { phase: 'Phase 3', artifact_name: 'UAT report' },
  'casdm.p4.runbooks': { phase: 'Phase 4', artifact_name: 'Runbooks / Documentation' },
} as const;

export type MicroArtifactEventCode = keyof typeof MICRO_ARTIFACT_EVENT_CODES;

/** The event_code charset/length contract enforced at the record_progress boundary (CR-14). */
export const EVENT_CODE_PATTERN = /^[a-z0-9._]{1,64}$/;

/**
 * Non-throwing membership check used by the record_progress passthrough. Unknown codes still
 * persist (timeline-only) — the Level-2 allow-list is enforced at reconcile time via the DB join,
 * so this is only a typed convenience for callers/tests, never a write-time gate.
 */
export function isKnownEventCode(code: string): code is MicroArtifactEventCode {
  return Object.prototype.hasOwnProperty.call(MICRO_ARTIFACT_EVENT_CODES, code);
}
