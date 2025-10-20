import { t } from './i18n/index.js';
// __I18N_READY__
import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import httpServer from './support/httpServer.js';

import { registerAuthTools } from './tools/auth.js';
import { registerSalesTools } from './tools/sales.js';
import { registerDataTools } from './tools/data.js';

const app = express();
app.set('trust proxy', true);
app.get('/mcp', async (req, res) => {
    // Headers SSE
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // CORS déjà géré globalement, on renforce pour SSE :
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Transport "streamable" du SDK MCP const transport = new StreamableHTTPServerTransport({ req, res });
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,   // ou () => crypto.randomUUID()
        enableJsonResponse: true,        // utile pour debug/outils
        // enableDnsRebindingProtection: true, // active en prod si exposé
    });

    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
});

app.use((req, _res, next) => { console.log(`[MCP] ${req.method} ${req.url}`); next(); });
app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
 });

//app.use(express.json());

const server = new McpServer({ name: 'caisse-enregistreuse-api', version: '1.0.0' });

// Enregistre tes outils
registerAuthTools(server);
registerSalesTools(server);
registerDataTools(server);

// Route MCP (Streamable HTTP)
app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: () => randomUUID()
  });
  res.on('close', () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Health + manifeste (same as before)
const aux = httpServer(server);
app.use(aux);

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`[MCP] HTTP server listening on :${port} (POST /mcp)`);
});
