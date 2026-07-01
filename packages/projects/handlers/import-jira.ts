/**
 * POST /api/projects/import-jira
 * One-time bulk import from Jira CST board.
 * Admin-only. Guard via SSM Parameter to prevent re-execution.
 * See specs/api/projects.yaml for API documentation.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';
import { withAdminOnly } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, ValidationError, ConflictError, AppError } from '@kiro-governance/shared/middleware/error-handler';
import { getPool } from '@kiro-governance/shared/db/pool';
import { ImportJiraInput, ImportJiraResponse } from '../types';

const ssm = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });
const secretsManager = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

const ImportJiraInputSchema = z.object({
  jira_base_url: z.string().url(),
  project_key: z.string(),
});

interface JiraIssue {
  key: string;
  id: string;
  fields: {
    summary: string;
    description: string | null;
    status: { name: string };
    customfield_10100?: string; // project_manager
    customfield_10101?: string; // solution_architect
    customfield_10102?: string; // account_executive
    customfield_10103?: string; // engineers_assigned
    customfield_10104?: string; // planned_kickoff_date
    customfield_10105?: string; // expected_completion_date
    customfield_10106?: string; // sow_hours
    customfield_10107?: string; // project_type
  };
}

/**
 * Fetch Jira API credentials from Secrets Manager.
 */
async function getJiraCredentials(): Promise<{ email: string; api_token: string }> {
  try {
    const response = await secretsManager.send(
      new GetSecretValueCommand({
        SecretId: '/deliverpro/integrations/jira-api-token',
      }),
    );

    if (!response.SecretString) {
      throw new Error('Secret value not found');
    }

    return JSON.parse(response.SecretString);
  } catch (error) {
    throw new AppError('JIRA_CREDENTIALS_ERROR', 'Failed to retrieve Jira API credentials', 502);
  }
}

/**
 * Check if import has already been completed via SSM.
 */
async function isImportCompleted(): Promise<boolean> {
  try {
    const response = await ssm.send(
      new GetParameterCommand({
        Name: '/deliverpro/config/jira-import-completed',
      }),
    );
    return response.Parameter?.Value === 'true';
  } catch (error: any) {
    // Parameter doesn't exist yet — not completed
    if (error.name === 'ParameterNotFound') {
      return false;
    }
    throw error;
  }
}

/**
 * Mark import as completed in SSM.
 */
async function markImportCompleted(): Promise<void> {
  await ssm.send(
    new PutParameterCommand({
      Name: '/deliverpro/config/jira-import-completed',
      Value: 'true',
      Type: 'String',
      Overwrite: true,
    }),
  );
}

/**
 * Fetch all issues from a Jira project.
 */
async function fetchJiraIssues(
  baseUrl: string,
  projectKey: string,
  email: string,
  apiToken: string,
): Promise<JiraIssue[]> {
  const allIssues: JiraIssue[] = [];
  const pageSize = 100;
  let startAt = 0;
  let isFinished = false;

  while (!isFinished) {
    try {
      const url = new URL(`${baseUrl}/rest/api/3/search`);
      url.searchParams.set('jql', `project=${projectKey}`);
      url.searchParams.set('maxResults', pageSize.toString());
      url.searchParams.set('startAt', startAt.toString());
      url.searchParams.set('fields', [
        'summary',
        'description',
        'status',
        'customfield_10100',
        'customfield_10101',
        'customfield_10102',
        'customfield_10103',
        'customfield_10104',
        'customfield_10105',
        'customfield_10106',
        'customfield_10107',
      ].join(','));

      const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new AppError('JIRA_UNAVAILABLE', `Jira API returned ${response.status}`, 502);
      }

      const data = await response.json();
      allIssues.push(...data.issues);
      isFinished = startAt + pageSize >= data.total;
      startAt += pageSize;
    } catch (error: any) {
      throw new AppError(
        'JIRA_UNAVAILABLE',
        error.message || 'Failed to connect to Jira API',
        502,
      );
    }
  }

  return allIssues;
}

async function importJiraProjects(
  input: ImportJiraInput,
): Promise<ImportJiraResponse> {
  const pool = await getPool();

  // Check if already completed
  if (await isImportCompleted()) {
    throw new ConflictError('Jira import has already been executed');
  }

  // Fetch Jira credentials
  const creds = await getJiraCredentials();

  // Fetch all issues from Jira
  const jiraIssues = await fetchJiraIssues(
    input.jira_base_url,
    input.project_key,
    creds.email,
    creds.api_token,
  );

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ jira_key: string; reason: string }> = [];

  // Insert into database
  for (const issue of jiraIssues) {
    try {
      const result = await pool.query(
        `INSERT INTO projects (
          jira_key, jira_id, title, description, status,
          project_manager, solution_architect, account_executive,
          engineers_assigned, planned_kickoff_date, expected_completion_date,
          sow_hours, project_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (jira_key) DO NOTHING`,
        [
          issue.key,
          issue.id,
          issue.fields.summary,
          issue.fields.description || null,
          issue.fields.status?.name || null,
          issue.fields.customfield_10100 || null,
          issue.fields.customfield_10101 || null,
          issue.fields.customfield_10102 || null,
          issue.fields.customfield_10103 || null,
          issue.fields.customfield_10104 || null,
          issue.fields.customfield_10105 || null,
          issue.fields.customfield_10106 ? parseFloat(issue.fields.customfield_10106) : null,
          issue.fields.customfield_10107 || null,
        ],
      );

      if (result.rowCount === 0) {
        // ON CONFLICT — already exists
        skipped++;
      } else {
        imported++;
      }
    } catch (error: any) {
      failed++;
      errors.push({
        jira_key: issue.key,
        reason: error.message || 'Unknown error',
      });
    }
  }

  // Mark as completed
  await markImportCompleted();

  return {
    imported,
    skipped,
    failed,
    errors,
  };
}

export const handler = withAdminOnly(async (event: APIGatewayProxyEvent, context: any): Promise<APIGatewayProxyResult> => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const input = ImportJiraInputSchema.parse(body);

    const result = await importJiraProjects(input);

    return ok(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleError(new ValidationError('Invalid request body', {}));
    }
    return handleError(error);
  }
});
