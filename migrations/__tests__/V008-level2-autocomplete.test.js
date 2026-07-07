/**
 * V008 Level-2 auto-completion guard (CR-12/14).
 *
 * Static assertions over migrations/V008__level2_micro_artifact_autocomplete.sql. Mirrors the
 * CR-01/CR-01A pattern (V004/V005 tests): needs no database, runs under `npm test` without a
 * ts-jest transform. Deeper behavioural + privilege verification (columns/seed/grants actually
 * applied; kiro_mcp_app really has no Level-2 privilege) is done by migrations/verify/V008__verify.sql
 * against an ephemeral Postgres 16.
 */
const fs = require('fs');
const path = require('path');

const RAW = fs.readFileSync(
  path.join(__dirname, '..', 'V008__level2_micro_artifact_autocomplete.sql'),
  'utf8',
);

// Strip line comments so keyword scans match real DDL, not the explanatory header/notes.
const ddl = RAW.split('\n')
  .map((line) => {
    const i = line.indexOf('--');
    return i === -1 ? line : line.slice(0, i);
  })
  .join('\n');
const ddlUpper = ddl.toUpperCase();

// Real GRANT lines mentioning the append-only MCP runtime role (comment-stripped).
const mcpAppGrantLines = ddl
  .split('\n')
  .filter((l) => /\bGRANT\b/i.test(l) && /\bkiro_mcp_app\b/.test(l));

describe('V008 — (A) governance_events.event_code (CR-14)', () => {
  test('adds the nullable event_code column, guarded', () => {
    expect(ddl).toMatch(/ALTER TABLE IF EXISTS\s+governance_events\s+ADD COLUMN IF NOT EXISTS\s+event_code\s+TEXT/i);
  });

  test('creates the partial index on (project_id, event_code)', () => {
    expect(ddl).toMatch(/CREATE INDEX IF NOT EXISTS\s+idx_governance_events_event_code/i);
    expect(ddl).toMatch(/WHERE\s+event_code\s+IS\s+NOT\s+NULL/i);
  });
});

describe('V008 — (B) micro_artifacts.manual_override (CR-12)', () => {
  test('adds a NOT NULL BOOLEAN DEFAULT false column, guarded', () => {
    expect(ddl).toMatch(
      /ALTER TABLE IF EXISTS\s+micro_artifacts\s+ADD COLUMN IF NOT EXISTS\s+manual_override\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+false/i,
    );
  });
});

describe('V008 — (C) seed micro_artifact_mapping', () => {
  test('inserts into micro_artifact_mapping with ON CONFLICT DO NOTHING', () => {
    expect(ddl).toMatch(/INSERT INTO micro_artifact_mapping\s*\(event_code, project_type, phase, artifact_name, is_active\)/i);
    expect(ddl).toMatch(/ON CONFLICT \(event_code, project_type, phase\) DO NOTHING/i);
  });

  test('seeds exactly the 16 CASDM codes, all project_type default + is_active true', () => {
    const codes = (ddl.match(/'casdm\.p[0-4]\.[a-z0-9_]+'/g) || []).map((s) => s.replace(/'/g, ''));
    // 16 unique codes in the VALUES list.
    expect(new Set(codes).size).toBe(16);
    // Every seeded row carries 'default' and true (spot-check row shape).
    const valueRows = ddl.match(/\('casdm\.[^\n]+/g) || [];
    expect(valueRows.length).toBe(16);
    for (const row of valueRows) {
      expect(row).toMatch(/'default'/);
      expect(row).toMatch(/true/);
    }
  });
});

describe('V008 — (D) micro_artifact_audit append-only trail', () => {
  test('creates the audit table guarded, with the action CHECK', () => {
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS\s+micro_artifact_audit/i);
    expect(ddl).toMatch(/action\s+TEXT\s+NOT NULL\s+CHECK \(action IN \('auto_complete', 'manual_override', 'reverse'\)\)/i);
    expect(ddl).toMatch(/REFERENCES\s+projects\s*\(\s*jira_key\s*\)/i);
    expect(ddl).toMatch(/CREATE INDEX IF NOT EXISTS\s+idx_micro_artifact_audit_project/i);
  });

  test('is owned by the non-runtime migrator role', () => {
    expect(ddl).toMatch(/ALTER TABLE\s+IF EXISTS\s+micro_artifact_audit\s+OWNER TO kiro_migrator/i);
    expect(ddl).toMatch(/ALTER SEQUENCE\s+IF EXISTS\s+micro_artifact_audit_id_seq\s+OWNER TO kiro_migrator/i);
  });
});

describe('V008 — (E) grants: app performs Level 2, MCP stays append-only', () => {
  test('grants kiro_phase2 SELECT on the mapping', () => {
    expect(ddl).toMatch(/GRANT SELECT\s+ON micro_artifact_mapping TO kiro_phase2/i);
  });

  test('grants kiro_phase2 SELECT, UPDATE on micro_artifacts (auto-complete)', () => {
    expect(ddl).toMatch(/GRANT SELECT, UPDATE\s+ON micro_artifacts\s+TO kiro_phase2/i);
  });

  test('grants kiro_phase2 INSERT, SELECT on the audit table (append-only audit)', () => {
    expect(ddl).toMatch(/GRANT INSERT, SELECT\s+ON micro_artifact_audit\s+TO kiro_phase2/i);
  });

  test('REVOKES ALL from kiro_mcp_app on all three Level-2 tables', () => {
    expect(ddl).toMatch(/REVOKE ALL ON micro_artifact_mapping FROM kiro_mcp_app/i);
    expect(ddl).toMatch(/REVOKE ALL ON micro_artifacts\s+FROM kiro_mcp_app/i);
    expect(ddl).toMatch(/REVOKE ALL ON micro_artifact_audit\s+FROM kiro_mcp_app/i);
  });

  test('APPEND-ONLY INVARIANT: NEVER grants kiro_mcp_app anything (no GRANT ... TO kiro_mcp_app)', () => {
    expect(mcpAppGrantLines).toHaveLength(0);
  });
});

describe('V008 — scope boundary', () => {
  test('does not create/alter roles (that is V005)', () => {
    expect(ddlUpper).not.toMatch(/CREATE\s+ROLE/);
    expect(ddlUpper).not.toMatch(/ALTER\s+ROLE/);
  });

  test('no destructive DDL', () => {
    expect(ddlUpper).not.toMatch(/DROP\s+TABLE/);
    expect(ddlUpper).not.toMatch(/DROP\s+INDEX/);
    expect(ddlUpper).not.toMatch(/DROP\s+COLUMN/);
    expect(ddlUpper).not.toMatch(/DROP\s+ROLE/);
  });
});

describe('V008 — idempotency', () => {
  test('every table/index create is guarded', () => {
    for (const m of ddl.match(/CREATE TABLE[^;]*/gi) || []) {
      expect(m).toMatch(/IF NOT EXISTS/i);
    }
    for (const m of ddl.match(/CREATE (UNIQUE )?INDEX[^;]*/gi) || []) {
      expect(m).toMatch(/IF NOT EXISTS/i);
    }
  });

  test('column adds are guarded and the seed uses ON CONFLICT', () => {
    for (const m of ddl.match(/ADD COLUMN[^,;]*/gi) || []) {
      expect(m).toMatch(/IF NOT EXISTS/i);
    }
    expect(ddl).toMatch(/ON CONFLICT[^;]*DO NOTHING/i);
  });
});
