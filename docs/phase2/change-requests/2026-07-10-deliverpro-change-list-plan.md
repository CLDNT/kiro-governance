# DeliverPro — Change-List Plan (Draft for Owner Review)

**Date:** 2026-07-10
**Prepared by:** AWS Architect
**Type:** Change-request impact / planning document (point-in-time — no changelog)
**Status:** DRAFT — for owner review. **No implementation has been done.**
**App:** DeliverPro (existing, deployed — AWS profile `ceanalytics`)

---

## 0. Purpose & How to Read This

This document investigates the **current state** of seven requested changes against the live
codebase (`frontend/` + `packages/`), then for each item proposes the change, affected layers,
rough effort, sequencing, owning agent, whether an SRS Functional Requirement (FR) is required,
and the open questions that need an owner decision before implementation.

Effort scale (spec-based development, Kiro-assisted):

- **XS** — < 0.5 day (single-file UI toggle / one query fix)
- **S** — 0.5–1 day (one handler or one component + tests)
- **M** — 1–3 days (handler + UI + tests, one domain)
- **L** — 3–5+ days (multi-domain, new endpoints, data-model touch)

> ⚠️ Nothing in this plan has been built. All file references are to the current `main` state.

---

## 1. Summary Table

| # | Item | Layers | Effort | Needs SRS FR? | Security-relevant? | Key open question |
|---|------|--------|--------|---------------|--------------------|-------------------|
| 1 | Defer Slack channel provisioning | Frontend (+ config flag) | XS–S | No (defer of CR-05 / FR-P2-039) | Low | Hide-only via flag, or also disable the API route? |
| 2 | Evidence view + remove (incl. post-analysis) | Frontend + Backend (+ IAM for S3 delete) | M | **Yes** (delete + list-with-view are new behaviour) | **Yes** | Who can delete? Cascade when meeting-link evidence backing an analysis is removed? |
| 3 | Hide "Run analysis" when analysis exists | Frontend only | XS | No (UI rule) | No | Keep a re-run path for admins, or remove entirely? |
| 4 | Transcript view modal | Frontend (reuses existing download-url endpoint) | S | No (surfaces existing data) | Low | Render raw `.txt` or formatted by speaker? |
| 5 | Show "topics covered" (keep expected/missing) | Frontend (data already returned) — Backend/FR only if a *canonical* expected list is wanted | XS (FE-only) / M (if canonical list) | **Conditional** | No | Is LLM-derived covered/missing enough, or do you want a fixed configured expected-topics checklist? |
| 6 | Phase filter not working (projects list) | Backend (bug) | XS | No (bugfix) | No | None — root cause identified below |
| 7 | Leadership dashboard usefulness | Frontend + Backend (new reporting aggregations) | L | **Yes** (new metrics = new FRs) | Low | Which widgets are must-have for v1? Several need new endpoints |

---

## 2. Item 1 — DEFER Slack Channel Provisioning

### Current state (file refs)
- **UI trigger:** `frontend/src/components/projects/ProjectLinkageCard.tsx` — "Provision Slack channels" button (~line 198), gated to `canManage` (admin/leadership), calls `handleProvision()` → `useProvisionSlack()`.
- **Hook:** `frontend/src/hooks/useProjects.ts` → `useProvisionSlack()` → `POST /api/projects/{id}/slack/provision`. The JSDoc there records the origin: **CR-05, FR-P2-039**.
- **Backend handler:** `packages/projects/handlers/provision-slack-channels.ts` (exported from `packages/projects/index.ts` as `provisionSlackChannelsHandler`).
- **Service:** `packages/projects/services/slack-provisioning.service.ts` (token via SSM, channel resolve/create).
- **Tests:** `packages/projects/__tests__/handlers/provision-slack-channels.test.ts`, `.../services/slack-provisioning.service.test.ts`.

### Proposed change
Hide the UI trigger and mark the capability **DEFERRED**. Do **not** delete the backend handler,
service, or tests. Preferred approach: a build-time/runtime feature flag (e.g. Vite env
`VITE_FEATURE_SLACK_PROVISIONING=false`) read in `ProjectLinkageCard.tsx` to conditionally render
the button and the "provisioned" result alert. Leave the `useProvisionSlack` hook in place.

### Affected layers
- **Frontend:** `ProjectLinkageCard.tsx` (conditional render), one feature-flag constant.
- **Backend:** none (route + handler remain live but unreferenced by UI).
- **Infra/data-model:** none.

### Effort
**XS–S** (XS if a simple constant; S if a small typed feature-flag utility is introduced for reuse).

### Dependencies / sequencing
Independent. Can ship first.

### Implementing agent
**Frontend Developer.**

### Needs SRS FR?
**No.** This is a *deferral* of an existing feature (CR-05 / FR-P2-039). Recommend the Product
Analyst add a one-line note to FR-P2-039 marking it **DEFERRED (2026-07-10, owner request)** for
traceability, but no new FR.

### Security flag
**Low.** Leaving the `/slack/provision` route live means the capability is still reachable by an
admin/leadership caller hitting the API directly. That is acceptable for a hide-only deferral, but
see the open question.

### Open questions
- **OQ1.1:** Hide-only (route stays live), or also short-circuit the handler (e.g. return `403 FEATURE_DISABLED`) so the capability cannot be triggered via direct API call while deferred? Hide-only is faster; API-disable is safer.

---

## 3. Item 2 — Evidence View + Remove (including after analysis)

### Current state (file refs)
- **Attach (create):** `packages/gates/handlers/attach-evidence.ts` — `POST /.../checkpoints/{checkpointId}/evidence`. Inserts into `gate_evidence`. Side effects: `meeting_link` type updates `macro_checkpoints.meeting_link`; `ai_analysis` type updates `macro_checkpoints.analysis_result`.
- **List:** `packages/gates/handlers/list-evidence.ts` — `GET /.../checkpoints/{checkpointId}/evidence`. **Exists in backend but is not called anywhere in the frontend** (no consumer found).
- **Delete:** **No delete handler exists** in `packages/gates/handlers/` or `packages/files/handlers/`.
- **Files domain:** `upload-url.ts` (presigned PUT) and `download-url.ts` (presigned GET) exist. `download-url.ts` already authorizes by project membership and supports both `evidence/` and `transcripts/` prefixes.
- **UI:** `frontend/src/pages/ProjectDetailPage.tsx` has an inline `EvidenceDialog` (add only) opened by an "Evidence" button; the checkpoint row shows `evidence_count` only. There is a second, apparently **orphaned** `frontend/src/components/gates/EvidenceModal.tsx` (also add-only).
- **⚠️ Notable finding — file upload is simulated:** Both `EvidenceModal.tsx` and the inline `EvidenceDialog` in `ProjectDetailPage.tsx` do **not** call the presigned `upload-url` endpoint. They fabricate a value `s3://deliverpro-evidence/${projectId}/${file.name}` and POST it as evidence. So "file_upload" evidence rows today point to objects that were never uploaded to S3.

### What's missing (gap list)
1. **View/list affordance** — the UI never renders the list of attached evidence, only a count. Users cannot see what is attached.
2. **Delete endpoint** — no `DELETE` handler; evidence cannot be removed at all.
3. **Delete UI affordance** — no button/row action.
4. **Real upload wiring** — file uploads are simulated, so "remove uploaded file" has nothing real to remove yet (only the DB row).
5. **Post-analysis behaviour** — deletion must be allowed after analysis has run (per request), so no lock; but the cascade needs a decision (see cascade analysis).

### Proposed change
- **Backend:** add `DELETE /api/projects/{projectId}/checkpoints/{checkpointId}/evidence/{evidenceId}` in `packages/gates/handlers/delete-evidence.ts`. It must:
  - Verify the evidence row belongs to the project + checkpoint.
  - Enforce RBAC (see OQ) and, for non-leadership/admin, project-membership (mirror `download-url.ts`).
  - If `evidence_type = 'file_upload'` and the value is a real S3 key, delete the S3 object (needs `s3:DeleteObject` IAM on the evidence prefix).
  - Delete the `gate_evidence` row.
  - Handle the cascade for `meeting_link` / `ai_analysis` types (see OQ2.2).
- **Frontend:** wire the existing `list-evidence` endpoint into a "View evidence" panel/modal that lists items with type, label, uploader, date, a download action (via `download-url` for `file_upload`), and a delete action (with confirm). Allowed regardless of analysis state.
- **Recommended (separate but related):** fix the simulated upload to actually use `upload-url` → S3 PUT → attach real `s3Key`. Flag as its own sub-item so it can be scheduled independently.

### Affected layers
- **Frontend:** ProjectDetailPage evidence panel + delete/confirm; optional real-upload wiring.
- **Backend:** new `delete-evidence.ts` handler; route registration; validation.
- **Infra:** IAM update for the evidence Lambda role to allow `s3:DeleteObject` on the evidence prefix. **Construct Developer** touch.
- **Data-model:** none (uses existing `gate_evidence`). No schema change unless soft-delete is chosen (see OQ2.3).

### Effort
**M** (delete handler + IAM + list/delete UI + tests). Add **S** if real upload wiring is included.

### Dependencies / sequencing
- Delete handler before delete UI.
- Real-upload wiring should ideally land before or with delete, otherwise "delete file" only removes a DB row that never had a backing object.

### Implementing agent
**Backend Developer** (delete handler), **Construct Developer** (IAM for `s3:DeleteObject`),
**Frontend Developer** (list/view/delete UI). Full-stack coordination.

### Needs SRS FR?
**Yes.** Deleting evidence and viewing/listing evidence are new user-facing behaviours with
governance implications (removing audit artifacts). Product Analyst should author an FR covering:
who can delete, what gets deleted (DB + S3), post-analysis allowance, and audit logging of deletions.

### Security flag — **YES**
- **Deleting governance evidence** is destructive and audit-sensitive. Must be RBAC-gated and every deletion must be audit-logged (actor, evidence id, checkpoint, timestamp).
- **Project-membership authorization** must be enforced on delete exactly as `download-url.ts` does, so users cannot delete evidence on projects they are not on.
- **S3 delete IAM** must be scoped to the evidence prefix only — no wildcard bucket delete.
- Consider whether hard-delete is acceptable for a governance system, or whether **soft-delete** (retain row, mark `deleted_at` + `deleted_by`) better preserves the audit trail.

### Cascade analysis (state-change tracing)
- Deleting a `meeting_link` evidence item after analysis: the transcript + `analysis_result` on `macro_checkpoints` still exist. Should deleting the source meeting link also clear `transcript_url` / `analysis_result` / `reached_at`? Likely **no** (keep the completed analysis), but must be decided.
- Deleting the `ai_analysis` evidence row (created by `analyze-transcript.ts`): should it also null out `macro_checkpoints.analysis_result`? If not, the evidence list and the checkpoint state diverge.

### Open questions
- **OQ2.1:** Which roles may delete evidence? (Proposal: `pm`, `sa` for their own project; `leadership`/`admin` any. Engineers read-only.)
- **OQ2.2:** When a `meeting_link` / `ai_analysis` evidence item is deleted after analysis, does the analysis result on the checkpoint stay (recommended) or get cleared?
- **OQ2.3:** Hard-delete or soft-delete (audit-preserving)? Governance context favours soft-delete.
- **OQ2.4:** Should we fix the simulated file upload now (real S3 PUT via `upload-url`), or track it as a separate defect? It directly affects what "remove uploaded evidence" means.

---

## 4. Item 3 — Hide "Run Analysis" When an Analysis Already Exists

### Current state (file refs)
- `frontend/src/components/gates/TranscriptAnalysisPanel.tsx`:
  - `showActions` initializes to `!checkpoint.analysis_result` — so when an analysis exists, the action buttons are hidden and the result is shown with a **"Re-run analysis"** button.
  - Clicking "Re-run analysis" sets `showActions = true`, which re-reveals **Fetch Transcript** and **Run Analysis**.
- So today, when a completed analysis exists, "Run Analysis" is reachable via the "Re-run analysis" affordance.

### Proposed change
Remove (or gate) the re-run path so that **"Run Analysis" is only shown when no analysis exists**
(`checkpoint.analysis_result` is null). Concretely: drop the "Re-run analysis" button, or hide it
behind an explicit role/decision. When an analysis exists, render the result view only.

### Affected layers
- **Frontend only:** `TranscriptAnalysisPanel.tsx`.

### Effort
**XS.**

### Dependencies / sequencing
Independent. Interacts conceptually with Item 5 (both touch this panel) — coordinate so both land in one PR.

### Implementing agent
**Frontend Developer.**

### Needs SRS FR?
**No** — UI display rule. (If re-run is removed entirely, note it against the analysis FR for traceability.)

### Security flag
**None.** (The `/analyze` endpoint remains; this is purely UI visibility. Backend does not block re-running — see OQ.)

### Open questions
- **OQ3.1:** Remove re-run entirely, or keep a re-run action for `admin` only? If re-run is fully removed from the UI but the `/analyze` endpoint still overwrites results, that is acceptable but worth confirming.

---

## 5. Item 4 — Transcript View Modal

### Current state (file refs)
- **Fetch + store:** `packages/analysis/handlers/fetch-transcript.ts` fetches from Avoma (`packages/analysis/services/avoma.service.ts`, two-step meeting→transcription flow) and stores plain text in S3 at `transcripts/{projectId}/{checkpoint_name}/{iso}.txt`, then sets `macro_checkpoints.transcript_url = s3://{bucket}/{key}`.
- **UI:** `TranscriptAnalysisPanel.tsx` shows only "Transcript fetched — N characters." There is **no way to view the transcript text**.
- **Retrieval path already exists:** `packages/files/handlers/download-url.ts` supports the `transcripts/` prefix and authorizes by project membership, returning a presigned GET URL.

### Proposed change
Add a **"View transcript"** button (shown when `checkpoint.transcript_url` is set) that opens a modal.
The modal: strip the `s3://{bucket}/` prefix from `transcript_url` to get the S3 key → `POST /api/files/download-url` → fetch the presigned URL text → render in a scrollable modal. **No new backend endpoint required** — reuses `download-url`.

### Affected layers
- **Frontend:** new `TranscriptModal` component + button in `TranscriptAnalysisPanel.tsx`.
- **Backend:** none (reuses `download-url`). Minor: confirm `download-url` accepts a bare key derived from the stored `s3://` URL.
- **Infra/data-model:** none.

### Effort
**S.**

### Dependencies / sequencing
Independent; naturally pairs with Items 3 and 5 (same panel).

### Implementing agent
**Frontend Developer** (Backend Developer only if `download-url` needs an input tweak for key parsing).

### Needs SRS FR?
**No** — surfaces already-fetched-and-stored data. Recommend a traceability note on the analysis FR.

### Security flag
**Low.** `download-url` already enforces project-membership authorization and returns a short-lived
(300s) presigned URL. Ensure the modal does not log or cache the transcript body (may contain
sensitive meeting content). Ensure the presigned URL is not persisted.

### Open questions
- **OQ4.1:** Render the raw stored text (currently `"[Speaker]: text"` lines), or parse speaker turns into a formatted view? Raw is faster; formatted is nicer.
- **OQ4.2:** Should PMs/SAs/engineers all be able to view transcripts, or leadership/admin/PM only? (Current `download-url` allows `pm, sa, engineer, leadership, admin`.)

---

## 6. Item 5 — Show Topics Covered (keep expected / should-have-been-discussed)

### Current state (file refs)
- **Analysis output shape:** `packages/analysis/types.ts` → `TranscriptAnalysisResult` already returns `topics_covered: string[]`, `topics_missing: string[]`, `key_points: string[]`, `disagreements: string[]`, `passed`, `confidence`.
- **Prompt:** `packages/analysis/services/prompt.service.ts` — the LLM derives `topics_covered` vs `topics_missing` per run (from an admin-configured prompt per checkpoint, or a generic fallback). There is **no separately stored, canonical "expected topics" list** — the "expected" set is effectively `topics_covered ∪ topics_missing`, produced fresh each run.
- **UI:** `TranscriptAnalysisPanel.tsx` currently shows `topics_covered.length` as a **count badge only**, and lists `topics_missing`. `key_points` and `disagreements` are returned but not displayed.

### Proposed change
- **Minimum (frontend-only):** render the **`topics_covered` list** (not just the count) alongside the existing `topics_missing` list. Optionally also surface `key_points` and `disagreements`, which are already returned. This fully satisfies "display topics covered while expected/missing remain shown" **if** the owner accepts LLM-derived covered/missing as the "expected" set.
- **If a canonical expected-topics checklist is wanted:** this becomes a backend + config change — store per-checkpoint expected topics (e.g. in `casdm_config` or `analysis_prompts`), have the analysis compare against that fixed list, and return covered/missing relative to it. That is a new behaviour and needs an FR.

### Affected layers
- **Minimum:** Frontend only (`TranscriptAnalysisPanel.tsx`).
- **Canonical list variant:** Backend (`analysis` domain + prompt/agent service), Data-model (store expected topics), Frontend.

### Effort
- **XS** frontend-only.
- **M** if canonical expected-topics list is introduced (data-model + prompt/agent changes + FR).

### Dependencies / sequencing
Frontend-only variant pairs with Items 3 & 4 (same panel). Canonical variant depends on config/data-model decisions and should follow Phase-2 architecture review.

### Implementing agent
**Frontend Developer** (minimum). **AWS Architect + Product Analyst + Backend Developer** if canonical list is chosen.

### Needs SRS FR?
**Conditional.**
- Frontend-only display of existing fields → **No FR** (display of already-specified output).
- Canonical configured expected-topics list + comparison logic → **Yes, new FR** (new source of truth + behaviour).

### Security flag
**None** (topic labels are non-sensitive metadata; no PII beyond what analysis already returns).

### Open questions
- **OQ5.1 (decisive):** Is LLM-derived `topics_covered` / `topics_missing` sufficient, or do you want a fixed, admin-configured expected-topics checklist per checkpoint that analysis is scored against? This single answer determines XS-frontend vs M-backend + FR.
- **OQ5.2:** Also display `key_points` and `disagreements` (already returned) in the result view?

---

## 7. Item 6 — Phase Filter Bug (Projects List)

### Current state (file refs) — root cause identified
- **Frontend correctly sends the filter.** `ProjectsPage.tsx` sets `phase` state, passes it to `useProjects({ ..., phase })` (~line 345); `useProjects.ts` appends `phase` to the query string. The client-side `filtered` memo only filters by type/pm/sa — it does **not** (and should not) filter phase; it relies on the backend.
- **Backend silently ignores the parameter.** `packages/projects/handlers/list-projects.ts`:
  - `ListProjectsQuerySchema` accepts `phase`.
  - But the handler has a **no-op block**:
    ```js
    if (query.phase) {
      // Note: phase is computed, so we filter after the CTE
      // We'll handle this differently below
    }
    ```
    …and there is **no code below that applies it.** `current_phase` is computed via a
    `CROSS JOIN LATERAL` (alias `cp`), but no `WHERE cp.current_phase = query.phase` is ever added.

**Defect:** the `phase` query parameter is accepted and then dropped — the filter has no effect.

### Proposed change
Apply the phase filter against the computed `current_phase`. Because `current_phase` is produced by
the lateral join, filter either by referencing `cp.current_phase` in the outer `WHERE`, or by
wrapping the projection in a subquery/CTE and filtering the computed column. The same predicate must
be applied to **both** the count query and the main query so `total_count` stays consistent.

### Affected layers
- **Backend only:** `list-projects.ts` (query construction). No frontend change; no data-model change.

### Effort
**XS** (plus a regression test asserting `?phase=Phase 2` returns only Phase 2 projects).

### Dependencies / sequencing
Independent. Good quick win.

### Implementing agent
**Backend Developer.**

### Needs SRS FR?
**No** — bugfix against existing intended behaviour.

### Security flag
**None.**

### Open questions
- **OQ6.1:** None functional. Minor: confirm expected behaviour when `phase` and `status` are combined (AND semantics — assumed).

---

## 8. Item 7 — Leadership Dashboard Usefulness (the big one)

### Current state (file refs)
- **Dashboard:** `frontend/src/pages/DashboardPage.tsx` (leadership/admin only). It already renders: 4 stat cards (total active, in Phase 0–1, in Phase 2–3, stalled), a phase-distribution pie, a stalled-projects table, and a gate-completion-rates table. So it is **not literally empty** — but it is thin and backward-looking.
- **Backend source:** `packages/reporting/services/reporting.service.ts` → `getReportingSummary()` returns only `total_active_projects`, `projects_by_phase`, `stalled_projects`, `gate_completion_rates`. `getReportingTimeline()` is **per-project only** (not surfaced on the dashboard).
- **Available-but-unsurfaced data across domains:**
  - **Projects** (`packages/projects`): `sow_hours`, `hours_consumed`, `burn_rate_pct` (already computed in `list-projects.ts`), `planned_kickoff_date`, `expected_completion_date`, `project_type`, `status`.
  - **Meetings** (`packages/meetings`): escalations (`create-escalation.ts`, `list-escalations.ts`, `resolve-escalation.ts`), weekly status logs (`create-status-log.ts`, `list-status-logs.ts`), discovery sessions. **No cross-project escalation aggregation endpoint exists.**
  - **Gates** (`packages/gates`): checkpoint completion, timelines. Gate-completion aggregate exists; **no "upcoming / overdue checkpoints" aggregate.**
  - **Analysis** (`packages/analysis`): transcript analysis pass/fail + confidence per checkpoint. **No aggregate of analysis outcomes across projects.**

### Proposed dashboard spec (widgets → backing endpoint)
Grouped by whether the backing data/endpoint exists today.

**A. Ships now (data already available):**

1. **Portfolio burn-rate watchlist** — projects where `burn_rate_pct` ≥ threshold (e.g. 80%/100%). Data already computed in `list-projects.ts`; needs to be aggregated into the reporting summary (or dashboard calls `/api/projects` and ranks client-side as an interim).
2. **Gate completion rates** — already present; keep.
3. **Phase distribution + total/stalled stat cards** — already present; keep.

**B. Needs a new/extended backend aggregation (gaps):**

4. **Open escalations (cross-project)** — count + list of unresolved escalations with age and owning project. **Gap:** no cross-project escalation aggregation endpoint (only per-project list). New reporting query/endpoint required.
5. **Upcoming / overdue checkpoints** — checkpoints due soon or past `expected_completion_date` with no `reached_at`. **Gap:** new aggregation.
6. **Analysis outcomes** — count of transcript-analysis checkpoints passed vs needs-discussion, avg confidence. **Gap:** new aggregation over `macro_checkpoints.analysis_result`.
7. **Recent activity feed (cross-project)** — most recent governance/checkpoint/evidence events across all projects. **Gap:** `getReportingTimeline` is per-project; a cross-project variant is needed.
8. **Weekly status coverage** — projects missing a recent weekly status log (a delivery-hygiene signal). **Gap:** new aggregation over `weekly_status_logs`.

### Affected layers
- **Backend:** extend `packages/reporting` — add fields to `getReportingSummary()` and/or new handlers (e.g. `get-escalations-summary`, `get-upcoming-checkpoints`, `get-activity-feed`, `get-analysis-summary`). Cross-domain reads (allowed via DB, per code-structure §2 — reporting already reads projects/gates/meetings tables directly).
- **Frontend:** new dashboard widgets (cards/tables/charts) wired to new hooks in `useReporting.ts`.
- **Data-model:** none expected (reads existing tables). Confirm indexes support the new aggregations at scale.
- **Infra:** none.

### Effort
**L** (multiple new aggregations + widgets + tests). Recommend phasing: Wave 1 = A (burn-rate watchlist)
+ escalations summary; Wave 2 = upcoming/overdue + analysis outcomes + activity feed.

### Dependencies / sequencing
- Each new widget's backend aggregation must land and pass Plan-Reviewer before its widget.
- Follows full Phase-2 architecture flow (architecture doc update to `reporting-architecture.md` → data validation → security gate light → backlog).

### Implementing agent
**AWS Architect** (extend `reporting-architecture.md` + define queries), **Product Analyst** (FRs for
the new metrics), **Backend Developer** (aggregations), **Frontend Developer** (widgets).

### Needs SRS FR?
**Yes.** New leadership metrics (escalation SLA view, burn-rate watchlist, upcoming/overdue,
analysis outcomes, activity feed, status coverage) are new product capabilities. Each widget in
group B should trace to an FR with testable acceptance criteria (exact thresholds, counts, ordering).

### Security flag
**Low.** Dashboard is already restricted to `leadership`/`admin` (enforced in `DashboardPage.tsx`
and must be re-enforced on any new reporting endpoint via `withRoles(['leadership','admin'])`).
Ensure new cross-project aggregations do not leak project detail to non-privileged roles — the new
endpoints must carry the same role guard as `get-summary.ts`.

### Open questions
- **OQ7.1 (decisive):** Which widgets are must-have for v1 vs later? Recommend v1 = burn-rate watchlist + open escalations + upcoming/overdue checkpoints.
- **OQ7.2:** Thresholds — burn-rate warning % (80? 90? 100?); "stalled" is currently 14 days — keep? "overdue" definition (past `expected_completion_date`? past a per-phase SLA?).
- **OQ7.3:** Is a cross-project activity feed desired, or is per-project timeline (already built) enough?
- **OQ7.4:** Should escalation aging use business days or calendar days? Any SLA target to color-code against?

---

## 9. Recommended Sequencing (draft)

1. **Quick wins (low risk, no FR):** Item 6 (phase filter bug), Item 3 (hide Run Analysis), Item 1 (defer Slack).
2. **Panel bundle (frontend, same component):** Item 4 (transcript modal) + Item 5 minimum (topics covered list) — one PR.
3. **Evidence (needs FR + security review):** Item 2 — decide OQ2.1–2.4 first; include IAM change and audit logging; decide on real-upload wiring.
4. **Dashboard (needs FRs + architecture doc update):** Item 7 — phase the widgets; Wave 1 first.

---

## 10. Items Requiring Product-Analyst FRs Before Build

| Item | Why an FR is needed |
|------|---------------------|
| 2 — Evidence delete/view | Destructive, audit-sensitive governance behaviour; role rules + cascade + audit logging must be specified. |
| 5 — *only if* canonical expected-topics list | New source of truth + scoring behaviour. Frontend-only display variant needs no FR. |
| 7 — Dashboard new metrics | New leadership capabilities; each widget needs testable ACs (thresholds, ordering, counts). |

Items 1, 3, 4, 6 (and Item 5 frontend-only variant) are deferrals / UI rules / bugfixes / display of
existing data and do **not** require new FRs — a traceability note against the relevant existing FR is
sufficient.

---

## 11. Security Callouts (consolidated)

- **Item 2 (high):** evidence deletion is destructive + audit-sensitive → RBAC + project-membership enforcement, scoped `s3:DeleteObject` IAM, mandatory audit logging, soft-delete recommended. Route to **Security Reviewer**.
- **Item 1 (low):** deferring by hiding the UI leaves the `/slack/provision` route reachable via direct API call — decide whether to also disable the route.
- **Item 4 (low):** transcript may contain sensitive meeting content — don't log/cache the body; rely on short-lived presigned URLs (already 300s).
- **Item 7 (low):** re-enforce `leadership`/`admin` role guard on every new reporting endpoint.

---

*End of draft. No code, specs, or backlog changes have been made. Awaiting owner decisions on the open questions above.*
