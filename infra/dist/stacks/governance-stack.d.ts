import * as cdk from 'aws-cdk-lib';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
/**
 * CDK Stack for kiro-governance F-04 Data & Persistence domain.
 * Implements: data-persistence-architecture.md §2, §6, §7
 * - RDS PostgreSQL 16: kiro_governance database
 * - IAM role: kiro-gov-mcp-server-role with rds-db:connect
 * - SSM parameters: db-endpoint, db-port, db-name, db-user
 * - CloudWatch log group: /kiro-governance/mcp-server
 */
export declare class GovernanceStack extends cdk.Stack {
    readonly dbInstance: rds.DatabaseInstance;
    readonly mcpServerRole: iam.Role;
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
}
