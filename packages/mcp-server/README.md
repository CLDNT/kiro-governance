# MCP Server (`@kiro-governance/mcp-server`)

Governance MCP server (F-01). Exposes the `record_progress` and `notify_slack`
tools over HTTPS on port 443. Persists governance events to Aurora PostgreSQL and
sends Slack notifications.

See `docs/phase1/mcp-server-core-architecture.md` for the full architecture.

---

## Slack integration — bot-token model (CR-05)

CR-05 replaces the per-repo incoming-webhook model with a single **workspace-level
Slack bot token** used against the Slack Web API `chat.postMessage` method.

**Source of record:** `docs/phase2/change-requests/2026-07-02-github-slack-linkage-impact.md`
(v3 Final Design of Record, Decision D + §v3-5.3) and the
`docs/phase1/mcp-server-core-architecture.md` §0 overlay.

### What CR-05 delivers

- `getBotToken(ssmClient)` — retrieves the workspace bot token from SSM
  SecureString, cached in memory with a 5-minute TTL (mirrors the legacy webhook
  cache TTL so a rotated token is picked up within one window without a restart).
- `postMessageToChannel(token, channelId, text)` — posts a plain-text message to a
  Slack channel via `POST https://slack.com/api/chat.postMessage` with
  `Authorization: Bearer <token>`. Treats HTTP 200 with `{ ok: false }` as a
  logical failure (Slack returns 200 even on error).
- `SlackServiceError` with typed, generic `code` values — the token, webhook URLs,
  and SSM paths are never included in an error message or logged.

### Explicitly NOT in CR-05

- Wiring routing / dual-channel selection into the `notify_slack` tool — that is
  **CR-09**. CR-05 provides the token retrieval + `chat.postMessage` client only.
- Channel provisioning (`conversations.create` / `conversations.list`) and storage
  of `slack_micro_channel_id` / `slack_macro_channel_id` — Phase 2 app work.
- The legacy `getWebhookUrl` / `postToSlack` helpers remain (marked
  `@deprecated`) as the CR-09 transition fallback (v3-5.3 / PLAN-H2b) so repos
  currently notified via webhooks do not go dark at cutover.

### Bot-token SSM parameter

| Property | Value |
|----------|-------|
| Path | `/kiro-governance/slack/bot-token` |
| Type | `SecureString` |
| Value | Single workspace Slack **bot token** (`xoxb-…`) — **secret** |
| Scope | Runtime token carries `chat:write` only (SEC-M1 two-token split). Provisioning scopes (`channels:read` / `channels:manage`) live on a **separate** credential held only by the app onboarding path — never used by this server. |

**Secret-handling rules (mandatory):**

- The bot token is stored **only** in SSM SecureString (or Secrets Manager). It is
  **never** committed to code or the repo, never a PostgreSQL column, never in an
  API response, and never logged.
- Only the non-secret **path** (`/kiro-governance/slack/bot-token`) appears in
  source (`BOT_TOKEN_SSM_PATH` in `src/services/slack.service.ts`).
- Provisioning the parameter (`ssm:PutParameter`) is admin-only / out-of-band —
  never granted to the MCP server runtime role.

### Least-privilege IAM (documentation only — do NOT edit live infra here)

The MCP server EC2 instance role needs, for Slack, exactly:

```jsonc
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SlackBotTokenRead",
      "Effect": "Allow",
      "Action": ["ssm:GetParameter"],
      "Resource": "arn:aws:ssm:<region>:<account-id>:parameter/kiro-governance/slack/bot-token"
    },
    {
      "Sid": "SlackBotTokenDecrypt",
      "Effect": "Allow",
      "Action": ["kms:Decrypt"],
      // aws/ssm managed key, or a scoped CMK if adopted (OQ-CR-18). Do NOT use "*".
      "Resource": "arn:aws:kms:<region>:<account-id>:key/<ssm-kms-key-id>",
      "Condition": {
        "StringEquals": { "kms:ViaService": "ssm.<region>.amazonaws.com" }
      }
    }
  ]
}
```

- Scope `ssm:GetParameter` + `kms:Decrypt` to the **single bot-token parameter ARN
  only** — not `/kiro-governance/*` and not `*`.
- No `ssm:PutParameter`. No `admin.*` Slack scopes.
- The CDK/infra change that applies this policy is a separate story
  (CR-05 infra / CR-09); this README documents the required grant only.

---

## Environment variables (systemd, on EC2)

| Variable | Example | Purpose |
|----------|---------|---------|
| `PORT` | `443` | HTTPS listen port |
| `TLS_CERT_PATH` | `/opt/kiro-governance/cert.pem` | TLS certificate |
| `TLS_KEY_PATH` | `/opt/kiro-governance/key.pem` | TLS private key |
| `AWS_REGION` | `us-east-1` | SDK region |
| `DB_ENDPOINT` / `DB_PORT` / `DB_NAME` / `DB_USER` | — | RDS PostgreSQL IAM-auth connection. `DB_USER` MUST be the non-master runtime role `kiro_mcp_app` (NOT the RDS master `kiro_mcp`) — append-only is only enforced when the MCP server connects as this NOSUPERUSER role (V005 / iam-review Finding 2, GATE 2). |
| `RDS_CA_BUNDLE_PATH` | `/opt/kiro-governance/rds-ca-bundle.pem` | RDS TLS CA bundle |

Secrets (API key, Slack bot token) are read from SSM at runtime — never passed as
environment variables.

## Testing

```bash
npm test -w packages/mcp-server                 # all mcp-server tests
npx jest packages/mcp-server/src/services/__tests__/slack.service.test.ts
```

Unit tests mock the SSM client and global `fetch`; no real Slack or AWS calls are
made. The suite asserts token caching, `chat.postMessage` success/failure mapping,
and that the bot token is never logged.
