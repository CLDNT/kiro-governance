import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { SsmSecretGrant } from '../constructs/ssm-secret-grant';

/**
 * Unit tests for SsmSecretGrant — the reusable single-ARN least-privilege SSM secret grant used to
 * enforce the CR-05 / CR-16 role↔secret-ARN matrix (runbook §5). Each test synthesises a throwaway
 * stack + role and asserts on the generated IAM policy document.
 */

const REGION = 'us-east-1';
const ACCOUNT = '111122223333';

function synthWithGrant(
  parameterName: string,
  opts?: { grantKmsDecrypt?: boolean; kmsKeyArn?: string; sidPrefix?: string },
): { template: Template; role: iam.Role } {
  const app = new App();
  const stack = new Stack(app, 'TestStack', { env: { account: ACCOUNT, region: REGION } });
  const role = new iam.Role(stack, 'TestRole', {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  });
  new SsmSecretGrant(stack, 'Grant', {
    role,
    parameterName,
    region: REGION,
    account: ACCOUNT,
    ...opts,
  });
  return { template: Template.fromStack(stack), role };
}

describe('SsmSecretGrant', () => {
  test('grants ssm:GetParameter on the single parameter ARN only', () => {
    const { template } = synthWithGrant('/kiro-governance/slack/bot-token');
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'GrantSsmGet',
            Effect: 'Allow',
            Action: 'ssm:GetParameter',
            Resource: `arn:aws:ssm:${REGION}:${ACCOUNT}:parameter/kiro-governance/slack/bot-token`,
          }),
        ]),
      },
    });
  });

  test('grants kms:Decrypt fenced by kms:ViaService=ssm by default', () => {
    const { template } = synthWithGrant('/kiro-governance/slack/bot-token');
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'GrantKmsDecrypt',
            Effect: 'Allow',
            Action: 'kms:Decrypt',
            Resource: `arn:aws:kms:${REGION}:${ACCOUNT}:key/*`,
            Condition: { StringEquals: { 'kms:ViaService': `ssm.${REGION}.amazonaws.com` } },
          }),
        ]),
      },
    });
  });

  test('never emits ssm:PutParameter and never a wildcard SSM resource', () => {
    const { template } = synthWithGrant('/kiro-governance/github/read-token');
    const policies = template.findResources('AWS::IAM::Policy');
    const statements = Object.values(policies).flatMap(
      (p) => (p.Properties as any).PolicyDocument.Statement as any[],
    );
    for (const s of statements) {
      const actions = ([] as string[]).concat(s.Action);
      expect(actions).not.toContain('ssm:PutParameter');
      const resources = ([] as string[]).concat(s.Resource);
      for (const r of resources) {
        // No wildcard on any /kiro-governance/* SSM parameter path.
        if (typeof r === 'string' && r.includes(':parameter/kiro-governance')) {
          expect(r).not.toContain('*');
        }
      }
    }
  });

  test('grantKmsDecrypt:false emits only the GetParameter statement (no KMS statement)', () => {
    const { template } = synthWithGrant('/kiro-governance/slack/bot-token', {
      grantKmsDecrypt: false,
      sidPrefix: 'SlackBotToken',
    });
    const policies = template.findResources('AWS::IAM::Policy');
    const statements = Object.values(policies).flatMap(
      (p) => (p.Properties as any).PolicyDocument.Statement as any[],
    );
    expect(statements.some((s) => ([] as string[]).concat(s.Action).includes('kms:Decrypt'))).toBe(
      false,
    );
    expect(
      statements.some((s) => ([] as string[]).concat(s.Action).includes('ssm:GetParameter')),
    ).toBe(true);
  });

  test('honours a specific KMS key ARN when provided', () => {
    const keyArn = `arn:aws:kms:${REGION}:${ACCOUNT}:key/abc-123`;
    const { template } = synthWithGrant('/kiro-governance/slack/provisioning-token', {
      kmsKeyArn: keyArn,
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 'kms:Decrypt', Resource: keyArn }),
        ]),
      },
    });
  });

  test('exposes the resolved parameter ARN', () => {
    const app = new App();
    const stack = new Stack(app, 'S', { env: { account: ACCOUNT, region: REGION } });
    const role = new iam.Role(stack, 'R', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    const grant = new SsmSecretGrant(stack, 'G', {
      role,
      parameterName: '/kiro-governance/github/read-token',
    });
    expect(grant.parameterArn).toBe(
      `arn:aws:ssm:${REGION}:${ACCOUNT}:parameter/kiro-governance/github/read-token`,
    );
  });

  test('rejects a wildcard parameter path at synth time', () => {
    const app = new App();
    const stack = new Stack(app, 'S', { env: { account: ACCOUNT, region: REGION } });
    const role = new iam.Role(stack, 'R', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    expect(
      () =>
        new SsmSecretGrant(stack, 'G', { role, parameterName: '/kiro-governance/slack/*' }),
    ).toThrow(/wildcards are forbidden/);
  });

  test('rejects a parameter path without a leading slash', () => {
    const app = new App();
    const stack = new Stack(app, 'S', { env: { account: ACCOUNT, region: REGION } });
    const role = new iam.Role(stack, 'R', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    expect(
      () => new SsmSecretGrant(stack, 'G', { role, parameterName: 'kiro-governance/x' }),
    ).toThrow(/must start with/);
  });
});
