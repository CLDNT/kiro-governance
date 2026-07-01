import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { CognitoAuthInfra } from '../constructs/cognito-auth';

/**
 * Stateful stack for DeliverPro Phase 2.
 * Contains: Cognito User Pool, S3 evidence bucket, S3 frontend bucket
 * Architecture reference: docs/phase2/auth-architecture.md, docs/phase2/files-architecture.md
 */
export interface StatefulStackProps extends cdk.NestedStackProps {
  /**
   * Environment: 'dev' or 'prod'
   * @default 'dev'
   */
  readonly environment?: 'dev' | 'prod';

  /**
   * CloudFront domain for Cognito callbacks (prod only)
   */
  readonly cloudFrontDomain?: string;
}

export class StatefulStack extends cdk.NestedStack {
  public readonly userPool: cdk.aws_cognito.UserPool;
  public readonly userPoolClient: cdk.aws_cognito.UserPoolClient;
  public readonly evidenceBucket: s3.Bucket;
  public readonly frontendBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StatefulStackProps) {
    super(scope, id, props);

    const accountId = this.account;
    const environment = props?.environment ?? 'dev';
    const removalPolicy = environment === 'dev' ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN;

    // ==================== Cognito Auth (DP-04) ====================
    // Delegated to reusable construct
    const authInfra = new CognitoAuthInfra(this, 'Auth', {
      environment,
      cloudFrontDomain: props?.cloudFrontDomain,
      removalPolicy,
    });

    this.userPool = authInfra.userPool;
    this.userPoolClient = authInfra.userPoolClient;

    // ==================== S3 Evidence Bucket ====================
    // Per files-architecture.md §2
    this.evidenceBucket = new s3.Bucket(this, 'EvidenceBucket', {
      bucketName: `deliverpro-evidence-${accountId}`,
      removalPolicy,
      autoDeleteObjects: environment === 'dev', // Only auto-delete in dev
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED, // SSE-S3 per arch doc
      versioned: false,
      enforceSSL: true,
    });

    // CORS configuration for CloudFront and localhost (dev)
    this.evidenceBucket.addCorsRule({
      allowedOrigins: ['https://*.cloudfront.net', 'http://localhost:5173'],
      allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
      allowedHeaders: ['Content-Type', 'Content-Length', 'x-amz-content-sha256'],
      exposedHeaders: ['ETag'],
      maxAge: 3600,
    });

    // Bucket policy: deny unencrypted uploads
    this.evidenceBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'DenyUnencryptedObjectUploads',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:PutObject'],
        resources: [this.evidenceBucket.arnForObjects('*')],
        conditions: {
          StringNotEquals: {
            's3:x-amz-server-side-encryption': 'AES256',
          },
        },
      }),
    );

    // ==================== S3 Frontend Bucket ====================
    // Per files-architecture.md §2
    this.frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `deliverpro-frontend-${accountId}`,
      removalPolicy,
      autoDeleteObjects: environment === 'dev',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
    });

    // ==================== SSM Parameter Exports (DP-04) ====================
    // Per DP-04 spec §6
    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: '/deliverpro/auth/user-pool-id',
      stringValue: this.userPool.userPoolId,
      description: 'Cognito User Pool ID for DeliverPro',
    });

    new ssm.StringParameter(this, 'ClientIdParam', {
      parameterName: '/deliverpro/auth/client-id',
      stringValue: this.userPoolClient.userPoolClientId,
      description: 'Cognito App Client ID for DeliverPro SPA',
    });

    // Domain URL: hardcoded domain prefix per construct
    const domainUrl = `https://deliverpro-auth.auth.${this.region}.amazoncognito.com`;
    new ssm.StringParameter(this, 'DomainUrlParam', {
      parameterName: '/deliverpro/auth/domain-url',
      stringValue: domainUrl,
      description: 'Cognito Hosted UI domain for DeliverPro',
    });

    new ssm.StringParameter(this, 'RegionParam', {
      parameterName: '/deliverpro/auth/region',
      stringValue: this.region,
      description: 'AWS region for Cognito',
    });

    // ==================== SSM Parameter Exports (DP-01 S3) ====================
    // Per DP-01 spec §3
    new ssm.StringParameter(this, 'EvidenceBucketNameParam', {
      parameterName: '/deliverpro/config/evidence-bucket-name',
      stringValue: this.evidenceBucket.bucketName,
      description: 'S3 evidence bucket name',
    });

    new ssm.StringParameter(this, 'FrontendBucketNameParam', {
      parameterName: '/deliverpro/config/frontend-bucket-name',
      stringValue: this.frontendBucket.bucketName,
      description: 'S3 frontend bucket name',
    });

    // ==================== Stack Tags ====================
    cdk.Tags.of(this).add('Project', 'DeliverPro');
    cdk.Tags.of(this).add('Stack', 'Stateful');
  }
}
