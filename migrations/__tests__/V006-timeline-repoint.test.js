/**
 * V006 timeline-repoint guard (CR-03).
 *
 * Static assertions over migrations/V006__timeline_repoint.sql — no database needed, so it runs as
 * plain CommonJS (same convention as V004/V005 guards). Behavioural verification (view actually
 * repointed, linked/unlinked surfacing) is covered by the packages/gates + packages/reporting
 * service/handler tests against mocked queries.
 *
 * Guards the CR-03 scope: v_timeline source-1 join repointed jira_key -> github_repo with the
 * collision-safe interim fallback, V003 column contract preserved, macro stays app-owned.
 */
const fs = require('fs');
const path = require('path');

const V006 = fs.readFileSync(path.join(__dirname, '..', 'V006__timeline_repoint.sql'), 'utf8');

// Strip line comments so keyword scans match real DDL, not the explanatory header.
const ddl = V006.split('\n')
  .map((line) => {
    const i = line.indexOf('--');
    return i === -1 ? line : line.slice(0, i);
  })
  .join('\n');
const ddlNorm = ddl.replace(/\s+/g, ' ');
const ddlUpper = ddlNorm.toUpperCase();

describe('V006 — v_timeline governance join repoint (CR-03)', () => {
  test('recreates the view (DROP VIEW IF EXISTS + CREATE VIEW)', () => {
    expect(ddl).toMatch(/DROP VIEW IF EXISTS\s+v_timeline/i);
    expect(ddl).toMatch(/CREATE VIEW\s+v_timeline\s+AS/i);
  });

  test('source-1 joins governance_events on projects.github_repo', () => {
    expect(ddlNorm).toContain('FROM governance_events ge JOIN projects p ON p.github_repo = ge.project_id');
  });

  test('keeps the collision-safe interim jira_key fallback branch', () => {
    expect(ddlNorm).toContain('OR (p.github_repo IS NULL AND p.jira_key = ge.project_id)');
  });

  test('emits p.jira_key AS project_id so downstream stays jira_key-keyed', () => {
    expect(ddlNorm).toContain('p.jira_key AS project_id');
  });

  test('does NOT keep the pre-repoint source-1 jira_key join', () => {
    // The ONLY jira_key join on governance_events must be the guarded NULL-fallback branch,
    // never a bare `p.jira_key = ge.project_id` as the primary predicate.
    expect(ddlNorm).not.toContain('JOIN projects p ON p.jira_key = ge.project_id');
  });

  test('preserves the V003 column contract (11 source-1 output columns)', () => {
    for (const col of [
      'project_id',
      'project_title',
      'event_type',
      'event_id',
      'event_timestamp',
      'phase',
      'phase_name',
      'title',
      'actor',
      'detail',
      'sub_type',
    ]) {
      expect(ddl).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  test('macro stays app-owned — no governance -> macro_checkpoints write path', () => {
    // The view is read-only; it must not UPDATE reached_at from a governance row.
    expect(ddlUpper).not.toContain('UPDATE MACRO_CHECKPOINTS');
    // Source 2 (macro_checkpoints) remains gated on reached_at.
    expect(ddl).toMatch(/mc\.reached_at IS NOT NULL/i);
  });
});
