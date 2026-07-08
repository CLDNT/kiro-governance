import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfront_origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { DeliverProLambdasStack } from './deliverpro-lambdas-stack';
import { SsmSecretGrant } from '../constructs/ssm-secret-grant';

/**
 * Stateless stack for DeliverPro Phase 2.
 * Contains: API Gateway REST API, Cognito Authorizer, CloudFront distribution, Lambda base role
 * Architecture reference: docs/phase2/auth-architecture.md §3, §6, §7
 */
export interface StatelessStackProps extends cdk.NestedStackProps {
  /**
   * Cognito User Pool from Stateful stack
   */
  readonly userPool: cognito.IUserPool;

  /**
   * S3 frontend bucket from Stateful stack
   */
  readonly frontendBucket: s3.Bucket;

  /**
   * S3 evidence bucket from Stateful stack (for Lambda role permissions)
   */
  readonly evidenceBucket: s3.Bucket;

  /**
   * Environment: 'dev' or 'prod'
   * @default 'dev'
   */
  readonly environment?: 'dev' | 'prod';

  /**
   * Database endpoint (for Lambda env vars)
   */
  readonly dbEndpoint: string;

  /**
   * Database name
   */
  readonly dbName: string;

  /**
   * Database user
   */
  readonly dbUser: string;

  /**
   * VPC for Lambda database access
   */
  readonly vpc?: ec2.IVpc;

  /**
   * Subnet selection for Lambdas
   */
  readonly vpcSubnets?: ec2.SubnetSelection;

  /**
   * Security group for Lambdas
   */
  readonly lambdaSecurityGroup?: ec2.ISecurityGroup;
}

export class StatelessStack extends cdk.NestedStack {
  public readonly restApi: apigateway.RestApi;
  public readonly cognitoAuthorizer: apigateway.CognitoUserPoolsAuthorizer;
  public readonly distribution: cloudfront.Distribution;
  public readonly lambdaBaseRole: iam.Role;
  /** Dedicated role for the projects-linkage function group (create/update/sync-gates) — reads the GitHub read-token ONLY. */
  public readonly projectsLinkageRole: iam.Role;
  /** Dedicated role for the Slack channel-provisioning Lambda — reads the Slack provisioning-token ONLY. */
  public readonly provisioningRole: iam.Role;
  /** Dedicated role for the gates macro-notify Lambda — reads the MCP api-key (SecureString) ONLY. */
  public readonly gatesNotifyRole: iam.Role;

  constructor(scope: Construct, id: string, props: StatelessStackProps) {
    super(scope, id, props);

    const accountId = this.account;
    const region = this.region;
    const environment = props.environment ?? 'dev';
    const removalPolicy = environment === 'dev' ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN;

    // ==================== API Gateway REST API ====================
    // Per auth-architecture.md §6, DP-01 spec §1.5
    this.restApi = new apigateway.RestApi(this, 'RestApi', {
      restApiName: 'deliverpro-api',
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
      },
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      // CORS: allow requests from CloudFront domain and local dev
      defaultCorsPreflightOptions: {
        allowOrigins: [
          'https://d2s8z1ws7s6cmc.cloudfront.net',
          'http://localhost:5173',
          'http://localhost:4173',
        ],
        allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: false,
      },
    });

    // ==================== CORS Gateway Responses ====================
    // Ensures CORS headers are present on ALL API Gateway error responses
    // (4xx, 5xx, auth failures) — not just Lambda-returned responses.
    // Without this, the browser blocks error responses from cross-origin requests.
    const corsResponseHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': "'https://d2s8z1ws7s6cmc.cloudfront.net'",
      'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
      'Access-Control-Allow-Methods': "'GET,POST,PUT,PATCH,DELETE,OPTIONS'",
    };

    const gatewayResponseTypes = [
      apigateway.ResponseType.DEFAULT_4XX,
      apigateway.ResponseType.DEFAULT_5XX,
      apigateway.ResponseType.UNAUTHORIZED,
      apigateway.ResponseType.ACCESS_DENIED,
      apigateway.ResponseType.MISSING_AUTHENTICATION_TOKEN,
      apigateway.ResponseType.EXPIRED_TOKEN,
    ];

    gatewayResponseTypes.forEach((responseType) => {
      this.restApi.addGatewayResponse(`GwResponse-${responseType.responseType}`, {
        type: responseType,
        responseHeaders: corsResponseHeaders,
      });
    });

    // ==================== Cognito Authorizer ====================
    // Per auth-architecture.md §3, DP-01 spec §1.6
    // Token source: Authorization header (Bearer {ID-token})
    this.cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
      identitySource: 'method.request.header.Authorization',
    });

    // Attach to a dummy resource to satisfy validation
    // Backend domain services will use this same authorizer
    const dummyResource = this.restApi.root.addResource('_internal');
    dummyResource.addMethod('GET', new apigateway.MockIntegration(), {
      authorizer: this.cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ==================== CloudFront Distribution ====================
    // Per files-architecture.md §5, DP-01 spec §1.7
    // Origin to frontend S3 bucket
    // Note: Using S3Origin (deprecated); will migrate to S3StaticWebsiteOrigin in CDK v3
    const s3Origin = new cloudfront_origins.S3Origin(props.frontendBucket);

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      enableLogging: environment === 'prod',
    });

    // ==================== Lambda Execution Roles (least-privilege secret isolation) ====================
    // Per DP-01 spec §2 the generic Lambdas share a base role. The two credential-bearing consumers
    // get DEDICATED roles so each reads exactly one SSM secret (CR-05 / CR-16 role↔secret-ARN matrix;
    // runbook §5). All three roles share the same common permissions (RDS IAM auth as kiro_phase2,
    // S3 evidence, deliverpro secrets/config, logs, VPC ENI) via applyCommonLambdaPolicies().
    //
    //   Role                 | May read (SSM secret)                       | Consumers
    //   ---------------------|---------------------------------------------|-------------------------------
    //   lambdaBaseRole       | (none of the three secrets)                 | ~33 generic Lambdas
    //   projectsLinkageRole  | /kiro-governance/github/read-token          | ProjectsCreate/Update/SyncGates
    //   provisioningRole     | /kiro-governance/slack/provisioning-token   | ProvisionSlackChannels

    this.lambdaBaseRole = new iam.Role(this, 'LambdaBaseRole', {
      roleName: 'deliverpro-lambda-base-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Base role for DeliverPro Lambda functions (no linkage secrets)',
    });

    this.projectsLinkageRole = new iam.Role(this, 'ProjectsLinkageRole', {
      roleName: 'deliverpro-projects-linkage-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description:
        'DeliverPro projects-linkage role (create/update/sync-gates) - GitHub read-token ONLY',
    });

    this.provisioningRole = new iam.Role(this, 'ProvisioningRole', {
      roleName: 'deliverpro-slack-provisioning-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'DeliverPro Slack channel-provisioning role - Slack provisioning-token ONLY',
    });

    // Gap B: the gates macro-notify Lambda (complete-checkpoint) needs the MCP API key at runtime to
    // authenticate app→MCP notify_slack calls. The key is a SecureString and CANNOT be injected into
    // a Lambda env var by CloudFormation, so this dedicated role reads it from SSM at runtime as a
    // SINGLE ARN (CR-05/CR-16 matrix) — the same pattern as the github/slack tokens above.
    this.gatesNotifyRole = new iam.Role(this, 'GatesNotifyRole', {
      roleName: 'deliverpro-gates-notify-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'DeliverPro gates macro-notify role - reads MCP api-key (SecureString) ONLY',
    });

    // Common permissions applied to all four roles.
    [
      this.lambdaBaseRole,
      this.projectsLinkageRole,
      this.provisioningRole,
      this.gatesNotifyRole,
    ].forEach((role) =>
      this.applyCommonLambdaPolicies(role, region, accountId, props.evidenceBucket),
    );

    // Secret grant 1 — GitHub read-token → projects-linkage role ONLY (single ARN, kms:ViaService=ssm).
    // Used by sync-gates + the best-effort link-time trigger in create/update (CR-16). The GitHub
    // token is never in an env var — only this scoped SSM read reaches it.
    new SsmSecretGrant(this, 'GithubReadTokenGrant', {
      role: this.projectsLinkageRole,
      parameterName: '/kiro-governance/github/read-token',
      region,
      account: accountId,
      sidPrefix: 'GithubReadToken',
    });

    // Secret grant 2 — Slack provisioning-token → provisioning role ONLY (single ARN, channels:manage).
    // Distinct from the runtime bot-token (read by the MCP server role) — SEC-M1 two-token split.
    new SsmSecretGrant(this, 'ProvisioningTokenGrant', {
      role: this.provisioningRole,
      parameterName: '/kiro-governance/slack/provisioning-token',
      region,
      account: accountId,
      sidPrefix: 'SlackProvisioningToken',
    });

    // Secret grant 3 — MCP API key → gates-notify role ONLY (single ARN, kms:ViaService=ssm).
    // Read at RUNTIME by the gates macro-notify path (complete-checkpoint → macro-notify.service →
    // mcp-client). A SecureString cannot be a Lambda env var, so only the parameter PATH is injected
    // (MCP_API_KEY_SSM_PARAM) and the value is fetched via this scoped SSM read.
    new SsmSecretGrant(this, 'McpApiKeyGrant', {
      role: this.gatesNotifyRole,
      parameterName: '/kiro-governance/config/mcp-api-key',
      region,
      account: accountId,
      sidPrefix: 'McpApiKey',
    });

    // MCP self-signed cert fingerprint — a NON-secret String param. Resolved at synth (lookup) and
    // injected as a plain env var so the app pins the TLS connection (mcp-client compares it against
    // cert.fingerprint256). Non-secret, so baking the literal into the template is acceptable.
    const mcpCertFingerprint = ssm.StringParameter.valueFromLookup(
      this,
      '/kiro-governance/config/mcp-cert-fingerprint',
    );

    // ==================== SSM Parameter Exports (DP-01) ====================
    // Per DP-01 spec §3
    new ssm.StringParameter(this, 'ApiGatewayUrlParam', {
      parameterName: '/deliverpro/config/api-gateway-url',
      stringValue: this.restApi.url,
      description: 'API Gateway REST endpoint',
    });

    new ssm.StringParameter(this, 'CloudFrontDomainParam', {
      parameterName: '/deliverpro/config/cloudfront-domain',
      stringValue: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain',
    });

    // ==================== Lambda Functions & API Routes ====================
    // All domain Lambdas live here (same nested stack as API Gateway) to avoid circular deps
    new DeliverProLambdasStack(this, 'Lambdas', {
      restApi: this.restApi,
      cognitoAuthorizer: this.cognitoAuthorizer,
      lambdaBaseRole: this.lambdaBaseRole,
      projectsLinkageRole: this.projectsLinkageRole,
      provisioningRole: this.provisioningRole,
      gatesNotifyRole: this.gatesNotifyRole,
      dbEndpoint: props.dbEndpoint,
      dbName: props.dbName,
      dbUser: props.dbUser,
      evidenceBucketName: props.evidenceBucket.bucketName,
      environment: environment as 'dev' | 'prod',
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
      lambdaSecurityGroup: props.lambdaSecurityGroup,
      // Gap B — MCP wiring for the app-owned MACRO Slack notify (in-VPC MCP server, private IP).
      mcpServerUrl: 'https://172.31.7.210:443',
      mcpApiKeySsmParam: '/kiro-governance/config/mcp-api-key',
      mcpCertFingerprint,
    });

    // ==================== Stack Tags ====================
    cdk.Tags.of(this).add('Project', 'DeliverPro');
    cdk.Tags.of(this).add('Stack', 'Stateless');
  }

  /**
   * Attach the permissions every DeliverPro Lambda role needs, regardless of which SSM secret
   * (if any) it may read: RDS IAM auth as the non-master kiro_phase2 runtime role (V005 append-only
   * model), S3 evidence, deliverpro secrets + config params, CloudWatch Logs, and VPC ENI management.
   * Secret grants are attached SEPARATELY, per-role, via SsmSecretGrant — never here.
   */
  private applyCommonLambdaPolicies(
    role: iam.Role,
    region: string,
    accountId: string,
    evidenceBucket: s3.Bucket,
  ): void {
    // RDS IAM authentication — connect ONLY as kiro_phase2 (non-master Phase-2 app role).
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'RDSConnect',
        effect: iam.Effect.ALLOW,
        actions: ['rds-db:connect'],
        resources: [`arn:aws:rds-db:${region}:${accountId}:dbuser:*/kiro_phase2`],
      }),
    );

    // S3 evidence bucket (evidence/ prefix only).
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'S3EvidenceBucket',
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:GetObject'],
        resources: [evidenceBucket.arnForObjects('evidence/*')],
      }),
    );

    // Secrets Manager (deliverpro/* paths — e.g. Avoma API key).
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'SecretsManager',
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:aws:secretsmanager:${region}:${accountId}:secret:/deliverpro/*`],
      }),
    );

    // SSM GetParameter (NON-SECRET deliverpro/* config only — NOT the /kiro-governance/* secrets).
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'SSMGetParameter',
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [`arn:aws:ssm:${region}:${accountId}:parameter/deliverpro/*`],
      }),
    );

    // CloudWatch Logs (standard for Lambda).
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'CloudWatchLogs',
        effect: iam.Effect.ALLOW,
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [`arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/*`],
      }),
    );

    // VPC ENI management (required for Lambda in VPC).
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'VPCNetworkInterface',
        effect: iam.Effect.ALLOW,
        actions: [
          'ec2:CreateNetworkInterface',
          'ec2:DescribeNetworkInterfaces',
          'ec2:DeleteNetworkInterface',
          'ec2:AssignPrivateIpAddresses',
          'ec2:UnassignPrivateIpAddresses',
        ],
        resources: ['*'],
      }),
    );
  }
}
