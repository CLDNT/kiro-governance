# Implementation Strategy — Phase 2: DeliverPro

## Changelog

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-06-30 | v1.0 | Technical PM | Initial implementation strategy from SRS v1.3, 8 architecture docs, domain decomposition v1.0 |

---

## 1. Team & Capacity

| Attribute | Value |
|-----------|-------|
| Developer | Muhammad Faraz |
| Hours/day | 4 |
| Days/week | 5 |
| Hours/week | 20 |
| Sprint duration | 1 week (20 hrs) |
| Story point | 1 hour of focused work |
| Sprint capacity | 20 pts |
| Total sprints | 8 |
| Total capacity | 160 pts (160 hours) |

## 4. Sprint Timeline

**Start date:** 2026-06-30 | **Developer:** Muhammad Faraz | **Pace:** 4 hrs/day, Mon–Fri

| Sprint | Focus | Start | Expected End | Revised End (+ buffer) |
|--------|-------|-------|--------------|------------------------|
| Sprint 1 | CDK infra, V003 migration, shared middleware, Cognito | 30 Jun | 4 Jul | 7 Jul |
| Sprint 2 | Projects backend (CRUD, Jira import, template seeding, checklist) | 7 Jul | 11 Jul | 14 Jul |
| Sprint 3 | Gates + Files backend | 14 Jul | 18 Jul | 21 Jul |
| Sprint 4 | Frontend Iteration 1 (auth, project list, gate view, evidence UI) | 21 Jul | 25 Jul | 28 Jul |
| Sprint 5 | Iteration 2 backend (meetings, closure, executive calls, discovery sessions) | 28 Jul | 1 Aug | 4 Aug |
| Sprint 6 | Iteration 2 frontend + Reporting (leadership view) | 4 Aug | 8 Aug | 11 Aug |
| Sprint 7 | Iteration 3 infra (AgentCore, config admin, project type templates, prompts) | 11 Aug | 15 Aug | 18 Aug |
| Sprint 8 | AI analysis (Avoma + Bedrock), CloudWatch alarms, runbooks, polish | 18 Aug | 22 Aug | 25 Aug |

**Expected delivery:** 22 Aug 2026
**Revised delivery (with buffer):** 25 Aug 2026

> Buffer accounts for integration surprises, Jira custom field resolution (OQ-P2-004, Sprint 2), and Bedrock AgentCore setup (Sprint 7). Assumes no holidays and consistent 4 hrs/day availability.

| Iteration | Sprints | Features | FRs Covered | Focus |
|-----------|---------|----------|-------------|-------|
| 1 | 1–4 | F-P2-01 through F-P2-05, F-P2-07 through F-P2-10, F-P2-13, F-P2-16, F-P2-17 | 16 FRs | Core tracking + auth + hosting |
| 2 | 5–6 | F-P2-06, F-P2-11 through F-P2-15 | 8 FRs | Extended lifecycle management |
| 3 | 7–8 | F-P2-18, F-P2-19 | 7 FRs | AI analysis + admin config |

---

## 3. Dual Timeline Comparison

### 3.1 Spec-Based Development (Kiro)

| Metric | Value |
|--------|-------|
| Total sprints | 8 |
| Points per sprint | 20 |
| Total story points | 160 |
| Total hours | 160 hrs |
| Calendar duration | 8 weeks at 20 hrs/week |
| Calendar months | ~2 months |

### 3.2 Traditional Development

| Metric | Value |
|--------|-------|
| Effort multiplier | 2.5× |
| Total hours | 400 hrs |
| At same pace (20 hrs/week) | 20 weeks |
| Calendar months | ~5 months |

### 3.3 Cost Savings

| Item | Value |
|------|-------|
| Hours saved | 240 hrs |
| Rate | $75/hr |
| **Cost savings** | **$18,000** |
| Time savings | 12 weeks (3 months earlier delivery) |

### 3.4 Where Kiro Delivers Maximum Savings

| Task Category | Traditional (hrs) | Kiro (hrs) | Reduction |
|---------------|------------------:|----------:|:---------:|
| Lambda CRUD handlers | 120 | 48 | 60% |
| CDK infrastructure | 40 | 20 | 50% |
| Frontend scaffolding + pages | 100 | 48 | 52% |
| Database migrations | 16 | 8 | 50% |
| Shared middleware | 24 | 12 | 50% |
| Integration (Avoma, AgentCore) | 40 | 24 | 40% |
| Testing & polish | 60 | — | Not Kiro-assisted |
| **Total** | **400** | **160** | **60%** |

---

## 4. Per-Sprint Hour Breakdown

| Sprint | Focus | Hours | Stories | Key Deliverables |
|--------|-------|------:|--------:|-----------------|
| Sprint 1 | Foundation (Infra + Auth) | 20 | 4 | CDK stack, V003 migration, shared middleware, Cognito setup |
| Sprint 2 | Projects Backend | 20 | 5 | Project CRUD, Jira import, CASDM seeding, onboarding checklist, resource budget |
| Sprint 3 | Gates + Files Backend | 20 | 5 | Gate status view, checkpoint completion, evidence attachment, presigned URLs, weekly status log |
| Sprint 4 | Frontend Iteration 1 | 20 | 6 | React scaffold, project list, project detail, evidence UI, checklist UI, status log UI |
| Sprint 5 | Iteration 2 Backend | 20 | 5 | Escalations, discovery sessions, checkpoint notes, executive checkpoints, closure workflow |
| Sprint 6 | Iteration 2 Frontend + Reporting | 20 | 6 | Escalation UI, discovery UI, closure UI, reporting handlers, leadership view |
| Sprint 7 | Iteration 3 Config + Infra | 20 | 5 | CASDM config CRUD, analysis prompts CRUD, project-type templates, AgentCore setup, alarms |
| Sprint 8 | Iteration 3 Analysis + Polish | 20 | 5 | Avoma integration, AgentCore analysis, metadata extraction, E2E tests, runbooks |
| **Total** | | **160** | **41** | |

---

## 5. Sprint Plan Detail

### Sprint 1: Foundation (Infrastructure + Auth)

**Goal:** Deploy CDK stack with all stateful/stateless resources. Run V003 migration. Establish shared middleware. Cognito pool ready.

| Story ID | Title | Points | Type |
|----------|-------|-------:|------|
| DP-01 | CDK Stack Scaffold | 8 | Infrastructure |
| DP-02 | V003 Database Migration Script | 4 | Backend |
| DP-03 | Shared Middleware (JWT, RBAC, Error Handler) | 5 | Backend |
| DP-04 | Cognito User Pool + 5 Groups | 3 | Infrastructure |
| | **Sprint Total** | **20** | |

**Risks:** None — no external dependencies.

---

### Sprint 2: Projects Backend

**Goal:** All project-domain Lambda handlers deployed. Jira import functional. CASDM seeding on create. Onboarding checklist and budget tracking.

| Story ID | Title | Points | Type |
|----------|-------|-------:|------|
| DP-05 | Project CRUD Handlers (list, get, create, update) | 5 | Backend |
| DP-06 | Jira One-Time Import Lambda | 4 | Backend |
| DP-07 | CASDM Template Seeding on Project Create | 4 | Backend |
| DP-08 | Onboarding Checklist CRUD | 4 | Backend |
| DP-09 | Resource Budget Update Handler | 3 | Backend |
| | **Sprint Total** | **20** | |

**Dependencies:** DP-01 (CDK), DP-02 (V003 migration), DP-03 (middleware)

---

### Sprint 3: Gates + Files Backend

**Goal:** Gate status view returns complete phase data. Checkpoints can be completed. Evidence can be attached. File upload/download works. Weekly status logs functional.

| Story ID | Title | Points | Type |
|----------|-------|-------:|------|
| DP-10 | Gate Status View Lambda | 5 | Backend |
| DP-11 | Checkpoint Completion Lambda (4 types) | 4 | Backend |
| DP-12 | Evidence Attachment Lambda | 3 | Backend |
| DP-13 | Files Domain — Presigned URL Lambdas | 4 | Backend |
| DP-14 | Weekly Status Call Log Handlers | 4 | Backend |
| | **Sprint Total** | **20** | |

**Dependencies:** DP-01 (CDK, S3 bucket), DP-02 (V003), DP-03 (middleware)

---

### Sprint 4: Frontend Iteration 1

**Goal:** Full frontend scaffold. Auth flow. Project list with search/filter. Project detail with gate status. Evidence upload. Onboarding checklist. Status log. Resource budget display.

| Story ID | Title | Points | Type |
|----------|-------|-------:|------|
| DP-15 | React + Vite + Tailwind Scaffold + Cognito Auth | 4 | Frontend |
| DP-16 | Project List Page + Search/Filter | 4 | Frontend |
| DP-17 | Project Detail Page (Gate Status View) | 4 | Frontend |
| DP-18 | Evidence Attachment UI + File Upload | 3 | Frontend |
| DP-19 | Onboarding Checklist UI | 2 | Frontend |
| DP-20 | Weekly Status Log UI + Resource Budget Display | 3 | Frontend |
| | **Sprint Total** | **20** | |

**Dependencies:** DP-05 through DP-14 (all backend APIs)

---

### Sprint 5: Iteration 2 Backend

**Goal:** Meetings domain fully functional (escalations, discovery). Checkpoint notes. Executive/planning checkpoints. Closure workflow.

| Story ID | Title | Points | Type |
|----------|-------|-------:|------|
| DP-21 | Escalation Board Handlers (create + resolve + list) | 4 | Backend |
| DP-22 | Discovery Sessions Handlers (create + list) | 3 | Backend |
| DP-23 | Checkpoint Notes Lambda (add + list) | 3 | Backend |
| DP-24 | Executive Check-in & Planning Checkpoints | 4 | Backend |
| DP-25 | Project Closure Workflow Lambda | 6 | Backend |
| | **Sprint Total** | **20** | |

**Dependencies:** DP-03 (middleware), DP-02 (V003)

---

### Sprint 6: Iteration 2 Frontend + Reporting

**Goal:** Iteration 2 UI pages live. Reporting handlers. Leadership summary view.

| Story ID | Title | Points | Type |
|----------|-------|-------:|------|
| DP-26 | Escalation Board UI | 3 | Frontend |
| DP-27 | Discovery Sessions UI | 3 | Frontend |
| DP-28 | Checkpoint Notes UI + Project Closure UI | 4 | Frontend |
| DP-29 | Reporting Domain Handlers (summary + timeline) | 4 | Backend |
| DP-30 | Leadership View UI | 3 | Frontend |
| DP-31 | Micro Artifact Status UI + Phase Progression Visual | 3 | Frontend |
| | **Sprint Total** | **20** | |

**Dependencies:** DP-21 through DP-25 (Iteration 2 backend)

---

### Sprint 7: Iteration 3 Infrastructure + Config

**Goal:** Config domain CRUD operational. Analysis prompts manageable. Project-type templates. AgentCore agent provisioned. CloudWatch alarms.

| Story ID | Title | Points | Type |
|----------|-------|-------:|------|
| DP-32 | CASDM Config CRUD Handlers | 5 | Backend |
| DP-33 | Analysis Prompts CRUD Handlers | 3 | Backend |
| DP-34 | Project Type Template Management | 4 | Backend |
| DP-35 | AgentCore Agent Setup (Bedrock) | 4 | Infrastructure |
| DP-36 | CloudWatch Alarms + Budget Alerts | 4 | Infrastructure |
| | **Sprint Total** | **20** | |

**Dependencies:** DP-01 (CDK stack), DP-02 (V003 for analysis_prompts table)

---

### Sprint 8: Iteration 3 Analysis + Polish

**Goal:** Full transcript analysis flow working. Evidence metadata extraction. End-to-end integration test. Operational documentation.

| Story ID | Title | Points | Type |
|----------|-------|-------:|------|
| DP-37 | Avoma Transcript Fetch Lambda | 4 | Backend |
| DP-38 | AgentCore Transcript Analysis Lambda | 5 | Backend |
| DP-39 | Evidence Link Metadata Extraction | 3 | Backend |
| DP-40 | E2E Integration Test Suite | 5 | Backend |
| DP-41 | Operational Runbooks + Config Admin UI | 3 | Full-stack |
| | **Sprint Total** | **20** | |

**Dependencies:** DP-35 (AgentCore setup), DP-33 (analysis_prompts)

---

## 6. Dependency Graph (Critical Path)

```
Sprint 1: DP-01 ─→ DP-02 ─→ DP-03 ─→ DP-04
              │         │         │
              ▼         ▼         ▼
Sprint 2: DP-05 → DP-06 → DP-07 → DP-08 → DP-09
              │                              │
              ▼                              ▼
Sprint 3: DP-10 → DP-11 → DP-12 → DP-13 → DP-14
              │                              │
              ▼                              ▼
Sprint 4: DP-15 → DP-16 → DP-17 → DP-18 → DP-19 → DP-20
              │
              ▼
Sprint 5: DP-21 → DP-22 → DP-23 → DP-24 → DP-25
              │                              │
              ▼                              ▼
Sprint 6: DP-26 → DP-27 → DP-28 → DP-29 → DP-30 → DP-31
              │
              ▼
Sprint 7: DP-32 → DP-33 → DP-34 → DP-35 → DP-36
              │         │
              ▼         ▼
Sprint 8: DP-37 → DP-38 → DP-39 → DP-40 → DP-41
```

**Critical path:** DP-01 → DP-02 → DP-03 → DP-05 → DP-10 → DP-15 → ... (infrastructure → backend → frontend)

---

## 7. Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| Avoma API unavailable or undocumented | Medium | High (blocks FR-P2-005, FR-P2-013) | Deferred to Iteration 3; manual transcript paste fallback |
| AgentCore pricing/GA unknown | Low | Medium (blocks FR-P2-005) | Fallback: raw Bedrock InvokeModel with same prompt |
| Jira CST field mapping unclear (OQ-P2-004) | Medium | Low (blocks DP-06 only) | Import Lambda accepts flexible field mapping config |
| RDS instance capacity for Phase 2 load | Low | Medium | Monitor connections; upgrade to db.t3.small if needed |
| Single developer — sick/vacation risk | Low | High | Architecture docs are spec-ready for any developer pickup |

---

## 8. Definition of Done (per story)

- [ ] Implementation matches architecture doc section
- [ ] All acceptance criteria pass
- [ ] TypeScript strict mode, no `any`
- [ ] Zod validation on all Lambda inputs
- [ ] Error handling returns correct HTTP status + error code
- [ ] Unit tests cover service layer (>80% coverage)
- [ ] `npm run lint` and `npm run format:check` pass
- [ ] CDK synth succeeds (infrastructure stories)
- [ ] API tested via curl/Postman (backend stories)
- [ ] Accessible and responsive (frontend stories)

---

## 9. Infrastructure Cost

Per `docs/phase2/architecture/cost-estimate.md`:

| Component | Monthly Cost |
|-----------|------------:|
| Phase 1 RDS + EC2 (existing) | $23.80 |
| Phase 2 serverless additions | $1.91 |
| **Total** | **$25.71/mo** |

Most Phase 2 services fall within AWS Free Tier. Only Secrets Manager ($0.80/mo) incurs cost outside free tier during the first 12 months.

---

## 10. Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| All 41 stories complete | 100% | Backlog tracking |
| All 31 FRs implemented | 100% | FR traceability matrix |
| Sprint velocity | 20 pts/sprint (no overrun) | Actual vs planned |
| Zero critical bugs at Iteration 1 end | 0 | Manual QA |
| Gate tracking adoption | 80% of test projects | End-to-end test |

---

*End of Implementation Strategy v1.0*
