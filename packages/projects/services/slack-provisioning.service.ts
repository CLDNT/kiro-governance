/**
 * Slack channel-provisioning service (CR-05, SEC-M1 two-token split).
 *
 * This is the ONLY path that holds the **provisioning** credential — a Slack
 * app credential scoped to `channels:read` + `channels:manage` (NO `admin.*`),
 * used solely to `conversations.list` / `conversations.create` a project's
 * micro + macro channels at link/onboarding time.
 *
 * It is deliberately SEPARATE from the runtime bot token used by the MCP
 * `notify_slack` tool (`chat:write`-only, `/kiro-governance/slack/bot-token`).
 * The two credentials live at two different SSM SecureString paths and are
 * granted to two different IAM roles:
 *   - runtime notify path → GetParameter+Decrypt on the bot-token ARN only;
 *   - this provisioning path → GetParameter+Decrypt on the provisioning ARN only.
 *
 * Source of record:
 *   - docs/phase2/projects-architecture.md §12.4 (FR-P2-039)
 *   - docs/phase1/mcp-server-core-architecture.md §0 overlay + §7.1 (SEC-M1)
 *   - change-requests/2026-07-02-github-slack-linkage-impact.md — SEC-M1, FR-P2-039
 *
 * Secret handling: the provisioning token is NEVER stored in code, in the repo,
 * in a PostgreSQL column, in an API response, or in a log line. Only the
 * (non-secret) SSM path below is committed.
 */

import { SSMClient, GetParameterCommand, ParameterNotFound } from '@aws-sdk/client-ssm';

/**
 * Machine-readable, secret-free error for provisioning failures. `code` values
 * never contain the provisioning token, an SSM path, or any other secret.
 */
export class SlackProvisioningError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SlackProvisioningError';
  }
}

/**
 * SSM SecureString path for the SEPARATE provisioning credential
 * (`channels:read` + `channels:manage`, no `admin.*`).
 *
 * DISTINCT from the runtime bot-token path
 * (`/kiro-governance/slack/bot-token`, `chat:write`-only) so a compromise of
 * the always-loaded runtime path cannot create/rename channels, and this
 * higher-privilege credential is only ever read by the link/onboarding Lambda.
 *
 * Provisioning of the parameter itself is admin/out-of-band (`ssm:PutParameter`).
 */
export const PROVISIONING_TOKEN_SSM_PATH = '/kiro-governance/slack/provisioning-token';

/** Slack Web API endpoints used by the provisioning path. */
const SLACK_CONVERSATIONS_LIST_URL = 'https://slack.com/api/conversations.list';
const SLACK_CONVERSATIONS_CREATE_URL = 'https://slack.com/api/conversations.create';

/** In-memory provisioning-token cache TTL (5 min) — mirrors the bot-token cache. */
const PROVISIONING_TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

/** Per-request Slack API timeout. */
const SLACK_API_TIMEOUT_MS = 5000;

/** conversations.list page size (POC scale — a workspace has hundreds of channels). */
const CONVERSATIONS_LIST_PAGE_LIMIT = 200;

/** Hard cap on pagination pages to bound worst-case latency / denial-of-wallet. */
const CONVERSATIONS_LIST_MAX_PAGES = 50;

/** Single-slot cache — one provisioning credential for the whole process. */
let provisioningTokenCache: { token: string; expiresAt: number } | null = null;

/** Test-only helper to clear the in-memory provisioning-token cache. */
export function __resetProvisioningTokenCache(): void {
  provisioningTokenCache = null;
}

/**
 * Retrieve the Slack provisioning credential from its own SSM SecureString
 * path, cached in memory with a 5-minute TTL.
 *
 * Throws SlackProvisioningError with code:
 * - 'PROVISIONING_TOKEN_NOT_FOUND': parameter missing/empty (no path exposed)
 * - 'SSM_ERROR': unexpected SSM failure (no details exposed)
 *
 * The token is never logged and never appears in an error message.
 */
export async function getProvisioningToken(ssmClient: SSMClient): Promise<string> {
  const now = Date.now();

  const cached = provisioningTokenCache;
  if (cached && cached.expiresAt > now) {
    return cached.token;
  }

  try {
    const result = await ssmClient.send(
      new GetParameterCommand({
        Name: PROVISIONING_TOKEN_SSM_PATH,
        WithDecryption: true,
      }),
    );

    const token = result.Parameter?.Value;
    if (!token) {
      throw new SlackProvisioningError(
        'PROVISIONING_TOKEN_NOT_FOUND',
        'Slack provisioning credential is not configured',
      );
    }

    provisioningTokenCache = { token, expiresAt: now + PROVISIONING_TOKEN_CACHE_TTL_MS };
    return token;
  } catch (err) {
    if (err instanceof SlackProvisioningError) {
      throw err;
    }
    if (
      err instanceof ParameterNotFound ||
      (err instanceof Error && err.message.includes('ParameterNotFound'))
    ) {
      throw new SlackProvisioningError(
        'PROVISIONING_TOKEN_NOT_FOUND',
        'Slack provisioning credential is not configured',
      );
    }
    throw new SlackProvisioningError('SSM_ERROR', 'Failed to retrieve Slack provisioning credential');
  }
}

/**
 * Convert an arbitrary project key into a Slack-safe channel-name fragment:
 * lowercase, only `[a-z0-9-_]`, collapsed/trimmed hyphens, length-bounded.
 * Slack channel names must be lowercase, ≤ 80 chars, no spaces or periods.
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 70);
}

/** Deterministic micro-channel name for a project (e.g. `DP-001` → `dp-001-micro`). */
export function microChannelName(jiraKey: string): string {
  return `${slugify(jiraKey)}-micro`;
}

/** Deterministic macro-channel name for a project (e.g. `DP-001` → `dp-001-macro`). */
export function macroChannelName(jiraKey: string): string {
  return `${slugify(jiraKey)}-macro`;
}

/** Result of resolving/creating a single channel. */
export interface ResolvedChannel {
  /** Non-secret Slack channel id (e.g. `C0123ABCD`). */
  id: string;
  /** true if this call created the channel; false if an existing one was resolved. */
  created: boolean;
}

interface SlackChannel {
  id: string;
  name: string;
}

interface ConversationsListResponse {
  ok?: boolean;
  error?: string;
  channels?: SlackChannel[];
  response_metadata?: { next_cursor?: string };
}

interface ConversationsCreateResponse {
  ok?: boolean;
  error?: string;
  channel?: SlackChannel;
}

/** Shared fetch wrapper: timeout + secret-free error mapping. Never logs the token. */
async function slackFetch(url: string, token: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLACK_API_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SlackProvisioningError('SLACK_TIMEOUT', 'Slack request timed out');
    }
    // Do not echo the underlying error — it may reference the outgoing request.
    throw new SlackProvisioningError('SLACK_NETWORK_ERROR', 'Network unreachable');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Find an existing channel by EXACT name via `conversations.list`, paginating
 * with the cursor until found or exhausted. Returns the id or null.
 *
 * Slack returns HTTP 200 with `{ ok:false, error }` on logical failure — the
 * body is inspected. `error` is a Slack error CODE (not a secret).
 */
async function findChannelByName(token: string, channelName: string): Promise<string | null> {
  let cursor: string | undefined;

  for (let page = 0; page < CONVERSATIONS_LIST_MAX_PAGES; page++) {
    const params = new URLSearchParams({
      limit: String(CONVERSATIONS_LIST_PAGE_LIMIT),
      exclude_archived: 'true',
      types: 'public_channel,private_channel',
    });
    if (cursor) params.set('cursor', cursor);

    const response = await slackFetch(`${SLACK_CONVERSATIONS_LIST_URL}?${params.toString()}`, token, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new SlackProvisioningError('SLACK_LIST_FAILED', `Slack returned status ${response.status}`);
    }

    let payload: ConversationsListResponse;
    try {
      payload = (await response.json()) as ConversationsListResponse;
    } catch {
      throw new SlackProvisioningError('SLACK_LIST_FAILED', 'Slack returned an unparseable response');
    }

    if (!payload.ok) {
      throw new SlackProvisioningError('SLACK_API_ERROR', `Slack API error: ${payload.error ?? 'unknown'}`);
    }

    const match = (payload.channels ?? []).find((c) => c.name === channelName);
    if (match) {
      return match.id;
    }

    cursor = payload.response_metadata?.next_cursor;
    if (!cursor) {
      return null;
    }
  }

  // Pagination exhausted without a match — treat as not found (bounded).
  return null;
}

/**
 * Create a channel via `conversations.create`. Throws SLACK_NAME_TAKEN on the
 * `name_taken` Slack error so the caller can re-resolve (race-safe idempotency).
 */
async function createChannel(token: string, channelName: string, isPrivate: boolean): Promise<string> {
  const response = await slackFetch(SLACK_CONVERSATIONS_CREATE_URL, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ name: channelName, is_private: isPrivate }),
  });

  if (!response.ok) {
    throw new SlackProvisioningError('SLACK_CREATE_FAILED', `Slack returned status ${response.status}`);
  }

  let payload: ConversationsCreateResponse;
  try {
    payload = (await response.json()) as ConversationsCreateResponse;
  } catch {
    throw new SlackProvisioningError('SLACK_CREATE_FAILED', 'Slack returned an unparseable response');
  }

  if (!payload.ok) {
    if (payload.error === 'name_taken') {
      throw new SlackProvisioningError('SLACK_NAME_TAKEN', 'Channel name already taken');
    }
    throw new SlackProvisioningError('SLACK_API_ERROR', `Slack API error: ${payload.error ?? 'unknown'}`);
  }

  const id = payload.channel?.id;
  if (!id) {
    throw new SlackProvisioningError('SLACK_CREATE_FAILED', 'Slack response missing channel id');
  }
  return id;
}

/**
 * Resolve-or-create a channel by name. Idempotent:
 *  1. `conversations.list` → if a channel with this exact name exists, return it
 *     (`created: false`) — a re-run never creates a duplicate.
 *  2. otherwise `conversations.create` → return the new id (`created: true`).
 *  3. if a concurrent caller created it first (`name_taken`), re-resolve via list.
 *
 * `channelId` returned is a non-secret Slack channel id; the token is never
 * returned, logged, or embedded in an error.
 */
export async function resolveOrCreateChannel(
  token: string,
  channelName: string,
  opts: { isPrivate?: boolean } = {},
): Promise<ResolvedChannel> {
  const existing = await findChannelByName(token, channelName);
  if (existing) {
    return { id: existing, created: false };
  }

  try {
    const id = await createChannel(token, channelName, opts.isPrivate ?? false);
    return { id, created: true };
  } catch (err) {
    if (err instanceof SlackProvisioningError && err.code === 'SLACK_NAME_TAKEN') {
      // Lost a create race — the channel now exists; resolve it.
      const raced = await findChannelByName(token, channelName);
      if (raced) {
        return { id: raced, created: false };
      }
    }
    throw err;
  }
}
