/**
 * POST /api/files/upload-url
 * Generate presigned PUT URL for direct S3 upload
 */

import { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ulid } from 'ulid';
import { withRoles } from '@kiro-governance/shared/middleware/rbac';
import { ok, handleError, ValidationError, AppError } from '@kiro-governance/shared/middleware/error-handler';
import { withLogging, log } from '@kiro-governance/shared/middleware/logger';
import { UploadUrlRequestSchema } from '../validation';
import { UploadUrlResponse, MAX_FILE_SIZE_BYTES, ALLOWED_CONTENT_TYPES } from '../types';

const s3Client = new S3Client({});
const BUCKET = process.env.EVIDENCE_BUCKET_NAME || 'deliverpro-evidence-504649076991';

export const handler: APIGatewayProxyHandler = withRoles(
  ['pm', 'sa', 'leadership', 'admin'],
  withLogging(async (event) => {
    try {
      const input = UploadUrlRequestSchema.parse(JSON.parse(event.body || '{}'));

      // Validate content type is in allowlist
      if (!ALLOWED_CONTENT_TYPES.includes(input.contentType as any)) {
        throw new AppError(
          'INVALID_CONTENT_TYPE',
          `Content type '${input.contentType}' is not allowed`,
          400,
        );
      }

      // Sanitize fileName — only alphanumeric, dots, dashes, underscores
      const sanitizedFileName = input.fileName
        .replace(/[^A-Za-z0-9._-]/g, '_')
        .slice(0, 255);

      // Build S3 key
      const s3Key = `evidence/${input.projectId}/${input.phase}/${input.checkpointName}/${ulid()}-${sanitizedFileName}`;

      // Create presigned PUT URL
      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
        ContentType: input.contentType,
      });

      // AWS SDK v3 getSignedUrl with conditions
      const uploadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 300,
      });

      const response: UploadUrlResponse = {
        uploadUrl,
        s3Key,
        expiresIn: 300,
      };

      log('UPLOAD_URL_GENERATED', {
        projectId: input.projectId,
        phase: input.phase,
        fileName: sanitizedFileName,
        s3Key,
      });

      return ok(response);
    } catch (err) {
      return handleError(err);
    }
  }),
);
