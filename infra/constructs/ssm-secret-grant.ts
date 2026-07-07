import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * SsmSecretGrant — reusable least-privilege grant for a SINGLE SSM SecureString secret.
 *
 * Bakes in the CR-05 / CR-16 credential-isolation pattern
 * (docs/phase2/runbooks/cr-github-slack-linkage-deploy.md §5):
 *
 *   - `ssm:GetParameter` on exactly ONE parameter ARN (never a `/kiro-governance/*` wildcard)
 *   - `kms:Decrypt` on the backing key, conditioned on `kms:ViaService = ssm.<region>.amazonaws.com`
 *   - NEVER `ssm:PutParameter` (rotation is admin / out-of-band)
 *
 * This construct intentionally attaches IAM statements to a caller-supplied role. That is a
 * deliberate exception to the "constructs don't grant IAM" guideline: the construct's sole purpose
 * is to encapsulate the single-secret grant pattern so it cannot be misconfigured (a wildcard path
 * or a `PutParameter` action throws at synth), and so the role↔secret-ARN matrix is enforced
 * identically across every consumer (MCP bot-token, provisioning-token, GitHub read-token).
 */
export interface SsmSecretGrantProps {
  /** IAM role that will be allowed to read exactly this one secret. */
  readonly role: iam.IRole;

  /**
   * Full SSM parameter path, leading slash included
   * (e.g. `/kiro-governance/slack/bot-token`). Wildcards are rejected.
   */
  readonly parameterName: string;

  /**
   * Region of the parameter.
   * @default — the enclosing Stack's region
   */
  readonly region?: string;

  /**
   * Account of the parameter.
   * @default — the enclosing Stack's account
   */
  readonly account?: string;

  /**
   * Whether to attach the `kms:Decrypt` (`kms:ViaService=ssm`) statement. Set `false` when the role
   * already carries an equivalent SSM-scoped decrypt statement, to avoid a redundant statement.
   * @default true
   */
  readonly grantKmsDecrypt?: boolean;

  /**
   * KMS key ARN backing the SecureString.
   * @default — `arn:aws:kms:<region>:<account>:key/*`, always fenced by the `kms:ViaService=ssm`
   * condition so it can only be used to decrypt SSM SecureStrings (the value is still unreachable
   * without the single-ARN `ssm:GetParameter` above).
   */
  readonly kmsKeyArn?: string;

  /**
   * Prefix for the emitted statement `sid`s (must be unique per role).
   * @default — the construct id with non-alphanumerics stripped
   */
  readonly sidPrefix?: string;
}

export class SsmSecretGrant extends Construct {
  /** The single parameter ARN this grant is scoped to. */
  public readonly parameterArn: string;

  constructor(scope: Construct, id: string, props: SsmSecretGrantProps) {
    super(scope, id);

    if (!props.parameterName.startsWith('/')) {
      throw new Error(
        `SsmSecretGrant: parameterName must start with '/': "${props.parameterName}"`,
      );
    }
    if (props.parameterName.includes('*')) {
      throw new Error(
        `SsmSecretGrant: wildcards are forbidden — grant a single parameter ARN only: "${props.parameterName}"`,
      );
    }

    const stack = cdk.Stack.of(this);
    const region = props.region ?? stack.region;
    const account = props.account ?? stack.account;
    const grantKmsDecrypt = props.grantKmsDecrypt ?? true;
    const sidBase = (props.sidPrefix ?? id).replace(/[^A-Za-z0-9]/g, '');

    // parameter name already carries a leading slash → arn:...:parameter/kiro-governance/...
    this.parameterArn = `arn:aws:ssm:${region}:${account}:parameter${props.parameterName}`;

    // Statement 1 — read exactly one parameter. No wildcard, no PutParameter.
    props.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: `${sidBase}SsmGet`,
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [this.parameterArn],
      }),
    );

    // Statement 2 — decrypt the SecureString, but only via SSM.
    if (grantKmsDecrypt) {
      props.role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          sid: `${sidBase}KmsDecrypt`,
          effect: iam.Effect.ALLOW,
          actions: ['kms:Decrypt'],
          resources: [props.kmsKeyArn ?? `arn:aws:kms:${region}:${account}:key/*`],
          conditions: { StringEquals: { 'kms:ViaService': `ssm.${region}.amazonaws.com` } },
        }),
      );
    }

    cdk.Tags.of(this).add('ManagedBy', 'CDK');
  }
}
