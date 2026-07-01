import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

/**
 * Reusable L3 Cognito Auth construct for DeliverPro.
 * Creates: User Pool, Groups (admin, leadership, pm, sa, engineer), App Client, Cognito Domain
 * Architecture reference: docs/phase2/auth-architecture.md §1.1–1.4
 */
export interface CognitoAuthInfraProps {
  /**
   * Environment: 'dev' or 'prod'. Used to select callback/logout URLs.
   * @default 'dev'
   */
  readonly environment?: 'dev' | 'prod';

  /**
   * CloudFront domain name for prod callback URLs.
   * Only used if environment is 'prod'.
   * @default undefined
   */
  readonly cloudFrontDomain?: string;

  /**
   * Removal policy for User Pool.
   * @default RemovalPolicy.RETAIN (auth data must survive stack deletion)
   */
  readonly removalPolicy?: cdk.RemovalPolicy;
}

export class CognitoAuthInfra extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly cognitoDomain: cognito.UserPoolDomain;

  private readonly groups: string[] = ['admin', 'leadership', 'pm', 'sa', 'engineer'];

  constructor(scope: Construct, id: string, props?: CognitoAuthInfraProps) {
    super(scope, id);

    const environment = props?.environment ?? 'dev';
    const removalPolicy = props?.removalPolicy ?? cdk.RemovalPolicy.RETAIN;

    // ==================== Cognito User Pool ====================
    // Per auth-architecture.md §1
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'deliverpro-user-pool',
      selfSignUpEnabled: false, // Admin creates users only (ID-6)
      signInAliases: { email: true },
      standardAttributes: {
        email: {
          required: true,
          mutable: false,
        },
        fullname: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true }, // TOTP only, no SMS
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy,
    });

    // ==================== User Pool Groups ====================
    // Per auth-architecture.md §1.2, create 5 groups with priority ordering
    const groupPriorities: { [key: string]: number } = {
      admin: 1,
      leadership: 2,
      pm: 3,
      sa: 4,
      engineer: 5,
    };

    const groupDescriptions: { [key: string]: string } = {
      admin: 'Full system configuration + user management',
      leadership: 'Cross-project visibility + admin panel access',
      pm: 'Project management — own projects + evidence + status logs',
      sa: 'Technical review — mark human_review checkpoints',
      engineer: 'Read-only project visibility',
    };

    this.groups.forEach((groupName) => {
      new cognito.CfnUserPoolGroup(this, `Group${groupName}`, {
        groupName,
        userPoolId: this.userPool.userPoolId,
        description: groupDescriptions[groupName],
        precedence: groupPriorities[groupName],
      });
    });

    // ==================== App Client (SPA) ====================
    // Per auth-architecture.md §1.3, PKCE + no client secret
    const callbackUrls = this.buildCallbackUrls(environment, props?.cloudFrontDomain);
    const logoutUrls = this.buildLogoutUrls(environment, props?.cloudFrontDomain);

    this.userPoolClient = this.userPool.addClient('SpaClient', {
      userPoolClientName: 'deliverpro-spa-client',
      generateSecret: false, // SPA cannot securely store secret
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls,
        logoutUrls,
      },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ==================== Cognito Domain ====================
    // Per auth-architecture.md §1.4, domain prefix for Hosted UI
    this.cognitoDomain = this.userPool.addDomain('CognitoDomain', {
      cognitoDomain: { domainPrefix: 'deliverpro-auth' },
    });

    // ==================== Tags ====================
    cdk.Tags.of(this).add('Project', 'DeliverPro');
    cdk.Tags.of(this).add('Component', 'Auth');
  }

  private buildCallbackUrls(environment: string, cloudFrontDomain?: string): string[] {
    if (environment === 'prod' && cloudFrontDomain) {
      return [`https://${cloudFrontDomain}/callback`];
    }
    // Dev: localhost
    return ['http://localhost:5173/callback'];
  }

  private buildLogoutUrls(environment: string, cloudFrontDomain?: string): string[] {
    if (environment === 'prod' && cloudFrontDomain) {
      return [`https://${cloudFrontDomain}/login`];
    }
    // Dev: localhost
    return ['http://localhost:5173/login'];
  }
}
