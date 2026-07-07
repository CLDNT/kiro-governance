import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import { Construct } from 'constructs';
import { StatefulStack } from './stateful-stack';
import { StatelessStack } from './stateless-stack';

/**
 * Main orchestrator stack for DeliverPro Phase 2.
 * Composes StatefulStack and StatelessStack, manages cross-stack outputs.
 * Architecture reference: DP-01 spec §1.1, code-structure.md §10
 */
export interface DeliverProStackProps extends cdk.StackProps {
  /**
   * Environment: 'dev' or 'prod'
   * @default 'dev'
   */
  readonly environment?: 'dev' | 'prod';
}

export class DeliverProStack extends cdk.Stack {
  public readonly statefulStack: StatefulStack;
  public readonly statelessStack: StatelessStack;
  public readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props?: DeliverProStackProps) {
    super(scope, id, props);

    const environment = props?.environment ?? 'dev';
    const accountId = this.account;
    const region = this.region;

    // ==================== DP-36: SNS Topic for CloudWatch Alarms ====================
    // Must be created first as it's referenced by alarm actions
    this.alarmTopic = new sns.Topic(this, 'DeliverProAlarmsTopic', {
      displayName: 'DeliverPro Operations Alarms',
      topicName: 'deliverpro-alarms',
    });

    // ==================== StatefulStack (Cognito, S3 buckets) ====================
    this.statefulStack = new StatefulStack(this, 'StatefulStack', {
      environment,
    });

    // ==================== VPC Lookup (for Lambda → RDS connectivity) ====================
    // Existing VPC from KiroGovernanceStack where RDS lives
    const vpc = ec2.Vpc.fromLookup(this, 'ExistingVpc', {
      vpcId: 'vpc-044a3d389fdef6906',
    });

    // Existing security group for Lambda functions
    const lambdaSg = ec2.SecurityGroup.fromSecurityGroupId(
      this, 'LambdaSg', 'sg-0c28319229f5bd5e0',
    );

    // ==================== StatelessStack (API Gateway, CloudFront, Lambda role, all Lambdas) ====================
    // Pass outputs from StatefulStack to StatelessStack
    this.statelessStack = new StatelessStack(this, 'StatelessStack', {
      userPool: this.statefulStack.userPool,
      frontendBucket: this.statefulStack.frontendBucket,
      evidenceBucket: this.statefulStack.evidenceBucket,
      dbEndpoint: 'kirogovernancestack-governancedb222ac1c0-zylylm08i7to.c2hys06m2tn2.us-east-1.rds.amazonaws.com',
      dbName: 'kiro_governance',
      // DB-role repoint (GATE 2): Phase-2 Lambdas authenticate as the NON-master kiro_phase2 role
      // (IAM DB auth), NOT kiro_mcp/master. This is what makes the V005 append-only model real —
      // kiro_phase2 has DeliverPro DML but is READ-ONLY on governance_events. The Lambda roles'
      // rds-db:connect ARN is already scoped to .../dbuser:*/kiro_phase2 (stateless-stack).
      // Source: runbook §3 (GATE 2); impact v3 §F.4 (D-v3-3 / D-v3-11).
      dbUser: 'kiro_phase2',
      environment,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      lambdaSecurityGroup: lambdaSg,
    });

    // ==================== Bedrock permissions for Lambda base role (DP-35) ====================
    this.statelessStack.lambdaBaseRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'BedrockInvokeAgent',
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeAgent'],
        resources: [
          `arn:aws:bedrock:${region}:${accountId}:agent/*`, // Will be scoped after agent creation
        ],
      }),
    );

    // ==================== DP-35: Bedrock AgentCore Agent ====================
    // Per docs/phase2/analysis-architecture.md §2.2
    // Foundation model: Claude Sonnet 4.5 via US cross-region inference (PD-14 resolved)
    // Note: Agent creation via CDK CfnAgent is complex. For now, we set up IAM and SSM parameters.
    // The Bedrock agent will be created manually or via separate Terraform/CLI.
    
    const bedrockAgentRole = new iam.Role(this, 'BedrockAgentRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      description: 'Role for Bedrock AgentCore transcript analyzer',
    });

    // Agent needs Secrets Manager access for Avoma API key (DP-35 requirement)
    bedrockAgentRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'SecretsManagerAccess',
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${region}:${accountId}:secret:/deliverpro/avoma-api-key`,
        ],
      }),
    );

    // Store agent role ARN in SSM for reference
    new ssm.StringParameter(this, 'BedrockAgentRoleParam', {
      parameterName: '/deliverpro/config/bedrock-agent-role-arn',
      stringValue: bedrockAgentRole.roleArn,
      description: 'IAM role ARN for Bedrock AgentCore agent',
    });

    // Store Bedrock model ID in SSM
    new ssm.StringParameter(this, 'BedrockModelIdParam', {
      parameterName: '/deliverpro/config/bedrock-model-id',
      stringValue: 'us.anthropic.claude-sonnet-4-5-20241022-v1:0',
      description: 'Bedrock model ID (Claude Sonnet 4.5 cross-region)',
    });

    // Create placeholder Secrets Manager entry for Avoma API key (DP-35)
    // Value is empty — Faraz will populate via AWS Console
    new secretsmanager.Secret(this, 'AvomApiKeySecret', {
      secretName: '/deliverpro/avoma-api-key',
      description: 'Avoma API key for fetching meeting transcripts',
    });

    // ==================== DP-36: CloudWatch Alarms ====================
    // Per cost-estimate.md §"Cost Protection Controls"

    // 1. AWS Budget alarm ($30/month threshold) — email action to SNS
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'DeliverPro-Monthly-30USD',
        budgetLimit: {
          amount: 30, // Must be number, not string
          unit: 'USD',
        },
        timeUnit: 'MONTHLY',
        budgetType: 'COST',
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 30,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [
            {
              subscriptionType: 'SNS',
              address: this.alarmTopic.topicArn,
            },
          ],
        },
      ],
    });

    // 2. Lambda concurrent execution alarm (threshold: 10)
    // Note: Generic alarm for all deliverpro Lambdas
    const lambdaConcurrentExecutionAlarm = new cloudwatch.Alarm(this, 'LambdaConcurrentExecutionAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'ConcurrentExecutions',
        statistic: 'Maximum',
        period: cdk.Duration.minutes(5),
        dimensionsMap: {
          FunctionName: '*deliverpro*',
        },
      }),
      threshold: 10,
      evaluationPeriods: 2,
      alarmName: 'DeliverPro-Lambda-ConcurrentExecutions',
      alarmDescription: 'Alert when Lambda concurrent executions exceed 10',
    });
    lambdaConcurrentExecutionAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alarmTopic));

    // 3. API Gateway 5xx alarm (threshold: 5 errors in 5 min)
    const apiGateway5xxAlarm = new cloudwatch.Alarm(this, 'ApiGateway5xxAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: 'ServerError',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
        dimensionsMap: {
          ApiName: 'deliverpro-api',
        },
      }),
      threshold: 5,
      evaluationPeriods: 1,
      alarmName: 'DeliverPro-ApiGateway-ServerErrors',
      alarmDescription: 'Alert on 5+ server errors in 5 minutes',
    });
    apiGateway5xxAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alarmTopic));

    // 4. Lambda duration alarm p99 (threshold: 10s per function group)
    // Generic: alerts if any deliverpro Lambda's p99 duration > 10s
    const lambdaDurationAlarm = new cloudwatch.Alarm(this, 'LambdaDurationAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Duration',
        statistic: 'p99',
        period: cdk.Duration.minutes(5),
        dimensionsMap: {
          FunctionName: '*deliverpro*',
        },
      }),
      threshold: 10000, // milliseconds (10 seconds)
      evaluationPeriods: 2,
      alarmName: 'DeliverPro-Lambda-Duration-P99',
      alarmDescription: 'Alert if Lambda p99 duration exceeds 10s',
    });
    lambdaDurationAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alarmTopic));

    // 5. RDS connections alarm (threshold: 40 — t3.micro max ~87, alert at ~50%)
    // Requires database name/resource ID (will need refinement based on actual RDS setup)
    const rdsConnectionsAlarm = new cloudwatch.Alarm(this, 'RDSConnectionsAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'DatabaseConnections',
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
        dimensionsMap: {
          DBInstanceIdentifier: 'kiro-phase2',
        },
      }),
      threshold: 40,
      evaluationPeriods: 2,
      alarmName: 'DeliverPro-RDS-Connections',
      alarmDescription: 'Alert if RDS connections exceed 40 (50% of t3.micro max)',
    });
    rdsConnectionsAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alarmTopic));

    // ==================== DP-36: CloudWatch Dashboard ====================
    new cloudwatch.Dashboard(this, 'OperationsDashboard', {
      dashboardName: 'DeliverPro-Operations',
    })
      .addWidgets(
        new cloudwatch.GraphWidget({
          title: 'Lambda Invocations',
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'Invocations',
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
              dimensionsMap: { FunctionName: '*deliverpro*' },
            }),
          ],
          width: 12,
          height: 6,
        }),
        new cloudwatch.GraphWidget({
          title: 'Lambda Duration (ms)',
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'Duration',
              statistic: 'Average',
              period: cdk.Duration.minutes(5),
              dimensionsMap: { FunctionName: '*deliverpro*' },
            }),
          ],
          width: 12,
          height: 6,
        }),
        new cloudwatch.GraphWidget({
          title: 'API Gateway Request Count',
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/ApiGateway',
              metricName: 'Count',
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
              dimensionsMap: { ApiName: 'deliverpro-api' },
            }),
          ],
          width: 12,
          height: 6,
        }),
        new cloudwatch.GraphWidget({
          title: 'API Gateway 5xx Errors',
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/ApiGateway',
              metricName: 'ServerError',
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
              dimensionsMap: { ApiName: 'deliverpro-api' },
            }),
          ],
          width: 12,
          height: 6,
        }),
        new cloudwatch.GraphWidget({
          title: 'RDS Connections',
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/RDS',
              metricName: 'DatabaseConnections',
              statistic: 'Average',
              period: cdk.Duration.minutes(5),
              dimensionsMap: { DBInstanceIdentifier: 'kiro-phase2' },
            }),
          ],
          width: 12,
          height: 6,
        }),
        new cloudwatch.GraphWidget({
          title: 'Lambda Concurrent Executions',
          left: [
            new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'ConcurrentExecutions',
              statistic: 'Maximum',
              period: cdk.Duration.minutes(5),
              dimensionsMap: { FunctionName: '*deliverpro*' },
            }),
          ],
          width: 12,
          height: 6,
        }),
      );

    // ==================== Stack Outputs ====================
    // For console visibility
    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: this.statelessStack.restApi.url,
      description: 'API Gateway REST endpoint',
      exportName: 'DeliverProApiGatewayUrl',
    });

    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: this.statelessStack.distribution.distributionDomainName,
      description: 'CloudFront distribution domain',
      exportName: 'DeliverProCloudFrontDomain',
    });

    new cdk.CfnOutput(this, 'CognitoUserPoolId', {
      value: this.statefulStack.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: 'DeliverProUserPoolId',
    });

    new cdk.CfnOutput(this, 'CognitoClientId', {
      value: this.statefulStack.userPoolClient.userPoolClientId,
      description: 'Cognito App Client ID',
      exportName: 'DeliverProClientId',
    });

    new cdk.CfnOutput(this, 'EvidenceBucketName', {
      value: this.statefulStack.evidenceBucket.bucketName,
      description: 'S3 evidence bucket name',
      exportName: 'DeliverProEvidenceBucketName',
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: this.statefulStack.frontendBucket.bucketName,
      description: 'S3 frontend bucket name',
      exportName: 'DeliverProFrontendBucketName',
    });

    new cdk.CfnOutput(this, 'LambdaBaseRoleArn', {
      value: this.statelessStack.lambdaBaseRole.roleArn,
      description: 'Lambda base role ARN (for backend Lambdas)',
      exportName: 'DeliverProLambdaBaseRoleArn',
    });

    new cdk.CfnOutput(this, 'AlarmsTopicArn', {
      value: this.alarmTopic.topicArn,
      description: 'SNS topic ARN for CloudWatch alarms',
      exportName: 'DeliverProAlarmsTopic',
    });

    // ==================== Stack Tags ====================
    cdk.Tags.of(this).add('Project', 'DeliverPro');
    cdk.Tags.of(this).add('Phase', '2');
    cdk.Tags.of(this).add('Environment', environment);
  }
}
