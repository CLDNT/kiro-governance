/**
 * Files domain types — presigned URL generation
 */

export const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'text/plain',
  'text/markdown',
] as const;

export type AllowedContentType = typeof ALLOWED_CONTENT_TYPES[number];

export const MAX_FILE_SIZE_BYTES = 26_214_400; // 25 MB
export const S3_KEY_PREFIX_ALLOWLIST = ['evidence/', 'transcripts/'] as const;

export interface UploadUrlRequest {
  projectId: string;
  phase: string;
  checkpointName: string;
  fileName: string;
  contentType: AllowedContentType;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  s3Key: string;
  expiresIn: 300;
}

export interface DownloadUrlRequest {
  s3Key: string;
}

export interface DownloadUrlResponse {
  downloadUrl: string;
  expiresIn: 300;
}

export interface AuthContext {
  role: string;
  email: string;
}
