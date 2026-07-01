# Phase 2 — Next Steps (AiDLC Flow)

**Date:** 2026-06-25
**Source:** Phase 2 transcript (Chris Xenos × Muhammad Faraz) + current project-progress.md

---

## Where We Are

Phase 1 (kiro-governance POC) is **fully complete and deployed**:
- MCP server live on EC2 (`100.50.184.141`)
- RDS PostgreSQL deployed (Sprint 4 done)
- GitHub Actions governance trigger operational
- All 10 macro gates tracked, CASDM phase-aligned

Phase 2 is a **new engagement scope** requested by Chris Xenos. It is not yet in the AiDLC flow — no SRS, no architecture, no backlog exists for it yet.

---

## What Chris Asked For (Phase 2 Scope)

From the transcript, three distinct things were requested:

### 1. Interactive Project Tracking App (QuickSight / QUIC)
An app where delivery PMs can:
- See all active projects and which CASDM gates each has passed
- View artifacts attached to each gate (SRS, design docs, transcripts, links)
- Manually add evidence: upload a file or paste a meeting link for gates that Kiro cannot auto-detect
- Role-based views (PM, SA, Engineer)
- Configurable gates and phases (add/rename without code changes)

This is **not** the reporting dashboard — it's the interactive layer beneath it.

### 2. Meeting/Transcript Integration (Avoma)
For gates that are validated by meetings (kickoff call, internal review, implementation plan review, etc.):
- PM pastes the Avoma meeting link into the app
- System fetches the transcript
- AI checks whether required topics were covered (sentiment + criteria analysis)
- Result is stored as artifact evidence for that gate

### 3. QuickSight Reporting Dashboard (top layer)
Read-only reporting view over the RDS data:
- All projects, current phase, gates passed
- No interactivity — reports only
- Sits on top of the same RDS database the MCP server writes to

---

## AiDLC Next Steps (in sequence)

Following the CASDM phases and the AiDLC flow already in place:

### Phase 0: Internal Preparation (NEW scope)

- [ ] **Determine project type** — this is a new Greenfield app (QUIC-based project tracker). Confirm with Chris/Tariq.
- [ ] **Resolve AWS account** — Chris confirmed sandbox is not acceptable. Need a dedicated account (Crunch account or new Cloudelligent delivery account). Chris to confirm with Kasha. **Blocker — do not start architecture until resolved.**
- [ ] **Get access to a live project board** — Chris agreed to share a "launch and enable" project file so Faraz can map the existing data fields to the new app schema.
- [ ] **Compliance check** — app will store project names, team member names, meeting links, artifact files. Likely no HIPAA/PCI but confirm with Chris whether any client PII will be stored.

### Phase 1: Discover & Align

- [ ] **Product Analyst: draft SRS** from Phase 2 transcript + key points (now indexed in KB)
  - Core entities: Project, Gate, GateEvidence, TeamMember, MeetingLink, Artifact
  - FR-01: List all projects with current phase and gate status
  - FR-02: Per-project gate detail view with evidence attachments
  - FR-03: Manual evidence upload/link entry per gate
  - FR-04: Avoma meeting link → transcript fetch → AI topic coverage check
  - FR-05: Configurable gates and phases (add/rename without deploy)
  - FR-06: Role-based views (PM, SA, Engineer, Leadership)
  - FR-07: QuickSight reporting layer over same RDS DB
  - FR-08: Pull existing Kiro macro/micro events from RDS into project timeline
- [ ] **Kickoff call with Chris** — present SRS for alignment before architecture starts
- [ ] **Internal team review of SRS** — Tariq + Faraz + SA alignment

### Phase 2: Design & Review

- [ ] **AWS Architect: domain decomposition** — suggested domains:
  - `projects` — project CRUD, phase/gate config
  - `evidence` — artifact uploads, meeting links, Avoma integration
  - `governance-sync` — reads from existing kiro-governance RDS, surfaces in project timeline
  - `reporting` — QuickSight dataset refresh, S3 exports
  - `auth` — Cognito or SSO for delivery team access
- [ ] **Solution Architecture Design** — QUIC app architecture, Avoma API integration, cross-account access pattern, RDS schema extension
- [ ] **Data Readiness** — extend existing `governance_events` table or new schema? Decide whether Phase 2 app shares the same RDS instance or gets its own.
- [ ] **TCO** — QUIC hosting cost, Avoma API plan, additional RDS cost if separate instance
- [ ] **Security Gate** — cross-account IAM, Cognito setup, data isolation between clients

### Phase 3: Build & Implement

- [ ] **Technical PM: sprint plan** — estimated 3–4 sprints based on scope
  - Sprint 1: App scaffold + project/gate data model + basic list view
  - Sprint 2: Evidence upload/link attachment + Avoma integration
  - Sprint 3: QuickSight reporting layer + governance-sync from kiro-governance RDS
  - Sprint 4: Role-based views + configurable gates + polish

### Phase 4: Launch & Enable

- [ ] Deploy to correct AWS account (non-sandbox)
- [ ] Embed app URL for delivery team access (no AWS account needed for consumers)
- [ ] KT session with PMs and SAs on how to use the app
- [ ] UAT with Chris Xenos

---

## Open Questions / Blockers

| # | Question | Owner | Status |
|---|----------|-------|--------|
| 1 | Which AWS account hosts the Phase 2 app? (not sandbox) | Chris Xenos + Kasha | **Blocker** |
| 2 | Does Avoma have an API for transcript fetch? What is the auth method? | Faraz to investigate | Open |
| 3 | Does Phase 2 app share the existing RDS instance or get its own? | Architect decision | Open |
| 4 | Is Oscar (presales) out of scope for Phase 2? (Chris confirmed yes — delivery phase only) | Chris Xenos | Resolved — Oscar excluded |
| 5 | What is the meeting-to-project linking strategy? Manual link entry confirmed as starting point. | Chris Xenos | Resolved — manual link |
| 6 | Role-based access: who are the roles? PM, SA, Engineer, Leadership (Chris/Tariq)? | Chris Xenos | Open |
| 7 | Long-term: replace Jira with this app (DeliverPro vision)? Scope for now or later? | Chris Xenos | Deferred — start small |

---

## Immediate Actions (this week)

1. **Confirm AWS account** with Chris/Kasha — everything else is blocked on this
2. **Product Analyst: draft Phase 2 SRS** from the indexed KB transcript
3. **Faraz: investigate Avoma API** — can we fetch a transcript given a meeting link?
4. **Get the live project board** Chris promised to share — needed to map existing fields to app schema

---

*Source: Phase 2 Transcript (Chris Xenos × Muhammad Faraz, 2026-06-25), CASDM PDF, current project-progress.md*
