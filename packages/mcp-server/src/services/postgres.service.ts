import { Signer } from '@aws-sdk/rds-signer';
import { Pool } from 'pg';
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
      ssl: { rejectUnauthorized: true },
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }

  return pool!;
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
         (project_id, update_text, type, flag_override, gate, phase, source_ref, actor, idempotency_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        record.project_id,
        record.update_text,
        record.type,
        record.flag_override ?? null,
        record.gate ?? null,
        record.phase ?? null,
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
