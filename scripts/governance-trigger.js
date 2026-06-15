#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const https = require('https');
const path = require('path');

// Load shared constants from compiled output
let MACRO_GATES, MACRO_GATE_ALIASES;
try {
  const shared = require(path.resolve(__dirname, '../packages/shared/dist/constants/macro-gates'));
  MACRO_GATES = shared.MACRO_GATES;
  MACRO_GATE_ALIASES = shared.MACRO_GATE_ALIASES;
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

// Validate required env vars
if (!MCP_SERVER_URL || !MCP_API_KEY || !MCP_CERT_FINGERPRINT || !PROJECT_ID || !ACTOR || !SOURCE_REF) {
  console.error(
    'Missing required environment variables: ' +
    'MCP_SERVER_URL, MCP_API_KEY, MCP_CERT_FINGERPRINT, PROJECT_ID, ACTOR, SOURCE_REF'
  );
  process.exit(1);
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
 * Match a line against macro gates using case-insensitive substring.
 * Returns canonical gate name or null.
 */
function matchGate(line) {
  const lower = line.toLowerCase();

  // Try canonical gates first
  for (const gate of MACRO_GATES) {
    if (lower.includes(gate.toLowerCase())) {
      return gate;
    }
  }

  // Try aliases
  for (const [alias, canonical] of Object.entries(MACRO_GATE_ALIASES)) {
    if (lower.includes(alias.toLowerCase())) {
      return canonical;
    }
  }

  return null;
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

async function main() {
  const addedLines = extractAddedLines();

  if (addedLines.length === 0) {
    console.log('No new lines in project-progress.md. Exiting cleanly.');
    process.exit(0);
  }

  console.log(`Found ${addedLines.length} added line(s).`);

  // Extract macro entries
  const macroEntries = [];
  for (const line of addedLines) {
    const gate = matchGate(line);
    if (gate) {
      macroEntries.push({ line, gate });
    }
  }

  if (macroEntries.length === 0) {
    console.log('No macro-gate entries detected. Exiting cleanly.');
    process.exit(0);
  }

  console.log(`Found ${macroEntries.length} macro-gate entries.`);

  let failures = 0;

  // Process each macro entry
  for (const { line, gate } of macroEntries) {
    console.log(`Processing gate: "${gate}" from line: "${line}"`);

    try {
      // Call record_progress
      const recordResult = await callMcpTool('record_progress', {
        project_id: PROJECT_ID,
        update_text: line,
        type: 'macro',
        gate,
        source_ref: SOURCE_REF,
        actor: ACTOR,
      });

      const content = recordResult?.result?.content?.[0]?.text;
      const parsed = content ? JSON.parse(content) : {};

      if (parsed.written === false) {
        console.log(`  → Duplicate (already recorded). Skipping notify_slack.`);
        continue;
      }

      // Call notify_slack only if record_progress succeeded
      const shortSha = SOURCE_REF.slice(0, 7);
      const commitUrl = GITHUB_REPOSITORY
        ? `https://github.com/${GITHUB_REPOSITORY}/commit/${SOURCE_REF}`
        : null;
      const refPart = commitUrl
        ? `(<${commitUrl}|${shortSha}>)`
        : `(ref: ${shortSha})`;
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

  if (failures > 0) {
    console.error(`${failures} MCP call(s) failed.`);
    process.exit(1);
  }

  console.log('All macro entries processed successfully.');
  process.exit(0);
}

main().catch(err => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
