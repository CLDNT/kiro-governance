# Phase 2 Cost Estimate — Kiro Governance

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-30 | v1.1 | AWS Architect | Updated Bedrock section: model confirmed as Claude Sonnet 4.5 (`us.anthropic.claude-sonnet-4-5-20241022-v1:0`) via US cross-region inference (PD-14 resolved). Replaced Haiku estimate with Sonnet pricing. |
| 2026-06-30 | v1.0 | AWS Architect | Initial Phase 2 cost estimate from AWS Pricing API |

---

## Pricing Model

- **Region:** us-east-1 (N. Virginia)
- **Model:** ON DEMAND — all figures are estimates
- **Source:** AWS Pricing API (queried 2026-06-30)
- **Scale:** Internal team (~5-10 users), low-traffic governance tool

---

## Phase 2 New Resources

| Service | Monthly Cost (est.) | Unit Pricing | Calculation |
|---------|-------------------:|--------------|-------------|
| **Cognito User Pool** | $0.00 | First 50,000 MAUs free (Essentials tier) | <50 MAUs = $0 |
| **API Gateway (REST)** | $0.04 | $3.50 per 1M requests (first 333M) | 10,000 req × $0.0000035 = $0.035 |
| **Lambda (compute)** | $0.33 | $0.0000133334/GB-s (ARM Tier 1) | 50,000 inv × 0.5s × 0.5 GB = 12,500 GB-s × $0.0000133334 = $0.17 |
| **Lambda (requests)** | $0.01 | $0.20 per 1M requests (ARM) | 50,000 req × $0.0000002 = $0.01 |
| **CloudFront (data transfer)** | $0.09 | $0.085/GB (first 10 TB) | 1 GB × $0.085 = $0.085 |
| **CloudFront (requests)** | $0.01 | $0.0100 per 10,000 HTTPS requests | ~10,000 req × $0.0000010 = $0.01 |
| **S3 (storage)** | $0.12 | $0.023/GB-month (Standard, first 50 TB) | 5 GB × $0.023 = $0.115 |
| **S3 (requests)** | $0.01 | $0.005 per 1,000 PUT; $0.0004 per 1,000 GET | ~1,000 mixed requests ≈ $0.005 |
| **Secrets Manager** | $0.80 | $0.40/secret/month + $0.05/10,000 API calls | 2 secrets × $0.40 = $0.80 (API calls negligible) |
| **CloudWatch Logs** | ~$0.50 | $0.50/GB ingested | ~1 GB log ingestion from 37 Lambdas |
| | | | |
| **Phase 2 Total** | **~$1.91** | | |

---

## Assumptions

1. **Cognito:** <50 MAUs (internal team only). Cognito User Pools Essentials tier provides 50,000 MAUs free. No cost.
2. **API Gateway:** REST API, ~10,000 requests/month. Internal team dashboards + Kiro agent calls. No API caching enabled.
3. **Lambda:** 37 handlers sharing ~50,000 total invocations/month. Average duration 500ms. Memory 512MB. ARM64 (Graviton) architecture. Free tier: 1M requests + 400,000 GB-s/month — **all usage falls within free tier for the first 12 months**.
4. **CloudFront:** SPA hosting (React dashboard). ~1 GB/month data transfer to ~5 users. CloudFront provides 1 TB/month free (Always Free) — **all usage within free tier**.
5. **S3:** Evidence bucket (PDF/screenshot uploads). 5 GB storage estimate assumes ~50 evidence files averaging 100KB each, plus SPA assets. S3 provides 5 GB free (first 12 months).
6. **Secrets Manager:** 2 actual secrets (Jira API token, Avoma API key). RDS IAM auth uses IAM role — no secret needed. API calls negligible (<100/month at cold starts).
7. **CloudWatch:** Lambda logs at ~1 GB/month. CloudWatch provides 5 GB free ingestion + 5 GB storage (Always Free).
8. **Bedrock AgentCore:** Deferred to Iteration 3 — not included in active Phase 2 cost. Model confirmed: Claude Sonnet 4.5 (`us.anthropic.claude-sonnet-4-5-20241022-v1:0`) via US cross-region inference (PD-14 resolved 2026-06-30).

---

## Free Tier Impact

> ⚠️ **Most Phase 2 services fall within AWS Free Tier for the first 12 months.** The estimates above show list pricing. Actual billed amount during free tier eligibility will be near **$0.80/month** (Secrets Manager only — not covered by free tier).

| Service | Free Tier Coverage | Monthly Cost After Free Tier |
|---------|-------------------|----------------------------:|
| Cognito | 50,000 MAUs (Always Free) | $0.00 |
| API Gateway | 1M REST calls/month (12-month) | $0.04 |
| Lambda | 1M requests + 400K GB-s (Always Free) | $0.00 |
| CloudFront | 1 TB transfer + 10M requests (Always Free) | $0.00 |
| S3 | 5 GB + 20K GET + 2K PUT (12-month) | $0.13 |
| Secrets Manager | No free tier | $0.80 |
| CloudWatch | 5 GB ingest + 5 GB storage (Always Free) | $0.00 |

---

## Grand Total

| Component | Monthly Cost (est.) |
|-----------|-------------------:|
| **Phase 1 — RDS db.t3.micro PostgreSQL** | $15.33 |
| **Phase 1 — EC2 t3.micro MCP server** | $8.47 |
| **Phase 2 — New serverless additions** | $1.91 |
| | |
| **Grand Total (Phase 1 + Phase 2)** | **~$25.71/mo** |

---

## Top 3 Cost Drivers

1. **RDS db.t3.micro** (~$15.33/mo) — Phase 1 database. Already running. Single largest line item.
2. **EC2 t3.micro** (~$8.47/mo) — Phase 1 MCP server. Already running.
3. **Secrets Manager** (~$0.80/mo) — Per-secret monthly charge. Only Phase 2 item not covered by free tier.

> Phase 2 serverless additions are negligible at this scale. The existing Phase 1 infrastructure (RDS + EC2) accounts for **92%** of total monthly cost.

---

## Deferred: Bedrock AgentCore (Iteration 3)

Estimated separately — not active in Phase 2 sprints 1-3.

| Component | Monthly Cost (est.) | Assumptions |
|-----------|-------------------:|-------------|
| Bedrock (Claude Sonnet 4.5 — cross-region) — input tokens | $0.72 | ~240K input tokens/month (30 inv × 8K tokens) × $0.003/1K tokens |
| Bedrock (Claude Sonnet 4.5 — cross-region) — output tokens | $0.23 | ~15K output tokens/month (30 inv × 500 tokens) × $0.015/1K tokens |
| **Deferred subtotal** | **~$0.95/mo** | Using `us.anthropic.claude-sonnet-4-5-20241022-v1:0` cross-region inference profile (PD-14 resolved 2026-06-30) |

**Model:** Claude Sonnet 4.5 via US cross-region inference profile (`us.anthropic.claude-sonnet-4-5-20241022-v1:0`). Pricing: $0.003/1K input tokens, $0.015/1K output tokens (on-demand). At internal team scale (~30 analyses/month), total Bedrock cost is under $1/month.

---

## Exclusions

- Data transfer between AWS services within the same region (negligible at this scale)
- Route 53 hosted zone ($0.50/month if custom domain added — not currently planned)
- AWS Support plan costs
- Developer time / Kiro AI token costs
- QuickSight (if added later: $24/month/author for pro edition)

---

## Cost Protection Controls

- **Budget alarm:** Set at $30/month (current grand total + 15% buffer)
- **Lambda concurrency limit:** 10 concurrent executions (prevents runaway)
- **API Gateway throttle:** 100 requests/second burst, 50 sustained (default)
- **S3 lifecycle:** Transition evidence files to Glacier after 365 days (future optimization)

---

*All figures are estimates based on AWS Pricing API data retrieved 2026-06-30. Actual costs may vary based on usage patterns.*
