import https from 'node:https';
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { validateApiKey } from './middleware/api-key.js';
import { registerRecordProgress } from './tools/record-progress.js';
import { registerNotifySlack } from './tools/notify-slack.js';

/**
 * Server configuration loaded from SSM and cached at startup.
 */
interface ServerConfig extends Record<string, unknown> {
  tableName: string;
  region: string;
  apiKey: string;
}

/**
 * MCP server bootstrap.
 * Loads TLS cert/key, config from SSM, creates HTTPS server,
 * registers MCP tools, and listens on port 443.
 */
async function bootstrap(): Promise<void> {
  // 1. Validate required environment variables (fail fast)
  const requiredEnvs = ['TLS_CERT_PATH', 'TLS_KEY_PATH', 'AWS_REGION', 'PORT'];
  const missingEnvs = requiredEnvs.filter(env => !process.env[env]);
  if (missingEnvs.length > 0) {
    throw new Error(`Missing required environment variables: ${missingEnvs.join(', ')}`);
  }

  const port = parseInt(process.env.PORT || '443', 10);
  const tlsCertPath = process.env.TLS_CERT_PATH!;
  const tlsKeyPath = process.env.TLS_KEY_PATH!;

  // 2. Load TLS certificate and key
  let tlsCert: Buffer;
  let tlsKey: Buffer;
  try {
    tlsCert = readFileSync(tlsCertPath);
    tlsKey = readFileSync(tlsKeyPath);
  } catch (err) {
    throw new Error(`Failed to read TLS cert/key: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Load config from SSM (cache in memory)
  const ssmClient = new SSMClient({ region: process.env.AWS_REGION });
  const config = await loadServerConfig(ssmClient);
  console.info('Loaded config from SSM', {
    tableName: config.tableName,
    region: config.region,
  });

  // 4. Create HTTPS server with TLS config
  const httpsServer = https.createServer({
    cert: tlsCert,
    key: tlsKey,
  });

  // 5. Attach HTTP routing
  httpsServer.on('request', (req, res) => {
    // Health check endpoint (no API key required)
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      return;
    }

    // MCP endpoint with API key validation
    if (req.url === '/mcp' && req.method === 'POST') {
      if (!validateApiKey(req, res, config.apiKey)) {
        return; // Middleware already sent 401
      }
      // Buffer the request body
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', async () => {
        try {
          const body = Buffer.concat(chunks).toString();
          const parsedBody = body ? JSON.parse(body) : undefined;
          // Create a fresh McpServer per request — the SDK does not support
          // reusing a single instance across concurrent connections.
          const requestServer = new McpServer({ name: 'kiro-governance', version: '1.0.0' });
          registerRecordProgress(requestServer, config);
          registerNotifySlack(requestServer, { ssmClient });
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined } as any);
          await requestServer.connect(transport);
          await (transport as any).handleRequest(req, res, parsedBody);
        } catch (err) {
          console.error('MCP transport error:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal error', code: 'INTERNAL_ERROR' }));
        }
      });
      return;
    }

    // 404 for unknown endpoints
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', code: 'NOT_FOUND' }));
  });

  // 8. Start server
  httpsServer.listen(port, () => {
    console.info(`kiro-governance MCP server listening on :${port}`);
  });
}

/**
 * Load server config from SSM Parameter Store.
 * Caches values in memory — no per-request fetches.
 */
async function loadServerConfig(ssmClient: SSMClient): Promise<ServerConfig> {
  const [tableNameParam, regionParam, apiKeyParam] = await Promise.all([
    ssmClient.send(
      new GetParameterCommand({
        Name: '/kiro-governance/config/table-name',
        WithDecryption: false,
      }),
    ),
    ssmClient.send(
      new GetParameterCommand({
        Name: '/kiro-governance/config/region',
        WithDecryption: false,
      }),
    ),
    ssmClient.send(
      new GetParameterCommand({
        Name: '/kiro-governance/config/mcp-api-key',
        WithDecryption: true,
      }),
    ),
  ]);

  return {
    tableName: tableNameParam.Parameter?.Value || '',
    region: regionParam.Parameter?.Value || '',
    apiKey: apiKeyParam.Parameter?.Value || '',
  };
}

// Run bootstrap
bootstrap().catch(err => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
