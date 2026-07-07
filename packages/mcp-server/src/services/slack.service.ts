import https from 'node:https';
import type { ClientRequest } from 'node:http';
import { SSMClient, GetParameterCommand, ParameterNotFound } from '@aws-sdk/client-ssm';

/**
 * Custom error class for Slack service errors.
 *
 * Error `code` values are machine-readable and MUST stay generic — they never
 * contain the bot token, a webhook URL, an SSM path, or any other secret.
 */
export class SlackServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SlackServiceError';
  }
}

// ---------------------------------------------------------------------------
// Bot-token model (CR-05) — Slack Web API `chat.postMessage`
//
// Source of record:
//   - change-requests/2026-07-02-github-slack-linkage-impact.md — v3 Final
//     Design of Record, Decision D + §v3-5.3.
//   - docs/phase1/mcp-server-core-architecture.md §0 overlay.
//
// CR-05 delivers ONLY the token retrieval + `chat.postMessage` client + config.
// Routing / dual-channel resolution inside `notify_slack` is CR-09 and is NOT
// wired here. The legacy incoming-webhook helpers further below are retained,
// deprecated, as the CR-09 transition fallback (v3-5.3 / PLAN-H2b).
// ---------------------------------------------------------------------------

/**
 * SSM SecureString parameter path for the SINGLE workspace-level Slack bot
 * token (e.g. `xoxb-...`). The token itself is a secret and is NEVER stored in
 * code, in the repo, in a PostgreSQL column, in an API response, or in a log.
 * Only this path (a non-secret reference) is committed.
 *
 * Provisioning of the parameter is out-of-band / admin-only (`ssm:PutParameter`).
 * The MCP server needs only `ssm:GetParameter` + `kms:Decrypt` on this one ARN.
 */
export const BOT_TOKEN_SSM_PATH = '/kiro-governance/slack/bot-token';

/** Slack Web API endpoint for posting a message to a channel. */
const SLACK_POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';

/**
 * In-memory bot-token cache TTL (5 minutes) — mirrors the legacy webhook cache
 * TTL (F-01 §6) so a newly-rotated token is picked up within one window without
 * a server restart.
 */
const BOT_TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

/** Slack `chat.postMessage` request timeout (F-01 §6.4, p95 target < 5s). */
const SLACK_POST_TIMEOUT_MS = 3000;

/** Single-slot cache — one workspace-level token for the whole server. */
let botTokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Test-only helper to clear the in-memory bot-token cache between cases.
 * Not part of the runtime contract.
 */
export function __resetBotTokenCache(): void {
  botTokenCache = null;
}

/**
 * Retrieve the workspace Slack bot token from SSM SecureString, cached in
 * memory with a 5-minute TTL.
 *
 * Throws SlackServiceError with code:
 * - 'BOT_TOKEN_NOT_FOUND': SSM parameter is missing/empty (generic — no path exposed)
 * - 'SSM_ERROR': unexpected SSM failure (generic — no details exposed)
 *
 * The token is never logged and never appears in an error message.
 */
export async function getBotToken(ssmClient: SSMClient): Promise<string> {
  const now = Date.now();

  const cached = botTokenCache;
  if (cached && cached.expiresAt > now) {
    return cached.token;
  }

  try {
    const result = await ssmClient.send(
      new GetParameterCommand({
        Name: BOT_TOKEN_SSM_PATH,
        WithDecryption: true,
      }),
    );

    const token = result.Parameter?.Value;
    if (!token) {
      throw new SlackServiceError('BOT_TOKEN_NOT_FOUND', 'Slack bot token is not configured');
    }

    botTokenCache = { token, expiresAt: now + BOT_TOKEN_CACHE_TTL_MS };
    return token;
  } catch (err) {
    if (err instanceof SlackServiceError) {
      throw err;
    }
    if (
      err instanceof ParameterNotFound ||
      (err instanceof Error && err.message.includes('ParameterNotFound'))
    ) {
      throw new SlackServiceError('BOT_TOKEN_NOT_FOUND', 'Slack bot token is not configured');
    }
    throw new SlackServiceError('SSM_ERROR', 'Failed to retrieve Slack bot token');
  }
}

/**
 * Post a plain-text message to a Slack channel via the Web API
 * `chat.postMessage` method using a bot token.
 *
 * `channelId` is a non-secret Slack channel id (e.g. `C0123ABCD`). The `token`
 * is the workspace bot token from {@link getBotToken}.
 *
 * IMPORTANT: Slack returns HTTP 200 even on logical failure — the response body
 * `{ ok: false, error }` must be inspected. `error` is a Slack error CODE
 * (e.g. `channel_not_found`, `invalid_auth`, `not_in_channel`); it never
 * contains the token and is safe to surface as a generic reason.
 *
 * Throws SlackServiceError with code:
 * - 'SLACK_TIMEOUT': request exceeded the timeout
 * - 'SLACK_NETWORK_ERROR': network unreachable
 * - 'SLACK_POST_FAILED': non-2xx HTTP status or unparseable body
 * - 'SLACK_API_ERROR': HTTP 200 but `{ ok: false }` (message carries Slack's error code)
 *
 * Neither the token nor its presence is ever logged.
 */
export async function postMessageToChannel(
  token: string,
  channelId: string,
  text: string,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLACK_POST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(SLACK_POST_MESSAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel: channelId, text }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SlackServiceError('SLACK_TIMEOUT', 'Slack request timed out');
    }
    // Do not echo the underlying error message — it could reference the request.
    throw new SlackServiceError('SLACK_NETWORK_ERROR', 'Network unreachable');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new SlackServiceError('SLACK_POST_FAILED', `Slack returned status ${response.status}`);
  }

  let payload: { ok?: boolean; error?: string };
  try {
    payload = (await response.json()) as { ok?: boolean; error?: string };
  } catch {
    throw new SlackServiceError('SLACK_POST_FAILED', 'Slack returned an unparseable response');
  }

  if (!payload.ok) {
    // payload.error is a Slack error code (not a secret) — safe to include.
    throw new SlackServiceError('SLACK_API_ERROR', `Slack API error: ${payload.error ?? 'unknown'}`);
  }
}

// ---------------------------------------------------------------------------
// DEPRECATED — legacy incoming-webhook model (pre-CR-05)
//
// As of CR-09, `notify_slack` NO LONGER imports or calls these helpers — routing
// is done entirely through the bot-token client above (getBotToken +
// postMessageToChannel), dual-channel by event_type. There is no runtime caller
// of getWebhookUrl / postToSlack anymore.
//
// They are retained ONLY as the documented CR-06 transition fallback
// (v3-5.3 / PLAN-H2b): repos currently notified via
// `/kiro-governance/slack/webhooks/{repo}` must not go dark before their
// slack_micro_channel_id / slack_macro_channel_id are backfilled. Do NOT extend
// these or re-wire them into a tool — build new behaviour on the bot-token
// client. Delete this whole block once CR-06 backfill + bot-token cutover
// validate for every currently-notifying repo (tie to the CR-06 gate).
// ---------------------------------------------------------------------------

/**
 * Webhook URL cache with TTL (5 minutes per F-01 §6).
 * Stores (url, expiresAt); updated per-request on cache miss.
 */
const webhookCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * @deprecated Legacy incoming-webhook lookup. Superseded by {@link getBotToken}
 * + {@link postMessageToChannel} (CR-05) and no longer called by `notify_slack`
 * after CR-09. Kept ONLY as the CR-06 transition fallback (v3-5.3 / PLAN-H2b).
 *
 * Get Slack webhook URL for a project via SSM lookup.
 * Cache in-memory with 5-min TTL to avoid repeated SSM calls.
 *
 * Throws SlackServiceError with code:
 * - 'PROJECT_NOT_FOUND': SSM parameter does not exist (generic error, no path exposed)
 * - 'SSM_ERROR': Unexpected SSM error (generic error, no details exposed)
 *
 * F-01 §3.1 LOW-8: "Remove SSM path from error response" — error messages are generic.
 */
export async function getWebhookUrl(ssmClient: SSMClient, projectId: string): Promise<string> {
  const now = Date.now();

  // Check cache
  const cached = webhookCache.get(projectId);
  if (cached && cached.expiresAt > now) {
    return cached.url;
  }

  // Cache miss or expired — fetch from SSM
  try {
    const ssmPath = `/kiro-governance/slack/webhooks/${projectId}`;
    const result = await ssmClient.send(
      new GetParameterCommand({
        Name: ssmPath,
        WithDecryption: true,
      }),
    );

    const webhookUrl = result.Parameter?.Value;
    if (!webhookUrl) {
      throw new SlackServiceError('PROJECT_NOT_FOUND', 'Webhook not found for project');
    }

    // Cache with 5-min TTL
    const expiresAt = now + 5 * 60 * 1000;
    webhookCache.set(projectId, { url: webhookUrl, expiresAt });

    return webhookUrl;
  } catch (err) {
    if (err instanceof ParameterNotFound || (err instanceof Error && err.message.includes('ParameterNotFound'))) {
      // SSM parameter does not exist — generic error to caller
      throw new SlackServiceError('PROJECT_NOT_FOUND', 'Webhook not found for project');
    }
    // Unexpected SSM error
    if (err instanceof SlackServiceError) {
      throw err;
    }
    throw new SlackServiceError('SSM_ERROR', 'Failed to retrieve webhook configuration');
  }
}

/**
 * @deprecated Legacy incoming-webhook POST. Superseded by
 * {@link postMessageToChannel} (CR-05) and no longer called by `notify_slack`
 * after CR-09. Kept ONLY as the CR-06 transition fallback (v3-5.3 / PLAN-H2b).
 *
 * POST to Slack webhook with message.
 *
 * Message body: { text: message }
 * Timeout: 3 seconds per F-01 §6.4 (p95 target <5s)
 *
 * Throws SlackServiceError with code:
 * - 'SLACK_POST_FAILED': Non-2xx HTTP response
 * - 'SLACK_TIMEOUT': Request exceeded timeout
 * - 'SLACK_NETWORK_ERROR': Network unreachable
 */
export async function postToSlack(webhookUrl: string, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text: message });

    let req: ClientRequest;
    const timeout = setTimeout(() => {
      req.destroy();
      reject(new SlackServiceError('SLACK_TIMEOUT', 'Slack request timed out'));
    }, 3000);

    try {
      req = https.request(webhookUrl, { method: 'POST' }, (res) => {
        let responseData = '';

        res.on('data', (chunk: Buffer) => {
          responseData += chunk.toString();
        });

        res.on('end', () => {
          clearTimeout(timeout);

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(
              new SlackServiceError(
                'SLACK_POST_FAILED',
                `Slack returned status ${res.statusCode}`,
              ),
            );
          } else {
            resolve();
          }
        });
      });

      req.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timeout);
        if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
          reject(new SlackServiceError('SLACK_NETWORK_ERROR', 'Network unreachable'));
        } else {
          reject(new SlackServiceError('SLACK_POST_FAILED', err.message));
        }
      });

      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Content-Length', Buffer.byteLength(body));
      req.write(body);
      req.end();
    } catch (err) {
      clearTimeout(timeout);
      reject(new SlackServiceError('SLACK_POST_FAILED', 'Failed to create request'));
    }
  });
}
