/**
 * V007 fresh-start cleanup guard (CR-17).
 *
 * Static assertions over migrations/V007__fresh_start_cleanup.sql (+ verify scripts) — no
 * database is touched. Mirrors the existing V006-timeline-repoint.test.js pattern: read the SQL
 * as text and validate the destructive predicate, template/append-only preservation, the
 * non-auto-run guard, and the safety documentation. The SQL is NEVER executed here.
 */
const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '..');
const V007 = fs.readFileSync(path.join(migrationsDir, 'V007__fresh_start_cleanup.sql'), 'utf8');
const PREFLIGHT = fs.readFileSync(path.join(migrationsDir, 'verify', 'V007__preflight.sql'), 'utf8');
const VERIFY = fs.readFileSync(path.join(migrationsDir, 'verify', 'V007__verify.sql'), 'utf8');

// Strip line comments so keyword scans match real SQL, not the explanatory header.
function stripComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

const ddl = stripComments(V007);
const ddlNorm = ddl.replace(/\s+/g, ' ');
const ddlUpper = ddlNorm.toUpperCase();

describe('V007 — fresh-start cleanup (CR-17), static safety guards', () => {
  test('DELETE predicate is exactly CST-% AND NOT __template__ (template excluded)', () => {
    expect(ddlNorm).toMatch(/DELETE FROM projects WHERE jira_key LIKE 'CST-%' AND jira_key <> '__template__'/i);
  });

  test('the ONLY DELETE targets the projects table (children removed via ON DELETE CASCADE)', () => {
    const deletes = ddlUpper.match(/DELETE FROM \w+/g) || [];
    expect(deletes).toEqual(['DELETE FROM PROJECTS']);
  });

  test('never deletes from governance_events (append-only audit trail preserved)', () => {
    expect(ddlUpper).not.toContain('DELETE FROM GOVERNANCE_EVENTS');
    // and the file documents that governance_events is untouched
    expect(V007).toMatch(/governance_events\s+(untouched|preserved|NOT cascaded)/i);
  });

  test('guarded by kiro.confirm_fresh_start GUC that defaults to a no-op (RETURN when not "yes")', () => {
    expect(ddl).toMatch(/current_setting\(\s*'kiro\.confirm_fresh_start'\s*,\s*true\s*\)/i);
    expect(ddlNorm).toMatch(/IS DISTINCT FROM 'yes' THEN/i);
    expect(ddlNorm).toMatch(/RETURN;/i);
    // the guard check must appear before the DELETE (no-op path precedes destruction)
    expect(ddlNorm.indexOf("IS DISTINCT FROM 'yes'")).toBeLessThan(ddlNorm.indexOf('DELETE FROM projects'));
  });

  test('carries a loud DESTRUCTIVE / DO NOT AUTO-RUN warning header', () => {
    expect(V007).toMatch(/DESTRUCTIVE/i);
    expect(V007).toMatch(/DO NOT AUTO-RUN/i);
  });

  test('carries a rollback note (IRREVERSIBLE / no down-migration)', () => {
    expect(V007).toMatch(/IRREVERSIBLE/i);
    expect(V007).toMatch(/ROLLBACK NOTE/i);
    expect(V007).toMatch(/no down-migration/i);
  });

  test('documents that the default runner must skip it (excluded from V001..V006 set)', () => {
    expect(V007).toMatch(/MUST SKIP|excluded from the ordered|NOT\s+part of the ordered/i);
  });
});

describe('V007 — preflight & verify are read-only', () => {
  for (const [name, sql] of [
    ['preflight', PREFLIGHT],
    ['verify', VERIFY],
  ]) {
    test(`${name} contains no DELETE / UPDATE / INSERT`, () => {
      const body = stripComments(sql).toUpperCase();
      expect(body).not.toMatch(/\bDELETE\b/);
      expect(body).not.toMatch(/\bUPDATE\b/);
      expect(body).not.toMatch(/\bINSERT\b/);
    });

    test(`${name} references the preserved sets (template, DP-%, governance_events)`, () => {
      expect(sql).toContain("'__template__'");
      expect(sql).toContain("DP-%");
      expect(sql).toContain('governance_events');
    });
  }
});
