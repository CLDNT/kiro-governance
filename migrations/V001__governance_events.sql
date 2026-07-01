-- Migration: V001__governance_events
-- Date: 2026-06-24
-- Purpose: Create governance_events table for recording macro/micro governance events
-- with idempotency tracking, project scoping, and performance indexes

CREATE TABLE IF NOT EXISTS governance_events (
  id              BIGSERIAL PRIMARY KEY,
  project_id      TEXT        NOT NULL,
  update_text     TEXT        NOT NULL CHECK (char_length(update_text) <= 4096),
  type            TEXT        NOT NULL CHECK (type IN ('macro', 'micro')),
  flag_override   BOOLEAN,
  gate            TEXT,
  phase           TEXT,
  phase_name      TEXT,
  source_ref      TEXT        NOT NULL,
  actor           TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT        NOT NULL,

  CONSTRAINT uq_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_project_created ON governance_events (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_type_created ON governance_events (type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gate_created ON governance_events (gate, created_at DESC) WHERE gate IS NOT NULL;

-- Initial setup: IAM database user for MCP server
CREATE USER IF NOT EXISTS kiro_mcp;
GRANT rds_iam TO kiro_mcp;
GRANT ALL PRIVILEGES ON DATABASE kiro_governance TO kiro_mcp;
