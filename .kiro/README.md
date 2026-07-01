# Kiro Agent Setup

## Agent Orchestration Model

This project uses a multi-agent orchestration approach where specialized AI agents collaborate through a central orchestrator to deliver software from requirements to implementation.

### Agent Team

| Agent                   | Role                                                              | Phase         |
| ----------------------- | ----------------------------------------------------------------- | ------------- |
| **Orchestrator**        | Central dispatcher — routes work, enforces gates, tracks progress | All phases    |
| **Product Analyst**     | Creates SRS from meeting notes and customer docs                  | Phase 0–1     |
| **AWS Architect**       | Reviews SRS, designs architecture, creates data model             | Phase 1–2     |
| **Plan Reviewer**       | Validates architecture, edge cases, cross-feature consistency     | Phase 2–3     |
| **Security Reviewer**   | Security + compliance + Well-Architected review                   | Phase 2 gates |
| **Technical PM**        | Sprint planning, JIRA backlog, timeline estimation                | Phase 2–3     |
| **Backend Developer**   | Implements Lambda handlers, services, DB migrations               | Phase 3       |
| **Frontend Developer**  | Implements UI components, hooks, pages                            | Phase 3       |
| **Construct Developer** | Implements CDK constructs and infrastructure                      | Phase 3       |

### Delivery Workflow

```
Phase 0: Internal Preparation
  └─ Determine project type: Greenfield (App Dev) or Modernization/Integration (App Mod)
  └─ Search meetings for HIPAA/SOC2/PCI-DSS/CCPA
  └─ Prompt customer if compliance unclear

Phase 1: Discover & Align
  └─ Product Analyst creates SRS (every FR has a Source tag)
  └─ [H1 GATE] Product Analyst self-audits: every FR has exact customer quote,
       no invented constraints, architect decisions labeled
  └─ AWS Architect reviews (traceability, completeness, ACs, NFRs)
       ← AWS Architect is SOLE reviewer for all client-facing docs (SRS, questionnaires)
       ← Plan Reviewer is NOT used for client-facing docs
  └─ Iterate until all gaps resolved → SRS approved (no round cap)

Phase 2: Design & Review (sequential, gated)
  [Modernization projects only — insert before Step 1:]
  Step 0: As-built discovery        → infrastructure inventory + codebase review
                                       + IaC health check + open assumption resolution
                                       GATE: all four items complete before Step 1 starts
                                       (Steps 1 and 2 may run in parallel with Step 0)

  Step 1: Domain decomposition     → Plan Reviewer + Product Analyst
  Step 2: Feature list             → Plan Reviewer + Product Analyst
  Step 3: Per-feature arch docs    → Plan Reviewer (+ edge cases)
                                       [Modernization: each doc needs Current State + Target State]
  [H2 GATE] After all domain docs approved, before Security Gate 1:
       AWS Architect self-audits: every resource traces to SRS FR,
       cross-domain interfaces consistent, no features without SRS basis
  Step 4: Security Gate 1          → Security Reviewer
  Step 5: Unified data model       → Plan Reviewer + Security Reviewer
  Step 5a: Security Gate 1.5       → Security Reviewer (data model PII/RLS/encryption)
  Step 6: Architecture diagram     → Plan Reviewer
                                       [draw.io XML only — never old MCP tool]
                                       [badges: parent="1", never inside containers]
                                       [no round cap — iterate until APPROVED]
  Step 7: Security Gate 2          → Security Reviewer (Well-Architected)
  Step 8: Cost estimate            → Plan Reviewer

Phase 3: Build & Implement
  └─ Technical PM asks for team size
  └─ Creates implementation strategy + JIRA backlog CSV
  └─ Dual timeline: spec-based vs traditional development
  └─ [H3 GATE] Technical PM self-audits: every AC traces to arch doc,
       no invented thresholds, no scope additions
  └─ [H3 GATE] Operational access check: if backlog includes VPC-isolated resources
       (databases, search clusters, caches), verify a developer access story exists
       (bastion host / SSM tunnel) — add one before the first story requiring direct access
  └─ AWS Architect reviews technical accuracy
  └─ Plan Reviewer validates capacity and dependencies

Phase 4: Launch & Enable
  └─ [H4 GATE] Orchestrator checks every AC traces to arch doc before dispatching
  └─ Orchestrator dispatches stories from approved backlog
  └─ Backend/Frontend/Construct developers implement
  └─ Code Reviewer reviews completed implementation

Deliverables (docx)
  └─ Use docx-generation skill for any .md → Word conversion
  └─ Run pre-conversion checklist before pandoc (fix tight lists, wide tables)
  └─ Output → output/ folder
```

### Key Rules

- **Spec-based development** — all code is generated from architecture specs by Kiro agents
- **Source traceability** — every FR must trace to a customer meeting or document. No hallucinated requirements.
- **SRS review rounds** — unlimited; iterate with AWS Architect until all gaps from original requirements are resolved
- **Max 3 review rounds** per all other steps — then escalate to human
- **Approval threshold** — zero Critical/High findings to pass any gate
- **Session resumption** — `docs/project-progress.md` tracks which step is current. New sessions read this file and resume.
- **Cost-conscious** — reuse existing infrastructure, prefer serverless, justify every new AWS service

---

## How to Use This Workflow (kiro-cli)

### Starting a Session

```bash
kiro-cli chat
```

This opens a chat with the **Orchestrator** agent. The orchestrator automatically:

1. Reads `docs/project-progress.md` to find where you left off
2. Resumes from the first unchecked step
3. Delegates work to specialized subagents as needed

You never talk to subagents directly — everything goes through the orchestrator.

### Typical Conversation Flow

**Starting a new project:**

```
You: We have a new project. Here are the meeting notes: [paste or reference files]
Orchestrator: [reads notes, runs compliance check, delegates to product-analyst to create SRS]
```

**Resuming work:**

```
You: [just open kiro-cli chat]
Orchestrator: Resuming from Phase 2 Step 3 — per-feature architecture docs.
              Last completed: domain decomposition (Apr 2). Next: feature list review.
```

**Handling new requirements:**

```
You: Josh sent new feedback. File is at .kiro/knowledge/uww-docs/feedback.txt
Orchestrator: [reads file, runs change request workflow, produces impact analysis]
```

**Asking about status:**

```
You: What's the sprint 2 status?
Orchestrator: [reads backlog CSV and implementation strategy, summarizes]
```

**Triggering specific work:**

```
You: Make E3-S05 spec-ready
Orchestrator: [checks architecture doc, delegates to aws-architect if gaps exist,
              then security-reviewer if security-related, then adds to backlog]
```

### How the Knowledge Base Works

Customer documents (meeting transcripts, PDFs, CSVs) are indexed in `.kiro/knowledge/`. The orchestrator and subagents use semantic search to find relevant content without you having to specify which file to look in.

```
.kiro/knowledge/
  uww-docs/
    Documentation/
      meetings/          ← meeting transcripts
      customer-provided/ ← PDFs, CSVs, specs from customer
```

To add new customer documents, place them in the appropriate subfolder. The knowledge base re-indexes automatically.

### How Subagent Delegation Works

When you ask the orchestrator to do something, it:

1. Determines which specialized agent(s) are needed
2. Invokes them via `use_subagent` with full context
3. Routes their output to a reviewer agent
4. Returns the final result to you

You see a summary of what each agent did. If a review fails, the orchestrator iterates automatically (up to 3 rounds) before escalating to you.

### When the Orchestrator Escalates to You

The orchestrator will stop and ask for your input when:

- A review round limit (3) is exceeded with unresolved findings (SRS has no round cap — escalate only if architect explicitly cannot resolve a gap)
- A stakeholder decision is needed (options presented, you choose)
- A questionnaire answer is required before work can proceed
- A Critical/High finding cannot be resolved without architectural changes

### Project State Files

| File                                        | Purpose                                              |
| ------------------------------------------- | ---------------------------------------------------- |
| `docs/project-progress.md`                  | Current phase and step — read on every session start |
| `docs/sprint-planning/jira-backlog.csv` | All stories, sprint assignments, dependencies        |
| `docs/srs.md`                    | Living requirements document                         |
| `docs/data-model.md`                    | Living data model                                    |
| `docs/change-requests/`                     | Impact analyses and stakeholder decisions            |
| `docs/srs-questionnaire.md`                 | All stakeholder questions and resolved answers       |

---

## Code Structure Doc (`docs/code-structure.md`)

This is the **most referenced file in the entire workflow** — 9 out of 11 agents load it as a resource. It is the single source of truth for:

- Monorepo folder layout and domain boundaries
- Lambda handler patterns and naming conventions
- CDK stack design (StatefulStack vs StatelessStack)
- Frontend page/component/hook structure
- Shared types and middleware patterns
- Domain isolation rules (what can import what)

### When It Must Exist

`docs/code-structure.md` must exist **before Phase 4 (implementation) begins**. Every spec a developer agent writes references it. Every code review validates against it.

### How It Gets Created

The AWS Architect creates it during Phase 2 architecture work:

1. If starting a new project — architect copies `.kiro/steering/code-structure-template.md` and fills in project-specific details
2. If rebuilding an existing system — architect reads the legacy codebase and documents the new structure

### What Happens Without It

If `docs/code-structure.md` is missing when a developer agent is invoked:

- The agent will look for it, not find it
- It will fall back to `.kiro/steering/code-structure-template.md` (generic)
- Generated code may not match your actual project structure

**Always ensure `docs/code-structure.md` exists and is up to date before starting Phase 4.**

### Steering Files

| File                                         | Purpose                                                |
| -------------------------------------------- | ------------------------------------------------------ |
| `.kiro/steering/orchestrator-standards.md`   | Delivery workflow, agent routing, compliance rules     |
| `.kiro/steering/aws-architect-standards.md`  | Architecture rules, SRS review checklist, traceability |
| `.kiro/steering/product-analyst-standard.md` | SRS writing standards, source traceability             |
| `.kiro/steering/reviewer-standards.md`       | Plan reviewer quality gates                            |
| `.kiro/steering/lambda-docs.md`              | Lambda documentation three-tier standard               |
| `.kiro/steering/code-structure-template.md`  | Generic code structure template for new projects       |

---

## Skills

Skills are reusable capability modules in `.kiro/skills/`. Each skill has a `SKILL.md` with instructions agents follow when using that capability.

| Skill | Location | Purpose |
|-------|----------|---------|
| **docx-generation** | `.kiro/skills/docx-generation/` | Convert `.md` files to Word `.docx` using pandoc. Includes pre-conversion checklist, formatting rules for Word output, and reference templates. |
| **aws-architecture-diagram-references** | `.kiro/skills/aws-architecture-diagram-references/` | draw.io XML templates, AWS shape libraries, layout guidelines for architecture diagrams. |

### docx-generation Skill

Converts any markdown file to a Word document. Key rules:

- Always use `reference-landscape.docx` (landscape, 0.75" margins) — better for wide tables
- **Run the pre-conversion checklist before every pandoc call** — fix tight bullet lists, bullets after code blocks, and wide tables in the source `.md` first
- Output always goes to `output/`

```bash
pandoc docs/file.md \
  --reference-doc=.kiro/skills/docx-generation/references/reference-landscape.docx \
  -o output/file.docx
```

---

## Quality Gates & Hallucination Prevention

The delivery workflow enforces four hallucination gates to prevent invented requirements, architect decisions, and unverified acceptance criteria from entering the project.

| Gate | When It Runs | What It Checks |
|------|-------------|----------------|
| **H1 — SRS Self-Audit** | After product-analyst writes SRS, before architect review | Every FR has a `Source:` tag with exact customer quote. No invented constraints. Specific numbers labeled as architect decisions. |
| **H2 — Architecture Self-Audit** | After all domain docs approved, before Security Gate 1 | Every endpoint/table/resource traces to an SRS FR. Cross-domain interfaces are consistent. No features added without SRS basis. |
| **H3 — Backlog Self-Audit** | After technical-pm creates backlog, before architect review | Every AC bullet traces to an architecture doc section. No invented thresholds or scope additions. |
| **H4 — Pre-Spec AC Check** | Before orchestrator dispatches any story | Every AC bullet in the story traces to the architecture doc. No AC adds behaviour beyond the doc. |

**Flag formats:**
- Unverified SRS item: `⚠️ UNVERIFIED (no customer source): [description]`
- Architect decision: `⚠️ ARCHITECT DECISION (no customer source): [description]`
- Unverified AC: `⚠️ UNVERIFIED AC (no arch doc source): [description]`
- AC not in arch doc: `⚠️ AC NOT IN ARCH DOC: [story ID] — [AC bullet] — not found in [arch doc section]`

### Client-Facing Document Review Rule

**AWS Architect is the sole reviewer for all client-facing documents** (SRS, kickoff questionnaire, technical scope docs, open questions). Plan Reviewer is NOT used for client-facing docs — only for architecture docs, backlog, and implementation specs.

### draw.io Diagram Rules

- Never use the old MCP tool for AWS architecture diagrams — aws-architect produces raw draw.io XML directly
- Every diagram must be reviewed by plan-reviewer before it is final
- Badge placement: all badges must have `parent="1"` (root), never inside a container
- No round cap on diagram fix iterations — keep iterating until plan-reviewer issues APPROVED

---

The MCP servers (pricing, diagrams, documentation) require valid AWS credentials.

### 1. Configure SSO

```bash
aws configure sso
```

When prompted:

- **SSO start URL**: `https://d-906778ee70.awsapps.com/start`
- **SSO region**: `us-east-1`

Pick your account and role, then note the profile name it creates.

### 2. Set your profile

Add to your `~/.bashrc` or `~/.zshrc`:

```bash
export AWS_PROFILE=<your-sso-profile>
```

### 3. Login before using Kiro

```bash
aws sso login
```

---

## Installing uvx (WSL / Linux)

The agent MCP servers auto-install `uvx` if missing, but if you need to install it manually:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Then add to your `~/.bashrc`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Reload your shell:

```bash
source ~/.bashrc
```

Verify:

```bash
uvx --version
```

### WSL-specific notes

- Make sure `curl` is installed: `sudo apt install -y curl`
- If you're behind a corporate proxy, set `HTTPS_PROXY` before running the install script
- The install goes to `~/.local/bin` inside WSL, not your Windows PATH — this is expected
