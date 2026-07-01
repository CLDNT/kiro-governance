# Analysis Domain Architecture — Phase 2: DeliverPro

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-30 | v1.2 | AWS Architect | Resolved OQ-P2-002: Avoma REST API confirmed (dev.avoma.com/Transcriptions). Resolved PD-14: AgentCore model updated to `us.anthropic.claude-sonnet-4-5-20241022-v1:0` (cross-region inference). Resolved OQ-P2-006: default prompts seeded in V003, admin can overwrite. Removed ASSUMPTION blocks. Updated cost estimate to Sonnet pricing. |
| 2026-06-30 | v1.1 | AWS Architect | Security Gate 1 fix: §11 IAM bedrock:InvokeAgent scoped to specific agentId ARN (was wildcard agent/*) |
| 2026-06-30 | v1.0 | AWS Architect | Initial analysis domain architecture from SRS v1.3 (FR-P2-005, FR-P2-013), config-architecture v1.0 (analysis_prompts), gates-architecture v1.0 §6 (evidence storage) |

---

## ⚠️ Status: Deferred to Iteration 3

> This domain is **architecture-defined but not implemented** in Iterations 1 or 2.
> Implementation depends on: Bedrock AgentCore access.
> Source: SRS §12 — Iteration 3 scope.

---

## 1. Overview

The `analysis` domain orchestrates AI-powered transcript analysis for `transcript_analysis`-type checkpoints. It fetches meeting transcripts from Avoma, stores them in S3, invokes a Bedrock AgentCore agent with checkpoint-specific prompts, and writes structured results back to the gates domain's tables.

**Domain responsibilities:**

| Responsibility | SRS Source |
|---------------|-----------|
| Fetch transcript from Avoma API | FR-P2-013 |
| Store transcript in S3 | FR-P2-013 |
| Invoke AgentCore with checkpoint-specific prompt | FR-P2-005 |
| Write analysis result to `macro_checkpoints` + `gate_evidence` | FR-P2-005 |
| Error handling for external service failures | FR-P2-005, FR-P2-013 |

**Tables owned:** None — this domain writes to tables owned by the `gates` domain (`macro_checkpoints`, `gate_evidence`).

**Cross-domain reads:**
- Reads `analysis_prompts` (owned by `config`) to fetch the checkpoint-specific prompt
- Reads `macro_checkpoints` (owned by `gates`) to validate checkpoint state
- Reads `gate_evidence` (owned by `gates`) to get the meeting link

---

## 2. AgentCore Agent Design

### 2.1 Recommendation: Single Agent with Dynamic Prompt Injection

**Decision:** One Bedrock AgentCore agent handles all checkpoint types. The checkpoint-specific prompt is injected dynamically per invocation via the `inputText` parameter.

**Rationale:**

| Option | Pros | Cons |
|--------|------|------|
| Single agent + dynamic prompt | One agent to manage, prompts updated without agent rebuild, admin prompt edits take effect immediately | Slightly larger input payload per invocation |
| One agent per checkpoint type | Cleaner agent isolation | Requires creating/managing N agents; prompt changes require agent rebuild; admin edits require redeployment |

The single-agent approach aligns with FR-P2-029: "Prompt changes take effect immediately on the next analysis run (no restart required)." A per-checkpoint agent would require re-creating the agent each time an admin edits a prompt.

### 2.2 Agent Configuration

| Property | Value |
|----------|-------|
| Agent Name | `deliverpro-transcript-analyzer` |
| Foundation Model | Claude Sonnet 4.5 via Bedrock (cross-region inference: `us.anthropic.claude-sonnet-4-5-20241022-v1:0`) |
| Agent Instructions (base) | "You are a meeting transcript analyst. You analyze transcripts to determine whether required discussion topics were covered. Always return structured JSON." |
| Input | Checkpoint-specific prompt (from `analysis_prompts`) + transcript text |
| Output | Structured JSON (see §5) |
| Session | `{projectId}#{checkpointId}` — ensures stateless per-analysis invocation |
| Agent ID Source | SSM Parameter: `/deliverpro/config/agent-id` |

### 2.3 Why AgentCore (Not InvokeModel)

> Source: Phase 2 Transcript — "I'm gonna use the agent core, which is more specialized toward these kind of dynamic behaviors"

AgentCore provides:
- Multi-step reasoning for complex transcript analysis
- Built-in guardrails and response validation
- Session management for potential future multi-turn analysis
- Tool use capability for future enhancements (e.g., fetching supplementary data)

---

## 3. API Endpoints

### 3.1 `POST /api/projects/{projectId}/checkpoints/{checkpointId}/analyze`

**Purpose:** Trigger transcript analysis — fetch from Avoma, store in S3, invoke AgentCore, write result.
**Source:** FR-P2-005, FR-P2-013

| Property | Value |
|----------|-------|
| Auth roles | `pm`, `leadership`, `admin` |
| Handler | `packages/analysis/handlers/analyze-transcript.ts` |

**Path params:**
- `projectId` — the `jira_key`
- `checkpointId` — the `macro_checkpoints.id` (BIGSERIAL)

**Request body:** None (the meeting link is read from the checkpoint's evidence or `meeting_link` column).

**Response (200):**

```typescript
interface AnalysisResponse {
  analysis_result: TranscriptAnalysisResult;
  analysis_run_at: string;        // ISO 8601
  result_detail: string;          // human-readable summary
  transcript_s3_key: string;      // where the transcript was stored
}
```

**Error codes:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `NO_MEETING_LINK` | Checkpoint has no `meeting_link` and no `meeting_link` evidence |
| 400 | `INVALID_CHECKPOINT_TYPE` | Checkpoint is not `checkpoint_type = 'transcript_analysis'` |
| 404 | `CHECKPOINT_NOT_FOUND` | Checkpoint does not exist or does not belong to project |
| 502 | `AVOMA_UNAVAILABLE` | Avoma API call failed (network, auth, invalid link) |
| 502 | `AGENT_UNAVAILABLE` | Bedrock AgentCore invocation timed out or failed |
| 502 | `PROMPT_NOT_FOUND` | No prompt in `analysis_prompts` AND generic fallback also failed |

---

## 4. Avoma API Integration

### 4.1 Authentication

| Property | Value |
|----------|-------|
| Auth method | API Key (Bearer token) |
| Secret location | AWS Secrets Manager: `deliverpro/avoma-api-key` |
| Cache | In-memory for Lambda warm starts; re-fetched on cold start |

### 4.2 API Call

```typescript
// packages/analysis/services/avoma.service.ts

interface AvomaTranscriptResponse {
  transcript_text: string;
  meeting_title: string;
  meeting_date: string;
  duration_minutes: number;
  participants: string[];
}

async function fetchTranscript(meetingLink: string, apiKey: string): Promise<AvomaTranscriptResponse> {
  // Extract meeting ID from URL: https://app.avoma.com/meetings/{meetingId}
  const meetingId = extractMeetingId(meetingLink);

  const response = await fetch(`https://api.avoma.com/v1/transcriptions/${meetingId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30_000), // 30s timeout
  });

  if (!response.ok) {
    throw new AppError('AVOMA_UNAVAILABLE', `Avoma API returned ${response.status}`, 502);
  }

  return response.json();
}
```

> **Confirmed (OQ-P2-002 RESOLVED):** Avoma exposes a REST API at `https://api.avoma.com/v1/transcriptions` (Transcriptions tag — see https://dev.avoma.com/#tag/Transcriptions). Auth is Bearer token via Secrets Manager. API docs: https://dev.avoma.com/#section/Introduction/Authorization.

### 4.3 Transcript Storage

After fetching, the transcript is stored in S3 for audit trail and potential re-analysis:

```
S3 key: transcripts/{project_id}/{checkpoint_name}/{ISO_timestamp}.txt
Bucket: kiro-governance-evidence-{account_id}
```

```typescript
await s3Client.send(new PutObjectCommand({
  Bucket: process.env.EVIDENCE_BUCKET!,
  Key: `transcripts/${projectId}/${checkpointName}/${new Date().toISOString()}.txt`,
  Body: transcriptText,
  ContentType: 'text/plain',
}));
```

---

## 5. Bedrock AgentCore Invocation

### 5.1 Input Construction

```typescript
// packages/analysis/services/agent.service.ts

async function invokeAnalysisAgent(
  transcript: string,
  prompt: string,
  sessionId: string
): Promise<TranscriptAnalysisResult> {
  const agentId = process.env.AGENT_ID!; // from SSM at startup
  const agentAliasId = process.env.AGENT_ALIAS_ID!;

  const inputText = `${prompt}\n\n---TRANSCRIPT BEGIN---\n${transcript}\n---TRANSCRIPT END---`;

  const response = await bedrockAgentClient.send(new InvokeAgentCommand({
    agentId,
    agentAliasId,
    sessionId,
    inputText,
  }));

  // Parse streaming response chunks into complete text
  const responseText = await collectStreamResponse(response.completion);

  // Extract JSON from agent response
  return parseAnalysisResult(responseText);
}
```

### 5.2 Session ID Strategy

```typescript
const sessionId = `${projectId}#${checkpointId}`;
```

Each analysis invocation uses a unique session. This ensures:
- No cross-contamination between different checkpoint analyses
- AgentCore does not carry over context from a previous project's analysis
- Re-running analysis on the same checkpoint creates a fresh session (AgentCore sessions expire after inactivity)

### 5.3 SSM Parameters

| Parameter Path | Value | Purpose |
|---------------|-------|---------|
| `/deliverpro/config/agent-id` | `XXXXXXXXXX` | AgentCore agent ID |
| `/deliverpro/config/agent-alias-id` | `XXXXXXXXXX` | Agent alias (version pointer) |

---

## 6. Result Shape

### 6.1 TypeScript Interface

```typescript
// packages/shared/types/analysis.ts

export interface TranscriptAnalysisResult {
  topics_covered: string[];
  topics_missing: string[];
  key_points: string[];
  disagreements: string[];
  passed: boolean;
  confidence: number;   // 0.0 – 1.0
}
```

### 6.2 Example Result

```json
{
  "topics_covered": [
    "Project scope and deliverables",
    "Customer expectations and success criteria",
    "Timeline and milestones",
    "Resource allocation and team introduction"
  ],
  "topics_missing": [
    "Known risks and constraints",
    "Technical environment and access requirements"
  ],
  "key_points": [
    "Client expects first deliverable by March 15",
    "Budget cap confirmed at 400 SOW hours"
  ],
  "disagreements": [
    "PM mentioned 3-sprint timeline but SA estimated 4 sprints"
  ],
  "passed": false,
  "confidence": 0.85
}
```

### 6.3 Pass/Fail Logic

The AgentCore agent determines `passed` based on:
- If all topics in the prompt's checklist are covered → `passed: true`
- If any mandatory topic is missing → `passed: false`
- `confidence` reflects how clearly the topics were discussed (not just mentioned in passing)

---

## 7. Data Write-Back

After a successful analysis, the handler writes to two targets:

### 7.1 `macro_checkpoints` Update

```sql
UPDATE macro_checkpoints
SET
  analysis_result = $1::jsonb,
  analysis_run_at = now(),
  reached_at = CASE WHEN reached_at IS NULL THEN now() ELSE reached_at END,
  result_detail = $2
WHERE id = $3 AND project_id = $4;
```

- `analysis_result`: The full JSON result (stored as JSONB)
- `analysis_run_at`: Timestamp of this analysis run
- `reached_at`: Set to `now()` only on first analysis (not overwritten on re-runs)
- `result_detail`: Human-readable summary, e.g., "4 of 6 topics covered — 2 missing: risks, technical environment"

### 7.2 `gate_evidence` Insert

```sql
INSERT INTO gate_evidence (project_id, checkpoint_name, evidence_type, label, value, uploaded_by, created_at)
VALUES ($1, $2, 'ai_analysis', 'Transcript Analysis Result', $3::text, 'system', now());
```

- `evidence_type`: `'ai_analysis'`
- `value`: `JSON.stringify(analysisResult)` — the full result as a string
- `uploaded_by`: `'system'` (not a user action)

---

## 8. Orchestration Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  POST /api/projects/{projectId}/checkpoints/{checkpointId}/analyze  │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │ Validate checkpoint:     │
                    │ - exists?                │
                    │ - type = transcript_     │
                    │   analysis?              │
                    │ - has meeting_link?      │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │ Fetch Avoma API key      │
                    │ from Secrets Manager     │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │ GET transcript from      │
                    │ Avoma API                │
                    │ (30s timeout)            │
                    └────────────┬────────────┘
                                 │
                          ┌──────┴──────┐
                          │ Success?    │
                          └──┬───────┬──┘
                       Yes  │       │  No
                            ▼       ▼
              ┌────────────────┐  Return 502
              │ Store transcript│  AVOMA_UNAVAILABLE
              │ in S3           │
              └───────┬────────┘
                      │
                      ▼
              ┌────────────────────────┐
              │ Fetch prompt from       │
              │ analysis_prompts        │
              │ (or use generic         │
              │  fallback)              │
              └───────┬────────────────┘
                      │
                      ▼
              ┌────────────────────────┐
              │ Invoke AgentCore:       │
              │ inputText = prompt +    │
              │ transcript              │
              │ sessionId = project#    │
              │ checkpoint              │
              │ (60s timeout)           │
              └───────┬────────────────┘
                      │
               ┌──────┴──────┐
               │ Success?    │
               └──┬───────┬──┘
            Yes  │       │  No
                 ▼       ▼
   ┌──────────────────┐  Return 502
   │ Parse JSON result │  AGENT_UNAVAILABLE
   │ Write to:         │
   │ - macro_check-    │
   │   points          │
   │ - gate_evidence   │
   └───────┬──────────┘
           │
           ▼
   Return 200 AnalysisResponse
```

---

## 9. Error Handling

| Error Scenario | HTTP Status | Code | User Impact | Recovery |
|---------------|-------------|------|-------------|----------|
| Checkpoint has no meeting_link | 400 | `NO_MEETING_LINK` | User must paste a meeting link first | Add meeting link evidence, then retry |
| Checkpoint is not `transcript_analysis` type | 400 | `INVALID_CHECKPOINT_TYPE` | N/A — UI should not show "Analyze" button for other types | None needed |
| Avoma API returns 401/403 | 502 | `AVOMA_UNAVAILABLE` | "Failed to fetch transcript" | Admin checks Secrets Manager API key validity |
| Avoma API returns 404 (invalid meeting link) | 502 | `AVOMA_UNAVAILABLE` | "Meeting link not found in Avoma" | User corrects the meeting link |
| Avoma API timeout (>30s) | 502 | `AVOMA_UNAVAILABLE` | "Avoma service timed out" | Retry later |
| AgentCore invocation timeout (>60s) | 502 | `AGENT_UNAVAILABLE` | "Analysis agent timed out" | Retry later |
| AgentCore returns non-JSON response | 502 | `AGENT_UNAVAILABLE` | "Failed to parse analysis result" | May indicate prompt issue — admin can edit prompt |
| No prompt in `analysis_prompts` for checkpoint | N/A | Uses fallback | Transparent to user | Admin can add a custom prompt |
| S3 PutObject fails | 500 | `INTERNAL_ERROR` | Logged; analysis still proceeds (transcript storage is best-effort) | Check S3 permissions |

### 9.1 Retry Strategy

- **Avoma:** Single automatic retry with 5s backoff. If both fail → 502.
- **AgentCore:** No automatic retry (invocations are expensive). User manually retries via UI button.
- **S3 storage:** Fire-and-forget. Failure does not block analysis.

---

## 10. Prompt Resolution

```typescript
async function resolvePrompt(checkpointName: string): Promise<string> {
  const result = await pool.query(
    'SELECT prompt_text FROM analysis_prompts WHERE checkpoint_name = $1',
    [checkpointName]
  );

  if (result.rows.length > 0) {
    return result.rows[0].prompt_text;
  }

  // Generic fallback — used when admin hasn't configured a prompt
  // Note: V003 migration seeds default prompts for all standard transcript_analysis checkpoints.
  // Admin can overwrite via config panel. This fallback only fires for newly-added checkpoints
  // that admin hasn't configured a prompt for yet.
  return `Analyze this meeting transcript and determine if the key discussion topics for a "${checkpointName}" meeting were covered. Evaluate comprehensively and return a JSON object: { "topics_covered": [...], "topics_missing": [...], "key_points": [...], "disagreements": [...], "passed": boolean, "confidence": number (0-1) }`;
}
```

---

## 11. IAM Permissions (Lambda Execution Role)

```json
{
  "Effect": "Allow",
  "Action": [
    "bedrock:InvokeAgent"
  ],
  "Resource": "arn:aws:bedrock:us-east-1:504649076991:agent/${ssm:/deliverpro/config/agent-id}"
},
{
  "Effect": "Allow",
  "Action": [
    "secretsmanager:GetSecretValue"
  ],
  "Resource": "arn:aws:secretsmanager:us-east-1:504649076991:secret:deliverpro/avoma-api-key-*"
},
{
  "Effect": "Allow",
  "Action": [
    "s3:PutObject"
  ],
  "Resource": "arn:aws:s3:::kiro-governance-evidence-504649076991/transcripts/*"
},
{
  "Effect": "Allow",
  "Action": [
    "ssm:GetParameter"
  ],
  "Resource": "arn:aws:ssm:us-east-1:504649076991:parameter/deliverpro/config/*"
}
```

---

## 12. Lambda Configuration

| Property | Value |
|----------|-------|
| Runtime | Node.js 20.x (ARM64) |
| Memory | 512 MB (transcript parsing + JSON serialization) |
| Timeout | 90 seconds (30s Avoma + 60s AgentCore) |
| VPC | Yes — same VPC as RDS for database writes |
| Env vars | `EVIDENCE_BUCKET`, `AGENT_ID`, `AGENT_ALIAS_ID`, `DB_SECRET_ARN` |

---

## 13. Cost Estimate

### 13.1 Bedrock AgentCore

| Item | Estimate | Rationale |
|------|----------|-----------|
| Invocations/month | ~30 | ~10 active projects × 3 transcript_analysis checkpoints |
| Input tokens/invocation | ~8,000 | ~1,500 prompt + ~6,500 transcript avg |
| Output tokens/invocation | ~500 | Structured JSON result |
| Claude Sonnet 4.5 input (cross-region) | $0.003/1K tokens × 8K × 30 = **$0.72/mo** | US cross-region inference profile |
| Claude Sonnet 4.5 output (cross-region) | $0.015/1K tokens × 0.5K × 30 = **$0.23/mo** | US cross-region inference profile |
| **Total Bedrock** | **~$0.95/mo** | |

### 13.2 Avoma API

| Item | Estimate |
|------|----------|
| API calls/month | ~30 |
| Cost | Depends on Avoma pricing plan (likely included in existing subscription) |

### 13.3 S3 Storage (Transcripts)

| Item | Estimate |
|------|----------|
| Avg transcript size | ~50 KB |
| Monthly storage added | 30 × 50 KB = 1.5 MB |
| S3 cost | <$0.01/mo |

### 13.4 Lambda

| Item | Estimate |
|------|----------|
| Invocations | 30/month |
| Avg duration | 45s × 512 MB = ~690 GB-seconds |
| Compute cost | 690 × $0.0000166667 = **$0.01/mo** |

### 13.5 Total Analysis Domain Cost

| Component | Monthly |
|-----------|---------|
| Bedrock AgentCore | $0.95 |
| Lambda | $0.01 |
| S3 | <$0.01 |
| Avoma API | Included in subscription |
| **Total** | **~$1.00/mo** |

---

## 14. Edge Cases

| # | Scenario | Handling |
|---|----------|----------|
| 1 | Transcript too long for AgentCore input (>100K tokens) | Truncate to last 80K tokens with a note: "Transcript truncated — only analyzing final portion." |
| 2 | AgentCore returns partial/malformed JSON | Attempt best-effort parse. If completely unparsable, return 502 `AGENT_UNAVAILABLE` with detail "Failed to parse analysis result". |
| 3 | Same checkpoint analyzed multiple times | Each run overwrites `analysis_result` and `analysis_run_at`. `reached_at` is only set on first run (not overwritten). New `gate_evidence` row inserted for each run (full history). |
| 4 | Meeting link changed after analysis | Next "Analyze" click fetches the new transcript from the updated link. Previous results remain in `gate_evidence` history. |
| 5 | Avoma link format changes | `extractMeetingId()` must handle multiple URL patterns. If no ID can be extracted, return 400 `NO_MEETING_LINK` with detail "Could not parse meeting ID from URL". |
| 6 | Concurrent analysis requests for same checkpoint | Last writer wins on `macro_checkpoints` update. Both `gate_evidence` rows are preserved (append-only). No mutex needed — rare scenario. |
| 7 | Admin deletes prompt while analysis is in-flight | Analysis uses the prompt fetched at invocation start. Deletion mid-flight has no effect on the running analysis. |

---

## 15. Future Enhancements (Post-Iteration 3)

- **Batch analysis:** Analyze all pending `transcript_analysis` checkpoints across projects in a single scheduled job
- **Confidence threshold configuration:** Admin sets minimum confidence for auto-pass
- **Multi-language support:** Transcript in non-English languages (AgentCore handles natively)
- **Comparison mode:** Compare two transcripts (e.g., kickoff prep vs actual kickoff) for topic alignment

---

*End of Analysis Architecture v1.0*
