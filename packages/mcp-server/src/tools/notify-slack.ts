import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSMClient } from '@aws-sdk/client-ssm';
import { getBotToken, postMessageToChannel, SlackServiceError } from '../services/slack.service';
import { resolveProject } from '../services/postgres.service';

/**
 * Input schema for notify_slack tool.
 * Contract is UNCHANGED (project_id = GitHub repo name, message, event_type) so
 * the app→MCP macro call and the CI/Kiro micro call need no changes.
 * Per mcp-server-core-architecture.md §3.1 / change-request v3 §E.
 */
export const NotifySlackInputSchema = z.object({
  project_id: z.string().min(1).describe('GitHub repository name'),
  message: z.string().min(1).describe('Notification message text'),
  event_type: z.enum(['macro', 'micro']).describe('Event classification'),
});

export type NotifySlackInput = z.infer<typeof NotifySlackInputSchema>;

/**
 * Output interface. `reason` is always a generic, machine-readable code — it never
 * contains the bot token, an SSM path, or the raw repo name.
 */
export interface NotifySlackOutput {
  notified: boolean;
  reason?: string;
}

/**
 * Slack channel id format (e.g. `C0123ABCD`). Public (`C`), private/group (`G`),
 * or DM (`D`) prefix followed by uppercase alphanumerics. Validated before any
 * post so a malformed/unconfigured value never reaches the Slack API (CR-05 LOW #2).
 */
const SLACK_CHANNEL_ID_RE = /^[CGD][A-Z0-9]{8,}$/;

/**
 * Max message length posted to Slack. `chat.postMessage` accepts up to ~40k chars
 * but recommends staying well below; the message body is capped and truncated
 * (with an ellipsis) rather than rejected so a notification is never silently
 * dropped for length alone (CR-05 LOW #2).
 */
const SLACK_MAX_TEXT_LEN = 3000;

/**
 * Register notify_slack MCP tool.
 * Handles BOTH micro and macro events (CR-09 — micro is no longer skipped):
 * micro → the project's micro channel, macro → the project's macro channel.
 * See mcp-server-core-architecture.md §3.1, §6 for architecture.
 */
export function registerNotifySlack(
  server: McpServer,
  config: { ssmClient: SSMClient },
): void {
  server.tool(
    'notify_slack',
    'Send a Slack notification for a governance event, routed by event_type to the project micro/macro channel',
    NotifySlackInputSchema.shape as Record<string, unknown>,
    async (params: unknown): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const result = await handleNotifySlack(params, config.ssmClient);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );
}

/**
 * Handler logic for notify_slack (CR-09 dual-channel bot-token model).
 *
 * Flow (change-request v3 §5.2):
 * 1. Validate input (Zod).
 * 2. Resolve the project by `github_repo` (= project_id). No match → graceful skip.
 * 3. Pick the channel by event_type: micro → micro channel, macro → macro channel.
 *    Channel null/unconfigured → graceful skip.
 * 4. Validate the channel id format + build a project-labelled, mention-sanitized,
 *    length-capped message.
 * 5. Post via the bot token (getBotToken) + chat.postMessage (postMessageToChannel).
 *
 * All failure paths return `{ notified:false, reason }` — no exception is thrown,
 * and no secret / SSM path / raw repo name is leaked in `reason`.
 */
export async function handleNotifySlack(
  params: unknown,
  ssmClient: SSMClient,
): Promise<NotifySlackOutput> {
  // 1. Validate input
  const input = NotifySlackInputSchema.parse(params);

  // 2. Resolve project by github_repo (project_id is the repo name).
  //    Reuses the same no-orphan resolve as record_progress (CR-08).
  let project: Awaited<ReturnType<typeof resolveProject>>;
  try {
    project = await resolveProject(input.project_id);
  } catch {
    // Repo name is logged inside resolveProject only — never surfaced here.
    return { notified: false, reason: 'project_lookup_failed' };
  }

  // Graceful skip — no linked project for this repo (feature switch OFF).
  if (!project) {
    return { notified: false, reason: 'no_matching_project' };
  }

  // 3. Route by event_type — micro → micro channel, macro → macro channel.
  const channelId =
    input.event_type === 'macro'
      ? project.slack_macro_channel_id
      : project.slack_micro_channel_id;

  // Graceful skip — the relevant channel is not configured for this project.
  if (!channelId) {
    return { notified: false, reason: 'channel_not_configured' };
  }

  // 4a. Validate the channel id format before posting (CR-05 LOW #2).
  if (!SLACK_CHANNEL_ID_RE.test(channelId)) {
    return { notified: false, reason: 'invalid_channel' };
  }

  // 4b. Build the project-labelled, sanitized, length-capped message text.
  const text = buildSlackText(project.jira_key, input.message);

  // 5. Retrieve the workspace bot token (cached; single SSM SecureString param).
  let token: string;
  try {
    token = await getBotToken(ssmClient);
  } catch (err) {
    // Generic reason only — no SSM path or token detail (SlackServiceError codes
    // are already generic, e.g. bot_token_not_found / ssm_error).
    return {
      notified: false,
      reason: err instanceof SlackServiceError ? err.code.toLowerCase() : 'token_error',
    };
  }

  // 5b. Post via chat.postMessage.
  try {
    await postMessageToChannel(token, channelId, text);
    return { notified: true };
  } catch (err) {
    if (err instanceof SlackServiceError) {
      // Slack error codes (e.g. slack_api_error, slack_timeout) are generic and
      // never contain the token — safe to surface.
      return { notified: false, reason: err.code.toLowerCase() };
    }
    return { notified: false, reason: 'slack_error' };
  }
}

/**
 * Build the Slack message text: a fixed `[jira_key]` project label prefix (never
 * the raw repo name) followed by the mention-sanitized, length-capped message body.
 */
function buildSlackText(jiraKey: string, message: string): string {
  const prefix = `[${jiraKey}] `;
  const sanitized = sanitizeSlackText(message);
  const available = SLACK_MAX_TEXT_LEN - prefix.length;
  const body = sanitized.length > available ? `${sanitized.slice(0, available - 1)}…` : sanitized;
  return `${prefix}${body}`;
}

/**
 * Neutralize Slack broadcast/mention injection (SEC-L1). Escaping `&`, `<`, `>`
 * (Slack's control characters) makes it impossible for a crafted `message` to
 * produce a live `<!channel>` / `<!here>` / `<@…>` / `<#…>` token — the text is
 * posted as literal plain text.
 */
function sanitizeSlackText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
