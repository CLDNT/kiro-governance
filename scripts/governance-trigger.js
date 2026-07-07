#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const https = require('https');
const path = require('path');

// Load shared constants from compiled output
let matchGateFromText;
try {
  const shared = require(path.resolve(__dirname, '../packages/shared/dist/constants/macro-gates'));
  matchGateFromText = shared.matchGateFromText;
  if (typeof matchGateFromText !== 'function') {
    throw new Error('shared macro-gates did not export matchGateFromText');
  }
} catch (err) {
  console.error(`Failed to load shared constants: ${err.message}`);
  process.exit(1);
}

// Environment variables
const MCP_SERVER_URL = process.env.MCP_SERVER_URL;
const MCP_API_KEY = process.env.MCP_API_KEY;
const MCP_CERT_FINGERPRINT = process.env.MCP_CERT_FINGERPRINT;
const PROJECT_ID = process.env.PROJECT_ID;
const ACTOR = process.env.ACTOR;
const SOURCE_REF = process.env.SOURCE_REF;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY; // e.g. CODEZAX-CE/kiro-governance

// Event mode (v3 GitHub/Slack linkage CR):
//   'micro' (DEFAULT) — CI/Kiro path emits MICRO events + micro-channel notify
//                       (v3 §0.1 / v3-6.1). The DeliverPro app owns MACRO, so
//                       the CI path must NOT double-notify on the macro channel.
//   'macro'           — CLI-macro backward-compat path (D-v3-10 / §0.3) for pure
//                       Kiro-CLI repos that have NO in-app macro approver. Emits a
//                       display-only macro event (does NOT set reached_at) + a
//                       macro-channel notify, preserving the demoed
//                       "progress-MD → gate → Slack macro" behaviour.
const EVENT_MODE = (process.env.GOVERNANCE_EVENT_MODE || 'micro').toLowerCase();

/**
 * Validate required environment. Called from main() only (NOT at module load) so this file
 * can be `require()`d by unit tests without triggering process.exit on unset env vars.
 */
function validateEnv() {
  if (!MCP_SERVER_URL || !MCP_API_KEY || !MCP_CERT_FINGERPRINT || !PROJECT_ID || !ACTOR || !SOURCE_REF) {
    console.error(
      'Missing required environment variables: ' +
      'MCP_SERVER_URL, MCP_API_KEY, MCP_CERT_FINGERPRINT, PROJECT_ID, ACTOR, SOURCE_REF'
    );
    process.exit(1);
  }

  if (EVENT_MODE !== 'micro' && EVENT_MODE !== 'macro') {
    console.error(`Invalid GOVERNANCE_EVENT_MODE: "${EVENT_MODE}". Expected "micro" (default) or "macro".`);
    process.exit(1);
  }
}

/**
 * Extract added lines from git diff.
 * Returns array of trimmed strings (+ prefix already removed).
 */
function extractAddedLines() {
  try {
    const diff = execSync('git diff HEAD~1 HEAD -- docs/project-progress.md', { encoding: 'utf8' });
    return diff
      .split('\n')
      .filter(line => line.startsWith('+') && !line.startsWith('+++'))
      .map(line => line.slice(1).trim())
      .filter(line => line.length > 0);
  } catch (err) {
    console.log('No diff available or file does not exist. Exiting cleanly.');
    return [];
  }
}

/**
 * Match a line against macro gates. Delegates to the shared `matchGateFromText`
 * (canonical-first, alias-bleed-free — single source of gate vocabulary).
 * Returns the canonical gate name, or null when nothing matches (script convention).
 */
function matchGate(line) {
  return matchGateFromText(line) || null;
}

/**
 * Call MCP server tool via HTTPS with cert fingerprint pinning.
 * Returns parsed JSON response.
 */
function callMcpTool(toolName, params) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(MCP_SERVER_URL);
    const host = urlObj.hostname;
    const port = urlObj.port || 443;

    const body = JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: params },
      id: `${toolName}-${Date.now()}`,
    });

    const req = https.request(
      {
        host,
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'X-API-Key': MCP_API_KEY,
          'Content-Length': Buffer.byteLength(body),
        },
        checkServerIdentity: (_host, cert) => {
          const actual = cert.fingerprint256;
          if (actual !== MCP_CERT_FINGERPRINT) {
            return new Error(
              `TLS cert fingerprint mismatch: expected ${MCP_CERT_FINGERPRINT}, got ${actual}`
            );
          }
          return undefined; // OK
        },
        // Required for self-signed certs: allows checkServerIdentity to run
        // Security is provided by the fingerprint check above, not the CA chain
        rejectUnauthorized: false,
      },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            // MCP server responds with SSE format: "event: message\ndata: {...}\n\n"
            // Extract the data: line and parse it
            const dataLine = data.split('\n').find(line => line.startsWith('data:'));
            if (dataLine) {
              resolve(JSON.parse(dataLine.slice(5).trim()));
            } else {
              resolve(JSON.parse(data.trim()));
            }
          } catch (err) {
            reject(new Error(`Failed to parse MCP response: ${err.message}. Raw: ${data.slice(0, 200)}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Build the record_progress arguments for a matched gate line, by event mode.
 *
 * MICRO (default, v3 §0.1 / PLAN-H1): explicit `type:'micro'` + `flag_override:true` + a NON-GATE
 *   `update_text` so no substring can re-classify it to macro. The `gate` is passed only to build a
 *   human-readable Slack label — it does NOT imply macro.
 *
 * MACRO (CLI display-only backward-compat, §0.3 / D-v3-10): `type:'macro'` + `flag_override:true`
 *   for pure-Kiro-CLI repos with no in-app approver. This is a DISPLAY-ONLY macro governance event:
 *   it surfaces on the timeline and triggers a macro-channel notify, but it carries NO field that
 *   sets `macro_checkpoints.reached_at` — macro COMPLETION stays app-owned (gates §5.3). The args
 *   are a plain governance event only (project_id/update_text/type/gate/source_ref/actor); there is
 *   deliberately no `reached_at`, `occurred`, or `reviewed_by` here.
 *
 * @param {{ mode: 'micro'|'macro', projectId: string, line: string, gate: string,
 *           sourceRef: string, actor: string }} params
 * @returns {object} record_progress arguments
 */
function buildRecordArgs({ mode, projectId, line, gate, sourceRef, actor }) {
  if (mode === 'macro') {
    return {
      project_id: projectId,
      update_text: line, // raw progress-MD line; macro is intentional (display-only)
      type: 'macro',
      flag_override: true,
      gate,
      source_ref: sourceRef,
      actor,
    };
  }
  return {
    project_id: projectId,
    update_text: 'Progress update: docs/project-progress.md changed', // non-gate label (PLAN-H1)
    type: 'micro',
    flag_override: true,
    gate,
    source_ref: sourceRef,
    actor,
  };
}

/**
 * Build the human-readable Slack notification message for a gate.
 * Uses a rich commit link when GITHUB_REPOSITORY is available, else a short ref.
 */
function buildNotifyMessage(gate) {
  const shortSha = SOURCE_REF.slice(0, 7);
  const commitUrl = GITHUB_REPOSITORY
    ? `https://github.com/${GITHUB_REPOSITORY}/commit/${SOURCE_REF}`
    : null;
  const refPart = commitUrl ? `(<${commitUrl}|${shortSha}>)` : `(ref: ${shortSha})`;
  return `${gate} — committed by ${ACTOR} ${refPart}`;
}

async function main() {
  validateEnv();

  const addedLines = extractAddedLines();

  if (addedLines.length === 0) {
    console.log('No new lines in project-progress.md. Exiting cleanly.');
    process.exit(0);
  }

  console.log(`Found ${addedLines.length} added line(s).`);
  console.log(`Governance event mode: "${EVENT_MODE}".`);

  // Extract gate entries. The gate name is used ONLY to build a human-readable
  // label — under the MICRO path it does NOT imply type:'macro' (v3 §0.1).
  const gateEntries = [];
  for (const line of addedLines) {
    const gate = matchGate(line);
    if (gate) {
      gateEntries.push({ line, gate });
    }
  }

  if (gateEntries.length === 0) {
    console.log('No macro-gate entries detected. Exiting cleanly.');
    process.exit(0);
  }

  console.log(`Found ${gateEntries.length} gate entries.`);

  const isMacroMode = EVENT_MODE === 'macro';
  let failures = 0;

  for (const { line, gate } of gateEntries) {
    console.log(`Processing gate: "${gate}" from line: "${line}"`);

    try {
      // record_progress params differ by mode (see buildRecordArgs for the full rationale).
      //   MICRO (default): type:'micro' + flag_override:true + non-gate update_text (PLAN-H1).
      //   MACRO (CLI display-only, §0.3): type:'macro' + flag_override:true; surfaces on the
      //     timeline + notifies the macro channel but sets NO reached_at (app-owned completion).
      const recordArgs = buildRecordArgs({
        mode: EVENT_MODE,
        projectId: PROJECT_ID,
        line,
        gate,
        sourceRef: SOURCE_REF,
        actor: ACTOR,
      });

      const recordResult = await callMcpTool('record_progress', recordArgs);

      const content = recordResult?.result?.content?.[0]?.text;
      const parsed = content ? JSON.parse(content) : {};

      // No-orphan (v3 §0.2 / CR-08): unlinked repo → hard-rejected by the server.
      // The script logs and CONTINUES (non-blocking) — unlinked repos produce
      // nothing (optional-linkage feature switch). This is NOT a failure.
      if (parsed.reason === 'no_matching_project') {
        console.log(`  → Repo "${PROJECT_ID}" not linked to a project. Skipping (feature switch off).`);
        continue;
      }

      if (parsed.written === false) {
        console.log(`  → Not written (${parsed.reason || 'unknown'}). Skipping notify_slack.`);
        continue;
      }

      // notify_slack — channel is driven by event_type (dual-channel, CR-09).
      //   MICRO → slack_micro_channel_id; MACRO → slack_macro_channel_id.
      const notifyResult = await callMcpTool('notify_slack', {
        project_id: PROJECT_ID,
        message: buildNotifyMessage(gate),
        event_type: isMacroMode ? 'macro' : 'micro',
      });

      const notifyContent = notifyResult?.result?.content?.[0]?.text;
      const notifyParsed = notifyContent ? JSON.parse(notifyContent) : {};
      const channelLabel = isMacroMode ? 'macro' : 'micro';
      if (notifyParsed.notified) {
        console.log(`  → Recorded (${channelLabel}) and Slack notified (${channelLabel} channel).`);
      } else {
        console.log(`  → Recorded (${channelLabel}). Slack skipped: ${notifyParsed.reason || 'unknown'}`);
      }
    } catch (err) {
      console.error(`  → ERROR: ${err.message}`);
      failures++;
    }
  }

  if (failures > 0) {
    console.error(`${failures} MCP call(s) failed.`);
    process.exit(1);
  }

  console.log('All gate entries processed successfully.');
  process.exit(0);
}

// Only auto-run when executed directly (node scripts/governance-trigger.js), NOT when
// required by a unit test — so tests can import the pure helpers without side effects.
if (require.main === module) {
  main().catch(err => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { matchGate, buildRecordArgs, buildNotifyMessage, main };
