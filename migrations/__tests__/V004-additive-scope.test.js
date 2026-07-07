/**
 * V004 additive-scope guard (CR-01).
 *
 * Static assertions over migrations/V004__github_slack_linkage.sql. This is the automated guard for
 * the CR-01 scope boundary — it needs no database, so it runs in the repo's (unconfigured) Jest
 * without a ts-jest transform. Deeper behavioural verification (columns/indexes/triggers actually
 * created, idempotent re-run) is done by migrations/verify/V004__verify.sql against an ephemeral
 * Postgres 16 — see the spec's "Verification Approach".
 *
 * Written as CommonJS .test.js on purpose: the repo has no jest.config / ts-jest preset, so a plain
 * JS test is guaranteed to execute under `npm test`.
 */
const fs = require('fs');
const path = require('path');

const V004 = fs.readFileSync(
  path.join(__dirname, '..', 'V004__github_slack_linkage.sql'),
  'utf8',
);

// Strip line comments so keyword scans match real DDL, not the explanatory header/notes.
const ddl = V004.split('\n')
  .map((line) => {
    const i = line.indexOf('--');
    return i === -1 ? line : line.slice(0, i);
  })
  .join('\n');
const ddlUpper = ddl.toUpperCase();

// NOTE: V005 (CR-01A append-only hardening) is now IMPLEMENTED — its privilege/ownership/role DDL
// is asserted by migrations/__tests__/V005-append-only-hardening.test.js. This file only guards the
// V004 additive scope boundary (no hardening leaked into V004).

describe('V004 — additive linkage schema (IN scope)', () => {
  test('adds all six nullable linkage columns to projects', () => {
    for (const col of [
      'github_repo',
      'github_url',
      'slack_micro_channel_id',
      'slack_macro_channel_id',
      'updated_by',
      'updated_at',
    ]) {
      expect(ddl).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${col}\\b`, 'i'));
    }
  });

  test('creates the partial unique index on github_repo', () => {
    expect(ddl).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS\s+uq_projects_github_repo/i);
    expect(ddl).toMatch(/WHERE\s+github_repo\s+IS\s+NOT\s+NULL/i);
  });

  test('creates project_link_audit table + index with the audited fields', () => {
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS\s+project_link_audit/i);
    expect(ddl).toMatch(/REFERENCES\s+projects\s*\(\s*jira_key\s*\)/i);
    expect(ddl).toMatch(/CREATE INDEX IF NOT EXISTS\s+idx_project_link_audit_project/i);
  });

  test('creates the per-field BEFORE UPDATE audit trigger (IS DISTINCT FROM)', () => {
    expect(ddl).toMatch(/CREATE OR REPLACE FUNCTION\s+trg_audit_project_linkage\s*\(/i);
    expect(ddl).toMatch(/BEFORE UPDATE ON projects FOR EACH ROW/i);
    expect(ddl).toMatch(/IS DISTINCT FROM/i);
    // one branch per linkage field
    expect((ddl.match(/IS DISTINCT FROM/gi) || []).length).toBe(4);
  });

  test('creates the AFTER INSERT create-path audit trigger (SEC-M5)', () => {
    expect(ddl).toMatch(/CREATE OR REPLACE FUNCTION\s+trg_audit_project_linkage_insert\s*\(/i);
    expect(ddl).toMatch(/AFTER INSERT ON projects FOR EACH ROW/i);
  });

  test('creates the INERT micro_artifact_mapping table with no seed rows', () => {
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS\s+micro_artifact_mapping/i);
    expect(ddl).toMatch(/uq_micro_artifact_mapping/i);
    // INERT => the file must not INSERT any seed rows into the mapping table
    expect(ddlUpper).not.toMatch(/INSERT\s+INTO\s+MICRO_ARTIFACT_MAPPING/);
  });
});

describe('V004 — idempotency', () => {
  test('every table/index create is guarded', () => {
    for (const m of ddl.match(/CREATE TABLE[^;]*/gi) || []) {
      expect(m).toMatch(/IF NOT EXISTS/i);
    }
    for (const m of ddl.match(/CREATE (UNIQUE )?INDEX[^;]*/gi) || []) {
      expect(m).toMatch(/IF NOT EXISTS/i);
    }
  });

  test('column adds are guarded and triggers are drop-then-create', () => {
    for (const m of ddl.match(/ADD COLUMN[^,;]*/gi) || []) {
      expect(m).toMatch(/IF NOT EXISTS/i);
    }
    for (const m of ddl.match(/CREATE TRIGGER\s+(\w+)/gi) || []) {
      const name = m.split(/\s+/)[2];
      expect(ddl).toMatch(new RegExp(`DROP TRIGGER IF EXISTS\\s+${name}\\b`, 'i'));
    }
  });
});

describe('V004 — scope boundary (OUT of CR-01 must NOT appear)', () => {
  test('no append-only ownership/GRANT hardening (belongs to CR-01A)', () => {
    expect(ddlUpper).not.toMatch(/\bALTER\s+TABLE\b[^;]*\bOWNER\s+TO\b/);
    expect(ddlUpper).not.toMatch(/\bALTER\s+SEQUENCE\b[^;]*\bOWNER\s+TO\b/);
    expect(ddlUpper).not.toMatch(/\bGRANT\b/);
    expect(ddlUpper).not.toMatch(/\bREVOKE\b/);
    expect(ddlUpper).not.toMatch(/ALTER\s+DEFAULT\s+PRIVILEGES/);
    expect(ddlUpper).not.toMatch(/CREATE\s+ROLE/);
  });

  test('no v_timeline view repoint (belongs to timeline reconciliation, not CR-01)', () => {
    expect(ddlUpper).not.toMatch(/DROP\s+VIEW/);
    expect(ddlUpper).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?VIEW/);
  });

  test('no event_code column added to governance_events (Phase-1 CR-14)', () => {
    expect(ddlUpper).not.toMatch(/GOVERNANCE_EVENTS[^;]*EVENT_CODE/);
  });
});
