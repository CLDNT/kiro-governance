# Files Domain Architecture — Phase 2: DeliverPro

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-30 | v1.1 | AWS Architect | Security Gate 1 fix: §4.2 + §7.2 + §7.3 — added project-membership authorization check on POST /api/files/download-url to prevent cross-project file access |
| 2026-06-30 | v1.0 | AWS Architect | Initial files architecture from SRS v1.3 (FR-P2-012), gates-architecture §6.3 |

---

## 1. Domain Responsibility

The `files` domain owns presigned URL generation for direct browser uploads/downloads to S3. It does **not** write to the database — the `gates` domain records the S3 key in `gate_evidence` after the client confirms a successful upload. This separation keeps the files domain stateless and single-purpose.

**Interaction with gates domain (from gates-architecture §6.3):**

```
User clicks "Upload File"
  → Frontend calls files domain: POST /api/files/upload-url { projectId, phase, checkpointName, fileName, contentType }
  → Files domain validates input + returns { uploadUrl, s3Key, expiresIn: 300 }
  → Frontend uploads file directly to S3 via presigned PUT URL
  → Frontend calls gates domain: POST /checkpoints/{id}/evidence { evidence_type: 'file_upload', value: s3Key, label: fileName }
  → Gates domain inserts gate_evidence row
```

---

## 2. S3 Bucket Design

| Property | Value | Source |
|----------|-------|--------|
| Bucket name | `deliverpro-evidence-{accountId}` (e.g. `deliverpro-evidence-504649076991`) | Task spec |
| Region | `us-east-1` | SRS §4.3 A1 — all resources in ceanalytics account |
| Block Public Access | All 4 settings enabled | SRS §6 NFR-P2-003, task spec |
| Encryption | SSE-S3 (AES-256, AWS-managed key) | Task spec — default encryption, no KMS cost |
| Versioning | Disabled | Task spec — overwrite is not a use case; ULID prefix ensures uniqueness |
| Lifecycle | None — files retained indefinitely | SRS FR-P2-012: "files retained indefinitely" |
| Object Lock | Disabled | Not required — append-only enforced by key uniqueness (ULID), not S3 immutability |

### 2.1 CORS Configuration

Required for direct browser uploads via presigned PUT URL:

```json
[
  {
    "AllowedOrigins": [
      "https://*.cloudfront.net",
      "http://localhost:5173"
    ],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["Content-Type", "Content-Length", "x-amz-content-sha256"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

> **Note:** When OQ-P2-010 resolves with a custom domain (e.g. `deliverpro.cloudelligent.com`), add it to `AllowedOrigins`.

### 2.2 Bucket Policy

The bucket is private. Only the Lambda execution role can generate presigned URLs. No direct public access, no CloudFront OAC (evidence files are served via presigned GET URLs, not CloudFront).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyUnencryptedUploads",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::deliverpro-evidence-504649076991/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": "AES256"
        }
      }
    }
  ]
}
```

---

## 3. S3 Key Pattern

```
evidence/{projectId}/{phase}/{checkpointName}/{ulid}-{fileName}
```

| Segment | Example | Purpose |
|---------|---------|---------|
| `evidence/` | Fixed prefix | IAM scope boundary; separates from `transcripts/` prefix used by analysis domain |
| `{projectId}` | `CST-674` | Project isolation |
| `{phase}` | `phase-2` | Organizational grouping |
| `{checkpointName}` | `kickoff-call` | Associates file to checkpoint |
| `{ulid}-{fileName}` | `01J5KXYZ-requirements.pdf` | ULID prefix ensures uniqueness; original filename preserved for display |

**Constraints:**
- `projectId`: validated against `^[A-Za-z0-9_-]{1,64}$`
- `phase`: validated against `^phase-[0-4]$`
- `checkpointName`: validated against `^[a-z0-9-]{1,128}$`
- `fileName`: sanitized — only `[A-Za-z0-9._-]` allowed; other chars replaced with `_`; max 255 chars

---

## 4. API Endpoints

### 4.1 `POST /api/files/upload-url`

Generate a presigned PUT URL for direct browser upload.

**Allowed roles:** `pm`, `sa`, `leadership`, `admin`

**Request body:**

```typescript
interface UploadUrlRequest {
  projectId: string;   // e.g. "CST-674"
  phase: string;       // e.g. "phase-2"
  checkpointName: string; // e.g. "kickoff-call"
  fileName: string;    // e.g. "requirements.pdf"
  contentType: string; // e.g. "application/pdf"
}
```

**Response (200):**

```typescript
interface UploadUrlResponse {
  uploadUrl: string;   // Presigned PUT URL
  s3Key: string;       // Full S3 key (frontend uses this to create gate_evidence)
  expiresIn: 300;      // Seconds
}
```

**Presigned URL conditions:**
- `Content-Type` must match the requested `contentType`
- `Content-Length-Range`: 1 byte to 26,214,400 bytes (25 MB)

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `INVALID_CONTENT_TYPE` | `contentType` not in allowed list |
| 400 | `VALIDATION_ERROR` | Missing/malformed field or filename contains invalid chars |
| 401 | `UNAUTHORIZED` | Missing/expired JWT |
| 403 | `FORBIDDEN` | Role `engineer` attempting upload |

### 4.2 `POST /api/files/download-url`

Generate a presigned GET URL for file download.

**Allowed roles:** `pm`, `sa`, `engineer`, `leadership`, `admin` (all authenticated users can download)

**Request body:**

```typescript
interface DownloadUrlRequest {
  s3Key: string; // e.g. "evidence/CST-674/phase-2/kickoff-call/01J5KXYZ-requirements.pdf"
}
```

**Response (200):**

```typescript
interface DownloadUrlResponse {
  downloadUrl: string; // Presigned GET URL
  expiresIn: 300;      // Seconds
}
```

**Authorization check (MANDATORY):**

Before generating the presigned URL, the handler MUST verify the requesting user has access to the project that owns the file:

1. Query `gate_evidence` to confirm the `s3Key` exists as a `value` in that table
2. Extract the `project_id` from the matching `gate_evidence` row
3. Verify the requesting user is associated with that project: either `project_manager`, `solution_architect`, or listed in `engineers_assigned` on the `projects` row — OR the user's role is `leadership` or `admin` (bypasses project membership check)
4. If no `gate_evidence` row matches the `s3Key`, return 404 `FILE_NOT_FOUND`
5. If the user is not associated with the project, return 403 `FORBIDDEN`

> **Exception:** Keys starting with `transcripts/` follow the same project-membership check — the `project_id` segment is extracted directly from the S3 key pattern `transcripts/{project_id}/...` and validated against user association.

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `INVALID_S3_KEY` | `s3Key` does not match allowed prefix pattern |
| 401 | `UNAUTHORIZED` | Missing/expired JWT |
| 403 | `FORBIDDEN` | User is not associated with the project that owns the file |
| 404 | `FILE_NOT_FOUND` | `s3Key` not found in `gate_evidence` (evidence prefix) or project does not exist (transcript prefix) |

---

## 5. Allowed File Types

| Extension | MIME Type |
|-----------|----------|
| `.pdf` | `application/pdf` |
| `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| `.png` | `image/png` |
| `.jpg` | `image/jpeg` |
| `.jpeg` | `image/jpeg` |
| `.txt` | `text/plain` |
| `.md` | `text/markdown` |

**Max file size:** 25 MB (26,214,400 bytes), enforced via presigned URL `Content-Length-Range` condition.

---

## 6. TypeScript Interfaces

```typescript
// packages/files/types.ts

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
```

---

## 7. Handler Implementations

### 7.1 Upload URL Handler

```typescript
// packages/files/handlers/upload-url.ts
import { APIGatewayProxyHandler } from 'aws-lambda';
import { requireRole } from '@deliverpro/shared/middleware/auth';
import { generateUploadUrl } from '../services/presign.service';
import { UploadUrlRequestSchema } from '../validation';

export const handler: APIGatewayProxyHandler = async (event) => {
  const auth = requireRole(['pm', 'sa', 'leadership', 'admin'])(event);
  const body = UploadUrlRequestSchema.parse(JSON.parse(event.body || '{}'));
  const result = await generateUploadUrl(body);
  return { statusCode: 200, body: JSON.stringify(result) };
};
```

### 7.2 Download URL Handler

```typescript
// packages/files/handlers/download-url.ts
import { APIGatewayProxyHandler } from 'aws-lambda';
import { requireRole, extractAuth } from '@deliverpro/shared/middleware/auth';
import { generateDownloadUrl } from '../services/presign.service';
import { DownloadUrlRequestSchema } from '../validation';

export const handler: APIGatewayProxyHandler = async (event) => {
  const auth = requireRole(['pm', 'sa', 'engineer', 'leadership', 'admin'])(event);
  const body = DownloadUrlRequestSchema.parse(JSON.parse(event.body || '{}'));
  const result = await generateDownloadUrl(body, auth);
  return { statusCode: 200, body: JSON.stringify(result) };
};
```

### 7.3 Presign Service

```typescript
// packages/files/services/presign.service.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ulid } from 'ulid';
import { ALLOWED_CONTENT_TYPES, MAX_FILE_SIZE_BYTES, S3_KEY_PREFIX_ALLOWLIST } from '../types';
import { AppError } from '@deliverpro/shared/errors';

const s3 = new S3Client({});
const BUCKET = process.env.EVIDENCE_BUCKET_NAME!;

export async function generateUploadUrl(input: {
  projectId: string;
  phase: string;
  checkpointName: string;
  fileName: string;
  contentType: string;
}): Promise<{ uploadUrl: string; s3Key: string; expiresIn: 300 }> {
  if (!ALLOWED_CONTENT_TYPES.includes(input.contentType as any)) {
    throw new AppError('INVALID_CONTENT_TYPE', `Content type '${input.contentType}' is not allowed`, 400);
  }

  const sanitizedFileName = input.fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 255);
  const s3Key = `evidence/${input.projectId}/${input.phase}/${input.checkpointName}/${ulid()}-${sanitizedFileName}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    ContentType: input.contentType,
  });

  const uploadUrl = await getSignedUrl(s3, command, {
    expiresIn: 300,
    signableHeaders: new Set(['content-type']),
    conditions: [['content-length-range', 1, MAX_FILE_SIZE_BYTES]],
  });

  return { uploadUrl, s3Key, expiresIn: 300 };
}

export async function generateDownloadUrl(input: {
  s3Key: string;
}, auth: { role: string; email: string }): Promise<{ downloadUrl: string; expiresIn: 300 }> {
  // Validate prefix to prevent path traversal
  const allowed = S3_KEY_PREFIX_ALLOWLIST.some((prefix) => input.s3Key.startsWith(prefix));
  if (!allowed || /\.\./.test(input.s3Key)) {
    throw new AppError('INVALID_S3_KEY', 'S3 key must start with evidence/ or transcripts/ and cannot contain path traversal', 400);
  }

  // --- Project-membership authorization check (Security Gate 1, Finding #2) ---
  // Leadership and admin roles bypass project-membership check
  if (!['leadership', 'admin'].includes(auth.role)) {
    let projectId: string;

    if (input.s3Key.startsWith('evidence/')) {
      // Look up the s3Key in gate_evidence to find owning project
      const evidenceRow = await pool.query(
        'SELECT project_id FROM gate_evidence WHERE value = $1 LIMIT 1',
        [input.s3Key]
      );
      if (evidenceRow.rows.length === 0) {
        throw new AppError('FILE_NOT_FOUND', 'File not found in evidence records', 404);
      }
      projectId = evidenceRow.rows[0].project_id;
    } else {
      // transcripts/{project_id}/... — extract projectId from key
      const segments = input.s3Key.split('/');
      projectId = segments[1]; // transcripts/{projectId}/...
      if (!projectId) {
        throw new AppError('INVALID_S3_KEY', 'Cannot determine project from S3 key', 400);
      }
    }

    // Verify user is associated with the project
    const projectRow = await pool.query(
      `SELECT 1 FROM projects
       WHERE jira_key = $1
         AND (project_manager = $2 OR solution_architect = $2 OR engineers_assigned ILIKE '%' || $2 || '%')`,
      [projectId, auth.email]
    );
    if (projectRow.rows.length === 0) {
      throw new AppError('FORBIDDEN', 'You do not have access to files for this project', 403);
    }
  }
  // --- End authorization check ---

  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: input.s3Key,
  });

  const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
  return { downloadUrl, expiresIn: 300 };
}
```

---

## 8. Validation Schemas (Zod)

```typescript
// packages/files/validation.ts
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
```

---

## 9. IAM Policy

The Lambda execution role for the files domain requires:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EvidenceUpload",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::deliverpro-evidence-504649076991/evidence/*"
    },
    {
      "Sid": "EvidenceAndTranscriptDownload",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": [
        "arn:aws:s3:::deliverpro-evidence-504649076991/evidence/*",
        "arn:aws:s3:::deliverpro-evidence-504649076991/transcripts/*"
      ]
    }
  ]
}
```

**Principle of least privilege:**
- `PutObject` scoped to `evidence/` prefix only — the files domain cannot write to `transcripts/` (that's the analysis domain's responsibility)
- `GetObject` scoped to both `evidence/` and `transcripts/` — users can download evidence files and fetched transcripts
- No `DeleteObject` — files are retained indefinitely per SRS

---

## 10. CDK Infrastructure

```typescript
// packages/files/infra.ts
import { NestedStack, NestedStackProps, Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface FilesInfraProps extends NestedStackProps {
  api: /* RestApi reference */;
  envName: 'dev' | 'prod';
  accountId: string;
}

export class FilesInfra extends NestedStack {
  public readonly evidenceBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: FilesInfraProps) {
    super(scope, id, props);

    this.evidenceBucket = new s3.Bucket(this, 'EvidenceBucket', {
      bucketName: `deliverpro-evidence-${props.accountId}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      removalPolicy: props.envName === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: props.envName !== 'prod',
      cors: [
        {
          allowedOrigins: ['https://*.cloudfront.net', 'http://localhost:5173'],
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedHeaders: ['Content-Type', 'Content-Length', 'x-amz-content-sha256'],
          exposedHeaders: ['ETag'],
          maxAge: 3600,
        },
      ],
    });

    // Lambda definitions for upload-url and download-url handlers
    // (Uses shared ProjectLambdaFunction construct from infra/constructs/)
    // Grants:
    //   uploadUrlFn.role → evidenceBucket.grantPut (scoped to evidence/*)
    //   downloadUrlFn.role → evidenceBucket.grantRead (scoped to evidence/* and transcripts/*)
  }
}
```

---

## 11. Edge Cases

| Scenario | Handling | Layer |
|----------|----------|-------|
| File > 25 MB | Presigned URL policy includes `Content-Length-Range` condition. S3 rejects the PUT with HTTP 403 `AccessDenied`. Frontend catches the 403 and shows "File exceeds 25 MB limit". | S3 (server-side enforcement) |
| Invalid contentType | Zod validation rejects before presigned URL is generated. Returns HTTP 400 `INVALID_CONTENT_TYPE`. | Lambda |
| s3Key path traversal (`../`) | `DownloadUrlRequestSchema` regex rejects keys containing `..`. `generateDownloadUrl` double-checks with `/\.\./.test()`. Returns HTTP 400 `INVALID_S3_KEY`. | Lambda |
| s3Key with disallowed prefix | Only keys starting with `evidence/` or `transcripts/` accepted. Returns HTTP 400 `INVALID_S3_KEY`. | Lambda |
| Presigned URL expires (>5 min) | Frontend must request a new presigned URL. Upload progress lost — frontend should warn user before starting large uploads. | Frontend |
| S3 service unavailable | `getSignedUrl` does not call S3 (it's a local signing operation). The actual PUT/GET may fail — frontend retries once, then shows error. | Frontend/S3 |
| Duplicate file names | ULID prefix guarantees uniqueness. Two files with the same name get different S3 keys. No conflict. | Lambda (ULID generation) |
| fileName with special characters | Sanitized to `[A-Za-z0-9._-]` before inclusion in S3 key. Original name preserved in `gate_evidence.label` (gates domain). | Lambda |
| Engineer attempts upload | `requireRole(['pm', 'sa', 'leadership', 'admin'])` rejects with HTTP 403. | Lambda middleware |

---

## 12. Cost Estimate

| Component | Monthly Cost | Notes |
|-----------|-------------|-------|
| S3 Standard storage | ~$0.50 | Estimated 20 GB first year (200 projects × ~100 MB evidence each). $0.023/GB. |
| S3 PUT requests | ~$0.05 | ~10,000 uploads/month. $0.005/1000 requests. |
| S3 GET requests | ~$0.01 | ~20,000 downloads/month. $0.0004/1000 requests. |
| Data transfer (out via presigned URL) | ~$0.50 | ~5 GB/month egress. $0.09/GB first 10 TB. |
| Lambda (2 handlers) | ~$0.00 | Presigned URL generation is CPU-trivial. <100ms per invocation. Covered by free tier. |
| **Total files domain** | **~$1/mo** | Grows linearly with storage volume. |

> Pricing source: AWS S3 pricing (us-east-1), verified against `Architect decision — not customer-specified`.

---

*End of Files Architecture v1.0*
