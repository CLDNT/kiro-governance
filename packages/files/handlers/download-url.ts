/**
 * POST /api/files/download-url
 * Generate presigned GET URL for S3 download with project membership authorization
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, ValidationError, AppError, NotFoundError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging, log } from '@kiro-governance/shared/middleware/logger';
import { queryOne } from '@kiro-governance/shared/db/pool';
import { DownloadUrlRequestSchema } from '../validation';
import { DownloadUrlResponse, S3_KEY_PREFIX_ALLOWLIST, AuthContext } from '../types';

const s3Client = new S3Client({});
const BUCKET = process.env.EVIDENCE_BUCKET_NAME || 'deliverpro-evidence-504649076991';

interface AuthContextData {
  role: string;
  email: string;
}

interface EvidenceRow {
  project_id: string;
}

interface ProjectRow {
  jira_key: string;
}

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'sa', 'engineer', 'leadership', 'admin'],
  withLogging(async (event) => {
    try {
      const input = DownloadUrlRequestSchema.parse(JSON.parse(event.body || '{}'));

      // Validate S3 key format and prevent path traversal
      const allowed = S3_KEY_PREFIX_ALLOWLIST.some((prefix) => input.s3Key.startsWith(prefix));
      if (!allowed || /\.\./.test(input.s3Key)) {
        throw new AppError(
          'INVALID_S3_KEY',
          'S3 key must start with evidence/ or transcripts/ and cannot contain path traversal',
          400,
        );
      }

      // Extract auth context
      const role = event.requestContext?.authorizer?.claims?.['cognito:groups']?.[0] || 'user';
      const email = event.requestContext?.authorizer?.claims?.['email'] || 'unknown';
      const auth: AuthContextData = { role, email };

      // --- Project-membership authorization check ---
      // Leadership and admin bypass project-membership check (Security Gate 1)
      if (!['leadership', 'admin'].includes(auth.role)) {
        let projectId: string;

        if (input.s3Key.startsWith('evidence/')) {
          // Look up the s3Key in gate_evidence to find owning project
          const evidenceRow = await queryOne<EvidenceRow>(
            `SELECT project_id FROM gate_evidence WHERE value = $1 LIMIT 1`,
            [input.s3Key],
          );

          if (!evidenceRow) {
            throw new NotFoundError('File', input.s3Key);
          }
          projectId = evidenceRow.project_id;
        } else if (input.s3Key.startsWith('transcripts/')) {
          // transcripts/{project_id}/... — extract projectId from key
          const segments = input.s3Key.split('/');
          projectId = segments[1]; // transcripts/{projectId}/...

          if (!projectId) {
            throw new AppError(
              'INVALID_S3_KEY',
              'Cannot determine project from S3 key',
              400,
            );
          }

          // Verify project exists
          const projectRow = await queryOne<ProjectRow>(
            `SELECT jira_key FROM projects WHERE jira_key = $1`,
            [projectId],
          );
          if (!projectRow) {
            throw new NotFoundError('Project', projectId);
          }
        } else {
          throw new AppError('INVALID_S3_KEY', 'Unknown S3 key prefix', 400);
        }

        // Verify user is associated with the project
        const projectRow = await queryOne<{ jira_key: string }>(
          `SELECT jira_key FROM projects
           WHERE jira_key = $1
             AND (project_manager = $2 OR solution_architect = $2 OR engineers_assigned ILIKE '%' || $2 || '%')`,
          [projectId, email],
        );

        if (!projectRow) {
          throw new AppError(
            'FORBIDDEN',
            'You do not have access to files for this project',
            403,
          );
        }
      }
      // --- End authorization check ---

      // Create presigned GET URL
      const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: input.s3Key,
      });

      const downloadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 300,
      });

      const response: DownloadUrlResponse = {
        downloadUrl,
        expiresIn: 300,
      };

      log('DOWNLOAD_URL_GENERATED', {
        s3Key: input.s3Key,
        requestedBy: email,
        role: auth.role,
      });

      return ok(response);
    } catch (err) {
      return handleError(err);
    }
  }),
);
