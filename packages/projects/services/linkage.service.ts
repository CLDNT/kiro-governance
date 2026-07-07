/**
 * Linkage service — shared helpers for the CR-02 GitHub ↔ dual-Slack linkage feature.
 * Covers admin/leadership-only authorization, cross-column collision guard, and the
 * Postgres unique-violation → 409 mapper. See specs/phase2/CR-02-projects-api-linkage-spec.md §5, §6.4.
 */

import { AuthContext } from '@kiro-governance/shared/types/auth';
import { AppError, ForbiddenError } from '@kiro-governance/shared/middleware/error-handler';
import { LINKAGE_FIELDS } from '../types';

/** Roles permitted to set/clear any linkage field (projects-architecture §12.1). */
const LINKAGE_ROLES: ReadonlyArray<AuthContext['role']> = ['admin', 'leadership'];

/** Minimal query surface accepted by the collision guard (Pool or PoolClient). */
export interface Queryable {
  query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
}

/**
 * True if the request body contains at least one linkage key — even if its value is null.
 * Presence-keyed so that a clear attempt (`{ github_repo: null }`) also counts as touching linkage.
 */
export function touchesLinkage(input: object): boolean {
  return LINKAGE_FIELDS.some((f) => f in input);
}

/**
 * Enforce §12.1: only admin/leadership may set/clear a linkage field.
 * Reads the Cognito-derived role (auth.role), never the free-text project_manager.
 * Throws ForbiddenError (code FORBIDDEN, 403) otherwise.
 */
export function assertLinkageAuthz(input: object, auth: AuthContext): void {
  if (touchesLinkage(input) && !LINKAGE_ROLES.includes(auth.role)) {
    throw new ForbiddenError('Only admin or leadership may change project linkage');
  }
}

/**
 * Map a Postgres unique-violation on uq_projects_github_repo to 409 DUPLICATE_GITHUB_REPO.
 * Re-throws any other error unchanged. Never returns.
 */
export function mapPgUniqueViolation(err: unknown): never {
  const e = err as { code?: string; constraint?: string };
  if (e?.code === '23505' && e.constraint === 'uq_projects_github_repo') {
    throw new AppError('DUPLICATE_GITHUB_REPO', 'github_repo is already linked to another project', 409);
  }
  throw err;
}

/**
 * SEC-M4 cross-column guard: reject a github_repo that equals ANY project's jira_key.
 * Keeps the interim collision-safe timeline join injective. `selfJiraKey` excludes the
 * row being updated. Throws 409 DUPLICATE_GITHUB_REPO on collision.
 */
export async function assertNoCrossColumnCollision(
  db: Queryable,
  githubRepo: string,
  selfJiraKey?: string,
): Promise<void> {
  const res = await db.query(
    `SELECT 1 FROM projects WHERE jira_key = $1 AND ($2::text IS NULL OR jira_key <> $2) LIMIT 1`,
    [githubRepo, selfJiraKey ?? null],
  );
  if (res.rows.length > 0) {
    throw new AppError('DUPLICATE_GITHUB_REPO', 'github_repo collides with an existing project key', 409);
  }
}
