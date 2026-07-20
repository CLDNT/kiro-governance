# DeliverPro — Impact & Change Report
> Generated: 2026-07-14 | Source: Meeting transcript analysis (new_updates KB)

## Executive Summary

DeliverPro today is a governance tracker with advisory-only enforcement — gates can be bypassed, artifacts are stored manually, and the UI requires too much human input. Three clear themes emerged from the meetings: (1) governance must be a thin **layer** over source systems, not a storage system itself; (2) quality scores — not binary yes/no — must drive gate progression; (3) enforcement must be identity-backed (OIDC) so gates cannot be skipped. Without the enforcement core, everything else stays advisory and Qasim's objection stands.

---

## What to REMOVE

| Item | Reason | Complexity | Priority |
|---|---|---|---|
| Micro gates in the UI | Micro events belong in the audit trail, not the main UI. They add noise and imply approval steps that shouldn't exist. Keep the data, hide the UI. | Low | P2 |
| Primary artifact storage in DeliverPro | The platform should never be the primary store for documents or transcripts. Artifacts live in Teams/GitHub; DeliverPro holds only references + scores. | High | P1 |
| Binary yes/no checkpoints | Qasim explicitly rejected these across all meetings. Quality signal replaces binary. | Low | P1 |
| Manual evidence upload flow | People won't do it. Same failure mode as Jira. Remove the pattern entirely. | Low | P1 |

---

## What to CHANGE

| Item | Current → Target | How-To | Complexity | Priority |
|---|---|---|---|---|
| Governance data model | Stores artifact blobs → stores only metadata, source references (URLs/IDs), and scores | Rewrite DynamoDB schema; replace artifact blobs with source pointers. Do this first — everything else depends on it. | High ⚠️ | P1 |
| Quality scoring at gates | No quality signal → automated LLM scoring gates cannot pass below threshold | Bedrock scores transcripts/artifacts → score written to DynamoDB → gate block applied. Strict order: inputs → scoring model → gate enforcement | High ⚠️ | P1 |
| Automated project init | Manual setup → one-click provisioning | On project creation: EventBridge/Step Functions creates GitHub repo (with .kiro gitignore baked in), Teams folder structure, Slack channel, pulls Oscar SOW context, generates preliminary SRS. Key: Clockify project ID as the identity anchor | High ⚠️ | P1 |
| PMO features (assignment/status views) | Active tooling with manual input → read-only auto-populated views | Pull from GitHub events + Clockify + governance events. No write paths. | Medium | P2 |
| Weekly status report form | Manual weekly entry → auto-prefilled draft for human confirmation | Only viable once the auto-prefill exists. Defer until then. | Medium | P3 |
| Micro/macro gate distinction | Two-class model (AI-generated vs human) → single ownership model | All artifacts are owned by people regardless of how they were generated. Remove the class distinction from the UI and the data model. | Low | P1 |
| IPR meeting tracking | Nayab manually tracks in Jira → Nayab logs in DeliverPro; system auto-fetches last IPR Avoma transcript | Nayab marks "IPR occurred for [project]"; system queries Avoma by naming convention + Clockify project ID and scores the transcript | Medium | P2 |

---

## What to ADD

| Item | Description | How-To | Complexity | Priority |
|---|---|---|---|---|
| GitHub OIDC enforcement | Gates cannot be bypassed from CI | Validate OIDC tokens at the MCP boundary; reject unauthenticated/bypass calls | Medium | P1 |
| FusionAuth OIDC integration | Identity for humans and agents (Cloudelligent partner, preferred) | Integrate FusionAuth as the OIDC issuer; validate tokens at the MCP layer | Medium | P1 |
| Avoma → project ID association | Auto-match meetings to projects without manual link entry | Enforce a meeting naming convention (project key in title) + use Clockify project ID as partition key; Avoma API queries by name pattern | Medium | P1 |
| Meeting naming convention enforcement | Meetings must be named to a standard for auto-matching to work | Roll out naming convention as part of CASDM; PM training; Nausheen owns the rollout | Low | P1 |
| Append-only audit history | Immutable event trail for compliance | DynamoDB append-only event streams; deny update/delete on governance events | Medium | P2 |
| Escalations module | Auto-escalate blocked or overdue gates | EventBridge rules on gate state + Slack/email notification path | Medium | P2 |
| Folder/structure enforcement | Fail a gate if required folder structure is missing | Validate at gate time via GitHub API; fail the gate on violation | Low–Medium | P2 |
| Executive check-in views | Auto-populated exec-level summary per phase | Read-only views sourced from governance events; no new data entry | Low | P3 |
| Lessons-learned database | Capture retro insights keyed to project | New store populated from retrospective transcript scoring | Medium | P3 |
| Agent Core / Strands migration | Move agent runtime to Agent Core for proper loop orchestration (hallucination gates, review loops) | Phased migration; Strands SDK for the aws-architect → plan-reviewer loop; MCP still used for AWS Pricing | High | P2 |

---

## Methodology / CASDM Process Updates

- **IP protection in Phase Zero** (Tariq): Add a mandatory step — create internal Cloudelligent repo with `.gitignore` excluding `.kiro/`. Never ship the `.kiro` folder to customer repos. Applies to all brownfield/App Mod projects.
- **Meeting naming convention**: Standardize Avoma meeting titles (must include project key). Nausheen to roll out as part of CASDM training.
- **Remove micro/macro gate distinction** from all documentation. Single ownership model — all artifacts are human-owned.
- **Governance-as-layer** principle: Add explicit language clarifying DeliverPro records metadata/scores, not artifacts. Artifacts live at source (Teams for docs, GitHub for code, Avoma for transcripts).
- **App Dev + App Mod training**: Combine into one training with two visible tracks. Not two separate documents.
- **Phase Zero automation** step: Document that project init (GitHub repo, Teams folder, Slack channel, preliminary SRS) is automated by DeliverPro on project creation.
- **Discovery phase differences**: App Mod has additional discovery steps (codebase review, regression test check, current state architecture). Document this as a visible fork in Phase 1 — same methodology, different path.

---

## Stakeholder Conflict Notes

| Topic | Chris's View | Qasim's View | Recommended Resolution |
|---|---|---|---|
| Weekly status form | Wants it — a standard form submitted weekly per project | Anti-pattern — more manual clicking, same as Jira | Build only when auto-prefilled. Human confirms a draft, never types cold. Defer to P3. |
| Manual acknowledgment | OK with some human confirmation steps to prove a human reviewed something | Not OK with anything that requires coming back to a screen and clicking | Resolve by: scoring proves a human *interacted* with the artifact (e.g., Avoma shows them in the call); only require manual input where no programmatic signal exists |
| PMO tooling depth | Wants active project management in the platform | Wants passive governance layer only | Build read-only auto-populated views for Chris's PMO use cases. No write paths. |

---

## Implementation Sequence

1. **Governance-as-layer data model** — Rewrite DynamoDB schema first. Everything depends on this. *(P1, High ⚠️)*
2. **Remove binary gates + manual evidence uploads** — Quick, immediate credibility with Qasim. *(P1, Low)*
3. **FusionAuth OIDC → GitHub OIDC bypass prevention** — Identity before enforcement. *(P1, Medium)*
4. **Quality scoring chain** — Bedrock scoring → gate enforcement. Strict dependency on #1 and #3. *(P1, High ⚠️)*
5. **Automated project init** — GitHub repo + Teams folder + preliminary SRS from Oscar. Key on Clockify project ID. *(P1, High ⚠️)*
6. **Meeting naming convention rollout + Avoma association** — Enables auto-fetch of IPR and other key meetings. *(P1, Low-Medium)*
7. **IPR epic, escalations, folder enforcement, append-only history, PMO read views** *(P2)*
8. **Agent Core / Strands migration** *(P2, High — do after P1 is stable)*
9. **Exec check-ins, lessons-learned DB, weekly status form** *(P3)*

---

**Watch items (P1 + High complexity):** governance data model, quality scoring chain, and automated project init — all three are on the critical path and are the largest engineering risk.
