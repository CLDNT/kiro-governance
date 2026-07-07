-- Migration: V006__timeline_repoint
-- Date: 2026-07-03
-- Story: CR-03 — Micro Level-1 timeline surfacing (v_timeline governance join repoint).
-- Scope: BEHAVIOURAL change to the existing v_timeline view ONLY. Repoints source-1
--        (governance_events) join from projects.jira_key to projects.github_repo, with a
--        collision-safe interim fallback for not-yet-backfilled projects.
-- Source: docs/phase2/gates-architecture.md §5.1/§5.4; reporting-architecture.md §5.3;
--         docs/phase2/architecture/unified-data-model.md §4.4.6; jira-backlog CR-03.
--
-- Why a SEPARATE migration (not folded into V004/V005): the repoint is neither additive (V004
--   is ADD COLUMN / CREATE ... IF NOT EXISTS only) nor privilege-only (V005 ownership/GRANTs).
--   It is a DROP+CREATE VIEW behavioural change gated on the CR-06 backfill collision guard.
--   V004 explicitly deferred it (see the V004 "SCOPE BOUNDARY" header). This file matches how
--   v_timeline is currently created in V003 (DROP VIEW IF EXISTS + CREATE VIEW).
--
-- Column contract: PRESERVES the deployed V003 v_timeline column shape EXACTLY —
--   (project_id, project_title, event_type, event_id, event_timestamp, phase, phase_name,
--    title, actor, detail, sub_type). Only source-1's JOIN predicate changes; sources 2 and 3
--   (macro_checkpoints, gate_evidence) are byte-for-byte the V003 definitions.
--
-- INTERIM collision-safe branch: `OR (p.github_repo IS NULL AND p.jira_key = ge.project_id)`
--   keeps imported-but-not-yet-linked projects visible during the CR-06 backfill window. It is
--   guarded by the pre-implementation no-collision check (no project's github_repo equals any
--   other project's jira_key — enforced app-side per CR-02 and re-validated by the CR-06 backfill
--   collision guard). This branch is DROPPED after CR-06 backfill validates, leaving only the
--   github_repo join. See unified-data-model.md §4.4.6.
--
-- Macro stays APP-OWNED (display-only Kiro macros): governance events (including type='macro')
--   surface as source-1 rows on the timeline, but this view NEVER sets macro_checkpoints.reached_at.
--   The macro_checkpoints branch (source 2) is unchanged and still gated on reached_at IS NOT NULL —
--   completion is set only by the in-app §4 state machine, never by a governance event. There is no
--   governance_events -> macro_checkpoints write path here (§5.3, D-v3-4).
--
-- Database: RDS PostgreSQL 16 (shared Phase 1 + Phase 2 instance). Idempotent — safe to re-run
--           (DROP VIEW IF EXISTS + CREATE VIEW).

DROP VIEW IF EXISTS v_timeline;
CREATE VIEW v_timeline AS
-- Source 1: governance_events from Phase 1 MCP — joined via github_repo (CR-03 repoint).
--   governance_events.project_id is the GitHub repo name, NOT the jira_key. Emit p.jira_key AS
--   project_id so downstream consumers stay jira_key-keyed. Unlinked projects (github_repo IS NULL)
--   yield zero governance rows (feature switch OFF) — except the interim collision-safe fallback.
SELECT
  p.jira_key AS project_id,
  p.title AS project_title,
  'governance_event'::text AS event_type,
  ge.id::text AS event_id,
  ge.created_at AS event_timestamp,
  ge.phase,
  ge.phase_name,
  ge.update_text AS title,
  ge.actor,
  ge.gate AS detail,
  ge.type AS sub_type
FROM governance_events ge
JOIN projects p
  ON p.github_repo = ge.project_id
  -- INTERIM collision-safe branch (DROP after CR-06 backfill validates; unified-data-model §4.4.6):
  OR (p.github_repo IS NULL AND p.jira_key = ge.project_id)

UNION ALL

-- Source 2: macro checkpoint completions (DeliverPro / app-owned; UNCHANGED from V003).
SELECT
  mc.project_id,
  p.title,
  'checkpoint'::text,
  mc.id::text,
  mc.reached_at,
  mc.phase,
  mc.phase_name,
  mc.checkpoint_name,
  mc.reviewed_by,
  mc.result_detail,
  mc.checkpoint_type
FROM macro_checkpoints mc
JOIN projects p ON p.jira_key = mc.project_id
WHERE mc.reached_at IS NOT NULL

UNION ALL

-- Source 3: evidence attachments (DeliverPro-native; UNCHANGED from V003).
SELECT
  ge2.project_id,
  p.title,
  'evidence'::text,
  ge2.id::text,
  ge2.created_at,
  NULL,
  NULL,
  ge2.label,
  ge2.uploaded_by,
  ge2.value,
  ge2.evidence_type
FROM gate_evidence ge2
JOIN projects p ON p.jira_key = ge2.project_id;

-- End V006 migration (v_timeline governance join repoint — jira_key -> github_repo, Level 1)
