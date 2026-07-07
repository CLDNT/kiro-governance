/**
 * Unit tests for the CR-16 GitHub read client (github.service).
 * Mocks SSM + global fetch. Asserts: 200 returns content; 404 → graceful no-op; rate-limit →
 * GITHUB_RATE_LIMITED; token cached (one SSM call for two fetches); token never leaks into an
 * error/log; owner parsed from github_url; CR16-H1 owner allowlist fails closed; SSRF host pin.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { SSMClient } from '@aws-sdk/client-ssm';
import {
  getGithubReadToken,
  fetchProgressFile,
  resolveOwner,
  isOwnerAllowed,
  GithubFetchError,
  GITHUB_READ_TOKEN_SSM_PATH,
  __resetGithubTokenCache,
} from '../../services/github.service';

const READ_TOKEN = 'ghp_READ_ONLY_SECRET_zzz999';

function mockSsm(): { client: SSMClient; send: jest.Mock } {
  const send = jest.fn() as jest.Mock;
  send.mockResolvedValue({ Parameter: { Value: READ_TOKEN } } as never);
  return { client: { send } as unknown as SSMClient, send };
}

interface FakeResponseOpts {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}
function fakeResponse({ status, body = '', headers = {} }: FakeResponseOpts): Response {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    text: async () => body,
  } as unknown as Response;
}

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  __resetGithubTokenCache();
  jest.restoreAllMocks();
  // Clean slate for allowlist-affecting env vars — happy path leaves them unset (allowlist off).
  delete process.env.GITHUB_DEFAULT_OWNER;
  delete process.env.GITHUB_ALLOWED_OWNERS;
});
afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch;
  process.env = { ...ORIG_ENV };
});

describe('getGithubReadToken', () => {
  it('reads the token from its OWN SSM SecureString path (WithDecryption)', async () => {
    const { client, send } = mockSsm();
    const token = await getGithubReadToken(client);
    expect(token).toBe(READ_TOKEN);
    const cmd = send.mock.calls[0][0] as { input: { Name: string; WithDecryption: boolean } };
    expect(cmd.input.Name).toBe(GITHUB_READ_TOKEN_SSM_PATH);
    expect(cmd.input.WithDecryption).toBe(true);
  });

  it('caches the token — two fetches trigger ONE SSM call', async () => {
    const { client, send } = mockSsm();
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () =>
      fakeResponse({ status: 200, body: 'ok' }),
    ) as unknown;

    await fetchProgressFile({ githubRepo: 'repo', githubUrl: 'https://github.com/acme/repo' }, client);
    await fetchProgressFile({ githubRepo: 'repo', githubUrl: 'https://github.com/acme/repo' }, client);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('throws GITHUB_TOKEN_NOT_FOUND when the parameter value is empty (no secret in message)', async () => {
    const send = jest.fn().mockResolvedValue({ Parameter: { Value: '' } } as never) as jest.Mock;
    const client = { send } as unknown as SSMClient;
    await expect(getGithubReadToken(client)).rejects.toMatchObject({ code: 'GITHUB_TOKEN_NOT_FOUND' });
  });
});

describe('resolveOwner', () => {
  it('parses the owner from an https://github.com/<owner>/… URL', () => {
    expect(resolveOwner('https://github.com/acme-org/deliverpro')).toBe('acme-org');
  });
  it('falls back to GITHUB_DEFAULT_OWNER when no URL', () => {
    process.env.GITHUB_DEFAULT_OWNER = 'default-org';
    expect(resolveOwner(null)).toBe('default-org');
  });
  it('returns undefined when neither URL nor default owner is available', () => {
    expect(resolveOwner(null)).toBeUndefined();
  });
});

describe('fetchProgressFile — happy path & graceful no-ops', () => {
  it('200 → returns the raw markdown content + provenance owner/repo', async () => {
    const { client } = mockSsm();
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async (url: string) => {
      expect(String(url)).toBe('https://api.github.com/repos/acme/repo/contents/docs/project-progress.md');
      return fakeResponse({ status: 200, body: '- [x] SRS approved', headers: { etag: 'W/"abc"' } });
    }) as unknown;

    const res = await fetchProgressFile(
      { githubRepo: 'repo', githubUrl: 'https://github.com/acme/repo' },
      client,
    );
    expect(res.content).toBe('- [x] SRS approved');
    expect(res.owner).toBe('acme');
    expect(res.repo).toBe('repo');
    expect(res.contentRef).toBe('W/"abc"');
  });

  it('unlinked project (github_repo null) → no-op, no fetch', async () => {
    const { client } = mockSsm();
    const fetchMock = jest.fn();
    (globalThis as { fetch?: unknown }).fetch = fetchMock as unknown;
    const res = await fetchProgressFile({ githubRepo: null, githubUrl: null }, client);
    expect(res).toEqual({ content: null, reason: 'not_linked' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404 → graceful no-op { content:null, reason:"file_not_found" }', async () => {
    const { client } = mockSsm();
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => fakeResponse({ status: 404 })) as unknown;
    const res = await fetchProgressFile(
      { githubRepo: 'repo', githubUrl: 'https://github.com/acme/repo' },
      client,
    );
    expect(res.content).toBeNull();
    expect(res.reason).toBe('file_not_found');
  });

  it('owner_unresolved → no-op when no URL and no default owner', async () => {
    const { client } = mockSsm();
    const fetchMock = jest.fn();
    (globalThis as { fetch?: unknown }).fetch = fetchMock as unknown;
    const res = await fetchProgressFile({ githubRepo: 'repo', githubUrl: null }, client);
    expect(res).toEqual({ content: null, reason: 'owner_unresolved' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchProgressFile — CR16-H1 owner allowlist (own-repo / approved-owner only)', () => {
  it('fails CLOSED (no fetch) when the resolved owner is not on the allowlist', async () => {
    process.env.GITHUB_ALLOWED_OWNERS = 'approved-org,other-org';
    const { client } = mockSsm();
    const fetchMock = jest.fn();
    (globalThis as { fetch?: unknown }).fetch = fetchMock as unknown;

    const res = await fetchProgressFile(
      { githubRepo: 'repo', githubUrl: 'https://github.com/evil-org/repo' },
      client,
    );
    expect(res).toEqual({ content: null, reason: 'owner_not_allowed', owner: 'evil-org', repo: 'repo' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('permits an owner that IS on the allowlist', async () => {
    process.env.GITHUB_ALLOWED_OWNERS = 'acme';
    const { client } = mockSsm();
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () =>
      fakeResponse({ status: 200, body: 'ok' }),
    ) as unknown;

    const res = await fetchProgressFile(
      { githubRepo: 'repo', githubUrl: 'https://github.com/acme/repo' },
      client,
    );
    expect(res.content).toBe('ok');
  });

  it('isOwnerAllowed: allowlist off (unset) → allows; configured → membership enforced', () => {
    expect(isOwnerAllowed('anyone')).toBe(true); // not configured
    process.env.GITHUB_ALLOWED_OWNERS = 'acme';
    expect(isOwnerAllowed('acme')).toBe(true);
    expect(isOwnerAllowed('ACME')).toBe(true); // case-insensitive
    expect(isOwnerAllowed('evil')).toBe(false);
  });
});

describe('fetchProgressFile — rate limit & secret safety', () => {
  it('403 with x-ratelimit-remaining:0 → throws GITHUB_RATE_LIMITED', async () => {
    const { client } = mockSsm();
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () =>
      fakeResponse({ status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    ) as unknown;

    await expect(
      fetchProgressFile({ githubRepo: 'repo', githubUrl: 'https://github.com/acme/repo' }, client),
    ).rejects.toMatchObject({ code: 'GITHUB_RATE_LIMITED' });
  });

  it('403 WITHOUT rate-limit headers → throws GITHUB_FORBIDDEN', async () => {
    const { client } = mockSsm();
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => fakeResponse({ status: 403 })) as unknown;
    await expect(
      fetchProgressFile({ githubRepo: 'repo', githubUrl: 'https://github.com/acme/repo' }, client),
    ).rejects.toMatchObject({ code: 'GITHUB_FORBIDDEN' });
  });

  it('the read token NEVER appears in the Authorization is Bearer, and never in error messages', async () => {
    const { client } = mockSsm();
    const fetchMock = jest.fn(async () => fakeResponse({ status: 500 }));
    (globalThis as { fetch?: unknown }).fetch = fetchMock as unknown;

    let thrown: unknown;
    try {
      await fetchProgressFile({ githubRepo: 'repo', githubUrl: 'https://github.com/acme/repo' }, client);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(GithubFetchError);
    expect((thrown as GithubFetchError).message).not.toContain(READ_TOKEN);
    expect((thrown as GithubFetchError).code).not.toContain(READ_TOKEN);
    // Token is passed via the Authorization header (Bearer), never the URL.
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(String(url)).not.toContain(READ_TOKEN);
  });

  it('SSRF host pin: the request always targets api.github.com regardless of github_url host', async () => {
    process.env.GITHUB_ALLOWED_OWNERS = 'acme';
    const { client } = mockSsm();
    const fetchMock = jest.fn(async () => fakeResponse({ status: 200, body: 'ok' }));
    (globalThis as { fetch?: unknown }).fetch = fetchMock as unknown;

    await fetchProgressFile(
      { githubRepo: 'repo', githubUrl: 'https://github.com/acme/repo' },
      client,
    );
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(String(url).startsWith('https://api.github.com/')).toBe(true);
  });
});
