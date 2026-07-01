# Analysis Domain — Transcript Analysis via Bedrock AgentCore

## Purpose

The `analysis` domain orchestrates AI-powered transcript analysis for CASDM `transcript_analysis`-type checkpoints. It fetches meeting transcripts from Avoma, stores them in S3, invokes a Bedrock AgentCore agent with checkpoint-specific prompts, and writes structured results back to the gates domain.

## API Endpoints

### `POST /api/projects/{projectId}/checkpoints/{checkpointId}/fetch-transcript`

Fetch a meeting transcript from Avoma and store in S3.

**Auth:** `pm`, `sa`, `leadership`, `admin`

**Response (200):**
```json
{
  "transcript_url": "s3://bucket/transcripts/...",
  "char_count": 45000
}
```

**Errors:**
- `400 NO_MEETING_LINK` — Checkpoint has no meeting link
- `502 AVOMA_UNAVAILABLE` — API failure (timeout, auth, invalid link)

### `POST /api/projects/{projectId}/checkpoints/{checkpointId}/analyze`

Analyze transcript via Bedrock AgentCore.

**Auth:** `pm`, `leadership`, `admin`

**Response (200):**
```json
{
  "analysis_result": {
    "topics_covered": ["scope", "timeline"],
    "topics_missing": ["risks"],
    "key_points": ["3-month timeline"],
    "disagreements": ["budget estimate"],
    "passed": false,
    "confidence": 0.85
  },
  "analysis_run_at": "2026-06-30T21:57:48Z",
  "result_detail": "2/3 topics covered (67%) — 1 missing: risks. Confidence: 85%. NEEDS DISCUSSION",
  "transcript_s3_key": "s3://bucket/transcripts/..."
}
```

**Errors:**
- `400 NO_MEETING_LINK` — Checkpoint has no transcript
- `400 INVALID_CHECKPOINT_TYPE` — Not a transcript_analysis checkpoint
- `502 AVOMA_UNAVAILABLE` — Transcript fetch failed
- `502 AGENT_UNAVAILABLE` — AgentCore invocation failed

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `EVIDENCE_BUCKET` | S3 bucket for transcript storage |
| `AVOMA_SECRET_ARN` | Secrets Manager ARN for Avoma API key |
| `DB_SECRET_ARN` | Secrets Manager ARN for DB credentials |

## Lambda Configuration

- **Runtime:** Node.js 20.x (ARM64)
- **Memory:** 512 MB
- **Timeout:** 90 seconds
- **VPC:** Yes (same VPC as RDS)

## IAM Permissions

```json
{
  "Effect": "Allow",
  "Action": ["bedrock:InvokeAgent"],
  "Resource": "arn:aws:bedrock:us-east-1:*:agent/*"
},
{
  "Effect": "Allow",
  "Action": ["s3:PutObject"],
  "Resource": "arn:aws:s3:::*-evidence-*/transcripts/*"
},
{
  "Effect": "Allow",
  "Action": ["secretsmanager:GetSecretValue"],
  "Resource": "arn:aws:secretsmanager:*:*:secret:deliverpro/*"
},
{
  "Effect": "Allow",
  "Action": ["ssm:GetParameter"],
  "Resource": "arn:aws:ssm:*:*:parameter/deliverpro/config/*"
}
```

## Services

### `avoma.service.ts`

- `fetchTranscriptFromAvoma()` — Fetch transcript from Avoma REST API
- Single automatic retry with 5s backoff
- 30s timeout per request

### `agent.service.ts`

- `invokeAnalysisAgent()` — Invoke Bedrock AgentCore
- 60s timeout per invocation
- Handles streaming response collection
- JSON result parsing and validation

### `prompt.service.ts`

- `resolvePrompt()` — Fetch admin-configured prompt or use generic fallback
- DB query with fallback on error

## Data Model

### `macro_checkpoints` (updated by analysis domain)

- `analysis_result` (JSONB) — Full structured result
- `analysis_run_at` (timestamp) — When analysis was run
- `reached_at` (timestamp) — Set on first analysis (not overwritten on re-runs)
- `result_detail` (text) — Human-readable summary
- `transcript_url` (text) — S3 URL of stored transcript

### `gate_evidence` (inserted by analysis domain)

- `evidence_type` — `'ai_analysis'`
- `value` — Stringified analysis result
- `uploaded_by` — `'system'`

## Cost Estimate

| Component | Monthly |
|-----------|---------|
| Bedrock AgentCore | $0.95 |
| Lambda | $0.01 |
| S3 | <$0.01 |
| **Total** | **~$1.00** |

## Edge Cases

1. **Transcript too long** — Truncated to last 80K tokens with user notice
2. **Multiple analyses** — Each run creates new evidence entry; `analysis_result` is overwritten
3. **Prompt deletion** — Analysis uses prompt fetched at invocation start; deletion mid-flight has no effect
4. **S3 storage failure** — Logged but doesn't block response (best-effort)
5. **Concurrent requests** — Last writer wins on checkpoint update; all rows preserved in evidence (append-only)

## Testing

```bash
npm test -w packages/analysis
```

Unit tests for:
- Avoma API integration (mocked fetch)
- AgentCore invocation (mocked BedrockAgentRuntimeClient)
- Prompt resolution (mocked DB queries)
- JSON parsing and validation

## Source References

- **Analysis Architecture:** `docs/phase2/analysis-architecture.md`
- **Data Persistence:** `docs/phase2/data-persistence-architecture.md`
- **Config Domain:** `docs/phase2/config-architecture.md`
- **Gates Domain:** `docs/phase2/gates-architecture.md`
