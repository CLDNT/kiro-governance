/**
 * POST /api/projects/{projectId}/checkpoints/{checkpointId}/fetch-transcript
 * Fetch meeting transcript from Avoma and store in S3
 * Source: analysis-architecture.md §3.1
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, NotFoundError, ValidationError, AppError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging, log } from '@kiro-governance/shared/middleware/logger';
import { queryOne } from '@kiro-governance/shared/db/pool';
import { fetchTranscriptFromAvoma } from '../services/avoma.service';
import type { FetchTranscriptResponse } from '../types';

const s3Client = new S3Client({});
const secretsClient = new SecretsManagerClient({});

interface CheckpointRow {
  checkpoint_name: string;
  meeting_link: string | null;
}

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'sa', 'leadership', 'admin'],
  withLogging(async (event: any) => {
    try {
      const projectId = event.pathParameters?.projectId;
      const checkpointId = event.pathParameters?.checkpointId;

      if (!projectId || !checkpointId) {
        throw new ValidationError('Project ID and checkpoint ID are required');
      }

      // Verify checkpoint exists and has meeting_link
      const checkpoint = await queryOne<CheckpointRow>(
        `SELECT checkpoint_name, meeting_link FROM macro_checkpoints 
         WHERE id = $1 AND project_id = $2`,
        [checkpointId, projectId]
      );

      if (!checkpoint) {
        throw new NotFoundError('Checkpoint', checkpointId);
      }

      if (!checkpoint.meeting_link) {
        throw new AppError(
          'NO_MEETING_LINK',
          'Checkpoint has no meeting link. Please attach a meeting link evidence first.',
          400
        );
      }

      // Fetch API key from Secrets Manager
      let apiKey: string;
      try {
        const secretResponse = await secretsClient.send(
          new GetSecretValueCommand({
            SecretId: process.env.AVOMA_SECRET_ARN || '/deliverpro/avoma-api-key',
          })
        );

        apiKey = secretResponse.SecretString || '';
        if (!apiKey) {
          throw new Error('Secret value is empty');
        }
      } catch (err) {
        log('SECRETS_ERROR', { error: String(err) });
        throw new AppError(
          'AVOMA_UNAVAILABLE',
          'Failed to retrieve Avoma API credentials',
          502
        );
      }

      // Fetch transcript from Avoma
      const transcript = await fetchTranscriptFromAvoma(checkpoint.meeting_link, apiKey);

      // Store in S3
      const isoTimestamp = new Date().toISOString();
      const s3Key = `transcripts/${projectId}/${checkpoint.checkpoint_name}/${isoTimestamp}.txt`;

      try {
        await s3Client.send(
          new PutObjectCommand({
            Bucket: process.env.EVIDENCE_BUCKET,
            Key: s3Key,
            Body: transcript.transcript_text,
            ContentType: 'text/plain',
          })
        );

        log('TRANSCRIPT_STORED', { projectId, checkpointId, s3Key });
      } catch (err) {
        log('S3_UPLOAD_ERROR', { error: String(err), s3Key });
        // S3 storage failure is best-effort — don't block the response
        // But log it for operational awareness
      }

      // Update checkpoint with transcript_url
      const transcriptUrl = `s3://${process.env.EVIDENCE_BUCKET}/${s3Key}`;

      await queryOne(
        `UPDATE macro_checkpoints 
         SET transcript_url = $1 
         WHERE id = $2 AND project_id = $3`,
        [transcriptUrl, checkpointId, projectId]
      );

      const charCount = transcript.transcript_text.length;

      log('FETCH_TRANSCRIPT_COMPLETE', {
        projectId,
        checkpointId,
        charCount,
        s3Key,
      });

      return ok({
        transcript_url: transcriptUrl,
        char_count: charCount,
      } as FetchTranscriptResponse);
    } catch (err) {
      return handleError(err);
    }
  })
);
