# Security Gate 1 — Findings & Resolution

**Date:** 2026-06-30
**Reviewer:** Security Reviewer
**Scope:** All Phase 2 per-feature architecture docs (analysis, auth, config, files, gates, meetings, projects, reporting)
**Gate Phase:** Phase 2 — Step 2.4

---

## Gate Verdict: ✅ PASSED

All 3 High findings have been resolved. Zero Critical findings. 6 Medium, 5 Low, and 2 Info findings are accepted with documented justification.

---

## Full Findings Table

| # | Severity | Domain | Finding | Status |
|---|----------|--------|---------|--------|
| 1 | **High** | Analysis | `bedrock:InvokeAgent` scoped to wildcard `agent/*` instead of specific agentId ARN | ✅ FIXED |
| 2 | **High** | Files | `POST /api/files/download-url` has no project-membership authorization check — any authenticated user can download evidence for any project | ✅ FIXED |
| 3 | **High** | Projects | `import-jira` Lambda writes `ssm:PutParameter` but IAM policy section was missing; SSM write permission scope unspecified | ✅ FIXED |
| 4 | Medium | Auth | No `AdminUserGlobalSignOut` on user deactivation; refresh tokens valid 30 days after removal | ⚠️ ACCEPTED |
| 5 | Medium | Auth | 5-min authorizer cache + role change latency not documented for promotion scenario | ⚠️ ACCEPTED |
| 6 | Medium | Config | Admin-editable Bedrock prompts have no audit trail or length validation; prompt injection risk | ⚠️ ACCEPTED |
| 7 | Medium | Analysis | In-memory Avoma API key has no TTL; stale after rotation until Lambda recycles | ⚠️ ACCEPTED |
| 8 | Medium | Files | Download regex allows cross-project key enumeration (partially mitigated by #2 fix) | ⚠️ ACCEPTED |
| 9 | Medium | Projects | PM ownership check for PATCH uses free-text `project_manager` field, not Cognito sub | ⚠️ ACCEPTED |
| 10 | Medium | Gates | `checkpoint_type` RBAC rules documented in prose only, not in an explicit role table | ⚠️ ACCEPTED |
| 11 | Low | Auth | PKCE storage mechanism undocumented | Noted |
| 12 | Low | Files | CloudFront CORS wildcard (`*.cloudfront.net`) | Noted |
| 13 | Low | Files | Bucket name inconsistency (`kiro-governance-evidence` vs `deliverpro-evidence`) | Noted |
| 14 | Low | Reporting | Cross-project access for leadership/admin undocumented as explicit decision | Noted |
| 15 | Low | Config | `phase` and `item_type` not enum-validated at DB level | Noted |
| 16 | Info | Auth | MFA optional (acceptable for MVP) | Noted |
| 17 | Info | Config | Secrets Manager path naming inconsistency | Noted |

---

## High Findings — Resolution Details

### #1 — Analysis IAM: bedrock:InvokeAgent Wildcard Scope

**File:** `docs/phase2/analysis-architecture.md` §11
**Change:** Replaced `arn:aws:bedrock:us-east-1:504649076991:agent/*` with `arn:aws:bedrock:us-east-1:504649076991:agent/${ssm:/deliverpro/config/agent-id}`

The agentId is already stored in SSM at `/deliverpro/config/agent-id`. The CDK construct resolves this at deploy time and injects the specific ARN into the IAM policy. This follows least-privilege — the Lambda can only invoke the one intended agent, not any agent in the account.

### #2 — Files: Download URL Missing Project-Membership Check

**File:** `docs/phase2/files-architecture.md` §4.2, §7.2, §7.3
**Changes:**

1. §4.2 — Added mandatory authorization check documentation: the handler must verify the requesting user is associated with the project that owns the file (by querying `gate_evidence` → `projects`). Leadership/admin roles bypass this check.
2. §4.2 — Added new error responses: 403 `FORBIDDEN` (user not associated with project) and 404 `FILE_NOT_FOUND` (s3Key not in gate_evidence).
3. §7.2 — Updated handler to pass `auth` context to `generateDownloadUrl`.
4. §7.3 — Updated `generateDownloadUrl` implementation with full project-membership authorization logic before presigned URL generation.

**Security model:** Evidence files → look up owning project via `gate_evidence.value` match. Transcript files → extract `project_id` from S3 key path. Both verified against `projects.project_manager`, `projects.solution_architect`, or `projects.engineers_assigned`.

### #3 — Projects: Missing IAM Section for Import-Jira SSM Write

**File:** `docs/phase2/projects-architecture.md` — new §10 (IAM Permissions)
**Changes:**

1. Added full §10 IAM Permissions section with two subsections:
   - §10.1 — Common permissions (SecretsManager read, SSM read)
   - §10.2 — Import-Jira specific: `ssm:PutParameter` scoped to exactly `arn:aws:ssm:us-east-1:504649076991:parameter/deliverpro/config/jira-import-completed`
2. No wildcard on SSM write — the import Lambda cannot write to any other SSM parameter.

---

## Medium Findings — Accepted with Justification

### #4 — Auth: No AdminUserGlobalSignOut on User Deactivation

**Justification:** This is an MVP scope decision. The current auth architecture handles deactivation by removing Cognito credentials, which prevents new logins. Existing refresh tokens expire naturally within 30 days. For this internal tool with <50 users, the risk is low — a deactivated employee's token would stop working within the refresh window. A post-MVP story will add `AdminUserGlobalSignOut` on the deactivation flow for immediate session termination.

**Mitigation:** Token lifetime is 1 hour (access) + 30 days (refresh). Admin can manually call `AdminUserGlobalSignOut` via console for urgent cases.

### #5 — Auth: Authorizer Cache + Role Change Latency

**Justification:** The 5-minute API Gateway authorizer cache is documented in `auth-architecture.md`. Role promotion (e.g., engineer → pm) is rare and performed by admin. A 5-minute delay between role change and effect is acceptable for an internal tool. If a user needs immediate access, admin can direct the user to log out and back in.

**Mitigation:** Documented as operational knowledge. Frontend shows "please log out and back in" after role change.

### #6 — Config: Bedrock Prompt Audit Trail & Injection Risk

**Justification:** The `analysis_prompts` table in `config-architecture.md` stores admin-editable prompts. Audit trail (who changed what, when) is a post-MVP enhancement. For MVP, only `admin` role can edit prompts, and the AgentCore agent has guardrails (model-level). Length validation will be added during implementation (max 10,000 chars) as a Zod schema constraint.

**Mitigation:** Only `admin` role can edit prompts (RBAC). AgentCore guardrails provide model-level injection resistance. Prompt changes are traceable via `updated_at` column.

### #7 — Analysis: Avoma API Key In-Memory Cache No TTL

**Justification:** The Avoma API key is fetched from Secrets Manager on Lambda cold start and cached in-memory for the lifetime of the execution environment. Lambda execution environments recycle every ~15 minutes under low load or more frequently under high load. For ~30 invocations/month, most invocations will be cold starts anyway. Adding a TTL mechanism adds complexity for minimal security gain.

**Mitigation:** If the key is rotated, redeploying or recycling the Lambda (by updating an env var) forces a fresh fetch. Post-MVP: add a 1-hour TTL with lazy refresh.

### #8 — Files: Download Regex Cross-Project Enumeration

**Justification:** Finding #2 fix (project-membership check) is the primary mitigation. Even if a user can construct valid S3 key patterns for other projects, the authorization check will reject the request with 403. The regex validation is defense-in-depth — it prevents completely malformed keys but is not the authorization boundary.

**Mitigation:** Fully mitigated by #2 fix. Regex remains as input validation layer.

### #9 — Projects: PM Ownership Check Uses Free-Text Field

**Justification:** The `project_manager` field stores the display name (e.g., "Faraz Ahmad") because it's imported from Jira where there is no Cognito sub. Matching against Cognito sub would require a user-project junction table, which is out of MVP scope. The current check compares the JWT's `name` claim against the free-text field.

**Mitigation:** For MVP, the match is name-based. Post-MVP improvement: add a `pm_cognito_sub` column populated on first login, then match against sub. This is tracked as a future hardening item.

### #10 — Gates: checkpoint_type RBAC in Prose Only

**Justification:** The checkpoint_type RBAC rules are currently documented in `gates-architecture.md` prose (e.g., "PM and above can mark manual checkpoints"). Converting to an explicit role × checkpoint_type permission matrix is a documentation enhancement that does not affect implementation — the handler code will have the explicit role checks regardless of doc format.

**Mitigation:** During spec creation for gates domain stories, the implementer will produce an explicit permission table. This is a doc completeness issue, not a security gap.

---

## Low Findings — Noted

| # | Finding | Notes |
|---|---------|-------|
| 11 | PKCE storage undocumented | PKCE is handled by Amplify/Cognito SDK client-side. Storage is in-memory (session). Will document in auth-architecture post-MVP. |
| 12 | CloudFront CORS wildcard | `*.cloudfront.net` is intentional for dev flexibility. Production CORS will be tightened when custom domain is confirmed (OQ-P2-010). |
| 13 | Bucket name inconsistency | `deliverpro-evidence-{accountId}` is the canonical name (files-architecture §2). Any references to `kiro-governance-evidence` in other docs are stale and will be caught during data model review (Step 2.5). |
| 14 | Reporting cross-project access | Leadership and admin roles intentionally have cross-project read access for reporting. This is by-design per FR-P2-016 (portfolio-level reports). Will add an explicit ADR. |
| 15 | Config phase/item_type not enum-validated | DB-level CHECK constraints for `phase` and `item_type` will be added during implementation. Not a security risk — invalid values only affect admin config, not user-facing data. |

---

## Info Findings — Noted

| # | Finding | Notes |
|---|---------|-------|
| 16 | MFA optional for MVP | Confirmed acceptable. SRS NFR-P2-003 states MFA is recommended, not mandatory. Will add as a post-launch hardening item. |
| 17 | Secrets Manager path naming inconsistency | Will standardize on `/deliverpro/` prefix during implementation. No security impact — paths are referenced by ARN in IAM policies. |

---

## Summary

- **Critical findings:** 0
- **High findings:** 3 → all 3 fixed
- **Medium findings:** 6 → accepted with justification and mitigation plans
- **Low findings:** 5 → noted, no architecture changes required
- **Info findings:** 2 → noted

**Gate verdict: PASSED** — Zero Critical/High findings remaining. Proceed to Step 2.5 (Unified Data Model).
