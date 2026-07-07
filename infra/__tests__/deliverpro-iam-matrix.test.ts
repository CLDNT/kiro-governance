import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { StatelessStack } from '../stacks/stateless-stack';

/**
 * Stack-level assertions for the CR-05 / CR-16 role↔secret-ARN matrix (runbook §5) and the DB-role
 * repoint (runbook §3 / impact v3 §F). Synthesises StatelessStack WITHOUT a VPC so no live
 * `Vpc.fromLookup` is required — the IAM wiring under test is VPC-independent.
 */

const ACCOUNT = '111122223333';
const REGION = 'us-east-1';

const BOT_TOKEN = 'parameter/kiro-governance/slack/bot-token';
const PROVISIONING_TOKEN = 'parameter/kiro-governance/slack/provisioning-token';
const GITHUB_TOKEN = 'parameter/kiro-governance/github/read-token';

function synth(): Template {
  const app = new App();
  const parent = new Stack(app, 'Parent', { env: { account: ACCOUNT, region: REGION } });
  const userPool = new cognito.UserPool(parent, 'Up');
  const frontendBucket = new s3.Bucket(parent, 'Fe');
  const evidenceBucket = new s3.Bucket(parent, 'Ev');

  const stateless = new StatelessStack(parent, 'StatelessStack', {
    userPool,
    frontendBucket,
    evidenceBucket,
    dbEndpoint: 'db.example.com',
    dbName: 'kiro_governance',
    dbUser: 'kiro_phase2',
    environment: 'dev',
    // no vpc → no lookup, and Lambdas are created without VPC config
  });
  return Template.fromStack(stateless);
}

/** All statements across all IAM policies attached to the role whose logical id contains `roleIdFragment`. */
function statementsForRole(template: Template, roleIdFragment: string): any[] {
  const policies = template.findResources('AWS::IAM::Policy');
  const out: any[] = [];
  for (const p of Object.values(policies)) {
    const roles = JSON.stringify((p.Properties as any).Roles ?? '');
    if (roles.includes(roleIdFragment)) {
      out.push(...(p.Properties as any).PolicyDocument.Statement);
    }
  }
  return out;
}

function ssmParamResources(statements: any[]): string[] {
  const out: string[] = [];
  for (const s of statements) {
    if (([] as string[]).concat(s.Action).includes('ssm:GetParameter')) {
      for (const r of ([] as any[]).concat(s.Resource)) {
        if (typeof r === 'string') out.push(r);
      }
    }
  }
  return out;
}

describe('DeliverPro Phase-2 IAM least-privilege matrix', () => {
  let template: Template;
  beforeAll(() => {
    template = synth();
  }, 120_000);

  test('projects-linkage role reads the GitHub read-token and NOT the Slack tokens', () => {
    const stmts = statementsForRole(template, 'ProjectsLinkageRole');
    const params = ssmParamResources(stmts);
    expect(params.some((r) => r.includes(GITHUB_TOKEN))).toBe(true);
    expect(params.some((r) => r.includes(BOT_TOKEN))).toBe(false);
    expect(params.some((r) => r.includes(PROVISIONING_TOKEN))).toBe(false);
  });

  test('provisioning role reads the provisioning-token and NOT the bot/github tokens', () => {
    const stmts = statementsForRole(template, 'ProvisioningRole');
    const params = ssmParamResources(stmts);
    expect(params.some((r) => r.includes(PROVISIONING_TOKEN))).toBe(true);
    expect(params.some((r) => r.includes(BOT_TOKEN))).toBe(false);
    expect(params.some((r) => r.includes(GITHUB_TOKEN))).toBe(false);
  });

  test('base role reads NONE of the three linkage secrets', () => {
    const stmts = statementsForRole(template, 'LambdaBaseRole');
    const params = ssmParamResources(stmts);
    expect(params.some((r) => r.includes(GITHUB_TOKEN))).toBe(false);
    expect(params.some((r) => r.includes(PROVISIONING_TOKEN))).toBe(false);
    expect(params.some((r) => r.includes(BOT_TOKEN))).toBe(false);
    // base role still gets non-secret deliverpro config
    expect(params.some((r) => r.includes('parameter/deliverpro/*'))).toBe(true);
  });

  test('no role grants ssm:PutParameter and no /kiro-governance/* wildcard', () => {
    const allPolicies = template.findResources('AWS::IAM::Policy');
    const allStatements = Object.values(allPolicies).flatMap(
      (p) => (p.Properties as any).PolicyDocument.Statement as any[],
    );
    for (const s of allStatements) {
      expect(([] as string[]).concat(s.Action)).not.toContain('ssm:PutParameter');
      for (const r of ([] as any[]).concat(s.Resource)) {
        if (typeof r === 'string' && r.includes(':parameter/kiro-governance')) {
          expect(r).not.toContain('*');
        }
      }
    }
  });

  test('every credential-bearing role connects to RDS as kiro_phase2 (DB repoint)', () => {
    for (const roleId of ['ProjectsLinkageRole', 'ProvisioningRole', 'LambdaBaseRole']) {
      const stmts = statementsForRole(template, roleId);
      const rds = stmts.filter((s) => ([] as string[]).concat(s.Action).includes('rds-db:connect'));
      expect(rds.length).toBeGreaterThan(0);
      const resources = JSON.stringify(rds.map((s) => s.Resource));
      expect(resources).toContain('/kiro_phase2');
      expect(resources).not.toContain('/kiro_mcp');
    }
  });

  test('the GitHub and provisioning secret grants are fenced by kms:ViaService=ssm', () => {
    for (const roleId of ['ProjectsLinkageRole', 'ProvisioningRole']) {
      const stmts = statementsForRole(template, roleId);
      const kms = stmts.filter((s) => ([] as string[]).concat(s.Action).includes('kms:Decrypt'));
      expect(kms.length).toBeGreaterThan(0);
      expect(
        kms.some(
          (s) => s.Condition?.StringEquals?.['kms:ViaService'] === `ssm.${REGION}.amazonaws.com`,
        ),
      ).toBe(true);
    }
  });
});
