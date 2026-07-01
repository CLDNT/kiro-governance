import * as cdk from 'aws-cdk-lib';
import { GovernanceStack } from '../stacks/governance-stack';
import { DeliverProStack } from '../stacks/deliverpro-stack';

const app = new cdk.App();

// Phase 1: Governance infrastructure
new GovernanceStack(app, 'KiroGovernanceStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  description: 'Kiro Governance — Phase 1 + Phase 2 Data & Persistence (RDS PostgreSQL + EC2 MCP Server)',
});

// Phase 2: DeliverPro application infrastructure
new DeliverProStack(app, 'DeliverProStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  description: 'DeliverPro — Phase 2 Application Infrastructure (Cognito, API Gateway, CloudFront, S3)',
  environment: 'dev',
});

app.synth();
