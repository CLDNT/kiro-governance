import { z } from 'zod';
import { ALLOWED_CONTENT_TYPES } from './types';

export const UploadUrlRequestSchema = z.object({
  projectId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  phase: z.string().regex(/^phase-[0-4]$/),
  checkpointName: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
  fileName: z.string().min(1).max(255),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
});

export const DownloadUrlRequestSchema = z.object({
  s3Key: z.string().min(10).max(1024).regex(/^(evidence|transcripts)\/[A-Za-z0-9._\/-]+$/),
});
