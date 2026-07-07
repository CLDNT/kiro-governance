import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { GovernanceStack } from '../stacks/governance-stack';
import { DeliverProStack } from '../stacks/deliverpro-stack';
import { applyNagSuppressions } from './nag-suppressions';

const app = new cdk.App();

// Phase 1: Governance infrastructure
const governanceStack = new GovernanceStack(app, 'KiroGovernanceStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  description: 'Kiro Governance — Phase 1 + Phase 2 Data & Persistence (RDS PostgreSQL + EC2 MCP Server)',
});

// Phase 2: DeliverPro application infrastructure
const deliverProStack = new DeliverProStack(app, 'DeliverProStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  description: 'DeliverPro — Phase 2 Application Infrastructure (Cognito, API Gateway, CloudFront, S3)',
  environment: 'dev',
});

// ==================== CDK Nag — AWS Solutions security checks (cdk-constructs-standards §9) ====================
// Registered as an Aspect (NOT a grep on synth output). Violations surface at synth time.
// Documented, justified suppressions live in bin/nag-suppressions.ts — every suppression carries a
// reason so accepted POC risks are auditable rather than silent.
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
applyNagSuppressions(governanceStack);
applyNagSuppressions(deliverProStack);

app.synth();
