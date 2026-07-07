import { Signer } from '@aws-sdk/rds-signer';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { GovernanceEventRecord } from '@kiro-governance/shared/types/governance-event';

let pool: Pool | null = null;
let tokenExpiry = 0;
let signer: Signer | null = null;

/**
 * Initialize RDS Signer for IAM authentication.
 * Called once at server startup.
 */
function initSigner(): Signer {
  if (!signer) {
    signer = new Signer({
      hostname: process.env.DB_ENDPOINT!,
      port: Number(process.env.DB_PORT!),
      username: process.env.DB_USER!,
      region: process.env.AWS_REGION!,
    });
  }
  return signer;
}

/**
 * Get or create database connection pool with IAM token.
 * Refreshes token if within 1 minute of expiry (14-minute refresh window).
 * Per F-04 §8: Token TTL is 15 minutes, refresh at 14 minutes.
 */
async function getPool(): Promise<Pool> {
  const now = Date.now();

  // Refresh token if within 1 min of expiry or first call
  if (now >= tokenExpiry) {
    const signer_ = initSigner();
    const token = await signer_.getAuthToken();
    tokenExpiry = now + 14 * 60 * 1000; // 14 minutes from now

    if (pool) {
      await pool.end();
    }

    pool = new Pool({
      host: process.env.DB_ENDPOINT!,
      port: Number(process.env.DB_PORT!),
      database: process.env.DB_NAME!,
      user: process.env.DB_USER!,
      password: token,
      ssl: {
        rejectUnauthorized: true,
        ca: readFileSync(process.env.RDS_CA_BUNDLE_PATH || '/opt/kiro-governance/rds-ca-bundle.pem', 'utf8'),
      },
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }

  return pool!;
}

/**
 * A project row resolved from a GitHub repository name.
 *
 * The column set is scoped to exactly the CR-01A column-scoped `SELECT` grant on
 * `projects` — `GRANT SELECT (jira_key, github_repo, slack_micro_channel_id,
 * slack_macro_channel_id) ON projects TO kiro_mcp_app` (change-request v3 §F / §5.4;
 * iam-review Finding 2 moved the runtime grant off the RDS master `kiro_mcp` onto the
 * dedicated non-master runtime role `kiro_mcp_app`). Do NOT add `id`, `title`, or any
 * other column here beyond those the hardened runtime role is granted, or the query
 * would cause a permission-denied error.
 *
 * - `jira_key` labels notifications (`[DP-001] …`) and confirms the link exists.
 * - `slack_micro_channel_id` / `slack_macro_channel_id` are non-secret Slack
 *   channel ids (nullable) used by `notify_slack` dual-channel routing (CR-09).
 */
export interface ProjectRow {
  jira_key: string;
  slack_micro_channel_id: string | null;
  slack_macro_channel_id: string | null;
}

/**
 * Resolve a GitHub repository name to its linked project.
 * See mcp-server-core-architecture.md §3.2 / change-request v3 §E, §G.
 *
 * Used by BOTH:
 *   - `record_progress` (CR-08 no-orphan): only the truthiness of the result
 *     matters — a match means the event may be stored.
 *   - `notify_slack` (CR-09 dual-channel routing): reads `jira_key` for the
 *     message label and the per-event-type channel id for routing.
 *
 * Returns the matching project row, or null if no project is linked to the repo.
 * `github_repo` carries a partial unique index, so at most one row can match.
 */
export async function resolveProject(repoName: string): Promise<ProjectRow | null> {
  try {
    const db = await getPool();

    const result = await db.query<ProjectRow>(
      `SELECT jira_key, slack_micro_channel_id, slack_macro_channel_id
         FROM projects
        WHERE github_repo = $1
        LIMIT 1`,
      [repoName],
    );

    return result.rows[0] ?? null;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Repo name is safe to log internally; it is never surfaced to the caller.
    console.error('[postgres.service] resolveProject failed', { error, repo: repoName });
    throw err;
  }
}

/**
 * Write a governance event to PostgreSQL.
 * Uses INSERT ... ON CONFLICT (idempotency_key) DO NOTHING for atomic deduplication.
 * Per F-04 §5.2.
 *
 * Returns:
 *   { written: true } if new event inserted
 *   { written: false, reason: 'duplicate' } if event with same idempotency_key exists
 */
export async function writeGovernanceEvent(
  record: GovernanceEventRecord,
  idempotencyKey: string,
): Promise<{ written: boolean; reason?: string }> {
  try {
    const db = await getPool();

    const result = await db.query(
      `INSERT INTO governance_events
         (project_id, update_text, type, flag_override, gate, phase, phase_name, event_code, source_ref, actor, idempotency_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        record.project_id,
        record.update_text,
        record.type,
        record.flag_override ?? null,
        record.gate ?? null,
        record.phase ?? null,
        record.phase_name ?? null,
        record.event_code ?? null,
        record.source_ref,
        record.actor,
        idempotencyKey,
        record.created_at,
      ],
    );

    if (result.rowCount === 0) {
      return { written: false, reason: 'duplicate' };
    }

    return { written: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[postgres.service] writeGovernanceEvent failed', { error, projectId: record.project_id });
    throw err;
  }
}
