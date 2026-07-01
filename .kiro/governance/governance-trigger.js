#!/usr/bin/env node
'use strict';

/**
 * Kiro Governance Trigger
 * Self-contained — no external dependencies beyond Node.js built-ins.
 * Copy this file and governance-trigger.yml into any project repo to enable governance.
 */

const { execSync } = require('child_process');
const https = require('https');

// ── Canonical gate list (inlined — no shared package dependency) ──────────────
// Changelog: 2026-06-23 — 'Spec file approved' renamed to 'Spec strategy approved' (Tariq Khan).
//            GATE_PHASES corrected to CASDM alignment. GATE_PHASE_NAMES added.
const MACRO_GATES = [
  'Discovery outputs validated',
  'Preliminary SRS validated',
  'SRS approved',
  'Design docs approved',
  'Implementation plan approved',
  'Spec strategy approved',
  'Code approved',
  'UAT report approved',
  'Runbooks approved',
  'Project documentation approved',
];

const MACRO_GATE_ALIASES = {
  'solution architecture approved': 'Design docs approved',
  'sprint plan approved': 'Implementation plan approved',
  'documentation approved': 'Runbooks approved',
  'spec file approved': 'Spec strategy approved',
};

const GATE_PHASES = {
  'Discovery outputs validated':    'Phase 0',
  'Preliminary SRS validated':      'Phase 0',
  'SRS approved':                   'Phase 1',
  'Design docs approved':           'Phase 2',
  'Implementation plan approved':   'Phase 2',
  'Spec strategy approved':         'Phase 3',
  'Code approved':                  'Phase 3',
  'UAT report approved':            'Phase 3',
  'Runbooks approved':              'Phase 4',
  'Project documentation approved': 'Phase 4',
};

const GATE_PHASE_NAMES = {
  'Discovery outputs validated':    'Internal Preparation',
  'Preliminary SRS validated':      'Internal Preparation',
  'SRS approved':                   'Discover & Align',
  'Design docs approved':           'Design & Review',
  'Implementation plan approved':   'Design & Review',
  'Spec strategy approved':         'Build & Implement',
  'Code approved':                  'Build & Implement',
  'UAT report approved':            'Build & Implement',
  'Runbooks approved':              'Launch & Enable',
  'Project documentation approved': 'Launch & Enable',
};

// ── Environment variables ─────────────────────────────────────────────────────
const MCP_SERVER_URL = process.env.MCP_SERVER_URL;
const MCP_API_KEY = process.env.MCP_API_KEY;
const MCP_CERT_FINGERPRINT = process.env.MCP_CERT_FINGERPRINT;
const PROJECT_ID = process.env.PROJECT_ID;
const ACTOR = process.env.ACTOR;
const SOURCE_REF = process.env.SOURCE_REF;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;

if (!MCP_SERVER_URL || !MCP_API_KEY || !MCP_CERT_FINGERPRINT || !PROJECT_ID || !ACTOR || !SOURCE_REF) {
  console.error('Missing required environment variables: MCP_SERVER_URL, MCP_API_KEY, MCP_CERT_FINGERPRINT, PROJECT_ID, ACTOR, SOURCE_REF');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractAddedLines() {
  try {
    const diff = execSync('git diff HEAD~1 HEAD -- docs/project-progress.md', { encoding: 'utf8' });
    return diff
      .split('\n')
      .filter(line => line.startsWith('+') && !line.startsWith('+++'))
      .map(line => line.slice(1).trim())
      .filter(line => line.length > 0);
  } catch {
    console.log('No diff available. Exiting cleanly.');
    return [];
  }
}

function matchGate(line) {
  const lower = line.toLowerCase();
  for (const [alias, canonical] of Object.entries(MACRO_GATE_ALIASES)) {
    if (lower.includes(alias.toLowerCase())) return canonical;
  }
  for (const gate of MACRO_GATES) {
    if (lower.includes(gate.toLowerCase())) return gate;
  }
  return null;
}

function callMcpTool(toolName, params) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(MCP_SERVER_URL);
    const body = JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: params },
      id: `${toolName}-${Date.now()}`,
    });

    const req = https.request(
      {
        host: urlObj.hostname,
        port: urlObj.port || 443,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'X-API-Key': MCP_API_KEY,
          'Content-Length': Buffer.byteLength(body),
        },
        rejectUnauthorized: false,
        checkServerIdentity: (_host, cert) => {
          const actual = cert.fingerprint256;
          if (actual !== MCP_CERT_FINGERPRINT) {
            return new Error(`TLS fingerprint mismatch: expected ${MCP_CERT_FINGERPRINT}, got ${actual}`);
          }
        },
      },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const dataLine = data.split('\n').find(l => l.startsWith('data:'));
            resolve(dataLine ? JSON.parse(dataLine.slice(5).trim()) : JSON.parse(data.trim()));
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

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const addedLines = extractAddedLines();
  if (addedLines.length === 0) { console.log('No new lines. Exiting cleanly.'); process.exit(0); }

  console.log(`Found ${addedLines.length} added line(s).`);

  const macroEntries = addedLines.map(line => ({ line, gate: matchGate(line) })).filter(e => e.gate);
  if (macroEntries.length === 0) { console.log('No macro-gate entries detected. Exiting cleanly.'); process.exit(0); }

  console.log(`Found ${macroEntries.length} macro-gate entries.`);
  let failures = 0;

  for (const { line, gate } of macroEntries) {
    console.log(`Processing gate: "${gate}" from line: "${line}"`);
    try {
      const recordResult = await callMcpTool('record_progress', {
        project_id: PROJECT_ID,
        update_text: line,
        type: 'macro',
        gate,
        phase: GATE_PHASES[gate] || undefined,
        phase_name: GATE_PHASE_NAMES[gate] || undefined,
        source_ref: SOURCE_REF,
        actor: ACTOR,
      });

      const content = recordResult?.result?.content?.[0]?.text;
      const parsed = content ? JSON.parse(content) : {};

      if (parsed.written === false) {
        console.log(`  → Duplicate (already recorded). Skipping notify_slack.`);
        continue;
      }

      const shortSha = SOURCE_REF.slice(0, 7);
      const commitUrl = GITHUB_REPOSITORY
        ? `https://github.com/${GITHUB_REPOSITORY}/commit/${SOURCE_REF}`
        : null;
      const refPart = commitUrl ? `(<${commitUrl}|${shortSha}>)` : `(ref: ${shortSha})`;

      await callMcpTool('notify_slack', {
        project_id: PROJECT_ID,
        message: `${gate} — committed by ${ACTOR} ${refPart}`,
        event_type: 'macro',
      });

      console.log(`  → Recorded and notified.`);
    } catch (err) {
      console.error(`  → ERROR: ${err.message}`);
      failures++;
    }
  }

  if (failures > 0) { console.error(`${failures} MCP call(s) failed.`); process.exit(1); }
  console.log('All macro entries processed successfully.');
}

main().catch(err => { console.error(`Unexpected error: ${err.message}`); process.exit(1); });
