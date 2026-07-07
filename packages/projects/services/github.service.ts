/**
 * github.service — READ-ONLY GitHub fetch of a project's `docs/project-progress.md`.
 *
 * This is the ONLY path that holds the GitHub READ credential — a fine-grained PAT / GitHub
 * App installation token scoped to **Contents: Read-only** on the org's repositories (no write,
 * no admin). It mirrors the SEC-M1 two-token pattern in `slack-provisioning.service.ts`:
 * the token lives in its OWN SSM SecureString path, is granted to the sync Lambda role by a
 * single-ARN IAM statement, is cached in-memory (5-min TTL), and is NEVER stored in PG, returned
 * by an API, or written to a log line.
 *
 * Security controls (CR-16 §3, §4, §8):
 *   - Token isolation + single-ARN IAM + secret-free error codes/messages.
 *   - Own-repo-only: owner/repo are resolved from the PROJECT ROW (github_repo/github_url),
 *     never from request input — the caller cannot point the sync at an arbitrary repo.
 *   - SSRF guard: owner/repo are validated against ^[A-Za-z0-9._-]+$ before URL construction;
 *     the host is HARD-PINNED to api.github.com (never built from github_url).
 *   - CR16-H1 defense-in-depth: a runtime OWNER ALLOWLIST (GITHUB_ALLOWED_OWNERS, defaulted from
 *     GITHUB_DEFAULT_OWNER) fails the sync CLOSED (no fetch, no-op) when the resolved owner is not
 *     an approved org owner — so a mis-scoped broad PAT still cannot resolve gates from a repo the
 *     org does not control. Operators MUST configure the allowlist and/or use a repo-scoped App
 *     installation token (see packages/projects/README.md).
 *
 * Source: specs/phase2/CR-16-link-time-gate-detection-spec.md §3, §4, §8; cr16-security-review CR16-H1/M2.
 */
import { SSMClient, GetParameterCommand, ParameterNotFound } from '@aws-sdk/client-ssm';

/** SSM SecureString path for the GitHub READ token (Contents:Read-only). Non-secret path only. */
export const GITHUB_READ_TOKEN_SSM_PATH = '/kiro-governance/github/read-token';

/** GitHub REST host — HARD-PINNED (never derived from a project's github_url — SSRF guard). */
const GITHUB_API_HOST = 'https://api.github.com';

/** Tracker file path fetched from every linked repo. */
const PROGRESS_FILE_PATH = 'docs/project-progress.md';

/** In-memory read-token cache TTL (5 min) — mirrors the Slack token caches. */
const READ_TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

/** Per-request GitHub API timeout. */
const GITHUB_API_TIMEOUT_MS = 5000;

/** owner/repo shape guard (applied before URL construction). */
const OWNER_REPO_RE = /^[A-Za-z0-9._-]+$/;

/** Parse the owner segment out of an https://github.com/<owner>/… URL. */
const GITHUB_URL_OWNER_RE = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\//;

/**
 * Machine-readable, secret-free error for GitHub fetch failures. `code` values never
 * contain the read token, an SSM path, an owner, or a URL.
 */
export class GithubFetchError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GithubFetchError';
  }
}

/**
 * Non-secret fetch result. `content` is null for a graceful no-op (missing file / unlinked /
 * owner-unresolved / owner-not-allowed), with a machine-readable `reason`. `owner`/`repo`/
 * `contentRef` are provenance fields for the append-only sync audit (never secrets).
 */
export interface ProgressFileResult {
  content: string | null;
  reason?: string;
  owner?: string;
  repo?: string;
  /** Non-secret content fingerprint (GitHub ETag) captured for the sync audit trail. */
  contentRef?: string;
}

/** Single-slot cache — one read credential for the whole process. */
let readTokenCache: { token: string; expiresAt: number } | null = null;

/** Test-only helper to clear the in-memory read-token cache. */
export function __resetGithubTokenCache(): void {
  readTokenCache = null;
}

/**
 * Retrieve the GitHub read token from its own SSM SecureString path, cached (5-min TTL).
 * Throws GithubFetchError('GITHUB_TOKEN_NOT_FOUND' | 'SSM_ERROR', …) — never leaks the token.
 */
export async function getGithubReadToken(ssmClient: SSMClient): Promise<string> {
  const now = Date.now();
  const cached = readTokenCache;
  if (cached && cached.expiresAt > now) {
    return cached.token;
  }

  try {
    const result = await ssmClient.send(
      new GetParameterCommand({ Name: GITHUB_READ_TOKEN_SSM_PATH, WithDecryption: true }),
    );
    const token = result.Parameter?.Value;
    if (!token) {
      throw new GithubFetchError('GITHUB_TOKEN_NOT_FOUND', 'GitHub read credential is not configured');
    }
    readTokenCache = { token, expiresAt: now + READ_TOKEN_CACHE_TTL_MS };
    return token;
  } catch (err) {
    if (err instanceof GithubFetchError) {
      throw err;
    }
    if (
      err instanceof ParameterNotFound ||
      (err instanceof Error && err.message.includes('ParameterNotFound'))
    ) {
      throw new GithubFetchError('GITHUB_TOKEN_NOT_FOUND', 'GitHub read credential is not configured');
    }
    throw new GithubFetchError('SSM_ERROR', 'Failed to retrieve GitHub read credential');
  }
}

/**
 * Resolve the repo owner: parse it from github_url, else fall back to GITHUB_DEFAULT_OWNER.
 * Returns undefined when neither yields an owner (caller → no-op reason 'owner_unresolved').
 */
export function resolveOwner(githubUrl: string | null | undefined): string | undefined {
  if (githubUrl) {
    const m = GITHUB_URL_OWNER_RE.exec(githubUrl);
    if (m?.[1]) {
      return m[1];
    }
  }
  const fallback = process.env.GITHUB_DEFAULT_OWNER?.trim();
  return fallback ? fallback : undefined;
}

/**
 * Build the approved-owner allowlist (CR16-H1). Union of GITHUB_ALLOWED_OWNERS (comma-separated)
 * and GITHUB_DEFAULT_OWNER (if set). Empty set means "not configured" (see isOwnerAllowed).
 */
function buildAllowedOwners(): Set<string> {
  const owners = new Set<string>();
  const list = process.env.GITHUB_ALLOWED_OWNERS?.split(',') ?? [];
  for (const raw of list) {
    const o = raw.trim().toLowerCase();
    if (o) owners.add(o);
  }
  const def = process.env.GITHUB_DEFAULT_OWNER?.trim().toLowerCase();
  if (def) owners.add(def);
  return owners;
}

/**
 * CR16-H1 defense-in-depth. When the allowlist is configured, the resolved owner MUST be a
 * member — otherwise the sync fails CLOSED. When it is NOT configured (empty), the check is a
 * no-op (the sync then relies solely on token scope) — this is logged by the caller and
 * operators are directed to configure it / use a repo-scoped App installation token.
 */
export function isOwnerAllowed(owner: string): boolean {
  const allowed = buildAllowedOwners();
  if (allowed.size === 0) {
    return true; // not configured — cannot enforce; caller warns.
  }
  return allowed.has(owner.toLowerCase());
}

/** True when NO owner allowlist is configured (caller emits a hardening warning). */
export function isOwnerAllowlistConfigured(): boolean {
  return buildAllowedOwners().size > 0;
}

/** fetch wrapper: 5s timeout + secret-free error mapping. Never logs the token. */
async function githubFetch(url: string, token: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_API_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'deliverpro-gate-sync',
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new GithubFetchError('GITHUB_TIMEOUT', 'GitHub request timed out');
    }
    // Do not echo the underlying error — it may reference the outgoing request/token.
    throw new GithubFetchError('GITHUB_NETWORK_ERROR', 'Network unreachable');
  } finally {
    clearTimeout(timer);
  }
}

/** True when a 403/429 response carries GitHub rate-limit signals. */
function isRateLimited(res: Response): boolean {
  return (
    res.status === 429 ||
    res.headers.get('x-ratelimit-remaining') === '0' ||
    res.headers.get('retry-after') != null
  );
}

/**
 * Fetch a linked project's docs/project-progress.md.
 *
 * Non-throwing → graceful no-op ({ content:null, reason }) for: unlinked project,
 * owner-unresolved, owner-not-allowed (CR16-H1), and 404 (file/repo not found or no access).
 * Throws GithubFetchError for auth/permission (GITHUB_FORBIDDEN), rate-limit
 * (GITHUB_RATE_LIMITED), network (GITHUB_NETWORK_ERROR), and timeout (GITHUB_TIMEOUT).
 *
 * @param project non-secret project linkage columns (read from the DB row, never request input)
 */
export async function fetchProgressFile(
  project: { githubRepo: string | null; githubUrl: string | null },
  ssmClient: SSMClient,
): Promise<ProgressFileResult> {
  // Short-circuit: unlinked project (feature switch OFF) — no fetch.
  if (!project.githubRepo) {
    return { content: null, reason: 'not_linked' };
  }
  const repo = project.githubRepo;

  const owner = resolveOwner(project.githubUrl);
  if (!owner) {
    return { content: null, reason: 'owner_unresolved' };
  }

  // SSRF guard — validate BOTH segments before building any URL.
  if (!OWNER_REPO_RE.test(owner) || !OWNER_REPO_RE.test(repo)) {
    return { content: null, reason: 'owner_repo_invalid' };
  }

  // CR16-H1 — fail closed if the resolved owner is not an approved org owner.
  if (!isOwnerAllowed(owner)) {
    return { content: null, reason: 'owner_not_allowed', owner, repo };
  }

  const token = await getGithubReadToken(ssmClient);
  const url = `${GITHUB_API_HOST}/repos/${owner}/${repo}/contents/${PROGRESS_FILE_PATH}`;
  const res = await githubFetch(url, token);

  if (res.status === 200) {
    const content = await res.text();
    return { content, reason: 'ok', owner, repo, contentRef: res.headers.get('etag') ?? undefined };
  }

  if (res.status === 404) {
    // File or repo not found / no access → graceful no-op (per task).
    return { content: null, reason: 'file_not_found', owner, repo };
  }

  if ((res.status === 403 || res.status === 429) && isRateLimited(res)) {
    throw new GithubFetchError('GITHUB_RATE_LIMITED', 'GitHub API rate limit reached');
  }

  if (res.status === 401 || res.status === 403) {
    throw new GithubFetchError('GITHUB_FORBIDDEN', 'GitHub denied access to the repository');
  }

  throw new GithubFetchError('GITHUB_FETCH_FAILED', `GitHub returned status ${res.status}`);
}
