/**
 * V005 append-only-hardening guard (CR-01A).
 *
 * Static assertions over migrations/V005__append_only_hardening.sql. Mirrors the CR-01 pattern
 * (V004-additive-scope.test.js): needs no database, so it runs in the repo's (unconfigured) Jest
 * without a ts-jest transform. Deeper behavioural verification (roles created, ownership actually
 * reassigned, kiro_mcp_app really has no UPDATE/DELETE, kiro_phase2 read-only on events) is done by
 * migrations/verify/V005__verify.sql against an ephemeral Postgres 16.
 *
 * Written as CommonJS .test.js on purpose: the repo has no jest.config / ts-jest preset, so a plain
 * JS test is guaranteed to execute under `npm test`.
 */
const fs = require('fs');
const path = require('path');

const RAW = fs.readFileSync(
  path.join(__dirname, '..', 'V005__append_only_hardening.sql'),
  'utf8',
);

// Strip line comments so keyword scans match real DDL, not the explanatory header/notes/ops-prereq.
const ddl = RAW.split('\n')
  .map((line) => {
    const i = line.indexOf('--');
    return i === -1 ? line : line.slice(0, i);
  })
  .join('\n');
const ddlUpper = ddl.toUpperCase();

// Lines that are real GRANT statements mentioning the non-master runtime role kiro_mcp_app
// (comment-stripped). This is where every runtime grant must live post-fix (iam-review Finding 2).
const mcpAppGrantLines = ddl
  .split('\n')
  .filter((l) => /\bGRANT\b/i.test(l) && /\bkiro_mcp_app\b/.test(l));

describe('V005 — roles (F.1)', () => {
  test('creates kiro_migrator as a NOLOGIN NOINHERIT owner role, guarded', () => {
    expect(ddl).toMatch(/CREATE ROLE\s+kiro_migrator\s+NOLOGIN\s+NOINHERIT/i);
    // guarded by an existence check (idempotent)
    expect(ddl).toMatch(/pg_roles\s+WHERE\s+rolname\s*=\s*'kiro_migrator'/i);
  });

  test('creates the DEDICATED non-master runtime role kiro_mcp_app as LOGIN NOSUPERUSER NOINHERIT, guarded', () => {
    // The crux of the iam-review Finding 2 fix: a distinct NOSUPERUSER runtime role so grants bite.
    expect(ddl).toMatch(/CREATE ROLE\s+kiro_mcp_app\s+LOGIN\s+NOSUPERUSER\s+NOINHERIT/i);
    expect(ddl).toMatch(/pg_roles\s+WHERE\s+rolname\s*=\s*'kiro_mcp_app'/i);
  });

  test('still guards the master proxy kiro_mcp and the phase-2 role kiro_phase2', () => {
    expect(ddl).toMatch(/CREATE ROLE\s+kiro_mcp\s+LOGIN/i);
    expect(ddl).toMatch(/CREATE ROLE\s+kiro_phase2\s+LOGIN/i);
    expect(ddl).toMatch(/pg_roles\s+WHERE\s+rolname\s*=\s*'kiro_mcp'/i);
    expect(ddl).toMatch(/pg_roles\s+WHERE\s+rolname\s*=\s*'kiro_phase2'/i);
  });

  test('rds_iam grant targets the runtime role kiro_mcp_app (not the master) and is guarded', () => {
    expect(ddl).toMatch(/pg_roles\s+WHERE\s+rolname\s*=\s*'rds_iam'/i);
    expect(ddl).toMatch(/GRANT\s+rds_iam\s+TO\s+kiro_mcp_app/i);
  });

  test('defensively revokes owner-role membership from the runtime roles (SEC-H1)', () => {
    expect(ddl).toMatch(/REVOKE\s+kiro_migrator\s+FROM\s+kiro_mcp_app/i);
    expect(ddl).toMatch(/REVOKE\s+kiro_migrator\s+FROM\s+kiro_phase2/i);
  });
});

describe('V005 — ownership reassignment (F.2)', () => {
  test('reassigns the core governance/linkage tables to kiro_migrator', () => {
    for (const t of [
      'governance_events',
      'projects',
      'project_link_audit',
      'micro_artifact_mapping',
    ]) {
      expect(ddl).toMatch(
        new RegExp(`ALTER TABLE\\s+IF EXISTS\\s+${t}\\s+OWNER TO kiro_migrator`, 'i'),
      );
    }
  });

  test('reassigns sequences and views to kiro_migrator', () => {
    expect(ddl).toMatch(/ALTER SEQUENCE\s+IF EXISTS\s+governance_events_id_seq\s+OWNER TO kiro_migrator/i);
    expect(ddl).toMatch(/ALTER VIEW\s+IF EXISTS\s+v_timeline\s+OWNER TO kiro_migrator/i);
  });

  test('includes a dynamic safety sweep for any object missed by the explicit list', () => {
    expect(ddl).toMatch(/format\(\s*'ALTER TABLE public\.%I OWNER TO kiro_migrator'/i);
    expect(ddl).toMatch(/format\(\s*'ALTER SEQUENCE public\.%I OWNER TO kiro_migrator'/i);
    expect(ddl).toMatch(/tableowner\s*<>\s*'kiro_migrator'/i);
  });
});

describe('V005 — kiro_mcp_app least privilege / append-only (F.3)', () => {
  test('strips residual table + sequence privileges from kiro_mcp_app first', () => {
    expect(ddl).toMatch(/REVOKE ALL ON ALL TABLES\s+IN SCHEMA public FROM kiro_mcp_app/i);
    expect(ddl).toMatch(/REVOKE ALL ON ALL SEQUENCES\s+IN SCHEMA public FROM kiro_mcp_app/i);
  });

  test('also strips any stale runtime grants from the master kiro_mcp (collision cleanup)', () => {
    expect(ddl).toMatch(/REVOKE ALL ON ALL TABLES\s+IN SCHEMA public FROM kiro_mcp\b/i);
    expect(ddl).toMatch(/REVOKE ALL ON ALL SEQUENCES\s+IN SCHEMA public FROM kiro_mcp\b/i);
  });

  test('grants kiro_mcp_app exactly INSERT + SELECT on governance_events (append-only)', () => {
    expect(ddl).toMatch(/GRANT INSERT, SELECT ON governance_events\s+TO kiro_mcp_app/i);
    expect(ddl).toMatch(/GRANT USAGE,\s*SELECT ON SEQUENCE governance_events_id_seq\s+TO kiro_mcp_app/i);
  });

  test('grants kiro_mcp_app only column-scoped SELECT on projects (no table-wide, no write)', () => {
    expect(ddl).toMatch(
      /GRANT SELECT \(github_repo, jira_key, slack_micro_channel_id, slack_macro_channel_id, id, title\)[\s\S]*?ON projects TO kiro_mcp_app/i,
    );
  });

  test('NEVER grants UPDATE or DELETE to kiro_mcp_app (append-only invariant)', () => {
    expect(mcpAppGrantLines.length).toBeGreaterThan(0); // sanity: runtime grants really moved here
    for (const line of mcpAppGrantLines) {
      expect(line).not.toMatch(/\bUPDATE\b/i);
      expect(line).not.toMatch(/\bDELETE\b/i);
    }
  });

  test('NEVER grants any runtime table/sequence privilege to the master kiro_mcp (iam-review Finding 2)', () => {
    // No real GRANT line may target the bare master role kiro_mcp (only kiro_mcp_app / kiro_phase2).
    // \bkiro_mcp\b does not match kiro_mcp_app (the trailing _ is a word char), so this isolates the master.
    for (const line of ddl.split('\n')) {
      if (/\bGRANT\b/i.test(line) && /\bkiro_mcp\b/.test(line)) {
        // The only permissible GRANT touching the master is nothing — assert there are none.
        throw new Error(`Unexpected GRANT to master kiro_mcp: ${line.trim()}`);
      }
    }
  });

  test('grants kiro_mcp_app NOTHING on micro_artifact_mapping (PLAN-L2)', () => {
    for (const line of ddl.split('\n')) {
      if (/micro_artifact_mapping/.test(line) && /\bkiro_mcp_app\b/.test(line)) {
        expect(line).not.toMatch(/\bGRANT\b/i);
      }
    }
  });
});

describe('V005 — kiro_phase2 app DML retained, events read-only (F.4)', () => {
  test('grants kiro_phase2 DeliverPro DML', () => {
    expect(ddl).toMatch(/GRANT\s+SELECT, INSERT, UPDATE, DELETE ON ALL TABLES\s+IN SCHEMA public TO kiro_phase2/i);
    expect(ddl).toMatch(/GRANT\s+USAGE, SELECT ON ALL SEQUENCES\s+IN SCHEMA public TO kiro_phase2/i);
  });

  test('keeps governance_events read-only for the app (append-only for app too)', () => {
    expect(ddl).toMatch(/REVOKE INSERT, UPDATE, DELETE ON governance_events FROM kiro_phase2/i);
    expect(ddl).toMatch(/GRANT\s+SELECT\s+ON governance_events TO\s+kiro_phase2/i);
  });
});

describe('V005 — default privileges + schema lockdown (F.5)', () => {
  test('closes future tables/sequences to kiro_mcp_app via ALTER DEFAULT PRIVILEGES', () => {
    expect(ddl).toMatch(
      /ALTER DEFAULT PRIVILEGES FOR ROLE kiro_migrator IN SCHEMA public\s+REVOKE ALL ON TABLES FROM kiro_mcp_app/i,
    );
    expect(ddl).toMatch(
      /ALTER DEFAULT PRIVILEGES FOR ROLE kiro_migrator IN SCHEMA public\s+REVOKE ALL ON SEQUENCES FROM kiro_mcp_app/i,
    );
  });

  test('revokes CREATE on schema public from PUBLIC and the non-master runtime role (SEC-L9)', () => {
    expect(ddl).toMatch(/REVOKE CREATE ON SCHEMA public FROM PUBLIC/i);
    expect(ddl).toMatch(/REVOKE CREATE ON SCHEMA public FROM kiro_mcp_app/i);
  });
});

describe('V005 — ops prerequisite is documented (SEC-H1)', () => {
  test('flags that append-only is NOT enforced while MCP connects as the RDS master', () => {
    // These live in the header comment block, so assert against the RAW (un-stripped) file.
    expect(RAW).toMatch(/master/i);
    expect(RAW).toMatch(/NOT\s+enforced/i);
    expect(RAW).toMatch(/repoint/i);
  });

  test('documents the mandatory pre-implementation ownership & role audit', () => {
    expect(RAW).toMatch(/pre-implementation/i);
    expect(RAW).toMatch(/pg_tables/i);
    expect(RAW).toMatch(/pg_auth_members/i);
  });

  test('documents the GATE 2 positive live-session connection check (SEC review L1)', () => {
    // Post-cutover check that the LIVE MCP session authenticates as the non-master runtime role.
    expect(RAW).toMatch(/pg_stat_activity/i);
    expect(RAW).toMatch(/usename/i);
  });
});

describe('V005 — explicit rollback section (documented, not executed)', () => {
  test('includes a ROLLBACK section reversing ownership + restoring the V001 grant', () => {
    expect(RAW).toMatch(/ROLLBACK/i);
    // Reverse ownership back to the runtime role and restore the broad DB grant, both commented out.
    expect(RAW).toMatch(/OWNER TO kiro_mcp/i);
    expect(RAW).toMatch(/GRANT ALL PRIVILEGES ON DATABASE kiro_governance TO kiro_mcp/i);
  });

  test('the rollback statements are commented out (never executed by the migration)', () => {
    // Every rollback DDL line must be comment-prefixed, so the comment-stripped DDL body must NOT
    // contain the reverse ownership/grant statements.
    expect(ddl).not.toMatch(/OWNER TO kiro_mcp/i);
    expect(ddl).not.toMatch(/GRANT ALL PRIVILEGES ON DATABASE kiro_governance TO kiro_mcp/i);
    expect(ddlUpper).not.toMatch(/DROP\s+ROLE/);
  });
});

describe('V005 — scope boundary (OUT of CR-01A must NOT appear)', () => {
  test('no additive schema DDL (that is V004)', () => {
    expect(ddlUpper).not.toMatch(/ADD COLUMN/);
    expect(ddlUpper).not.toMatch(/CREATE\s+TABLE\b/);
    expect(ddlUpper).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/);
    expect(ddlUpper).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/);
  });

  test('no v_timeline view repoint (belongs to the timeline-reconciliation migration)', () => {
    // ALTER VIEW ... OWNER TO is allowed (ownership); DROP/CREATE VIEW is the repoint and is OUT.
    expect(ddlUpper).not.toMatch(/DROP\s+VIEW/);
    expect(ddlUpper).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?VIEW/);
  });

  test('no destructive drops of tables/indexes', () => {
    expect(ddlUpper).not.toMatch(/DROP\s+TABLE/);
    expect(ddlUpper).not.toMatch(/DROP\s+INDEX/);
  });
});
