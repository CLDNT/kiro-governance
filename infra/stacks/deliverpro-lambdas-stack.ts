import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambda_nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { Construct } from 'constructs';

/**
 * DeliverPro Phase 2 Lambda Functions & API Gateway Routes
 * 
 * This NestedStack creates all 35 Lambda functions and their API Gateway routes.
 * 
 * Domains:
 * - projects: 9 handlers (list, create, get, update, etc.)
 * - gates: 8 handlers (checkpoint management, evidence, notes, timeline)
 * - files: 3 handlers (upload, download URLs, metadata extraction)
 * - meetings: 7 handlers (discovery sessions, escalations, status logs)
 * - config: 5 handlers (project config, phases, items, templates, prompts)
 * - analysis: 2 handlers (transcript fetching and analysis)
 * - reporting: 2 handlers (summary, timeline) — backend only, no Lambda yet
 * 
 * Architecture reference: docs/phase2/auth-architecture.md §3, §6
 * Spec reference: DP-01 spec §2
 */
export interface DeliverProLambdasStackProps {
  restApi: apigateway.RestApi;
  cognitoAuthorizer: apigateway.CognitoUserPoolsAuthorizer;
  lambdaBaseRole: iam.IRole;
  /** Dedicated role for projects-linkage Lambdas (create/update/sync-gates) — GitHub read-token only. */
  projectsLinkageRole: iam.IRole;
  /** Dedicated role for the Slack channel-provisioning Lambda — provisioning-token only. */
  provisioningRole: iam.IRole;
  /** Dedicated role for the gates macro-notify Lambda — reads the MCP api-key SecureString ONLY. */
  gatesNotifyRole: iam.IRole;
  dbEndpoint: string;
  dbName: string;
  dbUser: string;
  evidenceBucketName: string;
  environment: 'dev' | 'prod';
  vpc?: ec2.IVpc;
  vpcSubnets?: ec2.SubnetSelection;
  lambdaSecurityGroup?: ec2.ISecurityGroup;
  /** CR-16: approved GitHub org owner (fallback + allowlist seed). Optional. */
  githubDefaultOwner?: string;
  /** CR-16: comma-separated approved GitHub owners (H1 allowlist). Optional. */
  githubAllowedOwners?: string;
  /** Gap B: MCP server endpoint (in-VPC private IP) for the app-owned MACRO notify_slack call. */
  mcpServerUrl: string;
  /** Gap B: SSM parameter PATH holding the MCP API key SecureString (read at runtime, never in env). */
  mcpApiKeySsmParam: string;
  /** Gap B: MCP self-signed cert SHA-256 fingerprint (non-secret; injected as an env var for TLS pinning). */
  mcpCertFingerprint: string;
}

export class DeliverProLambdasStack extends Construct {
  /**
   * Map of handler name to Lambda function (for reference/debugging)
   */
  public readonly handlers: Record<string, lambda_nodejs.NodejsFunction> = {};

  constructor(scope: Construct, id: string, props: DeliverProLambdasStackProps) {
    super(scope, id);

    const accountId = cdk.Stack.of(this).account;
    const environment = props.environment ?? 'dev';

    // ==================== Lambda Base Configuration ====================
    const lambdaConfig = {
      entry: '', // Set per handler
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      role: props.lambdaBaseRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        DB_ENDPOINT: props.dbEndpoint,
        DB_PORT: '5432',
        DB_NAME: props.dbName,
        DB_USER: props.dbUser,
        AWS_ACCOUNT_ID: accountId,
        EVIDENCE_BUCKET: props.evidenceBucketName,
        NODE_ENV: environment,
        // CR-16 gate-sync config (non-secret). The GitHub READ token itself is read from SSM
        // (path fixed in github.service); only the owner allowlist/default is injected here.
        ...(props.githubDefaultOwner ? { GITHUB_DEFAULT_OWNER: props.githubDefaultOwner } : {}),
        ...(props.githubAllowedOwners ? { GITHUB_ALLOWED_OWNERS: props.githubAllowedOwners } : {}),
      },
      bundling: {
        // Bundle pg into the Lambda — no layer available
        // Only exclude AWS SDK (provided by Lambda runtime)
        externalModules: ['@aws-sdk/*'],
        forceDockerBundling: false,
        nodeModules: ['pg'],
      },
    };

    // ==================== Helper: Create Lambda Function ====================
    const createLambda = (
      id: string,
      handlerPath: string,
      timeout?: number,
      role?: iam.IRole,
    ): lambda_nodejs.NodejsFunction => {
      const func = new lambda_nodejs.NodejsFunction(this, id, {
        ...lambdaConfig,
        entry: handlerPath,
        role: role ?? props.lambdaBaseRole,
        timeout: timeout ? cdk.Duration.seconds(timeout) : lambdaConfig.timeout,
        ...(props.vpc && {
          vpc: props.vpc,
          vpcSubnets: props.vpcSubnets ?? { subnetType: ec2.SubnetType.PUBLIC },
          securityGroups: props.lambdaSecurityGroup ? [props.lambdaSecurityGroup] : [],
          allowPublicSubnet: true,
        }),
      });
      this.handlers[id] = func;
      return func;
    };

    // ==================== Helper: Add API Route ====================
    const addRoute = (
      resource: apigateway.IResource,
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      handler: lambda_nodejs.NodejsFunction,
    ): void => {
      resource.addMethod(method, new apigateway.LambdaIntegration(handler), {
        authorizer: props.cognitoAuthorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      });
    };

    // ==================== 1. PROJECTS DOMAIN (9 handlers) ====================
    const projectsListFn = createLambda(
      'ProjectsList',
      path.join(__dirname, '../../packages/projects/handlers/list-projects.ts'),
    );
    const projectsCreateFn = createLambda(
      'ProjectsCreate',
      path.join(__dirname, '../../packages/projects/handlers/create-project.ts'),
      undefined,
      props.projectsLinkageRole, // CR-16 best-effort link-time GitHub sync
    );
    const projectsGetFn = createLambda(
      'ProjectsGet',
      path.join(__dirname, '../../packages/projects/handlers/get-project.ts'),
    );
    const projectsUpdateFn = createLambda(
      'ProjectsUpdate',
      path.join(__dirname, '../../packages/projects/handlers/update-project.ts'),
      undefined,
      props.projectsLinkageRole, // CR-16 best-effort link-time GitHub sync
    );
    const projectsImportJiraFn = createLambda(
      'ProjectsImportJira',
      path.join(__dirname, '../../packages/projects/handlers/import-jira.ts'),
    );
    const projectsChecklistListFn = createLambda(
      'ProjectsChecklistList',
      path.join(__dirname, '../../packages/projects/handlers/list-checklist.ts'),
    );
    const projectsChecklistUpdateFn = createLambda(
      'ProjectsChecklistUpdate',
      path.join(__dirname, '../../packages/projects/handlers/update-checklist-item.ts'),
    );
    const projectsUpdateHoursFn = createLambda(
      'ProjectsUpdateHours',
      path.join(__dirname, '../../packages/projects/handlers/update-hours.ts'),
    );
    const projectsCloseFn = createLambda(
      'ProjectsClose',
      path.join(__dirname, '../../packages/projects/handlers/close-project.ts'),
    );
    const projectsReopenFn = createLambda(
      'ProjectsReopen',
      path.join(__dirname, '../../packages/projects/handlers/reopen-project.ts'),
    );

    // Routes: /api/projects
    const apiResource = props.restApi.root.addResource('api');
    const projectsResource = apiResource.addResource('projects');
    addRoute(projectsResource, 'GET', projectsListFn);
    addRoute(projectsResource, 'POST', projectsCreateFn);

    // Routes: /api/projects/import-jira
    const projectsImportJiraResource = projectsResource.addResource('import-jira');
    addRoute(projectsImportJiraResource, 'POST', projectsImportJiraFn);

    // Routes: /api/projects/{projectId}
    const projectIdResource = projectsResource.addResource('{projectId}');
    addRoute(projectIdResource, 'GET', projectsGetFn);
    addRoute(projectIdResource, 'PATCH', projectsUpdateFn);

    // Routes: /api/projects/{projectId}/checklist
    const checklistResource = projectIdResource.addResource('checklist');
    addRoute(checklistResource, 'GET', projectsChecklistListFn);

    // Routes: /api/projects/{projectId}/checklist/{itemId}
    const checklistItemResource = checklistResource.addResource('{itemId}');
    addRoute(checklistItemResource, 'PATCH', projectsChecklistUpdateFn);

    // Routes: /api/projects/{projectId}/hours
    const hoursResource = projectIdResource.addResource('hours');
    addRoute(hoursResource, 'PATCH', projectsUpdateHoursFn);

    // Routes: /api/projects/{projectId}/close
    const closeResource = projectIdResource.addResource('close');
    addRoute(closeResource, 'POST', projectsCloseFn);

    // Routes: /api/projects/{projectId}/reopen
    const reopenResource = projectIdResource.addResource('reopen');
    addRoute(reopenResource, 'POST', projectsReopenFn);

    // Routes: /api/projects/{projectId}/sync-gates (CR-16 — admin/leadership only, enforced in handler)
    const projectsSyncGatesFn = createLambda(
      'ProjectsSyncGates',
      path.join(__dirname, '../../packages/projects/handlers/sync-gates.ts'),
      undefined,
      props.projectsLinkageRole, // reads the GitHub read-token (single-ARN grant on this role)
    );
    const syncGatesResource = projectIdResource.addResource('sync-gates');
    addRoute(syncGatesResource, 'POST', projectsSyncGatesFn);

    // CR-05: Slack channel provisioning (admin/leadership only, enforced in handler).
    // Runs on the DEDICATED provisioning role — reads the Slack provisioning-token (channels:manage)
    // single-ARN ONLY, never the runtime bot-token or the GitHub read-token (SEC-M1 two-token split;
    // role↔secret-ARN matrix). Route: POST /api/projects/{projectId}/slack/provision.
    const projectsProvisionSlackFn = createLambda(
      'ProvisionSlackChannels',
      path.join(__dirname, '../../packages/projects/handlers/provision-slack-channels.ts'),
      undefined,
      props.provisioningRole,
    );
    const slackResource = projectIdResource.addResource('slack');
    const slackProvisionResource = slackResource.addResource('provision');
    addRoute(slackProvisionResource, 'POST', projectsProvisionSlackFn);

    // NOTE: The GitHub read-token and Slack provisioning-token SSM grants are attached to their
    // DEDICATED roles (projectsLinkageRole / provisioningRole) in stateless-stack.ts via the
    // SsmSecretGrant construct — NOT to the shared lambdaBaseRole. This enforces the CR-05/CR-16
    // matrix: each credential is readable by exactly one role, and the ~33 generic Lambdas on the
    // base role can read none of the three linkage secrets.

    // ==================== 2. GATES DOMAIN (8 handlers) ====================
    const gatesGetFn = createLambda(
      'GatesGet',
      path.join(__dirname, '../../packages/gates/handlers/get-gates.ts'),
    );
    const gatesCompleteFn = createLambda(
      'GatesComplete',
      path.join(__dirname, '../../packages/gates/handlers/complete-checkpoint.ts'),
      undefined,
      props.gatesNotifyRole, // Gap B: dedicated role that may read the MCP api-key SecureString ONLY
    );
    // Gap B: inject MCP env so the app-owned MACRO notify (complete-checkpoint → macro-notify.service
    // → mcp-client) reaches the in-VPC MCP server instead of no-op'ing with `mcp_not_configured`.
    // The API key is a SecureString read at RUNTIME from SSM (path below) on gatesNotifyRole — it is
    // deliberately NOT placed in an env var. See stateless-stack "Secret grant 3".
    gatesCompleteFn.addEnvironment('MCP_SERVER_URL', props.mcpServerUrl);
    gatesCompleteFn.addEnvironment('MCP_CERT_FINGERPRINT', props.mcpCertFingerprint);
    gatesCompleteFn.addEnvironment('MCP_API_KEY_SSM_PARAM', props.mcpApiKeySsmParam);
    // Option C: inject the MCP API key DIRECTLY as a plaintext env var (customer-confirmed the key
    // is stable and will not rotate). resolveMcpApiKey() checks process.env.MCP_API_KEY FIRST, so
    // when this is present the runtime SSM GetParameter read — and its 2 s abort path that was
    // stalling the notify — is skipped entirely. The value is supplied at deploy time via CDK
    // context (`-c mcpApiKey=...`) and is NEVER hardcoded in source. MCP_API_KEY_SSM_PARAM is kept
    // in place as a non-breaking fallback for environments deployed without the context value.
    const mcpApiKeyContext = this.node.tryGetContext('mcpApiKey');
    if (mcpApiKeyContext) {
      gatesCompleteFn.addEnvironment('MCP_API_KEY', mcpApiKeyContext);
    }
    const gatesEvidenceListFn = createLambda(
      'GatesEvidenceList',
      path.join(__dirname, '../../packages/gates/handlers/list-evidence.ts'),
    );
    const gatesEvidenceAttachFn = createLambda(
      'GatesEvidenceAttach',
      path.join(__dirname, '../../packages/gates/handlers/attach-evidence.ts'),
    );
    const gatesNotesListFn = createLambda(
      'GatesNotesList',
      path.join(__dirname, '../../packages/gates/handlers/list-notes.ts'),
    );
    const gatesNotesAddFn = createLambda(
      'GatesNotesAdd',
      path.join(__dirname, '../../packages/gates/handlers/add-note.ts'),
    );
    const gatesArtifactUpdateFn = createLambda(
      'GatesArtifactUpdate',
      path.join(__dirname, '../../packages/gates/handlers/update-artifact.ts'),
    );
    const gatesTimelineFn = createLambda(
      'GatesTimeline',
      path.join(__dirname, '../../packages/gates/handlers/project-timeline.ts'),
    );

    // Routes: /api/projects/{projectId}/gates
    const gatesResource = projectIdResource.addResource('gates');
    addRoute(gatesResource, 'GET', gatesGetFn);

    // Routes: /api/projects/{projectId}/timeline
    const gatesTimelineResource = projectIdResource.addResource('timeline');
    addRoute(gatesTimelineResource, 'GET', gatesTimelineFn);

    // Routes: /api/projects/{projectId}/checkpoints/{checkpointId}
    const checkpointsResource = projectIdResource.addResource('checkpoints');
    const checkpointIdResource = checkpointsResource.addResource('{checkpointId}');
    addRoute(checkpointIdResource, 'PATCH', gatesCompleteFn);

    // Routes: /api/projects/{projectId}/checkpoints/{checkpointId}/evidence
    const evidenceResource = checkpointIdResource.addResource('evidence');
    addRoute(evidenceResource, 'GET', gatesEvidenceListFn);
    addRoute(evidenceResource, 'POST', gatesEvidenceAttachFn);

    // Routes: /api/projects/{projectId}/checkpoints/{checkpointId}/notes
    const notesResource = checkpointIdResource.addResource('notes');
    addRoute(notesResource, 'GET', gatesNotesListFn);
    addRoute(notesResource, 'POST', gatesNotesAddFn);

    // Routes: /api/projects/{projectId}/artifacts/{artifactId}
    const artifactsResource = projectIdResource.addResource('artifacts');
    const artifactIdResource = artifactsResource.addResource('{artifactId}');
    addRoute(artifactIdResource, 'PATCH', gatesArtifactUpdateFn);

    // Routes: /api/projects/{projectId}/sync-artifacts (CR-12 — admin/leadership only, enforced in
    // handler). Level-2 micro-artifact reconcile: reads DB governance events only (no GitHub fetch),
    // so it runs on the shared base role (kiro_phase2 DB user) — no linkage/provisioning secret.
    const gatesSyncArtifactsFn = createLambda(
      'GatesSyncArtifacts',
      path.join(__dirname, '../../packages/gates/handlers/sync-artifacts.ts'),
    );
    const syncArtifactsResource = projectIdResource.addResource('sync-artifacts');
    addRoute(syncArtifactsResource, 'POST', gatesSyncArtifactsFn);

    // ==================== 3. FILES DOMAIN (3 handlers) ====================
    const filesUploadUrlFn = createLambda(
      'FilesUploadUrl',
      path.join(__dirname, '../../packages/files/handlers/upload-url.ts'),
    );
    const filesDownloadUrlFn = createLambda(
      'FilesDownloadUrl',
      path.join(__dirname, '../../packages/files/handlers/download-url.ts'),
    );
    const filesExtractMetadataFn = createLambda(
      'FilesExtractMetadata',
      path.join(__dirname, '../../packages/files/handlers/extract-metadata.ts'),
    );

    // Routes: /api/files/upload-url
    const filesResource = apiResource.addResource('files');
    const uploadUrlResource = filesResource.addResource('upload-url');
    addRoute(uploadUrlResource, 'POST', filesUploadUrlFn);

    // Routes: /api/files/download-url
    const downloadUrlResource = filesResource.addResource('download-url');
    addRoute(downloadUrlResource, 'POST', filesDownloadUrlFn);

    // Note: extract-metadata is for internal use (triggered by S3 event, not API)
    // Registered here for reference but no route

    // ==================== 4. MEETINGS DOMAIN (7 handlers) ====================
    const meetingsStatusLogListFn = createLambda(
      'MeetingsStatusLogList',
      path.join(__dirname, '../../packages/meetings/handlers/list-status-logs.ts'),
    );
    const meetingsStatusLogCreateFn = createLambda(
      'MeetingsStatusLogCreate',
      path.join(__dirname, '../../packages/meetings/handlers/create-status-log.ts'),
    );
    const meetingsEscalationListFn = createLambda(
      'MeetingsEscalationList',
      path.join(__dirname, '../../packages/meetings/handlers/list-escalations.ts'),
    );
    const meetingsEscalationCreateFn = createLambda(
      'MeetingsEscalationCreate',
      path.join(__dirname, '../../packages/meetings/handlers/create-escalation.ts'),
    );
    const meetingsEscalationResolveFn = createLambda(
      'MeetingsEscalationResolve',
      path.join(__dirname, '../../packages/meetings/handlers/resolve-escalation.ts'),
    );
    const meetingsDiscoveryListFn = createLambda(
      'MeetingsDiscoveryList',
      path.join(__dirname, '../../packages/meetings/handlers/list-discovery-sessions.ts'),
    );
    const meetingsDiscoveryCreateFn = createLambda(
      'MeetingsDiscoveryCreate',
      path.join(__dirname, '../../packages/meetings/handlers/create-discovery-session.ts'),
    );

    // Routes: /api/projects/{projectId}/status-logs
    const statusLogsResource = projectIdResource.addResource('status-logs');
    addRoute(statusLogsResource, 'GET', meetingsStatusLogListFn);
    addRoute(statusLogsResource, 'POST', meetingsStatusLogCreateFn);

    // Routes: /api/projects/{projectId}/escalations
    const escalationsResource = projectIdResource.addResource('escalations');
    addRoute(escalationsResource, 'GET', meetingsEscalationListFn);
    addRoute(escalationsResource, 'POST', meetingsEscalationCreateFn);

    // Routes: /api/projects/{projectId}/escalations/{escalationId}/resolve
    const escalationIdResource = escalationsResource.addResource('{escalationId}');
    const escalationResolveResource = escalationIdResource.addResource('resolve');
    addRoute(escalationResolveResource, 'POST', meetingsEscalationResolveFn);

    // Routes: /api/projects/{projectId}/discovery-sessions
    const discoverySessionsResource = projectIdResource.addResource('discovery-sessions');
    addRoute(discoverySessionsResource, 'GET', meetingsDiscoveryListFn);
    addRoute(discoverySessionsResource, 'POST', meetingsDiscoveryCreateFn);

    // ==================== 5. CONFIG DOMAIN (5 handlers) ====================
    const configGetFn = createLambda(
      'ConfigGet',
      path.join(__dirname, '../../packages/config/handlers/config.ts'),
    );
    const configAddPhaseFn = createLambda(
      'ConfigAddPhase',
      path.join(__dirname, '../../packages/config/handlers/config.ts'),
    );
    const configAddItemFn = createLambda(
      'ConfigAddItem',
      path.join(__dirname, '../../packages/config/handlers/config.ts'),
    );
    const configUpdateItemFn = createLambda(
      'ConfigUpdateItem',
      path.join(__dirname, '../../packages/config/handlers/config.ts'),
    );
    const configDeactivateItemFn = createLambda(
      'ConfigDeactivateItem',
      path.join(__dirname, '../../packages/config/handlers/config.ts'),
    );
    const configListProjectTypesFn = createLambda(
      'ConfigListProjectTypes',
      path.join(__dirname, '../../packages/config/handlers/config.ts'),
    );
    const configCopyTemplateFn = createLambda(
      'ConfigCopyTemplate',
      path.join(__dirname, '../../packages/config/handlers/config.ts'),
    );
    const configListPromptsFn = createLambda(
      'ConfigListPrompts',
      path.join(__dirname, '../../packages/config/handlers/prompts.ts'),
    );
    const configUpdatePromptFn = createLambda(
      'ConfigUpdatePrompt',
      path.join(__dirname, '../../packages/config/handlers/prompts.ts'),
    );

    // Routes: /api/admin/config
    const adminResource = apiResource.addResource('admin');
    const adminConfigResource = adminResource.addResource('config');
    addRoute(adminConfigResource, 'GET', configGetFn);

    // Routes: /api/admin/config/phases
    const phasesResource = adminConfigResource.addResource('phases');
    addRoute(phasesResource, 'POST', configAddPhaseFn);

    // Routes: /api/admin/config/items
    const itemsResource = adminConfigResource.addResource('items');
    addRoute(itemsResource, 'POST', configAddItemFn);

    // Routes: /api/admin/config/items/{itemId}
    const itemIdResource = itemsResource.addResource('{itemId}');
    addRoute(itemIdResource, 'PATCH', configUpdateItemFn);

    // Routes: /api/admin/config/items/{itemId}/deactivate
    const deactivateResource = itemIdResource.addResource('deactivate');
    addRoute(deactivateResource, 'POST', configDeactivateItemFn);

    // Routes: /api/admin/config/project-types
    const projectTypesResource = adminConfigResource.addResource('project-types');
    addRoute(projectTypesResource, 'GET', configListProjectTypesFn);

    // Routes: /api/admin/config/copy-template
    const copyTemplateResource = adminConfigResource.addResource('copy-template');
    addRoute(copyTemplateResource, 'POST', configCopyTemplateFn);

    // Routes: /api/admin/prompts
    const promptsResource = adminResource.addResource('prompts');
    addRoute(promptsResource, 'GET', configListPromptsFn);

    // Routes: /api/admin/prompts/{checkpointName}
    const checkpointNameResource = promptsResource.addResource('{checkpointName}');
    addRoute(checkpointNameResource, 'PUT', configUpdatePromptFn);

    // ==================== 6. ANALYSIS DOMAIN (2 handlers) ====================
    // Note: Analysis Lambdas have 90s timeout (vs 30s standard)
    const analysisFetchTranscriptFn = createLambda(
      'AnalysisFetchTranscript',
      path.join(__dirname, '../../packages/analysis/handlers/fetch-transcript.ts'),
      90,
    );
    const analysisAnalyzeTranscriptFn = createLambda(
      'AnalysisAnalyzeTranscript',
      path.join(__dirname, '../../packages/analysis/handlers/analyze-transcript.ts'),
      90,
    );

    // Routes: /api/analysis/{projectId}/{checkpointId}/fetch-transcript
    const analysisResource = apiResource.addResource('analysis');
    const analysisProjectIdResource = analysisResource.addResource('{projectId}');
    const analysisCheckpointIdResource = analysisProjectIdResource.addResource('{checkpointId}');
    const fetchTranscriptResource = analysisCheckpointIdResource.addResource('fetch-transcript');
    addRoute(fetchTranscriptResource, 'POST', analysisFetchTranscriptFn);

    // Routes: /api/analysis/{projectId}/{checkpointId}/analyze
    const analyzeResource = analysisCheckpointIdResource.addResource('analyze');
    addRoute(analyzeResource, 'POST', analysisAnalyzeTranscriptFn);

    // ==================== 7. REPORTING DOMAIN (2 handlers) ====================
    const reportingSummaryFn = createLambda(
      'ReportingSummary',
      path.join(__dirname, '../../packages/reporting/handlers/get-summary.ts'),
    );
    const reportingTimelineFn = createLambda(
      'ReportingTimeline',
      path.join(__dirname, '../../packages/reporting/handlers/get-timeline.ts'),
    );

    // Routes: /api/reporting/summary
    const reportingResource = apiResource.addResource('reporting');
    const summaryResource = reportingResource.addResource('summary');
    addRoute(summaryResource, 'GET', reportingSummaryFn);

    // Routes: /api/reporting/projects/{projectId}/timeline
    const reportingProjectsResource = reportingResource.addResource('projects');
    const reportingProjectIdResource = reportingProjectsResource.addResource('{projectId}');
    const timelineResource = reportingProjectIdResource.addResource('timeline');
    addRoute(timelineResource, 'GET', reportingTimelineFn);

    // ==================== Stack Tags ====================
    cdk.Tags.of(this).add('Project', 'DeliverPro');
    cdk.Tags.of(this).add('Component', 'Lambdas');
    cdk.Tags.of(this).add('Environment', environment);
  }
}
