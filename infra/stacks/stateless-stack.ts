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

    // ==================== Lambda Base Execution Role ====================
    // Per DP-01 spec §2, backend Lambdas inherit permissions from this role
    // Base permissions: RDS, S3, Secrets Manager, SSM
    this.lambdaBaseRole = new iam.Role(this, 'LambdaBaseRole', {
      roleName: 'deliverpro-lambda-base-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Base role for DeliverPro Lambda functions',
    });

    // Policy 1: RDS IAM authentication (to connect to existing RDS)
    this.lambdaBaseRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'RDSConnect',
        effect: iam.Effect.ALLOW,
        actions: ['rds-db:connect'],
        resources: [
          `arn:aws:rds-db:${region}:${accountId}:dbuser:*/kiro_phase2`,
        ],
      }),
    );

    // Policy 2: S3 evidence bucket (evidence/ prefix only)
    this.lambdaBaseRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'S3EvidenceBucket',
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:GetObject'],
        resources: [props.evidenceBucket.arnForObjects('evidence/*')],
      }),
    );

    // Policy 3: Secrets Manager (deliverpro/* paths)
    this.lambdaBaseRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'SecretsManager',
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${region}:${accountId}:secret:/deliverpro/*`,
        ],
      }),
    );

    // Policy 4: SSM GetParameter (deliverpro/* parameters)
    this.lambdaBaseRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'SSMGetParameter',
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${region}:${accountId}:parameter/deliverpro/*`,
        ],
      }),
    );

    // Policy 5: CloudWatch Logs (standard for Lambda)
    this.lambdaBaseRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'CloudWatchLogs',
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [`arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/*`],
      }),
    );

    // Policy 6: VPC ENI management (required for Lambda in VPC)
    this.lambdaBaseRole.addToPrincipalPolicy(
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
      dbEndpoint: props.dbEndpoint,
      dbName: props.dbName,
      dbUser: props.dbUser,
      evidenceBucketName: props.evidenceBucket.bucketName,
      environment: environment as 'dev' | 'prod',
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
      lambdaSecurityGroup: props.lambdaSecurityGroup,
    });

    // ==================== Stack Tags ====================
    cdk.Tags.of(this).add('Project', 'DeliverPro');
    cdk.Tags.of(this).add('Stack', 'Stateless');
  }
}
