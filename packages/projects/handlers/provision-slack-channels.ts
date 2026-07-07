/**
 * POST /api/projects/{projectId}/slack/provision
 * Resolve-or-create the project's micro + macro Slack channels and persist the
 * resulting channel ids via the CR-02 audited linkage path.
 *
 * Admin/leadership only (linkage mutation, projects-architecture §12.1). Uses the
 * SEPARATE provisioning credential (channels:read + channels:manage — SEC-M1 two-token
 * split), never the runtime chat:write bot token. Idempotent: a re-run resolves the
 * existing channels (no duplicate created) and, when the stored ids already match,
 * performs NO write (so no redundant project_link_audit row).
 *
 * The provisioning token is never returned, persisted, or logged — only the non-secret
 * channel ids reach the response and the projects columns.
 *
 * See specs/api/projects.yaml and docs/phase2/projects-architecture.md §12.4 (FR-P2-039).
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { SSMClient } from '@aws-sdk/client-ssm';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, AppError } from '@kiro-governance/shared/middleware/error-handler';
import { getPool } from '@kiro-governance/shared/db/pool';
import { AuthContext } from '@kiro-governance/shared/types/auth';
import { ProvisionSlackChannelsResponse } from '../types';
import {
  getProvisioningToken,
  resolveOrCreateChannel,
  microChannelName,
  macroChannelName,
  SlackProvisioningError,
} from '../services/slack-provisioning.service';

// Instantiate the SSM client outside the handler for execution-environment reuse.
const ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });

interface ProjectRow {
  jira_key: string;
  slack_micro_channel_id: string | null;
  slack_macro_channel_id: string | null;
}

async function provisionSlackChannels(
  projectId: string,
  auth: AuthContext,
): Promise<ProvisionSlackChannelsResponse> {
  const pool = await getPool();

  // Load only what we need — never select or return a secret.
  const existing = await pool.query(
    `SELECT jira_key, slack_micro_channel_id, slack_macro_channel_id
       FROM projects WHERE jira_key = $1`,
    [projectId],
  );
  if (existing.rows.length === 0) {
    throw new NotFoundError('Project', projectId);
  }
  const project = existing.rows[0] as ProjectRow;

  // Resolve-or-create both channels with the provisioning credential (SEC-M1).
  const token = await getProvisioningToken(ssmClient);
  const micro = await resolveOrCreateChannel(token, microChannelName(project.jira_key));
  const macro = await resolveOrCreateChannel(token, macroChannelName(project.jira_key));

  // Persist via the CR-02 audited linkage path ONLY when an id actually changed.
  // Setting updated_by (Cognito sub) + updated_at drives the BEFORE UPDATE
  // `audit_project_linkage` trigger to write one project_link_audit row per changed
  // field. Skipping the write on a no-op re-run keeps the operation idempotent and
  // avoids a redundant audit row.
  const changed =
    micro.id !== project.slack_micro_channel_id || macro.id !== project.slack_macro_channel_id;

  if (changed) {
    await pool.query(
      `UPDATE projects
          SET slack_micro_channel_id = $1,
              slack_macro_channel_id = $2,
              updated_by = $3,
              updated_at = now()
        WHERE jira_key = $4`,
      [micro.id, macro.id, auth.userId, project.jira_key],
    );
  }

  return {
    project_id: project.jira_key,
    slack_micro_channel_id: micro.id,
    slack_macro_channel_id: macro.id,
    provisioned: {
      micro: { channel_id: micro.id, created: micro.created },
      macro: { channel_id: macro.id, created: macro.created },
    },
    persisted: changed,
  };
}

export const handler = withRoles(
  ['admin', 'leadership'],
  async (event: APIGatewayProxyEvent, context: Context & { auth: AuthContext }): Promise<APIGatewayProxyResult> => {
    try {
      const projectId = event.pathParameters?.projectId;
      if (!projectId) {
        throw new Error('Missing projectId path parameter');
      }

      const result = await provisionSlackChannels(projectId, context.auth);
      return ok(result);
    } catch (error) {
      // Upstream Slack / SSM failures surface as a generic 502 — the SlackProvisioningError
      // `code`/`message` are already secret-free (no token, no SSM path).
      if (error instanceof SlackProvisioningError) {
        return handleError(new AppError(error.code, error.message, 502));
      }
      return handleError(error);
    }
  },
);
