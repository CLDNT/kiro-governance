import { Stack } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';

/**
 * Documented, justified CDK Nag (`AwsSolutions`) suppressions for the kiro-governance POC stacks.
 *
 * Policy (cdk-constructs-standards §9): CDK Nag runs as an Aspect and violations throw at synth.
 * Every accepted finding MUST carry an explicit, auditable reason here rather than being silently
 * ignored. Suppressions are applied at the stack level with `applyToChildren = true` so they also
 * cover resources inside the DeliverPro nested stacks (StatefulStack / StatelessStack). Revisit and
 * tighten (or remove) each entry before any production ("prod") deployment — several are only
 * acceptable because this is a single-tenant internal POC on `dev`.
 *
 * NB: this file does NOT weaken the V005 append-only model. The MCP runtime still authenticates as
 * the non-master `kiro_mcp_app` role (governance-stack RDSIAMConnect ARN) — no suppression touches
 * that control.
 */
export function applyNagSuppressions(stack: Stack): void {
  NagSuppressions.addStackSuppressions(
    stack,
    [
      // ── Network / compute (GovernanceStack: EC2 MCP server + RDS) ─────────────────────────────
      {
        id: 'AwsSolutions-EC23',
        reason:
          'MCP server is an internet-facing endpoint by design: Kiro CLI clients connect over HTTPS :443 from arbitrary developer IPs, and :22 is gated by the `adminCidr` context (defaults to a placeholder that MUST be narrowed per environment). Auth is enforced at the app layer (X-API-Key + pinned TLS cert fingerprint). POC accepts the open 443; prod should front it with a narrower CIDR / ALB + WAF.',
      },
      {
        id: 'AwsSolutions-EC28',
        reason:
          'Detailed (1-minute) EC2 monitoring is not justified for a single t3.micro POC MCP host; basic 5-minute CloudWatch metrics + the app log group suffice. Revisit for prod.',
      },
      {
        id: 'AwsSolutions-EC29',
        reason:
          'The MCP EC2 host is stateless (all state is in RDS + SSM) and fronted by a stable Elastic IP; it can be recreated without data loss, so instance termination protection is unnecessary for the POC.',
      },
      {
        id: 'AwsSolutions-RDS2',
        reason:
          'FOLLOW-UP (tracked): the shared RDS instance was created without storage encryption. Enabling encryption on an existing instance requires a snapshot-restore/replace, which is blocked here by RETAIN + deletionProtection. Accepted for the POC (internal-employee audit data only, no customer PII — see unified-data-model.md §6); must be remediated (encrypted replacement) before any regulated/prod use.',
      },
      {
        id: 'AwsSolutions-RDS3',
        reason:
          'Single-AZ is an accepted cost trade-off for the POC (t3.micro, 7-day automated backups). Multi-AZ is a prod hardening item.',
      },
      {
        id: 'AwsSolutions-RDS11',
        reason:
          'Default PostgreSQL port 5432 is retained; the instance is only reachable from the MCP/Lambda security groups (no public port exposure), so port obfuscation adds no meaningful defense here.',
      },
      {
        id: 'AwsSolutions-SMG4',
        reason:
          'The RDS master-user secret (and the placeholder Avoma API-key secret) are not on automatic rotation for the POC. The MCP/Lambda RUNTIME does not use the master secret — it authenticates via short-lived RDS IAM tokens as kiro_mcp_app/kiro_phase2. The master secret is admin/break-glass only; rotation is a documented manual/ops task. Revisit for prod.',
      },

      // ── IAM (both stacks) ─────────────────────────────────────────────────────────────────────
      {
        id: 'AwsSolutions-IAM4',
        reason:
          'The only AWS-managed policy in use is AmazonAPIGatewayPushToCloudWatchLogs, attached to the API Gateway account CloudWatch role that CDK provisions automatically. It is the standard, least-privilege managed policy for that purpose.',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'Remaining wildcards are scoped to service-required patterns that cannot be enumerated at synth time: CloudWatch Logs on `/aws/lambda/*` (per-function log groups), EC2 ENI actions on `*` (mandatory for Lambda-in-VPC / RDS IAM auth), SSM `GetParameter` on the non-secret `/kiro-governance/config/*` and `/deliverpro/*` config prefixes, KMS `Decrypt` conditioned on `kms:ViaService = ssm.<region>.amazonaws.com`, and S3 on the `evidence/*` object prefix. Each per-credential SSM secret (Slack bot/provisioning tokens, GitHub read-token) is granted as a SINGLE parameter ARN via SsmSecretGrant — those are NOT wildcarded. The RDS IAM `rds-db:connect` ARNs are pinned to the exact dbuser (`kiro_mcp_app` / `kiro_phase2`).',
      },

      // ── API Gateway (DeliverPro StatelessStack) ───────────────────────────────────────────────
      {
        id: 'AwsSolutions-APIG1',
        reason:
          'API Gateway access logging is deferred for the POC; execution logging (INFO) is enabled on the stage and application-level audit logging is handled in the Lambda layer. Enable access logs for prod.',
      },
      {
        id: 'AwsSolutions-APIG2',
        reason:
          'Request payloads are validated in-handler with Zod schemas at the domain boundary (backend-standards §9). API Gateway request-model validation is not used; validation correctness is covered by unit tests.',
      },
      {
        id: 'AwsSolutions-APIG3',
        reason:
          'No WAFv2 web ACL on the REST API for the POC (cost). Access is Cognito-authenticated; WAF is a prod hardening item tracked alongside CFR2.',
      },

      // ── CloudFront (DeliverPro StatelessStack) ────────────────────────────────────────────────
      {
        id: 'AwsSolutions-CFR1',
        reason: 'Geo restriction is not required — the app serves an internal, geographically-unrestricted employee audience.',
      },
      {
        id: 'AwsSolutions-CFR2',
        reason: 'AWS WAF integration on the CloudFront distribution is a prod hardening item (cost); the POC serves a static SPA behind Cognito-authenticated APIs.',
      },
      {
        id: 'AwsSolutions-CFR3',
        reason: 'CloudFront access logging is enabled only in prod (see `enableLogging: environment === "prod"`); disabled on dev to avoid log-bucket cost for the POC.',
      },
      {
        id: 'AwsSolutions-CFR4',
        reason:
          'The distribution uses the default CloudFront certificate/viewer policy (no custom domain), which permits older TLS versions on the *.cloudfront.net domain. A custom domain + ACM cert with a TLSv1.2_2021 minimum-protocol policy is a prod item.',
      },

      // ── Cognito (DeliverPro StatefulStack) ────────────────────────────────────────────────────
      {
        id: 'AwsSolutions-COG2',
        reason: 'MFA is not enforced for the POC internal user pool. Enabling MFA (TOTP) is a documented prod hardening item (auth-architecture).',
      },
      {
        id: 'AwsSolutions-COG8',
        reason: 'The Cognito user pool uses the default (Lite) feature plan; the Plus tier advanced-security features are not warranted for the internal POC and are a prod cost/hardening decision.',
      },

      // ── S3 (DeliverPro StatefulStack) ─────────────────────────────────────────────────────────
      {
        id: 'AwsSolutions-S1',
        reason:
          'Server access logging is disabled on the frontend and evidence buckets for the POC (avoids a dedicated log bucket + its own S1 finding). Both buckets block public access; evidence access is app-authorized. Enable access logging for prod audit needs.',
      },

      // ── SNS (DeliverPro alarms) ───────────────────────────────────────────────────────────────
      {
        id: 'AwsSolutions-SNS3',
        reason:
          'The CloudWatch-alarms SNS topic does not enforce an SSL-only publish policy. Publishers are AWS-internal (CloudWatch Alarms / Budgets) over the AWS network; no external publishers exist. Adding an aws:SecureTransport deny policy is a low-value prod hardening item.',
      },

      // ── Lambda runtime (DeliverPro StatelessStack) ────────────────────────────────────────────
      {
        id: 'AwsSolutions-L1',
        reason:
          'Lambda runtime version is pinned intentionally for reproducible POC builds. Runtime currency is managed as a deliberate, tested upgrade (dependency-management standards) rather than always tracking "latest" automatically.',
      },
    ],
    true, // applyToChildren — cascade into nested stacks (StatefulStack / StatelessStack) and their resources
  );
}
