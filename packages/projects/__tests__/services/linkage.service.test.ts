/**
 * Unit tests for the CR-02 linkage service helpers.
 * See specs/phase2/CR-02-projects-api-linkage-spec.md §5, §6.4, §10.
 */
import { AuthContext } from '@kiro-governance/shared/types/auth';
import { AppError, ForbiddenError } from '@kiro-governance/shared/middleware/error-handler';
import {
  touchesLinkage,
  assertLinkageAuthz,
  mapPgUniqueViolation,
  assertNoCrossColumnCollision,
  Queryable,
} from '../../services/linkage.service';

function auth(role: AuthContext['role']): AuthContext {
  return { userId: 'sub-123', email: 'u@x.com', name: 'U', role, groups: [role] };
}

describe('linkage.service', () => {
  describe('touchesLinkage', () => {
    it('is true when a linkage key is present (even with null value)', () => {
      expect(touchesLinkage({ github_repo: null })).toBe(true);
      expect(touchesLinkage({ slack_micro_channel_id: 'C1' })).toBe(true);
    });

    it('is false when no linkage key is present', () => {
      expect(touchesLinkage({ title: 'x' })).toBe(false);
      expect(touchesLinkage({})).toBe(false);
    });
  });

  describe('assertLinkageAuthz', () => {
    it.each(['pm', 'sa', 'engineer'] as const)('throws FORBIDDEN for role %s touching linkage', (role) => {
      expect(() => assertLinkageAuthz({ github_repo: 'r' }, auth(role))).toThrow(ForbiddenError);
      try {
        assertLinkageAuthz({ github_repo: 'r' }, auth(role));
      } catch (e) {
        expect((e as ForbiddenError).code).toBe('FORBIDDEN');
        expect((e as ForbiddenError).statusCode).toBe(403);
        expect((e as ForbiddenError).message).toBe('Only admin or leadership may change project linkage');
      }
    });

    it('throws FORBIDDEN for a pm clearing a linkage field (presence-keyed)', () => {
      expect(() => assertLinkageAuthz({ github_repo: null }, auth('pm'))).toThrow(ForbiddenError);
    });

    it.each(['admin', 'leadership'] as const)('allows role %s', (role) => {
      expect(() => assertLinkageAuthz({ github_repo: 'r' }, auth(role))).not.toThrow();
    });

    it('does not throw when no linkage field is present, regardless of role', () => {
      expect(() => assertLinkageAuthz({ title: 'x' }, auth('pm'))).not.toThrow();
    });
  });

  describe('mapPgUniqueViolation', () => {
    it('maps 23505 on uq_projects_github_repo to 409 DUPLICATE_GITHUB_REPO', () => {
      try {
        mapPgUniqueViolation({ code: '23505', constraint: 'uq_projects_github_repo' });
        throw new Error('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe('DUPLICATE_GITHUB_REPO');
        expect((e as AppError).statusCode).toBe(409);
      }
    });

    it('re-throws a non-unique error unchanged', () => {
      const other = new Error('boom');
      expect(() => mapPgUniqueViolation(other)).toThrow(other);
    });

    it('re-throws a 23505 on a different constraint unchanged (not mapped to AppError)', () => {
      const err = { code: '23505', constraint: 'some_other_uq' };
      try {
        mapPgUniqueViolation(err);
        throw new Error('should have thrown');
      } catch (e) {
        expect(e).not.toBeInstanceOf(AppError);
        expect(e).toBe(err);
      }
    });
  });

  describe('assertNoCrossColumnCollision', () => {
    const db = (rows: unknown[]): Queryable => ({ query: jest.fn().mockResolvedValue({ rows }) });

    it('throws 409 DUPLICATE_GITHUB_REPO when repo equals another project jira_key', async () => {
      await expect(assertNoCrossColumnCollision(db([{ col: 1 }]), 'DP-002')).rejects.toMatchObject({
        code: 'DUPLICATE_GITHUB_REPO',
        statusCode: 409,
      });
    });

    it('does not throw when there is no collision', async () => {
      await expect(assertNoCrossColumnCollision(db([]), 'my-repo')).resolves.toBeUndefined();
    });

    it('passes selfJiraKey to exclude the row being updated', async () => {
      const q = jest.fn().mockResolvedValue({ rows: [] });
      await assertNoCrossColumnCollision({ query: q }, 'my-repo', 'DP-001');
      expect(q).toHaveBeenCalledWith(expect.stringContaining('jira_key'), ['my-repo', 'DP-001']);
    });
  });
});
