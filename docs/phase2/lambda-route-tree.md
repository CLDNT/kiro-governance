# DeliverPro Phase 2 — Lambda Route Tree

Auto-generated from `infra/stacks/deliverpro-lambdas-stack.ts`

## API Structure

All routes require Cognito authorization (Bearer token in `Authorization` header).

```
/api
├── /projects                                   [projects domain]
│   ├── GET                    → list-projects
│   ├── POST                   → create-project
│   ├── /import-jira
│   │   └── POST               → import-jira
│   └── /{projectId}
│       ├── GET                → get-project
│       ├── PATCH              → update-project
│       ├── /checklist
│       │   ├── GET            → list-checklist
│       │   └── /{itemId}
│       │       └── PATCH      → update-checklist-item
│       ├── /hours
│       │   └── PATCH          → update-hours
│       ├── /close
│       │   └── POST           → close-project
│       ├── /reopen
│       │   └── POST           → reopen-project
│       ├── /gates             [gates domain]
│       │   └── GET            → get-gates
│       ├── /checkpoints       [gates domain]
│       │   └── /{checkpointId}
│       │       ├── PATCH      → complete-checkpoint
│       │       ├── /evidence
│       │       │   ├── GET    → list-evidence
│       │       │   └── POST   → attach-evidence
│       │       └── /notes
│       │           ├── GET    → list-notes
│       │           └── POST   → add-note
│       ├── /artifacts         [gates domain]
│       │   └── /{artifactId}
│       │       └── PATCH      → update-artifact
│       ├── /status-logs       [meetings domain]
│       │   ├── GET            → list-status-logs
│       │   └── POST           → create-status-log
│       ├── /escalations       [meetings domain]
│       │   ├── GET            → list-escalations
│       │   ├── POST           → create-escalation
│       │   └── /{escalationId}
│       │       └── /resolve
│       │           └── POST   → resolve-escalation
│       └── /discovery-sessions [meetings domain]
│           ├── GET            → list-discovery-sessions
│           └── POST           → create-discovery-session
│
├── /files                                      [files domain]
│   ├── /upload-url
│   │   └── POST               → upload-url
│   └── /download-url
│       └── POST               → download-url
│
├── /admin                                      [config domain]
│   ├── /config
│   │   ├── GET                → get-config
│   │   ├── /phases
│   │   │   └── POST           → add-phase
│   │   ├── /items
│   │   │   ├── POST           → add-item
│   │   │   └── /{itemId}
│   │   │       ├── PATCH      → update-item
│   │   │       └── /deactivate
│   │   │           └── POST   → deactivate-item
│   │   ├── /project-types
│   │   │   └── GET            → list-project-types
│   │   └── /copy-template
│   │       └── POST           → copy-template
│   └── /prompts               [config domain]
│       ├── GET                → list-prompts
│       └── /{checkpointName}
│           └── PUT            → update-prompt
│
└── /analysis                                   [analysis domain]
    └── /{projectId}
        └── /{checkpointId}
            ├── /fetch-transcript
            │   └── POST       → fetch-transcript (90s timeout)
            └── /analyze
                └── POST       → analyze-transcript (90s timeout)
```

## Lambda Function Inventory

| Domain | Handler File | Runtime Config | Handler Class |
|--------|--------------|----------------|---------------|
| **PROJECTS** | | | |
| | `list-projects.ts` | 30s timeout, 512MB | ProjectsList |
| | `create-project.ts` | 30s timeout, 512MB | ProjectsCreate |
| | `get-project.ts` | 30s timeout, 512MB | ProjectsGet |
| | `update-project.ts` | 30s timeout, 512MB | ProjectsUpdate |
| | `import-jira.ts` | 30s timeout, 512MB | ProjectsImportJira |
| | `list-checklist.ts` | 30s timeout, 512MB | ProjectsChecklistList |
| | `update-checklist-item.ts` | 30s timeout, 512MB | ProjectsChecklistUpdate |
| | `update-hours.ts` | 30s timeout, 512MB | ProjectsUpdateHours |
| | `close-project.ts` | 30s timeout, 512MB | ProjectsClose |
| | `reopen-project.ts` | 30s timeout, 512MB | ProjectsReopen |
| **GATES** | | | |
| | `get-gates.ts` | 30s timeout, 512MB | GatesGet |
| | `complete-checkpoint.ts` | 30s timeout, 512MB | GatesComplete |
| | `list-evidence.ts` | 30s timeout, 512MB | GatesEvidenceList |
| | `attach-evidence.ts` | 30s timeout, 512MB | GatesEvidenceAttach |
| | `list-notes.ts` | 30s timeout, 512MB | GatesNotesList |
| | `add-note.ts` | 30s timeout, 512MB | GatesNotesAdd |
| | `update-artifact.ts` | 30s timeout, 512MB | GatesArtifactUpdate |
| **FILES** | | | |
| | `upload-url.ts` | 30s timeout, 512MB | FilesUploadUrl |
| | `download-url.ts` | 30s timeout, 512MB | FilesDownloadUrl |
| | `extract-metadata.ts` | 30s timeout, 512MB | FilesExtractMetadata |
| **MEETINGS** | | | |
| | `list-status-logs.ts` | 30s timeout, 512MB | MeetingsStatusLogList |
| | `create-status-log.ts` | 30s timeout, 512MB | MeetingsStatusLogCreate |
| | `list-escalations.ts` | 30s timeout, 512MB | MeetingsEscalationList |
| | `create-escalation.ts` | 30s timeout, 512MB | MeetingsEscalationCreate |
| | `resolve-escalation.ts` | 30s timeout, 512MB | MeetingsEscalationResolve |
| | `list-discovery-sessions.ts` | 30s timeout, 512MB | MeetingsDiscoveryList |
| | `create-discovery-session.ts` | 30s timeout, 512MB | MeetingsDiscoveryCreate |
| **CONFIG** | | | |
| | `config.ts` (get, phases, items) | 30s timeout, 512MB | ConfigGet, ConfigAddPhase, ConfigAddItem, ConfigUpdateItem, ConfigDeactivateItem, ConfigListProjectTypes, ConfigCopyTemplate |
| | `prompts.ts` (list, update) | 30s timeout, 512MB | ConfigListPrompts, ConfigUpdatePrompt |
| **ANALYSIS** | | | |
| | `fetch-transcript.ts` | **90s timeout**, 512MB | AnalysisFetchTranscript |
| | `analyze-transcript.ts` | **90s timeout**, 512MB | AnalysisAnalyzeTranscript |

## Environment Variables (All Lambdas)

```env
DB_ENDPOINT=kirogovernancestack-governancedb222ac1c0-n7kkv2ltc0oe.cxuu7do6zxik.us-east-1.rds.amazonaws.com
DB_PORT=5432
DB_NAME=kiro_governance
DB_USER=kiro_mcp
AWS_ACCOUNT_ID=<injected-at-deploy>
EVIDENCE_BUCKET=<injected-from-stateful-stack>
NODE_ENV=dev|prod
```

## Authorization

- **Header**: `Authorization: Bearer {cognito-id-token}`
- **Authorizer**: Cognito User Pool
- **Applied to**: All 60+ routes
- **Enforcement**: API Gateway validates token before Lambda invocation

## Key Metrics

| Metric | Count |
|--------|-------|
| Total Lambdas | 35 |
| Total Routes | 60+ |
| Domains | 7 |
| Standard Timeout (30s) | 33 handlers |
| Extended Timeout (90s) | 2 handlers (analysis) |
| Memory per Lambda | 512MB |
| Architecture | ARM64 (Graviton) |

## References

- **Architecture**: `docs/phase2/auth-architecture.md` §3, §6
- **Implementation Spec**: `DP-01 spec` §2
- **Code Structure**: `docs/code-structure.md` §10
- **Stack File**: `infra/stacks/deliverpro-lambdas-stack.ts`
- **Main Stack**: `infra/stacks/deliverpro-stack.ts`
