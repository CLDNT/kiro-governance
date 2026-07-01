/**
 * DEPRECATED — Replaced by postgres.service.ts
 *
 * This file was previously used for DynamoDB-based event persistence.
 * As of 2026-06-24, all governance events are persisted to RDS PostgreSQL.
 *
 * See docs/phase1/data-persistence-architecture.md v2.0 for details.
 * 
 * @deprecated Use postgres.service.ts instead
 */

export function getDynamoDBClient() {
  throw new Error('getDynamoDBClient is deprecated. Use PostgreSQL via postgres.service.ts');
}

export function buildIdempotencyKey() {
  throw new Error('buildIdempotencyKey is deprecated. Use postgres.service.ts');
}

export async function attemptDedupSentinel() {
  throw new Error('attemptDedupSentinel is deprecated. Use postgres.service.ts with ON CONFLICT');
}

export async function writeGovernanceEvent() {
  throw new Error('writeGovernanceEvent is deprecated. Use postgres.service.ts');
}
