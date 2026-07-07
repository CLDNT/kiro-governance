# Software Requirements Specification — Phase 2: DeliverPro Project Tracking Application

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-07-07 | v1.7a | Product Analyst | **Reconciled stale NFR-P2-003 security text with the v1.7 FR-P2-042 activation (M2 code-round finding).** The §NFR-P2-003 POC risk-accept still (a) listed "Level 2 auto-completion … deferred from this build" and (b) stated "this risk-accept must be revisited before enabling Level 2; Level 2 is gated on GitHub OIDC trusted identity." Both contradicted the v1.7 activation (customer trust-model acceptance 2026-07-07). Updated to: Level 2 is **ACTIVE** under the same POC risk-accept, GitHub OIDC is **NOT required**, and the accepted trust model is the authenticated MCP path (same as `record_progress`). OIDC + distinct app service identity (SEC-M3) reframed as optional future hardening, not preconditions. No FR/AC content changed. Source: `specs/phase2/CR-12-14-level2-spec.md`; FR-P2-042 trust model. |
| 2026-07-07 | v1.7 | AWS Architect | **FR-P2-042 ACTIVATED — Level 2 micro→artifact auto-completion (CR-12/CR-14), WITHOUT GitHub OIDC.** Customer accepted the trust model 2026-07-07: auto-completion trusts the same authenticated MCP path as `record_progress` (no-orphan-resolved, append-only), so GitHub OIDC (CR-OIDC) is no longer a precondition. FR-P2-042 changed from **Could Have / Deferred → Must** with build-ready, machine-testable ACs. Adds: the 16-code `event_code` vocabulary (`casdm.<p0..p4>.<slug>`); a nullable `governance_events.event_code` column + optional `record_progress` `event_code` (CR-14); seeded `micro_artifact_mapping` (activating the inert V004 table); a `micro_artifacts.manual_override` flag + append-only `micro_artifact_audit` table; app-side reconciliation under `kiro_phase2` (`completed_by='kiro:<actor>'`, idempotent, reversible, own-repo-scoped) with the MCP runtime role `kiro_mcp_app` kept append-only; and a `POST /api/projects/{projectId}/sync-artifacts` (admin/leadership) endpoint + gate-view + link-time triggers. Migration V008. Source: `specs/phase2/CR-12-14-level2-spec.md`; customer trust-model acceptance 2026-07-07. |
| 2026-07-03 | v1.6 | AWS Architect | **SRS delta notes — CR-16 / CR-17 (replace cancelled CR-06 backfill).** Added FR-P2-043 (link-time / on-demand macro gate detection: fetch the linked repo's `docs/project-progress.md` via the GitHub REST API using an SSM read token, parse resolved macro gates via shared `matchGateFromText`, and idempotently set `macro_checkpoints.reached_at` with `reviewed_by='system:repo-sync'`; admin/leadership-only sync endpoint + link-time trigger; own-repo-only; no token leak). Added FR-P2-044 (fresh-start cleanup: gated, non-auto-run destructive migration V007 removing imported `CST-%` non-template projects). **Design change recorded:** the tracker MAY auto-resolve macro gates via this explicit fetch-and-parse sync path only; the passive `governance_events → v_timeline` join remains display-only and never auto-completes a gate (FR-P2-041 unchanged for the passive path). Source: Customer go-ahead 2026-07-02 + `docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md`; specs `specs/phase2/CR-16-link-time-gate-detection-spec.md`, `specs/phase2/CR-17-fresh-start-cleanup-spec.md`. |
| 2026-07-02 | v1.5 | Product Analyst | Added FR-P2-033 through FR-P2-042 for the approved GitHub↔Slack linkage + dual-channel notification + micro Level-1 integration change request. Source: Customer go-ahead 2026-07-02 + `docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md` (v3 — Final Design of Record). FR-P2-033..041 are Must (Level 1 timeline surfacing, no-orphan hard reject, append-only via ownership reassignment, dual-channel routing, optional-linkage feature switch, macro app-ownership + CLI-macro backward-compat). FR-P2-042 (Level 2 micro→artifact auto-completion) marked **Could Have / DEFERRED — not in this build** per customer decision 2026-07-02 (Level 2 micro→artifact auto-completion, `event_code`, and GitHub OIDC dropped/deferred; CR-12/13/14 out of scope). |
| 2026-06-30 | v1.3a | AWS Architect | Resolved OQ-P2-002 (Avoma REST API confirmed), OQ-P2-006 (default prompts seeded in V003, admin can overwrite), OQ-P2-010 (default CloudFront domain), PD-12 (AppDev confirmed at launch), PD-13 (project_type immutable), PD-14 (AgentCore with Claude Sonnet 4.5 cross-region). Updated §8.1 status, §8.5 model. Source: Faraz/Tariq confirmation 2026-06-30. |
| 2026-06-30 | v1.4 | Product Analyst | Added FR-P2-032 (first-login new password flow). Source: production bug — Cognito admin-created users require password reset on first login; discovered during deployment 2026-06-30. |
| 2026-06-29 | v1.3 | Product Analyst | Added FR-P2-029 through FR-P2-031.
| 2026-06-29 | v1.2 | Product Analyst | Added FR-P2-019 through FR-P2-028 from CASDM PDF swimlane + transcript second pass. Corrected FR-P2-009 (one-time Jira import, not ongoing sync). Fixed checkpoint result model (meeting_date + result_detail). Added 4 new schema tables. Added DeliverPro product vision §13. Confirmed tech stack (React+Vite+Tailwind, Lambda, Cognito, CloudFront). |
| 2026-06-29 | v1.2 | Product Analyst | Added FR-P2-019 through FR-P2-028 from CASDM PDF swimlane + transcript second pass. Corrected FR-P2-009 (one-time Jira import). Fixed checkpoint result model (meeting_date + result_detail). Added 4 new schema tables. Confirmed tech stack. Added DeliverPro product vision §13. |
| 2026-06-29 | v1.2a | Product Analyst | Fixed 2 medium architect findings: clarified §7 schema additions are V003 (not V002 modifications). Added explicit V003 ALTER statement for checkpoint_type CHECK constraint. |
| 2026-06-25 | v1.0 | Product Analyst | Initial SRS from Phase 2 transcript + CASDM methodology + existing schema |

---

## 1. Executive Summary

Phase 2 of the kiro-governance project delivers **DeliverPro** — an interactive project tracking application for Cloudelligent's delivery team. The application is a React + Vite + Tailwind CSS SPA deployed to CloudFront, backed by API Gateway + Lambda and RDS PostgreSQL. It enables Project Managers, Solutions Architects, and leadership to:

- View all active delivery projects and their CASDM phase/gate status
- Track micro artifacts (AI-generated by Kiro agents) and macro checkpoints (human-validated) per project per phase
- Attach evidence to checkpoints — paste an Avoma meeting link, upload a file, or add a URL
- Trigger transcript analysis on meeting links (Avoma API) to validate topic coverage
- Manage project onboarding checklists, weekly status calls, escalations, and resource budgets
- Track discovery sessions, kickoff prep, executive check-ins, and project closure workflows
- Access role-based views tailored to PM, SA, Engineer, and Leadership personas

The application reuses the existing RDS PostgreSQL instance deployed in Phase 1 (account: `ceanalytics`, 504649076991) and extends it with the project/CASDM tracking schema designed in `V002__projects_and_casdm_tracking.sql`.

**Technology Stack:**

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + Tailwind CSS (custom SPA) |
| Hosting | Amazon CloudFront (static SPA distribution) |
| API | AWS Lambda (REST) behind API Gateway |
| Database | RDS PostgreSQL (existing Phase 1 instance, ceanalytics) |
| Auth | AWS Cognito (user pools, JWT) |
| File Storage | Amazon S3 |
| AI Analysis | Amazon Bedrock Agents (AgentCore) |
| Reporting | QuickSight — **deferred, NOT in scope for this build** |

---

## 2. Problem Statement

### Pain Point 1: No visibility into project gate status

> Source: Phase 2 Transcript — "I would wanna go to this app, and I'd wanna say, okay. Looking at this project, I would say, okay. The kickoff happened. These were the topics that were discussed."

Delivery leadership (Chris Xenos, Kasim) cannot attend every project call. There is no single place to see which CASDM gates a project has passed, what evidence supports each gate, or where projects are stalled.

### Pain Point 2: Governance artifacts live in disconnected systems

> Source: Phase 2 Transcript — "There's things here that aren't flags... Like this kickoff meeting. Kiro doesn't know it happened."

Kiro auto-tracks micro artifacts (SRS draft, specs, code), but macro checkpoints (kickoff calls, implementation reviews, SA sign-offs) are only known to the humans who attended. No system of record captures them together.

### Pain Point 3: Meeting governance is manual and unreliable

> Source: Phase 2 Transcript — "I'd like it to... give it criteria to look for in that transcript or in that call and tell us whether those topics were covered."

Critical meetings (sales-to-delivery handoff, implementation plan review, retrospectives) have required discussion topics. Today there is no automated validation — it depends on trust and memory.

### Pain Point 4: No interactive layer for PMs to manage workflow

> Source: Phase 2 Transcript — "I don't want a dashboard yet... there has to be an interactive place where... I can add evidence to it. I can add links."

The existing Jira CST board provides project cards but no structured gate-tracking or artifact attachment. PMs need an interactive layer to manage their workflow.

### Pain Point 5: Methodology changes require code deploys

> Source: Phase 2 Transcript — "Let's say we change the methodology and I need to add a gate. How do I do that?"

The CASDM methodology is evolving. Adding, renaming, or reordering phases and gates should not require a developer.

### Pain Point 6: Project lifecycle management is fragmented across tools

> Source: Phase 2 Transcript — "eventually, I'd like to get rid of these Jira pages and even use this"

Weekly status calls, escalations, onboarding checklists, resource budgets, and closure workflows are tracked in Jira, spreadsheets, or not at all. This app consolidates the entire project lifecycle.

---

## 3. Stakeholders

| Role | Name(s) | Interest |
|------|---------|----------|
| Product Owner / Sponsor | Chris Xenos | Vision, approval, methodology definition |
| Delivery Leadership | Kasim, Chris Xenos | Cross-project health, gate compliance |
| Project Managers | Delivery PMs | Day-to-day gate tracking, evidence upload, status logs |
| Solutions Architects | SAs | Review and validate micro/macro artifacts |
| Engineers | Assigned developers | Visibility into project state |
| Account Executives | AEs | Account planning sessions, revenue opportunities |
| Builder | Muhammad Faraz | Architecture, implementation |

---

## 4. Scope

### 4.1 In Scope

- React + Vite + Tailwind CSS SPA deployed to CloudFront
- API Gateway + Lambda backend writing to RDS PostgreSQL
- Cognito authentication (JWT-based)
- Project list with one-time Jira CST import to seed existing projects
- Direct project creation in-app (this app IS the project management system going forward)
- CASDM micro artifact tracking (AI-generated, per phase)
- CASDM macro checkpoint tracking (human-validated, per phase) with rich result capture
- Evidence attachment to checkpoints (meeting links, file uploads, URLs)
- Avoma API integration for transcript fetch and AI topic-coverage analysis
- Configurable phases and gates (admin can add/rename without code deploy)
- Project onboarding checklist workflow
- Weekly status call logging
- Escalation board
- Resource budget tracking (SOW hours vs consumed)
- Discovery sessions log
- Kickoff prep meeting tracking
- Executive check-in calls (Phase 3 + Phase 4)
- Account planning session tracking
- Project closure workflow
- Role-based views (PM, SA, Engineer, Leadership)
- Existing Phase 1 RDS reuse (same database, extended schema)
- Existing Phase 1 MCP server data (governance_events) surfaced in project timeline

### 4.2 Out of Scope

- **QuickSight reporting dashboard** — deferred, NOT in scope for this build
  > Source: Confirmed decision — QuickSight deferred
- **Oscar** (presales transcription tool) — delivery phase only, use Avoma
  > Source: Phase 2 Transcript — "Oscar... doesn't cover the actual execution of a project. It's just the presales."
- **Recurring Jira sync** — one-time import only; app replaces Jira going forward
  > Source: Phase 2 Transcript — "eventually, I'd like to get rid of these Jira pages and even use this"
- Mobile app
- Financial/billing tracking beyond SOW hours

### 4.3 Assumptions

| # | Assumption | Impact if Wrong |
|---|------------|-----------------|
| A1 | Phase 2 app runs in ceanalytics account (504649076991) alongside Phase 1 infrastructure. **CONFIRMED 2026-06-29 by Faraz (Tariq Khan).** |
| A2 | Avoma provides a REST API that accepts a meeting link/ID and returns the transcript | Integration blocked if API unavailable |
| A3 | Jira CST board data can be exported/fetched for one-time import | Initial project seeding blocked if unavailable |
| A4 | Stack is React + Vite + Tailwind CSS, API Gateway + Lambda, RDS PostgreSQL, Cognito, S3, Bedrock, CloudFront | Confirmed decision |
| A5 | Phase 1 RDS instance has sufficient capacity for Phase 2 schema extension | May need instance resize |

### 4.4 Open Questions

See §10 for the full list.

---

## 5. Functional Requirements

### FR-P2-001: Project List View

**Priority:** Must Have
**Source:** Phase 2 Transcript — "I need an application that tracks projects... these are all the projects in professional services right now."

**Description:**
The system shall display a list of all active delivery projects. Projects are initially seeded via a one-time Jira CST import and subsequently created directly in this application.

**Acceptance Criteria:**
- Given a user navigates to the project list, when the page loads, then all projects with `status != 'Closed'` from the `projects` table are displayed
- Each project card shows: `title`, `jira_key` (if imported), `current_phase` (computed), `project_type`, `project_manager`, `solution_architect`, `status`
- `current_phase` is computed at query time as the highest phase where all mandatory macro checkpoints have `reached_at IS NOT NULL`
- Each project is clickable and navigates to the project detail view (FR-P2-002)
- Given a user clicks "New Project", then a creation form is presented (FR-P2-009)

---

### FR-P2-002: Project Detail — Gate Status View

**Priority:** Must Have
**Source:** Phase 2 Transcript — "when I clicked on a project, I could see which gates it went through. Where the artifacts are."

**Description:**
The system shall display a per-project detail view showing all CASDM phases (0–4) with their micro artifacts and macro checkpoints, organized by phase.

**Acceptance Criteria:**
- Given a user clicks on a project, then all 5 CASDM phases are shown with their micro artifacts and macro checkpoints
- Each micro artifact shows: `artifact_name`, `status` (pending/in_progress/complete), `completed_at`, `completed_by`
- Each macro checkpoint shows: `checkpoint_name`, `checkpoint_type`, `occurred`/`reviewed_by`, `meeting_date`, `reached_at`, `result_detail`, and attached evidence count
- Items are grouped by phase with clear visual separation
- Completed items are visually distinct from pending/in-progress items

---

### FR-P2-003: Manual Evidence Attachment

**Priority:** Must Have
**Source:** Phase 2 Transcript — "they need to be able to go add the evidence" and "it could be that they go into this app and just put the link in there to the actual meeting."

**Description:**
The system shall allow authorized users (PM, SA) to attach evidence to any macro checkpoint. Evidence types: meeting link (Avoma URL), file upload (S3-backed), or arbitrary URL.

**Acceptance Criteria:**
- Given a user is on a macro checkpoint, when they click "Add Evidence", then a form appears with options: paste meeting link, upload file, or enter URL
- Given a user pastes an Avoma meeting link, then the evidence is saved with `evidence_type = 'meeting_link'` and the link is stored in `value`
- Given a user uploads a file, then the file is stored in S3 and the `gate_evidence` record references the S3 key with `evidence_type = 'file_upload'`
- Given a user enters a URL (non-Avoma), then the evidence is saved with `evidence_type = 'url'`
- Each evidence item shows: `label`, `evidence_type`, `value`, `uploaded_by`, `created_at`
- Multiple evidence items can be attached to a single checkpoint

---

### FR-P2-004: Meeting Link Entry (Manual)

**Priority:** Must Have
**Source:** Phase 2 Transcript — "it could be just they give you the... link in there to the actual meeting. We don't have to guess which meeting. Just put the link there."

**Description:**
For macro checkpoints of type `meeting` or `transcript_analysis`, the system shall provide a dedicated field to paste the Avoma meeting link.

**Acceptance Criteria:**
- Given a macro checkpoint expects a meeting link, then a "Paste Meeting Link" field is prominently displayed
- Given a user pastes a valid Avoma URL (matching `https://app.avoma.com/*`), then the link is saved to `meeting_link` column on the checkpoint
- Given a user pastes the link, then the `occurred` flag is set to `true` and `reached_at` is set to `now()`
- The user can optionally set `meeting_date` to the actual date the meeting occurred (separate from `reached_at`)
- The system does not attempt to auto-detect or auto-associate meetings with projects

---

### FR-P2-005: Transcript Analysis (AI Topic Coverage)

**Priority:** Should Have (next iteration after initial build)
**Source:** Phase 2 Transcript — "I'd like it to... give it criteria to look for in that transcript or in that call and tell us whether those topics were covered." + "I'm gonna use the agent core, which is more specialized toward these kind of dynamic behaviors"

**Description:**
For checkpoints of type `transcript_analysis`, the system shall fetch the transcript from Avoma using the provided meeting link, then run AI analysis via **Amazon Bedrock Agents (AgentCore)** to check whether required topics were discussed. AgentCore provides dynamic agent behavior and multi-step reasoning needed for per-gate configurable prompt execution (see FR-P2-029 for admin-editable prompts).

**Acceptance Criteria:**
- Given a checkpoint has a `meeting_link` and the user clicks "Analyze Transcript", then the system calls the Avoma API to fetch the transcript text
- Given the transcript is fetched, then the system invokes the **Bedrock AgentCore agent** with the checkpoint-specific prompt (from `analysis_prompts` table, see FR-P2-029) and the transcript as input
- The AgentCore agent returns structured JSON: `{ topics_covered: string[], topics_missing: string[], passed: boolean, confidence: number }`
- The result is stored in `analysis_result` JSONB column and `analysis_run_at` timestamp is set
- The `result_detail` TEXT field captures a human-readable summary of the analysis outcome
- The UI shows a pass/fail indicator with details of covered and missing topics
- If the Avoma API call fails, the system returns HTTP 502 with `{ "code": "AVOMA_UNAVAILABLE", "message": "Failed to fetch transcript from Avoma" }` and the user can retry
- If the AgentCore invocation fails, the system returns HTTP 502 with `{ "code": "AGENT_UNAVAILABLE", "message": "Failed to invoke analysis agent" }` and the user can retry

---

### FR-P2-006: Configurable Phases and Gates

**Priority:** Must Have
**Source:** Phase 2 Transcript — "Let's say we change the methodology and I need to add a gate. How do I do that?... we wanna rename a phase from, like, discovery to something else."

**Description:**
The system shall allow an admin user to add, rename, reorder, or deactivate phases and gates without a code deployment. Changes apply to new projects; existing projects retain their original gate configuration.

**Acceptance Criteria:**
- Given an admin user navigates to the configuration panel, then they see all current phases and their gates from `casdm_config` table
- Given an admin adds a new gate to a phase, then a row is inserted into `casdm_config` with `is_active = true` and new projects include the new gate
- Given an admin renames a phase, then `casdm_config.phase_name` is updated and the new name appears on the config panel
- Given an admin deactivates a gate, then `is_active` is set to `false`; it no longer appears on new projects but remains visible (greyed out) on existing projects
- Changes are effective immediately without code deployment or server restart
- `changed_by` and `updated_at` are recorded on every modification

---

### FR-P2-007: Micro Artifact Status Tracking

**Priority:** Must Have
**Source:** Phase 2 Transcript — "micro is everything you do in Kiro. It's tracking in the progress file, and you're capturing in your database."

**Description:**
The system shall display the status of AI-generated micro artifacts per project per phase. Status is updated automatically from governance events and manually by authorized users.

**Acceptance Criteria:**
- Given a project is created, then all CASDM micro artifacts are pre-seeded from the `casdm_config` table (where `config_type = 'micro_artifact'` and `is_active = true`)
- Status transitions: `pending` → `in_progress` → `complete`
- Given the Phase 1 MCP server records a governance event matching a micro artifact, then the corresponding artifact's `status` updates to `in_progress` or `complete`
- Users with PM or SA role can manually override status with a note
- Each status change records `completed_by` and `completed_at`

---

### FR-P2-008: Macro Checkpoint Completion

**Priority:** Must Have
**Source:** Phase 2 Transcript — "macro would be that the meeting happened and that... certain topics were discussed" and "it's not yes or no — this is something else."

**Description:**
The system shall allow authorized users to mark macro checkpoints as complete. Checkpoints support rich result capture beyond simple Yes/No via the `result_detail` field.

**Acceptance Criteria:**
- Given a `human_review` checkpoint, then an SA can click "Mark Reviewed" and `reviewed_by` + `reviewed_at` are recorded
- Given a `meeting` checkpoint, then a PM can set `occurred = true`, paste a `meeting_link`, set `meeting_date`, and optionally fill `result_detail` with outcome notes
- Given a `transcript_analysis` checkpoint with a meeting link, then the "Analyze" button triggers FR-P2-005
- Given a `checklist` checkpoint (FR-P2-019), then completion is determined by all child items being checked
- `reached_at` is set to `now()` when the PM logs completion (system timestamp)
- `meeting_date` records when the meeting actually happened (user-provided date)
- `result_detail` captures richer outcome text beyond boolean (e.g., "3 of 5 topics covered — follow-up scheduled")
- A checkpoint cannot be un-completed once marked (append-only audit trail)

---

### FR-P2-009: Jira CST One-Time Import & Direct Project Creation

**Priority:** Must Have
**Source:** Phase 2 Transcript — "eventually, I'd like to get rid of these Jira pages and even use this"

**Description:**
The system shall support a **one-time bootstrap import** from the Jira CST board to seed existing projects into the app. After the initial import, all new projects are created directly in this application. There is no recurring sync. This app IS the project management system going forward.

**Acceptance Criteria:**
- Given an admin triggers the one-time import, then the system fetches all issues from the Jira CST board via Jira Cloud REST API
- Each Jira issue creates a row in `projects` with: `jira_key`, `title`, `description`, `status`, `project_manager`, `solution_architect`, `account_executive`, `engineers_assigned`, `planned_kickoff_date`, `expected_completion_date`, `sow_hours`, `project_type`
- The import runs exactly once; subsequent attempts return HTTP 409 with `{ "code": "IMPORT_ALREADY_COMPLETE", "message": "Jira import has already been executed" }`
- After import, the "Import from Jira" button is disabled and shows "Import completed on [date]"
- Given a user clicks "New Project", then a creation form collects: `title`, `project_type`, `project_manager`, `solution_architect`, `account_executive`, `sow_hours`, `planned_kickoff_date`, `expected_completion_date`
- On project creation, CASDM template micro artifacts, macro checkpoints, and onboarding checklist items (FR-P2-019) are auto-seeded
- No recurring Jira sync exists — the app is the system of record going forward

---

### FR-P2-010: Role-Based Views

**Priority:** Must Have
**Source:** Phase 2 Transcript — "if I'm the project manager and I wanna see where my project is"

**Description:**
The system shall provide role-based views:
- **PM View:** My projects, gate status, upload evidence, mark checkpoints, log status calls, manage escalations
- **SA View:** Projects assigned for review, pending review items, mark human_review checkpoints
- **Engineer View:** Read-only project status, relevant micro artifacts (specs, code)
- **Leadership View:** Cross-project summary, phase completion rates, stalled projects, admin panel access

**Acceptance Criteria:**
- Given a user logs in via Cognito, then they see the view appropriate to their role (stored in Cognito custom attributes or app DB)
- PM view shows only projects where the user is the assigned PM (plus a "Browse All" option)
- SA view highlights checkpoints pending their review
- Leadership view shows an aggregate summary with drill-down capability
- Unauthorized access to admin functions returns HTTP 403 with `{ "code": "FORBIDDEN", "message": "Insufficient permissions" }`

---

### FR-P2-011: Phase 1 Governance Data Integration

**Priority:** Must Have
**Source:** Phase 2 Transcript — "you're collecting stuff in your database for Kiro. Where would I see that if I'm a project manager?"

**Description:**
The system shall surface governance events from the Phase 1 `governance_events` table within the project timeline. Phase 1 and Phase 2 share the same RDS PostgreSQL database — the `governance_events` table is already on this instance. No sync or mirroring is required.

**Acceptance Criteria:**
- Given the Phase 1 MCP server records a governance event with a `project_id` matching a project in `projects.jira_key`, then that event appears in the project's timeline
- Events are displayed chronologically, interleaved with manual checkpoint completions
- Micro events (`type = 'micro'`) appear as timeline entries under the appropriate phase
- Macro events (`type = 'macro'`) appear as checkpoint completions and update the corresponding `macro_checkpoints` row's `reached_at`

---

### FR-P2-012: File Upload to S3

**Priority:** Must Have
**Source:** Phase 2 Transcript — "they need to be able to go add the evidence" (evidence includes uploaded files)

**Description:**
The system shall allow users to upload files as gate evidence. Files are stored in S3 with a structured key path.

**Acceptance Criteria:**
- Given a user clicks "Upload File" on a checkpoint, then a file picker opens
- Accepted file types: PDF, DOCX, XLSX, PNG, JPG, TXT, MD (max 25 MB)
- File is uploaded to S3 at path: `evidence/{project_id}/{phase}/{checkpoint_name}/{filename}`
- Upload progress indicator is shown; on completion a `gate_evidence` row is created with `evidence_type = 'file_upload'` and `value` = S3 key
- Files exceeding 25 MB are rejected client-side with message "File size exceeds 25 MB limit"
- Files can be downloaded by any authenticated user viewing the checkpoint

---

### FR-P2-013: Avoma API Integration

**Priority:** Should Have (dependent on Avoma API availability)
**Source:** Phase 2 Transcript — "I'd like to just put the meeting link or something like that" and "put Avoma if we have that ability"

**Description:**
The system shall integrate with the Avoma API to fetch meeting transcripts given a meeting link or ID. Credentials are stored in AWS Secrets Manager.

**Acceptance Criteria:**
- Given a user has pasted an Avoma meeting link, when they click "Fetch Transcript", then the Lambda calls the Avoma API to retrieve the full transcript text
- Avoma API credentials are stored in AWS Secrets Manager (not in code or environment variables)
- If the API call succeeds, the transcript text is stored in S3 at `transcripts/{project_id}/{checkpoint_name}/{timestamp}.txt`
- If the API call fails (invalid link, auth error, rate limit), the API returns HTTP 502 with `{ "code": "AVOMA_UNAVAILABLE", "message": "[error detail]" }`
- The transcript can then be sent for AI analysis (FR-P2-005)

---

### FR-P2-014: Project Phase Progression

**Priority:** Must Have
**Source:** Architect decision — derived from CASDM methodology structure

**Description:**
The system shall track and display each project's progression through CASDM phases.

**Acceptance Criteria:**
- `current_phase` is **computed at query time** — derived as the highest phase where all mandatory macro checkpoints have `reached_at IS NOT NULL`
- No `current_phase` column exists in the `projects` table
- The project detail view shows progression: completed phases (green), current phase (blue), future phases (grey)
- There is no automatic lock-out — users can still add evidence to past-phase checkpoints
- Phase advancement is displayed but does not block any actions

---

### FR-P2-015: Search and Filter Projects

**Priority:** Should Have
**Source:** Architect decision — UX necessity for a project list with many items

**Description:**
The system shall allow users to search and filter the project list.

**Acceptance Criteria:**
- A search bar filters by `title` or `jira_key` (case-insensitive partial match)
- Dropdown filters available for: `status`, computed `current_phase`, `project_manager`, `solution_architect`, `project_type`
- Filters combine with AND logic
- Filter state persists during the browser session (localStorage)
- Empty results show "No projects match your filters" message

---

### FR-P2-016: Admin — Manage Phase/Gate Configuration

**Priority:** Must Have
**Source:** Phase 2 Transcript — "Let's just say we wanna add a step... let's say we change the methodology and I need to add a gate." + Phase 2 Meeting Notes — "make gates and project type configuration extensible for different project categories (AppDev, Migration, AI/ML)"

**Description:**
The system shall provide an admin panel where Leadership role users can manage the CASDM phase/gate configuration template **per project type**. Each project type (AppDev, App Mod/Migration, AI/ML, Other) has its own independent gate template.

**Acceptance Criteria:**
- Admin panel shows the current CASDM template from `casdm_config` table: phases → gates and artifacts per phase
- Admin can select a project type and manage its specific phase/gate configuration independently from other project types
- Admin can add a new phase (with `phase_name`, `phase_order`)
- Admin can add a new gate or artifact to an existing phase (with `item_name`, `item_order`, `item_type`, `is_mandatory`)
- Admin can rename a phase or gate (updates `phase_name` or `item_name`)
- Admin can reorder phases or gates (updates `phase_order` or `item_order`)
- Admin can deactivate (set `is_active = false`) a gate or artifact
- Admin can copy a template from one project type to another as a starting point
- Changes only affect newly-created projects (existing projects are not retroactively modified)
- All changes record `changed_by` and `updated_at`
- Non-Leadership users accessing `/admin/*` routes receive HTTP 403

---

### FR-P2-017: Checkpoint Notes

**Priority:** Should Have
**Source:** Phase 2 Transcript — contextual from "add the evidence" and need for PMs to annotate progress

**Description:**
The system shall allow users to add free-text notes to any checkpoint.

**Acceptance Criteria:**
- Each macro checkpoint has a "Add Note" button
- Notes are saved as append-only entries in `checkpoint_notes` table (columns: `id`, `project_id`, `checkpoint_name`, `note_text`, `author`, `created_at`)
- `note_text` max length: 4000 characters; exceeding returns HTTP 400 with `{ "code": "VALIDATION_ERROR", "field": "note_text", "message": "Note exceeds 4000 character limit" }`
- Each note displays `author` and `created_at` timestamp
- Notes cannot be edited or deleted after creation (append-only)

---

### FR-P2-018: CloudFront Deployment

**Priority:** Must Have
**Source:** Phase 2 Transcript — "they can be embedded into a URL, and that URL can be used to fetch the data. They don't need to actually own that AWS account."

**Description:**
The React SPA shall be deployed to Amazon CloudFront. The app URL is shareable; delivery team members access it via browser without needing AWS console access.

**Acceptance Criteria:**
- The Vite build output (`dist/`) is deployed to an S3 bucket configured as a CloudFront origin
- CloudFront distribution serves the SPA with HTTPS (ACM certificate)
- All routes return `index.html` for client-side routing (CloudFront custom error response: 403/404 → `/index.html` with 200)
- The app URL (e.g., `https://deliverpro.cloudelligent.com` or CloudFront domain) is accessible to any authenticated team member
- No AWS console access required to use the application
- Static assets are cached with appropriate `Cache-Control` headers (immutable for hashed files, no-cache for `index.html`)

---

### FR-P2-019: Project Onboarding Checklist

**Priority:** Must Have
**Source:** CASDM PDF Phase 0 swimlane — PM + SA + AE actions

**Description:**
When a project is created, a structured onboarding checklist is presented covering all Phase 0 setup tasks. Each item is independently checkable with a completion date and actor.

**Acceptance Criteria:**
- On project creation, the following items are seeded into `onboarding_checklist_items` table:
  1. "Set up Slack/Teams channel"
  2. "Set up Clockify"
  3. "Assign resources via email"
  4. "Complete SOW handoff checklist"
  5. "Send customer intro email — Introduce team"
  6. "Send customer intro email — Schedule kickoff"
  7. "Send customer intro email — Share discovery agenda & questions"
  8. "Send customer intro email — Figure out account access"
  9. "Send customer intro email — Confirm communication channels"
- Each item has columns: `id`, `project_id` (FK), `item_name`, `completed` (BOOLEAN, default false), `completed_by` (TEXT), `completed_at` (TIMESTAMPTZ)
- Given a user checks an item, then `completed = true`, `completed_by = [current_user]`, `completed_at = now()`
- Items can be unchecked (set `completed = false`, clear `completed_by` and `completed_at`)
- The onboarding checklist is visible on the project detail view under Phase 0
- A progress indicator shows "X of 9 complete"
- The checklist checkpoint type in `macro_checkpoints` is `'checklist'` — its `reached_at` is set when all 9 items are complete

---

### FR-P2-020: Weekly Status Call Log

**Priority:** Must Have
**Source:** CASDM PDF — "Weekly Status Call with Client (Status & Demo)" + Phase 2 Transcript — "status reports embedded in here so that it come and add a status report every week"

**Description:**
PMs log each weekly client status call occurrence per project.

**Acceptance Criteria:**
- Given a PM clicks "Log Status Call" on a project, then a form collects: `log_date` (DATE, required), `meeting_link` (TEXT, optional Avoma URL), `topics_covered` (TEXT, required), `demo_items` (TEXT, optional), `blockers` (TEXT, optional)
- On submit, a row is inserted into `weekly_status_logs` with `logged_by = [current_user]` and `created_at = now()`
- The project detail view shows a chronological list of all status logs for the project
- Each log entry displays: date, meeting link (clickable), topics, demo items, blockers, logged by
- `log_date` must not be in the future; validation error HTTP 400 `{ "code": "VALIDATION_ERROR", "field": "log_date", "message": "Date cannot be in the future" }`

---

### FR-P2-021: Escalation Board

**Priority:** Must Have
**Source:** CASDM PDF — "Escalation Board (As per requirement)"

**Description:**
PMs log escalations against a project with severity tracking and resolution workflow.

**Acceptance Criteria:**
- Given a PM clicks "Log Escalation", then a form collects: `raised_date` (DATE, required), `description` (TEXT, required, max 2000 chars), `severity` (enum: 'low'|'medium'|'high'|'critical', required), `raised_by` (TEXT, required)
- On submit, a row is inserted into `escalations` with `status = 'open'` and `created_at = now()`
- The project detail view shows all escalations sorted by `raised_date` DESC, with open escalations visually highlighted
- Given a user clicks "Resolve" on an open escalation, then a form collects: `resolved_date` (DATE, required), `resolution_notes` (TEXT, required)
- On resolution, `status` is set to `'resolved'`, `resolved_date` and `resolution_notes` are saved
- Severity filter: users can filter escalations by severity level
- The `severity` column uses CHECK constraint: `('low','medium','high','critical')`
- The `status` column uses CHECK constraint: `('open','resolved')`

---

### FR-P2-022: Resource Budget Tracking

**Priority:** Must Have
**Source:** CASDM PDF — "Update Resource budget plan" + Jira XML — SOW Hours field

**Description:**
Each project shows SOW hours (from project creation) vs hours consumed (manually updated by PM). Burn rate is displayed as a percentage with visual indicator.

**Acceptance Criteria:**
- The `projects` table has `sow_hours NUMERIC(8,2)` (set at project creation or import)
- A new field `hours_consumed NUMERIC(8,2) DEFAULT 0` is added to the `projects` table
- Given a PM clicks "Update Hours", then a form allows entering the current `hours_consumed` value
- Burn rate is computed as: `(hours_consumed / sow_hours) * 100` — displayed as a percentage
- Visual indicator: green (0-70%), yellow (71-90%), red (91%+)
- If `sow_hours` is NULL or 0, the burn rate section shows "SOW hours not set" instead of a percentage
- The resource budget summary is visible on the project detail view header

---

### FR-P2-023: Project Closure Workflow

**Priority:** Must Have
**Source:** CASDM PDF Phase 4 swimlane

**Description:**
Phase 4 includes a closure checklist. When all items are complete, the project status transitions to Closed.

**Acceptance Criteria:**
- The closure workflow consists of 4 checklist items tracked as `macro_checkpoints` with `checkpoint_type = 'checklist'` in Phase 4:
  1. "Request Signoff from Business Ops" — `occurred` (Yes/No) + `meeting_date`
  2. "Share Signoff with Customer" — `occurred` (Yes/No) + `meeting_date`
  3. "Project Closure Meeting/Email" — `occurred` (Yes/No) + `meeting_date` + optional `meeting_link`
  4. "Create Project Closure Deck" — evidence file upload required (via FR-P2-012)
- Given all 4 closure items have `occurred = true` (or evidence attached for item 4), then the system prompts: "All closure items complete. Close this project?"
- Given the user confirms closure, then `projects.status` is set to `'Closed'`
- Closed projects remain visible in the project list (filterable) but are visually muted
- Closure can be reversed by a Leadership role user (sets status back to previous value)

---

### FR-P2-024: Executive Check-in Calls

**Priority:** Must Have
**Source:** CASDM PDF — both calls appear in separate phase swimlanes

**Description:**
Two separate executive check-in calls per project: Call 1 during Phase 3 (Build & Implement) and Call 2 during Phase 4 (Launch & Enable).

**Acceptance Criteria:**
- "Executive Check-in Call 1" is a `macro_checkpoint` in Phase 3 with `checkpoint_type = 'meeting'`
- "Executive Check-in Call 2" is a `macro_checkpoint` in Phase 4 with `checkpoint_type = 'meeting'`
- Each tracks: `occurred` (Yes/No), `meeting_date` (DATE), `meeting_link` (TEXT, optional Avoma URL)
- The `result_detail` field can capture notes from the executive discussion
- Both are seeded from the CASDM template on project creation

---

### FR-P2-025: Discovery Sessions Log

**Priority:** Must Have
**Source:** CASDM PDF — "Discovery Session 1, Discovery Session 2, Discovery Session X"

**Description:**
Phase 1 supports multiple discovery sessions. Each is logged separately. These are distinct from the Discovery Readout (the client-facing summary meeting).

**Acceptance Criteria:**
- Given a PM clicks "Log Discovery Session" on a Phase 1 project, then a form collects: `session_number` (INT, auto-incremented per project), `session_date` (DATE, required), `meeting_link` (TEXT, optional), `participants` (TEXT, required), `notes` (TEXT, optional)
- On submit, a row is inserted into `discovery_sessions` with `created_at = now()`
- `session_number` is auto-assigned as `MAX(session_number) + 1` for that `project_id`
- The project detail view under Phase 1 shows all discovery sessions in order
- Each session displays: "Discovery Session [N]", date, meeting link (clickable), participants, notes

---

### FR-P2-026: Kickoff Prep Meeting

**Priority:** Must Have
**Source:** CASDM PDF — "Kickoff Call Prep Meeting (PM + SA + Engineer)"

**Description:**
Internal meeting (PM + SA + Engineer) before the customer kickoff call. Tracked as a macro checkpoint.

**Acceptance Criteria:**
- "Kickoff Prep Meeting" is a `macro_checkpoint` in Phase 1 with `checkpoint_type = 'meeting'`
- Tracks: `occurred` (Yes/No), `meeting_date` (DATE), `meeting_link` (TEXT, optional)
- Seeded from CASDM template on project creation
- Appears in the project detail view under Phase 1, before the "Kickoff Call" checkpoint

---

### FR-P2-027: Account Planning Session

**Priority:** Must Have
**Source:** CASDM PDF — "Account Planning Session (Led by AE)" + "Discuss Additional Revenue Opportunities"

**Description:**
AE-led session where PM/SA attend. Tracked with meeting details and revenue opportunities noted.

**Acceptance Criteria:**
- "Account Planning Session" is a `macro_checkpoint` in Phase 4 with `checkpoint_type = 'meeting'`
- Tracks: `occurred` (Yes/No), `meeting_date` (DATE), `meeting_link` (TEXT, optional)
- The `result_detail` field captures "Revenue opportunities noted" (free text describing additional opportunities discussed)
- Seeded from CASDM template on project creation
- Appears in the project detail view under Phase 4

---

### FR-P2-028: Resource Budget Display on Project Card

**Priority:** Should Have
**Source:** CASDM PDF — "Update Resource budget plan" + Jira XML — SOW Hours field

**Description:**
The project list view (FR-P2-001) shows a compact burn rate indicator on each project card for quick at-a-glance resource health.

**Acceptance Criteria:**
- Each project card in the list view shows a small burn rate badge: "[X]% burned"
- Badge color follows the same rules as FR-P2-022: green (0-70%), yellow (71-90%), red (91%+)
- If `sow_hours` is NULL or 0, no badge is shown
- Clicking the badge navigates to the project detail resource budget section

---

### FR-P2-029: Admin-Editable Analysis Prompts per Gate

**Priority:** Must Have
**Source:** Phase 2 Meeting Transcript (Chris Xenos + Faraz) — "in the admin section, you may wanna be able to adjust the prompt... these things are configurable upon admin controls"

**Description:**
Each macro checkpoint of type `transcript_analysis` has an associated Bedrock prompt stored in a new `analysis_prompts` table. Admins edit these prompts via the admin panel without code deployment. The AgentCore analysis agent uses the checkpoint-specific prompt when analyzing transcript evidence.

**Acceptance Criteria:**
- Given an admin navigates to the prompt management section, then they see a list of all `transcript_analysis` checkpoints with their associated prompts from the `analysis_prompts` table
- Given an admin edits a prompt for a checkpoint, then `prompt_text` is updated, `updated_by` is set to the current user, and `updated_at` is set to `now()`
- Given a transcript analysis is triggered (FR-P2-005), then the system fetches the prompt from `analysis_prompts` where `checkpoint_name` matches the current checkpoint and passes it to the AgentCore agent
- If no prompt exists for a checkpoint, the system uses a default generic prompt: "Analyze this transcript and determine if the following topics were covered: [topics from casdm_config]"
- `prompt_text` has no character limit but the UI displays a character count for reference
- Only Leadership/Admin role users can edit prompts; others see prompts as read-only
- Prompt changes take effect immediately on the next analysis run (no restart required)

---

### FR-P2-030: Project Type–Based Gate Templates

**Priority:** Must Have
**Source:** Phase 2 Meeting Notes — "make gates and project type configuration extensible for different project categories (AppDev, Migration, AI/ML)"

**Description:**
When a new project is created, the PM selects a project type (AppDev, App Mod/Migration, AI/ML, Other). The `casdm_config` table is keyed by `project_type` so each type has its own phase/gate template. Creating a project seeds the matching template into the project's checkpoints and artifacts.

**Acceptance Criteria:**
- Given a user creates a new project (FR-P2-009), then the project type dropdown offers: `AppDev`, `App Mod/Migration`, `AI/ML`, `Other` (sourced from distinct `project_type` values in `casdm_config`)
- Given a project type is selected at creation, then the system seeds micro artifacts, macro checkpoints, and onboarding checklist items from the `casdm_config` rows matching that `project_type`
- Given the admin manages gate configuration (FR-P2-016), then they select which project type template they are editing
- The `casdm_config` table uses a compound unique constraint on `(phase, item_name, project_type)` — the same gate can exist in multiple project types with different configurations
- A `'default'` project type template serves as the fallback if a project type has no specific configuration
- The one-time Jira import (FR-P2-009) uses the `project_type` from Jira data to seed the matching template; if project type is missing, uses `'default'`

---

### FR-P2-031: Evidence Link Metadata Extraction

**Priority:** Should Have
**Source:** Phase 2 Meeting Transcript — "if you can just strip that from the Avoma link... there is some embedded metadata attached to the link... I'll try to find out if there is timestamps"

**Description:**
When a user adds a URL (Avoma, Teams, SharePoint) as evidence, the system attempts best-effort metadata extraction: meeting title, date/time, duration. Extracted metadata is displayed alongside the link. If extraction fails, the link is stored without metadata (no error shown to user).

**Acceptance Criteria:**
- Given a user submits a URL as evidence (meeting_link or url type), then the system asynchronously attempts metadata extraction
- For Avoma links (`https://app.avoma.com/*`): attempt to extract meeting title, date, and duration from the Avoma API or page metadata
- For Teams links (`https://teams.microsoft.com/*`): attempt to extract meeting title and date from URL parameters or metadata
- For SharePoint links (`https://*.sharepoint.com/*`): attempt to extract document title and last-modified date
- Extracted metadata is stored as a JSONB `link_metadata` column on the `gate_evidence` record: `{ "title": string, "date": string, "duration_minutes": number | null }`
- If extraction fails (network error, unsupported format, no metadata available), the evidence is saved with `link_metadata = NULL` — no error is shown to the user
- The UI displays extracted metadata (title, date, duration) below the link when available
- Metadata extraction is non-blocking — the evidence record is created immediately and metadata is populated asynchronously

---

---

### FR-P2-032: First-Login New Password Flow

**Priority:** Must Have
**Source:** Production bug — 2026-06-30. Cognito `adminCreateUser` sets accounts to `FORCE_CHANGE_PASSWORD` state. Every admin-invited user hits this on first login.

**Description:**
When a user logs in for the first time with an admin-assigned temporary password, Cognito returns a `NEW_PASSWORD_REQUIRED` challenge. The system shall intercept this challenge and present an inline "Set your permanent password" form without redirecting away from the login page. On successful password set, the user is automatically authenticated and redirected to `/projects`.

**Acceptance Criteria:**
- Given a user logs in with a temporary password, when Cognito returns `NEW_PASSWORD_REQUIRED`, then the login form transitions to a "Set new password" form on the same page
- The new password form shows: new password field, confirm password field, and "Set Password & Sign In" button
- An informational message explains: "Your administrator created your account. Please set a permanent password to continue."
- Client-side validation: minimum 8 characters, passwords must match — both enforced before API call
- On success: user is authenticated and redirected to `/projects` (no second login required)
- On failure (e.g. password does not meet Cognito policy): error message shown, form remains
- A "Back to login" link resets to the standard login form
- The `completeNewPassword()` function in `auth.ts` uses the `CognitoUser` instance held from the initial `authenticateUser` call — no second authentication round trip

---

> **FR-P2-033 through FR-P2-042 — GitHub ↔ Slack Linkage & Micro Integration (added v1.5, 2026-07-02; FR-P2-042 activated v1.7, 2026-07-07).**
> These requirements formalize the approved change request for linking a project to its GitHub repository and dual Slack destinations, reconciling Phase 1 governance events to Phase 2 projects, enforcing no-orphan governance storage, and routing dual-channel notifications through the shared MCP `notify_slack` tool. Source of design: `docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md` (v3 — Final Design of Record) + `specs/phase2/CR-12-14-level2-spec.md` (Level 2). Micro integration now covers **both levels**: Level 1 (timeline surfacing, FR-P2-036) and **Level 2 (micro→artifact auto-completion, FR-P2-042 — ACTIVATED 2026-07-07, Must)**. Per the customer trust-model acceptance of 2026-07-07, Level 2 runs app-side and trusts the same authenticated MCP path as `record_progress`; GitHub OIDC is **not** a prerequisite.

---

### FR-P2-033: Project Unique Key — Uniqueness & Immutability

**Priority:** Must Have
**Source:** Customer 2026-07-02 (change request Decision B): "every project must have a unique identifier (a key)." Existing DB behaviour verified in `migrations/V002__projects_and_casdm_tracking.sql` (`jira_key TEXT NOT NULL UNIQUE`). Immutability is an **Architect decision — not customer-specified** (all child FKs reference `jira_key` with `ON DELETE CASCADE` and no `ON UPDATE CASCADE`, so mutating the key would orphan every child row).

**Description:**
Every project shall have a globally unique business key (`jira_key`) assigned at creation (imported from Jira, or generated as `DP-NNN`) that is immutable for the life of the project. The key is the referential anchor for all child records.

**Acceptance Criteria:**

- Given two projects, when both exist, then their `jira_key` values are distinct (enforced by the `UNIQUE` constraint on `projects.jira_key`).

- Given a create request whose `jira_key` already exists, when submitted, then the API returns HTTP 409 `{ "code": "DUPLICATE_JIRA_KEY" }`.

- Given a `PATCH /api/projects/{projectId}` request with any attempt to change `jira_key`, when submitted, then the API returns HTTP 422 `{ "code": "IMMUTABLE_FIELD", "field": "jira_key", "message": "jira_key cannot be changed after creation" }` and the stored value is unchanged.

- Given a directly-created project, when created, then `jira_key` matches the pattern `^DP-\d{3,}$` and is the next sequential value.

- Given any child record (`micro_artifacts`, `macro_checkpoints`, `gate_evidence`, `checkpoint_notes`, `weekly_status_logs`, `escalations`, `discovery_sessions`, `onboarding_checklist_items`, `project_link_audit`), then its `project_id` FK references exactly one `projects.jira_key`.

---

### FR-P2-034: Project ↔ GitHub Repository Link

**Priority:** Must Have
**Source:** Customer 2026-07-02 (change request Decision A) + Phase 2 transcript, Muhammad Faraz: "attach it to a repository, generate some documents" and "It works with your Github… write it down on our database" (`.kiro/Knowledge/Phase2MeetingTranscript.txt`). Storing the link on the project entity and the admin/leadership authorization are **Architect + security decisions — not customer-specified**.

**Description:**
A project shall be linkable to its GitHub repository. The repository name is the identifier Phase 1 governance events are keyed by (`github.event.repository.name`), so the link is the bridge that reconciles Phase 1 governance events to Phase 2 projects. The link is nullable (feature switch — see FR-P2-040), correctable by authorized roles, and fully audited per field.

**Acceptance Criteria:**

- Given a project, then it exposes `github_repo` (repository name, e.g. `deliverpro`) and `github_url` (full HTTPS repo URL); both nullable.

- Given a `POST /api/projects` request that omits `github_repo`, when submitted, then the project is created with `github_repo = NULL` (feature switch OFF; linkable later).

- Given two projects both with a non-NULL `github_repo`, when both exist, then their values are distinct; a duplicate returns HTTP 409 `{ "code": "DUPLICATE_GITHUB_REPO" }` (enforced by a partial unique index — 1:1 repo↔project).

- Given a `github_repo` value, when set, then it matches `^[A-Za-z0-9._-]{1,100}$`; an invalid value returns HTTP 400 `{ "code": "VALIDATION_ERROR", "field": "github_repo" }`.

- Given a `github_url` value, when set, then it MUST match `^https://github\.com/[A-Za-z0-9._/-]{1,200}$` (scheme `https` only; host allow-listed to `github.com`); any other scheme, host, or embedded control characters returns HTTP 400 `{ "code": "VALIDATION_ERROR", "field": "github_url" }`. When rendered as a clickable link, the anchor uses `rel="noopener noreferrer"`.

- Given an `admin` or `leadership` user (verified on the Cognito `sub`/group claim, NOT the free-text `project_manager` field) submits `PATCH /api/projects/{projectId}` with a new `github_repo`, when submitted, then the link is updated; given any other role attempts the same change, then the API returns HTTP 403 `{ "code": "FORBIDDEN", "message": "Only admin or leadership may change project linkage" }`.

- Given any create or change of `github_repo` / `github_url`, when persisted, then one `project_link_audit` row is written per changed field (`field` = the exact column name, `old_value`, `new_value`, actor Cognito `sub`, timestamp) and `projects.updated_by` / `projects.updated_at` are set.

- Given a project with `github_repo` set, when its detail is viewed, then the `github_url` is rendered as a clickable link.

---

### FR-P2-035: Project ↔ Dual Slack Destinations (App-Managed)

**Priority:** Must Have
**Source:** Customer 2026-07-02 (change request Decisions C, D, E) — dual channels per project (micro + macro); one workspace-level Slack bot token; the token is a secret.

**Description:**
A project shall store two non-secret Slack channel identifiers — one for MICRO notifications and one for MACRO notifications. The workspace Slack bot token is a secret and is stored only in SSM SecureString (or Secrets Manager); it is never a database column, API response, or log line. PostgreSQL holds only the non-secret channel ids.

**Acceptance Criteria:**

- Given a project, then it exposes `slack_micro_channel_id` and `slack_macro_channel_id` (both nullable, non-secret Slack channel ids e.g. `C0123ABCD`); no bot token or webhook URL is ever present in any API response, database column, or log.

- Given the workspace Slack bot token, then it is stored only in SSM SecureString (or Secrets Manager) as a single workspace-level parameter; it is never a database column.

- Given a change to either channel id, when submitted, then it is authorized to `admin` / `leadership` (Cognito-sub check, per FR-P2-034) and writes one `project_link_audit` row per changed field (`field` = `slack_micro_channel_id` or `slack_macro_channel_id`, with that field's own old→new value, actor, timestamp).

- Given the rejected webhook-URL-in-PG alternative, if chosen by the customer, then any URL column MUST be `pgcrypto`/KMS-encrypted and pass a dedicated security review (the default design forbids storing any Slack URL in PostgreSQL).

---

### FR-P2-036: Governance Reconciliation — MICRO Surfacing (Level 1); MACRO Display-Only

**Priority:** Must Have
**Source:** Customer 2026-07-02 (change request Decisions H, I — Level 1) + FR-P2-011. Reconciliation via `github_repo` is an **Architect decision — not customer-specified** (fixes the identifier-space mismatch between Phase 1 repo names and Phase 2 `jira_key`).

**Description:**
Governance events produced by GitHub/Kiro (Phase 1, keyed by repository name) shall reconcile to the correct Phase 2 project via the project's `github_repo` link so that micro events surface on the project timeline (Level 1) and macro events are displayed but never auto-complete app-owned gates. This build includes both Level 1 (timeline surfacing, this FR) and Level 2 (micro→artifact auto-completion — see FR-P2-042, activated 2026-07-07). Macro completion remains app-owned regardless (FR-P2-041).

**Acceptance Criteria:**

- Given a `governance_events` row with `project_id = R` and a project with `github_repo = R`, when the timeline is requested, then that event appears on that project's timeline with `source: 'kiro_mcp'`, ordered chronologically.

- Given a `governance_events` row with `type = 'macro'`, when processed, then it is displayed on the timeline but does NOT set `macro_checkpoints.reached_at` (macro completion is app-owned — FR-P2-041).

- Given a `governance_events` row whose `project_id` matches no project's `github_repo`, when processed, then it does not appear on any project timeline and no error is raised (it was hard-rejected at write time per FR-P2-038).

- Given a project with `github_repo = NULL`, when its timeline is requested, then only DeliverPro-native events (checkpoints, evidence) appear — identical to current behaviour — and no error is raised.

---

### FR-P2-037: MCP Governance Logs Visible Per Project

**Priority:** Must Have
**Source:** Customer — FR-P2-011 source quote: "you're collecting stuff in your database for Kiro. Where would I see that if I'm a project manager?" (`docs/phase2/srs.md` FR-P2-011). This FR makes FR-P2-011 deliver by fixing the join key from `jira_key` to `github_repo`.

**Description:**
For every project with a valid GitHub link, the MCP governance events shall be visible in the project timeline, the leadership reporting timeline, and the QuickSight-ready `v_timeline` view, joined via `github_repo`.

**Acceptance Criteria:**

- Given a project with `github_repo = R` and one or more `governance_events` rows with `project_id = R`, when `GET /api/projects/{projectId}/timeline`, `GET /api/reporting/timeline/{projectId}`, and the `v_timeline` view are queried, then all three return those events (joined via `github_repo`), ordered chronologically, with `source: 'kiro_mcp'`.

- Given a project with `github_repo = NULL`, when its timeline is requested, then only DeliverPro-native events appear and no error is raised.

- Given a project whose `github_repo` was just backfilled, when the timeline is next requested, then historical governance events for that repo appear immediately (read-side join; no reprocessing/sync required).

---

### FR-P2-038: No-Orphan Governance Event Storage

**Priority:** Must Have
**Source:** Customer 2026-07-02 (change request Decision G): "stored only if it maps to an existing project; if none, do not store." Append-only DB enforcement is an **Architect + security decision** (SEC-H1 — ownership reassignment).

**Description:**
The MCP `record_progress` tool shall persist a governance event only if the event's repository name resolves to an existing project (`projects.github_repo = event repo`). If no project matches, the event is hard-rejected and not written. The MCP database role is append-only on `governance_events` and read-only (column-scoped) on `projects`, enforced by reassigning table ownership to a non-runtime `kiro_migrator` role.

**Acceptance Criteria:**

- Given `record_progress` with `project_id = R`, when no project has `github_repo = R`, then the event is NOT written and the tool returns `{ "written": false, "reason": "no_matching_project" }`.

- Given the same rejection, when it occurs, then a dimensionless `GovernanceEventRejected` CloudWatch counter is incremented (NO repo dimension) and the repo name is written to the structured log only; no orphan row is stored.

- Given `record_progress` with a project that matches on `github_repo`, when written, then behaviour (classification, dedup via `ON CONFLICT (idempotency_key)`, RDS write) is unchanged.

- Given resolution, then it uses `SELECT jira_key FROM projects WHERE github_repo = $1 LIMIT 1` for both macro and micro events.

- Given the MCP database user `kiro_mcp`, then its privileges are exactly `INSERT, SELECT ON governance_events` (plus the sequence) and column-scoped `SELECT (jira_key, github_repo, slack_micro_channel_id, slack_macro_channel_id) ON projects`; it holds no `UPDATE` or `DELETE` on any table. Append-only is enforced by reassigning table ownership of all governance tables to a non-runtime `kiro_migrator` role (a plain `REVOKE` is insufficient because the runtime role currently owns the tables).

---

### FR-P2-039: App-Managed Slack Provisioning & Dual-Channel Routing

**Priority:** Must Have
**Source:** Customer 2026-07-02 (change request Decisions D, E, F) — one workspace app + bot token + `chat.postMessage`; dual per-project channels routed through the same MCP `notify_slack` by `event_type`.

**Description:**
DeliverPro shall authenticate a single workspace-level Slack app once, provision/resolve per-project micro and macro channels, and store their ids on the project. All Slack posts flow through the shared MCP `notify_slack` tool, which routes by `event_type` — micro events to the micro channel, macro events to the macro channel — using the workspace bot token. The app does not build its own Slack client.

**Acceptance Criteria:**

- Given a single workspace Slack app + bot token, then DeliverPro authenticates once (admin OAuth consent); there is no per-project OAuth.

- Given a project being linked, when linkage is saved, then DeliverPro resolves or creates the micro and/or macro channels (`conversations.list` / `conversations.create`) and stores their ids in `slack_micro_channel_id` / `slack_macro_channel_id`.

- Given `notify_slack` with `event_type = 'micro'`, when invoked, then it posts to `slack_micro_channel_id`; given `event_type = 'macro'`, then it posts to `slack_macro_channel_id` — both via `chat.postMessage` using the SSM bot token, resolving the project by `github_repo`.

- Given the resolved channel id is NULL or the project does not resolve, when `notify_slack` is invoked, then it returns `{ "notified": false, "reason": "channel_not_configured" }` — no error surfaced and no secret, SSM path, or repo name leaked in the response.

- Given a posted message, then it is project-labelled using `jira_key` (and title when available), e.g. `[DP-001] …`, not the repo name; Slack broadcast tokens (`<!here>`, `<!channel>`, `<!everyone>`) and `<@…>`/`<#…>` link syntax in the message body are stripped/escaped before posting.

- Given the bot token, then it is read with least-privilege `ssm:GetParameter` + `kms:Decrypt` scoped to the single token parameter ARN only; `ssm:PutParameter` is admin/out-of-band.

- Given the two-token split, then the runtime token used by `notify_slack` carries `chat:write` only (it cannot create or rename channels), and the provisioning scopes (`channels:read` + `channels:manage`) live on a separate credential held only by the app's link/onboarding path; neither credential carries any `admin.*` scope.

---

### FR-P2-040: Optional Linkage Feature Switch

**Priority:** Must Have
**Source:** Customer 2026-07-02 (change request Decision A) — linkage is optional per project and is the feature switch.

**Description:**
The presence of `projects.github_repo` is the on/off switch for external governance recording and Slack routing. An unlinked project behaves exactly as the current architecture (no regression). Linking a repository is the single action that turns on micro recording and micro-channel Slack routing for that project.

**Acceptance Criteria:**

- Given `github_repo = NULL`, when governance events are processed, then no Kiro governance events are recorded against the project and its timeline shows only DeliverPro-native events (identical to today); no external Slack routing occurs.

- Given `github_repo` is set, when a linked repo emits events, then micro recording and micro-channel Slack routing turn ON for that repo.

- Given a CI/Kiro-path `record_progress` call for a linked repo, when the event is persisted, then the stored `governance_events` row has `type = 'micro'` (the classifier honours the explicit `type`), regardless of any gate-name substring present in `update_text`. A stored `type = 'macro'` from the CI path is a defect.

- Given `github_repo` is later cleared or re-pointed, when the change is saved, then previously-stored events keyed to the old repo stop surfacing on the timeline (the join is on the current `github_repo`), the change is written to `project_link_audit`, and the UI warns the operator of the historical-event visibility impact. Re-pointing back to the original repo restores visibility.

---

### FR-P2-041: MACRO Gate Ownership & CLI-Macro Backward-Compatibility

**Priority:** Must Have
**Source:** Customer 2026-07-02 (change request Decisions F, H) — macro gates are app-owned/human-approved; CI/Kiro path owns micro; both coexist with no double-notification. CLI-macro backward-compatibility path is retained per the 2026-07-02 go-ahead.

**Description:**
Macro checkpoint completion is set only by in-app triggers; Kiro macro governance events are display-only. Macro notifications originate only from the DeliverPro app (on in-app gate approval) and micro notifications only from the CI/Kiro path — no event produces both. A backward-compatible CLI-macro path is retained for pure-Kiro-CLI repositories that have no in-app approver.

**Acceptance Criteria:**

- Given any macro checkpoint, then `reached_at` is set only by an in-app trigger (`human_review` / `meeting` / `transcript_analysis` / `checklist` per `gates-architecture.md` §4); Kiro macro governance events never set it.

- Given an in-app macro-gate approval on a linked project, when the gate is approved, then the DeliverPro app calls the shared MCP `notify_slack` with `event_type = 'macro'` (macro channel); the app does not build its own Slack client. If the project is unlinked (`github_repo IS NULL`), the app skips the `notify_slack` call entirely (it does not call with a null `project_id`); macro completion is still recorded in `macro_checkpoints`.

- Given the ownership split, then micro notifications originate only from the CI/Kiro path and macro notifications only from the app — no single event produces both a micro and a macro notification (no double-notification).

- Given a linked repository that has no in-app macro approver (CLI-only), when the CI script processes a macro gate, then it MAY emit a macro governance event (`type = 'macro'`, `flag_override: true`) that is display-only (surfaces on the timeline, does NOT set `macro_checkpoints.reached_at`) and triggers the macro-channel notification — preserving the "progress-MD → gate → Slack" behaviour without violating app-owned completion.

- Given the current codebase, then no `governance_events → macro_checkpoints` auto-completion path exists or is (re)introduced (verified: current `gates-architecture.md` has no such write path).

---

### FR-P2-042: Micro-Event → Micro-Artifact Auto-Completion (Level 2)

**Priority:** Must Have — **ACTIVATED 2026-07-07** (was Deferred/Could Have). GitHub OIDC precondition **removed** by customer trust-model acceptance 2026-07-07.
**Source:** Customer 2026-07-02 (change request Decision I, Level 2) + customer trust-model acceptance 2026-07-07 (GitHub OIDC no longer required for Level 2). The `event_code` vocabulary, app-side placement, and `kiro:<actor>` provenance are Architect + security decisions — not customer-specified. Design of record: `specs/phase2/CR-12-14-level2-spec.md`.

**Trust model (accepted 2026-07-07 — replaces the OIDC precondition):**
Level-2 auto-completion trusts the **same authenticated MCP path as `record_progress`**. The micro `governance_events` it consumes were already written through the API-key-gated MCP `record_progress` tool, which enforces no-orphan resolve-or-reject (FR-P2-038) and append-only persistence. Level 2 reads those already-persisted, already-authorised events and reconciles them **app-side** — it introduces no new trust surface, so GitHub OIDC is **not** a prerequisite. Compensating controls: allow-list by construction (only an `event_code` seeded in `micro_artifact_mapping` with `is_active=true` can complete an artifact), deterministic config lookup (never fuzzy text), idempotent, reversible + audited, own-repo-scoped, and app-owned (the `UPDATE` runs under `kiro_phase2`; the MCP runtime role `kiro_mcp_app` stays append-only with no grant on the Level-2 tables). Residual risk (POC-accepted, same as Level 1 SEC-H2/H3 in §NFR-P2-003): under the shared MCP API key, a key holder could emit a micro event with a mapped `event_code` for another **linked** project's repo and falsely complete its artifact — bounded to insert-with-wrong-attribution (append-only, never edit/delete) and fully reversible + audited here. Revisit if a non-first-party CI ever holds the key.

**Description:**
When a linked project (`github_repo` set) has a micro `governance_event` whose `event_code` resolves through the deterministic `micro_artifact_mapping` `(event_code, project_type, phase) → artifact_name` lookup, DeliverPro idempotently marks the matching `micro_artifacts` row complete. Reconciliation runs on gate-view load, on link (create/update), and via an admin/leadership sync endpoint. `record_progress` gains an optional `event_code` (nullable `governance_events.event_code` column, CR-14). The `event_code` vocabulary is the 16 CASDM template micro artifacts (`casdm.<p0..p4>.<artifact_slug>`); micro events with no/unknown `event_code` are timeline-only (Level 1 unaffected).

**Acceptance Criteria:**

- Given a linked project and a `governance_events` row with `type='micro'`, `project_id = <github_repo>`, and an `event_code` present in `micro_artifact_mapping` (`is_active=true`) for the project's `project_type` (or `'default'`), when reconciliation runs, then the mapped `micro_artifacts` row is set `status='complete'`, `completed_at = event.created_at`, `completed_by = 'kiro:' || event.actor`.

- Given the mapping key, then it is `event_code` only (`micro_artifact_mapping.UNIQUE(event_code, project_type, phase)`); text or `source_ref` matching is never used.

- Given a micro event whose `event_code` is absent or not in the mapping, then no artifact is changed and the event still surfaces on the timeline (Level 1 unaffected by Level 2 misses).

- Given reconciliation runs twice with no new events, then it is idempotent — the second run returns `completed: 0`, no `micro_artifacts` row is changed, and no duplicate audit row is written.

- Given a `micro_artifacts` row with `manual_override = true`, then reconciliation never changes it (a human decision is never clobbered).

- Given any auto-completion, then an append-only `micro_artifact_audit` row is written (`action='auto_complete'`, `event_code`, `event_actor`, `actor='system:artifact-sync'`); an admin/leadership user can reverse it via `PATCH /api/projects/{projectId}/artifacts/{artifactId}` and the reversal is audited (`action='reverse'`).

- Given `POST /api/projects/{projectId}/sync-artifacts`, then an `admin`/`leadership` caller receives `200 { project_id, matched, completed, skipped }`; any other role receives `403 FORBIDDEN` (Cognito-derived role, never the free-text `project_manager`); an unknown project returns `404`; an unlinked project (`github_repo IS NULL`) returns `200` with all-zero counts.

- Given the MCP runtime DB role (`kiro_mcp_app`), then it holds no privilege on `micro_artifact_mapping`, `micro_artifacts`, or `micro_artifact_audit` (append-only posture preserved); the auto-completion `UPDATE` runs only under the Phase-2 app role `kiro_phase2`. Macro completion (FR-P2-041) and the passive `v_timeline` join remain unchanged.

- Given a completed micro artifact, then the UI shows a `kiro` source badge when `completed_by` starts with `kiro:` and a manual indicator otherwise; the manual status toggle remains available as an override.

---

> **FR-P2-043 / FR-P2-044 — Link-Time Gate Detection & Fresh-Start Cleanup (added v1.6, 2026-07-03).**
> These delta FRs replace the cancelled CR-06 backfill. FR-P2-043 adds an explicit, admin-triggered path that reads a linked repository's `docs/project-progress.md` and resolves matching macro gates in DeliverPro. FR-P2-044 adds a gated, non-auto-run cleanup migration for stale imported projects. Source of design: `docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md`; specs `specs/phase2/CR-16-link-time-gate-detection-spec.md`, `specs/phase2/CR-17-fresh-start-cleanup-spec.md`.

### FR-P2-043: Link-Time / On-Demand Macro Gate Detection from Repo Tracker

**Priority:** Must Have
**Source:** Customer 2026-07-02 (change request; replaces cancelled CR-06 backfill) — "It works with your Github… the project-progress MD file… drag that change as a gate… write it down on our database." The explicit fetch-and-parse sync mechanism, admin/leadership authz, and `system:repo-sync` provenance are **Architect + security decisions — not customer-specified**.

**Description:**
When a project's GitHub repository is linked (or on demand via an admin/leadership sync action), DeliverPro fetches the repository's `docs/project-progress.md` via the GitHub REST API using a read-only token held in SSM SecureString, parses the resolved macro gates from the tracker (reusing the shared `matchGateFromText` canonical-gate matcher), and idempotently marks the corresponding `macro_checkpoints` complete.

**Deliberate design change (documented):** the project tracker MAY auto-resolve macro checkpoints **only** through this explicit fetch-and-parse sync path (link-time trigger or the admin sync endpoint). The passive `governance_events → v_timeline` join remains display-only and still never auto-completes a checkpoint — FR-P2-041 is unchanged for the passive path. CR-16 is a scoped, provenance-tagged, admin-only exception.

**Acceptance Criteria:**

- Given a project with `github_repo` set, when `github_repo` is set/changed (create or update) OR an admin/leadership user calls `POST /api/projects/{projectId}/sync-gates`, then DeliverPro fetches `docs/project-progress.md` from that repo via `GET https://api.github.com/repos/{owner}/{repo}/contents/docs/project-progress.md` using the read token at SSM path `/kiro-governance/github/read-token`.

- Given the GitHub API returns 404 for the file (missing / private-without-access), when handled, then the sync is a no-op (no error surfaced) and returns `{ matched: 0, resolved: 0, skipped: 0 }`.

- Given a private repository the token can access, when fetched, then the file content is retrieved successfully (private repos supported).

- Given GitHub rate-limiting (403/429 with rate-limit headers), when it occurs, then the sync endpoint returns HTTP 503 `{ "code": "REPO_SYNC_UNAVAILABLE" }` and the link-time trigger logs and continues (non-blocking); no token or URL is leaked in the response or logs.

- Given the fetched markdown, when parsed, then a line is treated as a resolved gate only if it is a completed task-list item (`- [x] …`) or contains "approved by" (case-insensitive), and its canonical gate is resolved via the shared `matchGateFromText`; unchecked or merely-mentioned gate lines are ignored.

- Given a resolved canonical gate that maps (via the `GATE_TO_CHECKPOINT` config lookup) to an existing `macro_checkpoints` row for the project whose `reached_at IS NULL`, when applied, then that row is set `reached_at = now()`, `reviewed_by = 'system:repo-sync'`; a resolved gate that is unmapped, or whose checkpoint row is missing, or already resolved, is counted as `skipped` and mutates nothing.

- Given the sync runs twice with no tracker change, when re-run, then it is idempotent — the second run returns `resolved: 0` and no `macro_checkpoints` row is changed.

- Given the sync completes, when it returns, then the response is `{ project_id, matched, resolved, skipped }`.

- Given a caller who is not `admin` or `leadership`, when they call `POST /api/projects/{projectId}/sync-gates`, then the API returns HTTP 403 `{ "code": "FORBIDDEN" }` (authorization uses the Cognito-derived role, never the free-text `project_manager`).

- Given any sync, when it targets a repository, then it uses only the requested project's own `github_repo`/`github_url` (read from the project row, never from request input); the read token is never logged, returned, or embedded in an error message.

### FR-P2-044: Fresh-Start Cleanup of Imported Projects (Gated, Non-Auto-Run)

**Priority:** Should Have
**Source:** Customer 2026-07-02 (change request; replaces cancelled CR-06 backfill) — remove stale one-time Jira `CST-*` imports for a clean start. Delivery as a gated, non-auto-run destructive migration is an **Architect + security decision — not customer-specified** (data deletion is irreversible).

**Description:**
A cleanup migration (`V007__fresh_start_cleanup.sql`) permanently removes imported non-template projects (`jira_key LIKE 'CST-%' AND jira_key <> '__template__'`) and their cascaded child rows, while preserving the CASDM `__template__` seed, all `DP-*` projects, and the append-only `governance_events` table. Because it is destructive and irreversible, it is delivered gated and is never auto-run.

**Acceptance Criteria:**

- Given the migration, when authored, then its DELETE predicate is exactly `jira_key LIKE 'CST-%' AND jira_key <> '__template__'` (the `__template__` CASDM seed and all `DP-*` projects are never deleted).

- Given the migration, when applied intentionally, then imported `CST-*` projects and their `ON DELETE CASCADE` children (`micro_artifacts`, `macro_checkpoints`, `gate_evidence`, `checkpoint_notes`, `weekly_status_logs`, `escalations`, `discovery_sessions`, `onboarding_checklist_items`, `project_link_audit`) are removed; `governance_events` (no FK; append-only) is not deleted.

- Given the migration, when the confirmation guard (`kiro.confirm_fresh_start = 'yes'`) is not set, then it performs no deletion (safe no-op) — it cannot delete on a normal runner/`psql` pass.

- Given the migration file, when present in the repo, then it is excluded from the automatic migration runner set and documented as operator-run only, and carries a loud destructive-warning header and an irreversible/no-down-migration rollback note.

- Given the change request, when this cleanup is delivered, then it replaces the cancelled CR-06 backfill (no backfill of `projects.github_repo` is performed).

---

## 6. Non-Functional Requirements

### NFR-P2-001: Performance

**Source:** Cloudelligent recommended best practice — pending client confirmation

- Project list page loads within 2 seconds for up to 200 projects
- Project detail page loads within 3 seconds
- File upload provides progress feedback within 1 second of initiation
- API response time p95 < 500ms for CRUD operations

### NFR-P2-002: Availability

**Source:** Architect decision — not customer-specified

- Application available during business hours (Mon–Fri 8am–8pm ET) with 99% uptime
- CloudFront serves static assets with 99.9% availability
- Scheduled maintenance windows on weekends only
- RDS instance uses existing Phase 1 infrastructure (single instance)

### NFR-P2-003: Security

**Source:** Phase 2 Transcript — "sandbox, everyone will have access to the data, and that is a little bit chaotic"

- Application requires authentication via AWS Cognito (JWT tokens)
- All API endpoints validate JWT Bearer token; missing/expired token returns HTTP 401
- All API keys and credentials stored in AWS Secrets Manager
- S3 bucket for evidence files has Block Public Access enabled
- RDS access restricted to Lambda execution role only (no public access)
- Role-based access control enforced at the API layer (Cognito groups map to app roles)
- CloudFront distribution uses HTTPS only (redirect HTTP → HTTPS)

**Governance-linkage security (added 2026-07-02 — GitHub↔Slack linkage CR; security-review SEC-H1/H2/H3):**

- **Append-only governance store (SEC-H1 / iam-review Finding 2):** the MCP runtime DB role — the **dedicated non-master `kiro_mcp_app`** (`LOGIN NOSUPERUSER NOINHERIT`) — holds exactly `INSERT, SELECT ON governance_events` (+ sequence) and column-scoped `SELECT` on `projects`; no `UPDATE`/`DELETE`/write on any table. Enforced by reassigning table ownership to a non-runtime `NOINHERIT` `kiro_migrator` role (a plain `REVOKE` is insufficient because the tables were previously owned by the connecting role); the runtime role is not a member of `kiro_migrator`. The RDS master `kiro_mcp` is admin/migrations ONLY — runtime grants are NOT placed on it (a superuser bypasses them). The Phase-2 app authenticates as a distinct role (`kiro_phase2`) retaining DML on DeliverPro tables. See `unified-data-model.md` §4.4.4, `V005__append_only_hardening.sql`.
  - **⚠️ Blocking pre-implementation caveat:** the RDS master user `kiro_mcp` is a `rds_superuser`, and an earlier design reused that same name for the runtime role — so its grants were bypassed (the collision). Append-only is a real DB guarantee ONLY once the MCP runtime authenticates as the non-master, non-superuser `kiro_mcp_app`; otherwise it is a best-effort claim covered by the POC risk-accept below. Requires ops sign-off (GATE 2) before implementation.

- **Cross-project isolation under the shared MCP API key (SEC-H2/H3) — POC RISK-ACCEPT (human decision recorded 2026-07-02):** the MCP tools trust the caller-asserted `project_id` (repo name). Under a single shared API key, a key holder can assert **another linked project's** repo and post to that project's Slack channel or mis-attribute governance events. No-orphan storage blocks only *unlinked* repos; a valid other-project repo still resolves. Per the 2026-07-02 go-ahead, **Level 1 ships under POC risk-accept**. **Level 2 auto-completion (FR-P2-042) was subsequently ACTIVATED 2026-07-07 under this same POC risk-accept — GitHub OIDC is NOT required** (customer trust-model acceptance 2026-07-07; see FR-P2-042 "Trust model"). GitHub OIDC per-repo identity would structurally close this residual risk, but it is **not a precondition for either level** — it remains an optional future hardening (D-v3-8). Compensating controls in force:
  - No-orphan hard-reject + append-only bound tampering to *insert-with-wrong-attribution* only (never edit/delete).
  - Slack posts limited to channels the app itself provisioned; runtime bot token is `chat:write`-only (two-token split — SEC-M1); channel-provisioning scopes on a separate credential.
  - Slack message body sanitized (broadcast/link tokens stripped — SEC-L1); messages project-labelled by `jira_key`.
  - Dimensionless `GovernanceEventRejected` counter (no repo dimension — denial-of-wallet guard) + repo in structured log only.
  - Bot token stored only in SSM SecureString (never in PG, API responses, or logs); IAM `ssm:GetParameter`+`kms:Decrypt` scoped to the single token ARN.
  - **Level 2 (FR-P2-042) is ACTIVE as of 2026-07-07 under this same POC risk-accept — it is NOT gated on GitHub OIDC.** The accepted trust model is the authenticated MCP path (same as `record_progress`): Level 2 only reconciles micro `governance_events` that were already written through the API-key-gated `record_progress` tool (no-orphan resolve-or-reject — FR-P2-038 — and append-only), so it introduces no new trust surface. Auto-completion is additionally bounded to the same residual risk as Level 1 — allow-listed by `micro_artifact_mapping` (`is_active=true`), deterministic (never fuzzy text), idempotent, reversible, fully audited (`micro_artifact_audit`), and own-repo-scoped. Revisit only if a non-first-party CI ever holds the shared key.
  - App→MCP macro calls currently reuse the shared key; a distinct app service identity remains the recommended future hardening (SEC-M3) — optional, not a precondition for Level 1 or Level 2.

### NFR-P2-004: Data Integrity

**Source:** Architect decision — not customer-specified

- Checkpoint completions are append-only (no delete, no modification of `reached_at` after recording)
- All user actions logged with actor, timestamp, and action type
- Database uses the existing Phase 1 RDS with point-in-time recovery enabled
- Foreign key constraints enforce referential integrity across all tables

### NFR-P2-005: Scalability

**Source:** Architect decision — not customer-specified

- System supports up to 200 concurrent projects
- System supports up to 50 concurrent users
- Evidence file storage (S3) is unlimited
- Lambda concurrency handles up to 50 simultaneous API requests
- Schema supports future phases (Phase 5+) without migration

### NFR-P2-006: Maintainability

**Source:** Phase 2 Transcript — requirement for no-code-deploy changes

- Phase/gate configuration stored in database (`casdm_config`), not code
- Application logs to CloudWatch with structured JSON
- Database schema uses sequential SQL migrations (`V001__`, `V002__`, `V003__`)
- Frontend is a standard React + Vite app with Tailwind — no proprietary frameworks

---

## 7. Data Model

The data schema for Phase 2 is implemented across two migrations:
- **`V002__projects_and_casdm_tracking.sql`** — already written, contains the base tables (see §7.1)
- **`V003__phase2_additions.sql`** — to be created, contains the new columns and tables described in §7.2

> ⚠️ The additions in §7.2 are **V003 changes**, not modifications to V002. V002 must not be edited once deployed.

### 7.1 Existing Tables (from V002)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `projects` | One row per project (imported or created) | `jira_key` (UNIQUE), `title`, `status`, `project_manager`, `solution_architect`, `account_executive`, `sow_hours`, `project_type` |
| `micro_artifacts` | AI-generated deliverables per phase per project | `project_id` FK → projects.jira_key, `phase`, `artifact_name`, `status` |
| `macro_checkpoints` | Human-validated gates per phase per project | `project_id`, `phase`, `checkpoint_name`, `checkpoint_type`, `occurred`, `meeting_link`, `analysis_result` |
| `gate_evidence` | Artifacts attached to checkpoints | `project_id`, `checkpoint_name`, `evidence_type`, `value`, `uploaded_by` |
| `casdm_config` | Configurable phase/gate template (keyed by project_type) | `config_type`, `phase`, `phase_name`, `item_name`, `project_type`, `is_active`, `changed_by` |
| `checkpoint_notes` | Append-only notes on checkpoints | `project_id`, `checkpoint_name`, `note_text`, `author` |

### 7.2 Schema Additions (v1.3)

#### `macro_checkpoints` — new columns

| Column | Type | Purpose |
|--------|------|---------|
| `meeting_date` | `DATE` | When the meeting actually happened (user-provided). Separate from `reached_at` which is when the PM logged it. |
| `result_detail` | `TEXT` | Rich outcome capture beyond boolean `occurred`. E.g., "3 of 5 topics covered — follow-up scheduled". |
| `reached_at` | `TIMESTAMPTZ` | When the PM logged the checkpoint in the app (system timestamp). Already exists as concept via `reviewed_at`; formalized as explicit column. |

#### `macro_checkpoints` — updated CHECK constraint (V003)

```sql
-- V003 ALTER to add 'checklist' type:
ALTER TABLE macro_checkpoints
  DROP CONSTRAINT IF EXISTS macro_checkpoints_checkpoint_type_check,
  ADD CONSTRAINT macro_checkpoints_checkpoint_type_check
    CHECK (checkpoint_type IN ('human_review', 'meeting', 'transcript_analysis', 'checklist'));
```

The `'checklist'` type is used for onboarding checklist (FR-P2-019) and closure workflow (FR-P2-023) checkpoints whose completion is determined by child items.

#### `projects` — new column

| Column | Type | Purpose |
|--------|------|---------|
| `hours_consumed` | `NUMERIC(8,2) DEFAULT 0` | Hours consumed to date, manually updated by PM (FR-P2-022) |

#### New Table: `weekly_status_logs`

```sql
CREATE TABLE weekly_status_logs (
  id              BIGSERIAL    PRIMARY KEY,
  project_id      TEXT         NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  log_date        DATE         NOT NULL,
  meeting_link    TEXT,
  topics_covered  TEXT         NOT NULL,
  demo_items      TEXT,
  blockers        TEXT,
  logged_by       TEXT         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_weekly_status_project ON weekly_status_logs (project_id, log_date);
```

#### New Table: `escalations`

```sql
CREATE TABLE escalations (
  id               BIGSERIAL    PRIMARY KEY,
  project_id       TEXT         NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  raised_date      DATE         NOT NULL,
  description      TEXT         NOT NULL,
  severity         TEXT         NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  raised_by        TEXT         NOT NULL,
  resolved_date    DATE,
  resolution_notes TEXT,
  status           TEXT         NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_escalations_project ON escalations (project_id, status);
```

#### New Table: `discovery_sessions`

```sql
CREATE TABLE discovery_sessions (
  id              BIGSERIAL    PRIMARY KEY,
  project_id      TEXT         NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  session_number  INT          NOT NULL,
  session_date    DATE         NOT NULL,
  meeting_link    TEXT,
  participants    TEXT         NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_discovery_session UNIQUE (project_id, session_number)
);
CREATE INDEX idx_discovery_sessions_project ON discovery_sessions (project_id);
```

#### New Table: `onboarding_checklist_items`

```sql
CREATE TABLE onboarding_checklist_items (
  id              BIGSERIAL    PRIMARY KEY,
  project_id      TEXT         NOT NULL REFERENCES projects(jira_key) ON DELETE CASCADE,
  item_name       TEXT         NOT NULL,
  completed       BOOLEAN      NOT NULL DEFAULT false,
  completed_by    TEXT,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_onboarding_project ON onboarding_checklist_items (project_id);
```

#### `casdm_config` — new column (v1.3)

| Column | Type | Purpose |
|--------|------|---------|
| `project_type` | `TEXT NOT NULL DEFAULT 'default'` | Keys the template to a project type. Each project type (AppDev, App Mod/Migration, AI/ML, Other) has its own gate template. |

```sql
-- V003 ALTER to add project_type column:
ALTER TABLE casdm_config
  ADD COLUMN project_type TEXT NOT NULL DEFAULT 'default';

-- Update unique constraint to include project_type:
ALTER TABLE casdm_config
  DROP CONSTRAINT IF EXISTS casdm_config_phase_item_name_key,
  ADD CONSTRAINT casdm_config_phase_item_name_project_type_key UNIQUE (phase, item_name, project_type);
```

The `projects.project_type` column (already exists from V002) maps to `casdm_config.project_type` as the seeding key when creating a new project.

#### `gate_evidence` — new column (v1.3)

| Column | Type | Purpose |
|--------|------|---------|
| `link_metadata` | `JSONB` | Best-effort metadata extracted from evidence URLs: `{ "title": string, "date": string, "duration_minutes": number \| null }`. NULL if extraction failed or not applicable. |

```sql
-- V003 ALTER to add link_metadata column:
ALTER TABLE gate_evidence
  ADD COLUMN link_metadata JSONB;
```

#### New Table: `analysis_prompts` (v1.3)

```sql
CREATE TABLE analysis_prompts (
  id              BIGSERIAL    PRIMARY KEY,
  checkpoint_name TEXT         NOT NULL UNIQUE,
  prompt_text     TEXT         NOT NULL,
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

This table stores admin-editable Bedrock AgentCore prompts per `transcript_analysis` checkpoint. The `checkpoint_name` references the checkpoint for which the prompt is used. Admins edit prompts via the admin panel (FR-P2-029).

### 7.3 Checkpoint Types

| Type | Description | Completion Method |
|------|-------------|-------------------|
| `human_review` | SA/Tech Lead reviews an artifact | SA marks reviewed + name + timestamp |
| `meeting` | Meeting occurred with optional rich result | PM confirms + meeting_date + meeting_link + result_detail |
| `transcript_analysis` | Avoma transcript fetched + AI analysis | Meeting link → API fetch → Bedrock analysis → result_detail |
| `checklist` | Parent checkpoint completed when all child items are done | Child items (onboarding/closure) all checked → reached_at set |

### 7.4 Evidence Types

| Type | Description |
|------|-------------|
| `meeting_link` | Avoma/Zoom URL |
| `transcript` | Full transcript text (S3 reference) |
| `file_upload` | Uploaded file (S3 key) |
| `url` | Arbitrary URL reference |
| `ai_analysis` | AI analysis result JSON |

### 7.5 Seeding Strategy

The `__template__` project in `micro_artifacts` and `macro_checkpoints` tables serves as the CASDM template. When a new project is created, its micro artifacts, macro checkpoints, and onboarding checklist items are cloned from the template/config. New checkpoints added in v1.2:

- Phase 1: "Kickoff Prep Meeting" (`meeting`)
- Phase 3: "Executive Check-in Call 1" (`meeting`)
- Phase 4: "Account Planning Session" (`meeting`)
- Phase 4: Closure items as `checklist` type

---

## 8. Integration Requirements

### 8.1 Avoma API

**Purpose:** Fetch meeting transcripts for transcript analysis checkpoints

| Item | Detail |
|------|--------|
| Direction | App (Lambda) → Avoma |
| Auth | API key or OAuth (stored in Secrets Manager) |
| Trigger | User clicks "Fetch Transcript" after pasting meeting link |
| Data | Meeting transcript text (may include speaker labels) |
| Error Handling | Retry once; on failure return HTTP 502; user can re-attempt manually |
| Status | RESOLVED — REST API confirmed at dev.avoma.com/Transcriptions (`https://api.avoma.com/v1/transcriptions`), Bearer token auth via Secrets Manager. API docs: https://dev.avoma.com/#tag/Transcriptions. Auth docs: https://dev.avoma.com/#section/Introduction/Authorization. |

### 8.2 Jira CST Board (One-Time Import)

**Purpose:** Seed existing project metadata from the Jira CST board into the `projects` table

| Item | Detail |
|------|--------|
| Direction | App (Lambda) ← Jira Cloud REST API |
| Auth | Jira API token (stored in Secrets Manager) |
| Trigger | Admin clicks "Import from Jira" (one-time only) |
| Data | Issue key, title, description, status, assignees, dates, SOW hours, project type |
| Error Handling | Log per-issue failures; continue with remaining; report summary |
| Post-Import | No recurring sync. This app replaces Jira for project management. |
| Status | Source: Phase 2 Transcript — "eventually, I'd like to get rid of these Jira pages and even use this" |

### 8.3 Existing Phase 1 RDS (kiro_governance database)

**Purpose:** Shared database between Phase 1 MCP server and Phase 2 interactive app

| Item | Detail |
|------|--------|
| Database | `kiro_governance` on existing RDS instance |
| Phase 1 Table | `governance_events` (written by MCP server) |
| Phase 2 Tables | `projects`, `micro_artifacts`, `macro_checkpoints`, `gate_evidence`, `casdm_config`, `checkpoint_notes`, `weekly_status_logs`, `escalations`, `discovery_sessions`, `onboarding_checklist_items` |
| Coexistence | Both systems write to the same DB; Phase 2 reads Phase 1 events for timeline display |
| Account | ceanalytics (504649076991) |

### 8.4 Phase 1 MCP Server (Governance Events)

**Purpose:** Surface Kiro-tracked micro/macro events in the project timeline

| Item | Detail |
|------|--------|
| Direction | Phase 2 app reads from `governance_events` table |
| Mapping | `governance_events.project_id` maps to `projects.jira_key` |
| Display | Events appear in project timeline interleaved with manual checkpoint entries |

### 8.5 Amazon Bedrock Agents — AgentCore (AI Analysis)

**Purpose:** Analyze meeting transcripts against required topic checklist using per-gate configurable prompts

| Item | Detail |
|------|--------|
| Direction | App (Lambda) → Bedrock AgentCore |
| Model | Claude Sonnet 4.5 via Bedrock AgentCore (cross-region inference: `us.anthropic.claude-sonnet-4-5-20241022-v1:0`) |
| Input | Transcript text + checkpoint-specific prompt (from `analysis_prompts` table) |
| Output | `{ topics_covered: string[], topics_missing: string[], passed: boolean, confidence: number }` |
| Trigger | User initiates after transcript is fetched |
| Prompt Source | `analysis_prompts` table — admin-editable per checkpoint (FR-P2-029) |
| Status | Source: Phase 2 Transcript — "give it criteria to look for in that transcript" + "I'm gonna use the agent core, which is more specialized toward these kind of dynamic behaviors" |

### 8.6 Amazon S3 (Evidence Storage)

**Purpose:** Store uploaded files and fetched transcripts

| Item | Detail |
|------|--------|
| Bucket | `kiro-governance-evidence-{account_id}` |
| Key Pattern | `evidence/{project_id}/{phase}/{checkpoint_name}/{filename}` |
| Transcripts | `transcripts/{project_id}/{checkpoint_name}/{timestamp}.txt` |
| Access | Lambda execution role only; Block Public Access enabled |
| Lifecycle | No auto-deletion; files retained indefinitely |

### 8.7 AWS Cognito (Authentication)

**Purpose:** User authentication and role-based access

| Item | Detail |
|------|--------|
| User Pool | One pool for all DeliverPro users |
| Groups | `pm`, `sa`, `engineer`, `leadership`, `admin` |
| Token | JWT with custom claims for role |
| Integration | API Gateway Cognito Authorizer validates JWT on every request |

### 8.8 Amazon CloudFront (SPA Hosting)

**Purpose:** Serve the React SPA globally with low latency

| Item | Detail |
|------|--------|
| Origin | S3 bucket containing Vite build output |
| Behavior | Default → S3, with custom error pages routing to `/index.html` |
| HTTPS | ACM certificate (or CloudFront default `*.cloudfront.net`) |
| Cache | Hashed assets: 1 year immutable; `index.html`: no-cache |

---

## 9. Role Definitions

| Role | Access Level | Key Actions |
|------|-------------|-------------|
| **PM (Project Manager)** | Own projects + browse all | View projects, mark meeting checkpoints, paste meeting links, upload evidence, add notes, log status calls, log escalations, update hours consumed, log discovery sessions |
| **SA (Solutions Architect)** | Assigned projects | View projects, mark human_review checkpoints, upload evidence, add notes |
| **Engineer** | Read-only | View project status, view micro artifact status, view evidence |
| **Leadership** | All projects + admin | View all projects, cross-project summary, access admin panel (FR-P2-016), manage configuration |
| **Admin** | System configuration | All Leadership actions + manage users/roles, trigger Jira import, manage phase/gate configuration |

---

## 10. Open Questions

| # | Question | Owner | Priority | Impact |
|---|----------|-------|----------|--------|
| OQ-P2-001 | ~~Which AWS account?~~ **RESOLVED 2026-06-29** — Same `ceanalytics` account (504649076991) for all Phase 2 resources (Lambda, CloudFront, Cognito, S3). | Chris Xenos | ~~Blocker~~ Resolved | — |
| OQ-P2-002 | ~~Does Avoma have a REST API for transcript fetch given a meeting URL? What auth method? Rate limits?~~ **RESOLVED 2026-06-30** — REST API confirmed at `https://api.avoma.com/v1/transcriptions`. Bearer token auth via Secrets Manager. API docs: dev.avoma.com. | Faraz | ~~High~~ Resolved | — |
| OQ-P2-003 | ~~Is QuickSight QUIC sufficient for interactive forms?~~ **RESOLVED** — Custom React + Vite + Tailwind CSS app. QuickSight deferred entirely. | — | Resolved | — |
| OQ-P2-004 | What Jira custom fields on CST board hold PM, SA, Engineer assignments? (needed for one-time import mapping) | Chris Xenos | Medium | FR-P2-009 field mapping |
| OQ-P2-005 | Should existing projects (already past certain phases) be backfilled with historical checkpoint dates, or only tracked from import date forward? | Chris Xenos | Medium | Data migration scope |
| OQ-P2-006 | ~~What required topics should be checked per transcript_analysis gate? Who defines the criteria list?~~ **RESOLVED 2026-06-30** — Admin provides baseline prompt per gate, but system default exists (seeded in V003 migration). Admin can overwrite via config panel. If no custom prompt, system default is used. | Chris Xenos | ~~Medium~~ Resolved | — |
| OQ-P2-007 | ~~What authentication mechanism?~~ **RESOLVED** — AWS Cognito with user pools and JWT. | — | Resolved | — |
| OQ-P2-008 | Should the Leadership view include email/Slack alerts for stalled projects? | Chris Xenos | Low | Potential future FR |
| OQ-P2-009 | Is there a budget constraint for Phase 2 infrastructure (RDS sizing, S3, Bedrock usage)? | Chris Xenos | Low | Capacity planning |
| OQ-P2-010 | ~~What is the custom domain for the CloudFront distribution? (e.g., `deliverpro.cloudelligent.com`) Or use default CloudFront domain?~~ **RESOLVED 2026-06-30** — Use default CloudFront domain (`*.cloudfront.net`). No custom domain. | Chris Xenos | ~~Medium~~ Resolved | — |
| OQ-P2-011 | For the onboarding checklist (FR-P2-019), are the 9 items fixed or should they be admin-configurable per project type? | Chris Xenos | Low | FR-P2-019 flexibility |
| PD-12 | ~~What are the exact project types supported at launch? (AppDev, App Mod/Migration, AI/ML confirmed — any others?)~~ **RESOLVED 2026-06-30** — AppDev confirmed at launch. AppMod and AIML remain in enum but are seeded without gate templates initially — admin adds them. Admin provides baseline prompt but a default one exists that can be overwritten. | Chris Xenos | ~~Medium~~ Resolved | — |
| PD-13 | ~~Should a project be allowed to change its project type after creation? (affects gate seeding — would require re-seeding or orphaned checkpoints)~~ **RESOLVED 2026-06-30** — Project type is IMMUTABLE after creation. PATCH returns 422 if attempted. | Chris Xenos | ~~Medium~~ Resolved | — |
| PD-14 | ~~AgentCore vs raw InvokeModel — is an AgentCore agent pre-configured (one agent handles all checkpoints with different prompts), or is a separate agent created per checkpoint type at runtime?~~ **RESOLVED 2026-06-30** — Build a new Bedrock Agent (AgentCore) in ceanalytics account. Single agent, dynamic prompt injection. Model: Claude Sonnet 4.5 (`us.anthropic.claude-sonnet-4-5-20241022-v1:0`) via US cross-region inference. | Faraz | ~~High~~ Resolved | — |
| ID-8 | For Avoma link metadata extraction — does Avoma expose an oembed or metadata API endpoint, or does this require parsing the Avoma page HTML? | Faraz to investigate | Medium | FR-P2-031 feasibility |

---

## 11. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Gate tracking adoption | 80% of active projects have ≥1 checkpoint completed within 30 days | Query `macro_checkpoints` where `reached_at IS NOT NULL` |
| Evidence attachment rate | 60% of completed checkpoints have ≥1 evidence item | Query `gate_evidence` count per checkpoint |
| Weekly status logging | 90% of active projects have a status log entry within the past 7 days | Query `weekly_status_logs` by `log_date` |
| Time to visibility | PM can see project gate status within 2 clicks from login | UX test |
| Transcript analysis accuracy | AI correctly identifies ≥80% of covered topics (validated against 10 sample transcripts) | Manual audit of `analysis_result` |
| Onboarding completion | 80% of new projects complete all 9 onboarding items within 5 business days | Query `onboarding_checklist_items` completion rate |

---

## 12. Delivery Phasing (Recommended)

Per Chris Xenos' direction to "start small":

| Iteration | Scope | Dependencies |
|-----------|-------|--------------|
| **Iteration 1** | Project list (with one-time Jira import + direct creation) + gate status view + manual evidence attachment + onboarding checklist + weekly status log + resource budget + CloudFront deployment + Cognito auth | OQ-P2-001 (account) |
| **Iteration 2** | Escalation board + discovery sessions + kickoff prep + executive check-ins + account planning + project closure workflow + checkpoint notes | Iteration 1 complete |
| **Iteration 3** | Avoma integration + transcript analysis + AI topic coverage + configurable gates admin panel + admin-editable prompts (FR-P2-029) + project-type templates (FR-P2-030) + evidence link metadata extraction (FR-P2-031) | Bedrock AgentCore access (OQ-P2-002 ✅, PD-14 ✅) |

> Source: Phase 2 Transcript — "let's just start small. Just build some kind of small app that shows just the things you're tracking in Kiro."

---

## 13. Product Vision — DeliverPro

> Source: Phase 2 Transcript — Chris Xenos: "eventually, I'd like to get rid of these Jira pages and even use this, and then maybe this app becomes DeliverPro"

### Current Scope (Phase 2 Build)

A **delivery governance layer** — an interactive project tracking application that captures CASDM phase/gate status, evidence, and artifacts for Cloudelligent's professional services projects. Replaces the Jira CST board for project lifecycle management.

### Medium-Term Vision

**Full project lifecycle management** replacing Jira entirely. The app becomes the single system of record for:
- Project creation and onboarding
- Phase/gate tracking with evidence
- Weekly status reporting
- Escalation management
- Resource budget tracking
- Discovery session logging
- Project closure workflows
- Meeting transcript analysis for governance validation

### Long-Term Vision

**DeliverPro** — a productized project delivery governance platform that could be offered to Cloudelligent clients as a value-add service. Combines:
- Micro tracking (AI agent-generated artifacts via Kiro)
- Macro tracking (human-validated gates, meetings, transcripts)
- Automated governance validation (Bedrock-powered transcript analysis)
- Configurable methodology (not limited to CASDM)
- Cross-project portfolio reporting

This vision is aspirational and not in scope for the current build, but architecture decisions should avoid precluding it.

---

*End of Phase 2 SRS v1.5*
