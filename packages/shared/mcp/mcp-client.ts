/**
 * Shared MCP client — thin HTTPS caller for the centralized Kiro governance MCP server.
 *
 * The DeliverPro app backend uses this to invoke MCP tools (currently `notify_slack`) over the
 * SAME contract the CI script (`scripts/governance-trigger.js`) uses: HTTPS + `X-API-Key` header +
 * JSON-RPC 2.0 `tools/call`, with optional self-signed TLS cert fingerprint pinning.
 *
 * IMPORTANT — the app builds NO Slack client of its own. All Slack posting is centralized in the
 * MCP `notify_slack` tool (change-requests/2026-07-02-github-slack-linkage-impact.md v3 §E/§6.2).
 * This helper only speaks to the MCP endpoint; it never talks to Slack directly.
 *
 * See docs/phase1/github-trigger-architecture.md §3.4/§4.4 for the transport contract this mirrors.
 */

import * as https from 'node:https';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

/** Connection + auth config for the MCP server. */
export interface McpClientConfig {
  /** Full HTTPS endpoint, e.g. `https://<elastic-ip>:443`. */
  serverUrl: string;
  /** Shared API key sent as `X-API-Key`. */
  apiKey: string;
  /**
   * Optional SHA-256 cert fingerprint (Node colon-delimited hex, e.g. `AA:BB:...`).
   * When set, the TLS connection is pinned to this fingerprint (self-signed cert on EC2).
   * When absent, standard CA verification applies.
   */
  certFingerprint?: string;
  /** Request timeout in ms. @default 3000 */
  timeoutMs?: number;
}

/** Result shape returned by the `notify_slack` MCP tool. */
export interface NotifySlackResult {
  notified: boolean;
  reason?: string;
}

/** Parameters for the `notify_slack` MCP tool (contract per mcp-server notify-slack.ts). */
export interface NotifySlackParams {
  /** GitHub repository name — MCP resolves the project + channel from this. */
  project_id: string;
  /** Notification message text (project-labelled + sanitized server-side). */
  message: string;
  /** Routes to the project's micro or macro channel. */
  event_type: 'macro' | 'micro';
}

/**
 * Resolve MCP client config from environment variables.
 * Returns null when the required variables are missing (caller should treat as "not configured"
 * and skip — a missing MCP endpoint must never break the primary operation).
 *
 * Env (same names the CI workflow uses):
 * - MCP_SERVER_URL
 * - MCP_API_KEY
 * - MCP_CERT_FINGERPRINT (optional)
 */
export function resolveMcpConfigFromEnv(): McpClientConfig | null {
  const serverUrl = process.env.MCP_SERVER_URL;
  const apiKey = process.env.MCP_API_KEY;
  if (!serverUrl || !apiKey) {
    return null;
  }
  return {
    serverUrl,
    apiKey,
    certFingerprint: process.env.MCP_CERT_FINGERPRINT,
  };
}

// In-memory API-key cache — reused across warm Lambda invocations (execution-environment reuse).
let cachedSsmApiKey: string | undefined;
let ssmClient: SSMClient | undefined;

/**
 * Resolve the MCP API key, in priority order:
 *   1. `MCP_API_KEY` env var — the CI workflow and dev-agent path (value supplied directly).
 *   2. `MCP_API_KEY_SSM_PARAM` env var — read that SecureString from SSM at runtime (decrypted),
 *      then cache it for the life of the execution environment.
 *
 * Why the SSM path exists: a SecureString CANNOT be injected into a Lambda environment variable by
 * CloudFormation, so the DeliverPro app Lambdas receive only the parameter PATH in env and read the
 * decrypted value at runtime on a single-ARN-scoped IAM role — the same secret-handling pattern the
 * repo already uses for the GitHub read-token and Slack provisioning-token.
 */
export async function resolveMcpApiKey(): Promise<string | undefined> {
  const direct = process.env.MCP_API_KEY;
  if (direct) {
    return direct;
  }
  if (cachedSsmApiKey) {
    return cachedSsmApiKey;
  }
  const paramName = process.env.MCP_API_KEY_SSM_PARAM;
  if (!paramName) {
    return undefined;
  }
  ssmClient ??= new SSMClient({});
  const res = await ssmClient.send(
    new GetParameterCommand({ Name: paramName, WithDecryption: true }),
  );
  const value = res.Parameter?.Value;
  if (value) {
    cachedSsmApiKey = value;
  }
  return value;
}

/**
 * Resolve the full MCP client config, supporting BOTH the env-only path (CI / dev agent) and the
 * env + SSM-SecureString path (DeliverPro app Lambdas). Returns null when the server URL or API key
 * cannot be resolved (caller treats this as "not configured" and skips gracefully — a missing MCP
 * endpoint must never break the primary operation).
 *
 * Env:
 * - MCP_SERVER_URL         (required)
 * - MCP_API_KEY            (or MCP_API_KEY_SSM_PARAM → runtime SSM read)
 * - MCP_CERT_FINGERPRINT   (optional; required in practice for the self-signed MCP cert)
 */
export async function resolveMcpConfig(): Promise<McpClientConfig | null> {
  const serverUrl = process.env.MCP_SERVER_URL;
  const apiKey = await resolveMcpApiKey();
  if (!serverUrl || !apiKey) {
    return null;
  }
  return {
    serverUrl,
    apiKey,
    certFingerprint: process.env.MCP_CERT_FINGERPRINT,
  };
}

/**
 * Low-level: call an MCP tool via HTTPS JSON-RPC `tools/call`.
 * Rejects on transport error, non-2xx status, TLS fingerprint mismatch, or unparseable body.
 * The MCP server responds in SSE framing (`data: {...}`) — this parses either SSE or raw JSON.
 */
export function callMcpTool(
  config: McpClientConfig,
  toolName: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let urlObj: URL;
    try {
      urlObj = new URL(config.serverUrl);
    } catch {
      reject(new Error('Invalid MCP_SERVER_URL'));
      return;
    }

    const body = JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: params },
      id: `${toolName}-${Date.now()}`,
    });

    const options: https.RequestOptions = {
      host: urlObj.hostname,
      port: urlObj.port || 443,
      path: '/mcp',
      method: 'POST',
      timeout: config.timeoutMs ?? 3000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'X-API-Key': config.apiKey,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    // Pin to the self-signed cert fingerprint when provided (matches the CI script).
    if (config.certFingerprint) {
      options.checkServerIdentity = (_host, cert) => {
        const actual = (cert as { fingerprint256?: string }).fingerprint256;
        if (actual !== config.certFingerprint) {
          return new Error('TLS cert fingerprint mismatch');
        }
        return undefined;
      };
      // Fingerprint pinning above provides the security guarantee for the self-signed cert.
      options.rejectUnauthorized = false;
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          reject(new Error(`MCP HTTP ${status}`));
          return;
        }
        try {
          // SSE framing: "event: message\ndata: {...}\n\n" — extract the data line if present.
          const dataLine = data.split('\n').find((line) => line.startsWith('data:'));
          const payload = dataLine ? dataLine.slice(5).trim() : data.trim();
          resolve(JSON.parse(payload));
        } catch {
          reject(new Error('Failed to parse MCP response'));
        }
      });
    });

    req.on('timeout', () => req.destroy(new Error('MCP request timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Call the `notify_slack` MCP tool and return its parsed `{ notified, reason }` result.
 *
 * Throws on transport/parse errors — callers that require best-effort behaviour (e.g. the
 * macro-gate approval path) MUST wrap this in try/catch so a notify failure never fails the
 * primary operation.
 *
 * @param params notify_slack arguments (project_id = github_repo, message, event_type)
 * @param config explicit config, or omit to resolve from environment
 */
export async function notifySlack(
  params: NotifySlackParams,
  config?: McpClientConfig | null,
): Promise<NotifySlackResult> {
  const cfg = config ?? (await resolveMcpConfig());
  if (!cfg) {
    // MCP endpoint not configured for this environment — treat as a graceful no-op.
    return { notified: false, reason: 'mcp_not_configured' };
  }

  const response = (await callMcpTool(cfg, 'notify_slack', {
    project_id: params.project_id,
    message: params.message,
    event_type: params.event_type,
  })) as { result?: { content?: Array<{ text?: string }> } };

  const text = response?.result?.content?.[0]?.text;
  if (!text) {
    return { notified: false, reason: 'no_result' };
  }
  return JSON.parse(text) as NotifySlackResult;
}
