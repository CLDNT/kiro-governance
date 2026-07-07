import { describe, it, expect } from 'vitest';
import type { AxiosError } from 'axios';

import {
  buildLinkagePayload,
  canManageLinkage,
  EMPTY_LINKAGE_VALUES,
  hasErrors,
  isRepoRepointOrClear,
  mapServerError,
  validateGithubRepo,
  validateGithubUrl,
  validateLinkageValues,
  validateSlackChannelId,
  type LinkageValues,
} from './linkage';

// Build a minimal AxiosError-shaped object for mapServerError tests.
function axiosError(status: number, data: unknown): AxiosError {
  return {
    isAxiosError: true,
    name: 'AxiosError',
    message: 'Request failed',
    response: { status, data, statusText: '', headers: {}, config: {} },
  } as unknown as AxiosError;
}

describe('canManageLinkage (§12.1 role gate)', () => {
  it('allows only admin and leadership', () => {
    expect(canManageLinkage('admin')).toBe(true);
    expect(canManageLinkage('leadership')).toBe(true);
  });

  it('denies pm / sa / engineer / null / undefined', () => {
    expect(canManageLinkage('pm')).toBe(false);
    expect(canManageLinkage('sa')).toBe(false);
    expect(canManageLinkage('engineer')).toBe(false);
    expect(canManageLinkage(null)).toBe(false);
    expect(canManageLinkage(undefined)).toBe(false);
  });
});

describe('validateGithubRepo (§12.2 charset)', () => {
  it('accepts empty (optional)', () => {
    expect(validateGithubRepo('')).toBeUndefined();
  });

  it('accepts the allowed charset', () => {
    expect(validateGithubRepo('my-service.repo_1')).toBeUndefined();
    expect(validateGithubRepo('a'.repeat(100))).toBeUndefined();
  });

  it('rejects disallowed characters and over-length', () => {
    expect(validateGithubRepo('bad repo')).toBeDefined();
    expect(validateGithubRepo('org/repo')).toBeDefined();
    expect(validateGithubRepo('a'.repeat(101))).toBeDefined();
  });
});

describe('validateGithubUrl (§12.2 https + github.com only)', () => {
  it('accepts empty (optional)', () => {
    expect(validateGithubUrl('')).toBeUndefined();
  });

  it('accepts an https github.com url', () => {
    expect(validateGithubUrl('https://github.com/org/repo')).toBeUndefined();
  });

  it('rejects http, non-github hosts, and open-redirect shapes', () => {
    expect(validateGithubUrl('http://github.com/org/repo')).toBeDefined();
    expect(validateGithubUrl('https://evil.com/org/repo')).toBeDefined();
    expect(validateGithubUrl('https://github.com.evil.com/x')).toBeDefined();
    expect(validateGithubUrl('javascript:alert(1)')).toBeDefined();
  });
});

describe('validateSlackChannelId (non-secret shape)', () => {
  it('accepts channel-id shapes and empty', () => {
    expect(validateSlackChannelId('')).toBeUndefined();
    expect(validateSlackChannelId('C0123ABCD')).toBeUndefined();
  });

  it('rejects token/webhook-looking values', () => {
    expect(validateSlackChannelId('xoxb-123-abc')).toBeDefined();
    expect(validateSlackChannelId('https://hooks.slack.com/x')).toBeDefined();
  });
});

describe('validateLinkageValues + hasErrors', () => {
  it('returns no errors for an all-empty form', () => {
    const errors = validateLinkageValues(EMPTY_LINKAGE_VALUES);
    expect(hasErrors(errors)).toBe(false);
  });

  it('collects per-field errors', () => {
    const values: LinkageValues = {
      github_repo: 'bad repo',
      github_url: 'http://x',
      slack_micro_channel_id: 'xoxb-secret',
      slack_macro_channel_id: 'C0OK',
    };
    const errors = validateLinkageValues(values);
    expect(errors.github_repo).toBeDefined();
    expect(errors.github_url).toBeDefined();
    expect(errors.slack_micro_channel_id).toBeDefined();
    expect(errors.slack_macro_channel_id).toBeUndefined();
    expect(hasErrors(errors)).toBe(true);
  });
});

describe('isRepoRepointOrClear (FR-P2-040)', () => {
  it('is false when there was no original repo', () => {
    expect(isRepoRepointOrClear(null, 'new-repo')).toBe(false);
    expect(isRepoRepointOrClear('', 'new-repo')).toBe(false);
  });

  it('is false when repo is unchanged', () => {
    expect(isRepoRepointOrClear('repo', 'repo')).toBe(false);
    expect(isRepoRepointOrClear('repo', ' repo ')).toBe(false);
  });

  it('is true when clearing an existing repo', () => {
    expect(isRepoRepointOrClear('repo', '')).toBe(true);
  });

  it('is true when re-pointing to a different repo', () => {
    expect(isRepoRepointOrClear('repo', 'other-repo')).toBe(true);
  });
});

describe('buildLinkagePayload', () => {
  it('create mode includes only non-empty fields', () => {
    const values: LinkageValues = {
      ...EMPTY_LINKAGE_VALUES,
      github_repo: 'repo',
    };
    expect(buildLinkagePayload(values, 'create')).toEqual({ github_repo: 'repo' });
  });

  it('edit mode sends only changed fields, using null to clear', () => {
    const original: LinkageValues = {
      github_repo: 'repo',
      github_url: 'https://github.com/org/repo',
      slack_micro_channel_id: 'C1',
      slack_macro_channel_id: 'C2',
    };
    const next: LinkageValues = {
      ...original,
      github_repo: '', // cleared
      slack_micro_channel_id: 'C9', // changed
    };
    const payload = buildLinkagePayload(next, 'edit', original);
    expect(payload).toEqual({ github_repo: null, slack_micro_channel_id: 'C9' });
  });

  it('edit mode with no changes yields an empty payload', () => {
    const original: LinkageValues = { ...EMPTY_LINKAGE_VALUES, github_repo: 'repo' };
    expect(buildLinkagePayload({ ...original }, 'edit', original)).toEqual({});
  });
});

describe('mapServerError (400/409/422 → inline)', () => {
  it('maps 400 VALIDATION_ERROR details to field errors', () => {
    const err = axiosError(400, {
      code: 'VALIDATION_ERROR',
      details: { github_url: ['Invalid URL'] },
    });
    const { fieldErrors, formError } = mapServerError(err);
    expect(fieldErrors.github_url).toBe('Invalid URL');
    expect(formError).toBeNull();
  });

  it('maps 409 DUPLICATE_GITHUB_REPO to the github_repo field', () => {
    const err = axiosError(409, { code: 'DUPLICATE_GITHUB_REPO' });
    const { fieldErrors } = mapServerError(err);
    expect(fieldErrors.github_repo).toMatch(/already linked/i);
  });

  it('maps 422 IMMUTABLE_FIELD to a form-level message with the field name', () => {
    const err = axiosError(422, { code: 'IMMUTABLE_FIELD', details: { field: 'jira_key' } });
    const { formError } = mapServerError(err);
    expect(formError).toMatch(/jira_key/);
  });

  it('maps 403 FORBIDDEN to a form-level message', () => {
    const err = axiosError(403, {
      code: 'FORBIDDEN',
      message: 'Only admin or leadership may change project linkage',
    });
    const { formError } = mapServerError(err);
    expect(formError).toMatch(/admin or leadership/i);
  });

  it('falls back to 409 status when no code is present', () => {
    const err = axiosError(409, {});
    const { fieldErrors } = mapServerError(err);
    expect(fieldErrors.github_repo).toBeDefined();
  });
});
