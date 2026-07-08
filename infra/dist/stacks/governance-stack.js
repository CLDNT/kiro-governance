"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GovernanceStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const rds = __importStar(require("aws-cdk-lib/aws-rds"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const ssm = __importStar(require("aws-cdk-lib/aws-ssm"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const ssm_secret_grant_1 = require("../constructs/ssm-secret-grant");
/**
 * CDK Stack for kiro-governance F-04 Data & Persistence domain.
 * Implements: data-persistence-architecture.md §2, §6, §7
 * - RDS PostgreSQL 16: kiro_governance database
 * - IAM role: kiro-gov-mcp-server-role with rds-db:connect
 * - SSM parameters: db-endpoint, db-port, db-name, db-user
 * - CloudWatch log group: /kiro-governance/mcp-server
 */
class GovernanceStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const accountId = this.account;
        const region = this.region;
        // ==================== VPC & EC2 Security Group (created first for RDS SG reference) ====================
        const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });
        const adminCidr = this.node.tryGetContext('adminCidr') ?? '0.0.0.0/0';
        const sg = new ec2.SecurityGroup(this, 'McpServerSg', {
            vpc,
            securityGroupName: 'kiro-gov-mcp-server-sg',
            description: 'kiro-governance MCP server',
            allowAllOutbound: true,
        });
        sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS MCP server');
        sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'SSH admin access');
        // ==================== RDS Security Group ====================
        // Source: data-persistence-architecture.md §6.2
        const dbSg = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
            vpc,
            securityGroupName: 'kiro-gov-rds-sg',
            description: 'RDS PostgreSQL - allow 5432 from MCP server only',
            allowAllOutbound: false,
        });
        // Inbound: TCP 5432 from EC2 MCP server security group
        dbSg.addIngressRule(sg, ec2.Port.tcp(5432), 'MCP server access to RDS');
        // ==================== RDS PostgreSQL Instance ====================
        // Source: data-persistence-architecture.md §2, §7
        this.dbInstance = new rds.DatabaseInstance(this, 'GovernanceDb', {
            engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            securityGroups: [dbSg],
            databaseName: 'kiro_governance',
            // RDS MASTER username stays `kiro_mcp` (admin/migrations only). We do NOT rename the master —
            // that forces replacement of this RETAIN + deletion-protected instance. The MCP RUNTIME
            // authenticates as the dedicated non-master role `kiro_mcp_app` (created by migrations/V005;
            // IAM auth below), NOT the master — iam-review Finding 2 / SEC-H1 collision fix.
            credentials: rds.Credentials.fromUsername('kiro_mcp'),
            allocatedStorage: 20,
            storageType: rds.StorageType.GP2,
            multiAz: false,
            deletionProtection: true,
            backupRetention: cdk.Duration.days(7),
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            iamAuthentication: true,
        });
        // ==================== IAM Role: kiro-gov-mcp-server-role ====================
        // Trust: EC2 service
        // Permissions: RDS IAM auth, SSM GetParameter, KMS Decrypt
        // Source: data-persistence-architecture.md §6.1
        this.mcpServerRole = new iam.Role(this, 'McpServerRole', {
            roleName: 'kiro-gov-mcp-server-role',
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
            description: 'MCP Server EC2 instance role for governance data writes',
        });
        // ALLOW: RDS IAM database authentication — connect ONLY as the non-master runtime role
        // `kiro_mcp_app` (append-only writer). NOT the RDS master `kiro_mcp` (a superuser bypasses the
        // append-only grants — iam-review Finding 2 / SEC-H1). GATE 2 repoints DB_USER + this ARN.
        this.mcpServerRole.addToPrincipalPolicy(new iam.PolicyStatement({
            sid: 'RDSIAMConnect',
            effect: iam.Effect.ALLOW,
            actions: ['rds-db:connect'],
            resources: [`arn:aws:rds-db:${region}:${accountId}:dbuser:${this.dbInstance.instanceResourceId}/kiro_mcp_app`],
        }));
        // ALLOW: SSM GetParameter on NON-SECRET config paths only (db-endpoint/port/name/user,
        // region, mcp-api-key). Scoped to /config/* — deliberately NOT the broad /kiro-governance/*
        // wildcard, so the MCP role cannot read the Slack provisioning-token or the GitHub read-token
        // (CR-05 / CR-16 role↔secret-ARN matrix; runbook §5).
        this.mcpServerRole.addToPrincipalPolicy(new iam.PolicyStatement({
            sid: 'SSMReadConfig',
            effect: iam.Effect.ALLOW,
            actions: ['ssm:GetParameter'],
            resources: [`arn:aws:ssm:${region}:${accountId}:parameter/kiro-governance/config/*`],
        }));
        // ALLOW: KMS Decrypt on AWS-managed SSM key (config SecureStrings: mcp-api-key + bot-token).
        this.mcpServerRole.addToPrincipalPolicy(new iam.PolicyStatement({
            sid: 'KmsDecryptSsm',
            effect: iam.Effect.ALLOW,
            actions: ['kms:Decrypt'],
            resources: [`arn:aws:kms:${region}:${accountId}:key/*`],
            conditions: {
                StringEquals: {
                    'kms:ViaService': `ssm.${region}.amazonaws.com`,
                },
            },
        }));
        // ALLOW: SSM GetParameter on the runtime Slack bot-token ONLY (chat:write, notify_slack).
        // Single-ARN least-privilege — the MCP runtime never reads the provisioning-token or the
        // GitHub read-token. KMS decrypt is already covered by KmsDecryptSsm above (grantKmsDecrypt:
        // false avoids a redundant statement). Source: mcp-server slack.service BOT_TOKEN_SSM_PATH;
        // runbook §4/§5; CR-05 two-token split.
        new ssm_secret_grant_1.SsmSecretGrant(this, 'McpBotTokenGrant', {
            role: this.mcpServerRole,
            parameterName: '/kiro-governance/slack/bot-token',
            region,
            account: accountId,
            grantKmsDecrypt: false,
            sidPrefix: 'SlackBotToken',
        });
        // ==================== Instance Profile ====================
        // Allows EC2 instances to assume the mcpServerRole
        const instanceProfile = new iam.InstanceProfile(this, 'McpServerInstanceProfile', {
            role: this.mcpServerRole,
        });
        cdk.Tags.of(instanceProfile).add('Name', 'kiro-gov-mcp-server-profile');
        // ==================== EC2 Instance ====================
        // User data script
        const userData = ec2.UserData.forLinux();
        userData.addCommands('#!/bin/bash', 'set -euxo pipefail', 
        // Node.js 20 via nvm
        'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash', 'export NVM_DIR="/root/.nvm"', '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"', 'nvm install 20', 'nvm use 20', 'nvm alias default 20', 
        // App directory
        'mkdir -p /opt/kiro-governance', 
        // TLS cert (idempotent)
        'if [ ! -f /opt/kiro-governance/cert.pem ]; then', '  openssl req -x509 -newkey rsa:4096 \\', '    -keyout /opt/kiro-governance/key.pem \\', '    -out /opt/kiro-governance/cert.pem \\', '    -days 365 -nodes \\', '    -subj "/CN=kiro-governance"', '  chmod 600 /opt/kiro-governance/key.pem', '  chmod 644 /opt/kiro-governance/cert.pem', 'fi', 
        // .env.example
        'cat > /opt/kiro-governance/.env.example << \'EOF\'', 'DB_ENDPOINT=localhost', 'DB_PORT=5432', 'DB_NAME=kiro_governance', 'DB_USER=kiro_mcp_app', 'AWS_REGION=us-east-1', 'MCP_API_KEY=REPLACE_WITH_REAL_KEY', 'TLS_CERT_PATH=/opt/kiro-governance/cert.pem', 'TLS_KEY_PATH=/opt/kiro-governance/key.pem', 'PORT=443', 'EOF');
        // EC2 Instance (L2 construct)
        const instance = new ec2.Instance(this, 'McpServer', {
            vpc,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
            machineImage: ec2.MachineImage.latestAmazonLinux2023(),
            securityGroup: sg,
            role: this.mcpServerRole,
            userData,
            userDataCausesReplacement: false,
            blockDevices: [{
                    deviceName: '/dev/xvda',
                    volume: ec2.BlockDeviceVolume.ebs(20, { encrypted: true }),
                }],
        });
        // Elastic IP
        const eip = new ec2.CfnEIP(this, 'McpServerEip', { domain: 'vpc' });
        new ec2.CfnEIPAssociation(this, 'McpServerEipAssoc', {
            instanceId: instance.instanceId,
            allocationId: eip.attrAllocationId,
        });
        // ==================== SSM Parameters ====================
        // Source: data-persistence-architecture.md §6.2
        // RDS connection details
        new ssm.StringParameter(this, 'DbEndpointParam', {
            parameterName: '/kiro-governance/config/db-endpoint',
            stringValue: this.dbInstance.dbInstanceEndpointAddress,
            description: 'RDS instance endpoint',
        });
        new ssm.StringParameter(this, 'DbPortParam', {
            parameterName: '/kiro-governance/config/db-port',
            stringValue: this.dbInstance.dbInstanceEndpointPort,
            description: 'RDS instance port',
        });
        new ssm.StringParameter(this, 'DbNameParam', {
            parameterName: '/kiro-governance/config/db-name',
            stringValue: 'kiro_governance',
            description: 'PostgreSQL database name',
        });
        new ssm.StringParameter(this, 'DbUserParam', {
            parameterName: '/kiro-governance/config/db-user',
            stringValue: 'kiro_mcp_app',
            description: 'PostgreSQL IAM user for MCP server runtime (non-master append-only role; NOT the RDS master kiro_mcp)',
        });
        // Parameter: Region (for SDK clients)
        new ssm.StringParameter(this, 'RegionParam', {
            parameterName: '/kiro-governance/config/region',
            stringValue: region,
            description: 'AWS region for RDS and other services',
        });
        // Note: /kiro-governance/config/mcp-api-key is a SecureString parameter
        // created outside CDK (manually or via deployment script) with a secret value.
        // The MCP server reads it at startup and caches it in memory.
        // Per code-structure.md §6: "API key is loaded from SSM at startup and cached in memory
        // (never re-fetched per-request)"
        // Note: /kiro-governance/slack/webhooks/{project_id} parameters are created
        // outside CDK, per-project, by admin during onboarding. Per data-persistence-architecture.md §6.2:
        // "per-project, created outside CDK"
        // ==================== CloudWatch Log Group ====================
        // Purpose: Centralized logging for MCP server output
        // Source: code-structure.md §11, F-01 §9.2
        new logs.LogGroup(this, 'McpServerLogGroup', {
            logGroupName: '/kiro-governance/mcp-server',
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // ==================== Stack Outputs ====================
        new cdk.CfnOutput(this, 'RdsEndpoint', {
            value: this.dbInstance.dbInstanceEndpointAddress,
            description: 'RDS instance endpoint',
            exportName: 'KiroGovernanceRdsEndpoint',
        });
        new cdk.CfnOutput(this, 'RdsPort', {
            value: this.dbInstance.dbInstanceEndpointPort,
            description: 'RDS instance port',
            exportName: 'KiroGovernanceRdsPort',
        });
        new cdk.CfnOutput(this, 'RdsDbName', {
            value: 'kiro_governance',
            description: 'RDS database name',
        });
        new cdk.CfnOutput(this, 'RdsUser', {
            value: 'kiro_mcp_app',
            description: 'RDS IAM database user for the MCP runtime (non-master append-only role)',
        });
        new cdk.CfnOutput(this, 'McpServerRoleName', {
            value: this.mcpServerRole.roleName,
            description: 'IAM role for MCP server EC2 instance',
            exportName: 'KiroGovernanceMcpServerRole',
        });
        new cdk.CfnOutput(this, 'McpServerRoleArn', {
            value: this.mcpServerRole.roleArn,
            description: 'ARN of MCP server role',
        });
        new cdk.CfnOutput(this, 'InstanceProfileArn', {
            value: instanceProfile.instanceProfileArn,
            description: 'Instance profile ARN for EC2 instances',
            exportName: 'KiroGovernanceMcpServerInstanceProfile',
        });
        new cdk.CfnOutput(this, 'ElasticIP', {
            value: eip.ref,
            description: 'MCP Server Elastic IP — use for MCP_SERVER_URL and SSH access',
            exportName: 'KiroGovernanceMcpServerEIP',
        });
        new cdk.CfnOutput(this, 'McpServerInstanceId', {
            value: instance.instanceId,
            description: 'EC2 instance ID for MCP server',
        });
        new cdk.CfnOutput(this, 'McpServerSecurityGroupId', {
            value: sg.securityGroupId,
            description: 'Security group ID for MCP server',
        });
    }
}
exports.GovernanceStack = GovernanceStack;
