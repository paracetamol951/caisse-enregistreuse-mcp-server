import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAuthTools } from './tools/auth.js';
import { registerSalesTools } from './tools/sales.js';
import { registerDataTools } from './tools/data.js';
import { registerVatTools } from './tools/vats.js';
import { registerCatalogTools } from './tools/catalog.js';
import { setSessionAuth, runWithSession, updateSessionId } from './context.js';
import { loadSessionAuth } from './support/session-store.js';
import { initStore } from './support/store.js';
import { registerPrompts } from './prompts/index.js';
import oauthRouter, { bearerValidator } from './support/oauth.js';
import { registerClientTools } from './tools/clients.js';
import { registerResources } from './resources/index.js';
import { registerPaymentModeTools } from './tools/payment_modes.js';

// Initialise le store (Redis si disponible, sinon mémoire)
await initStore();

const app = express();

app.use(await oauthRouter());

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id, Mcp-Session-Id, x-api-key, x-apikey, x-shop-id, x-shopid');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});
app.use(express.json());

function getSessionId(req: express.Request): string | undefined {
    return req.get('Mcp-Session-Id') || req.get('mcp-session-id') || undefined;
}

// Isole chaque requête /mcp dans son propre contexte de session
app.use('/mcp', (req, res, next) => {
    const sessionId = getSessionId(req) ?? randomUUID();
    runWithSession(sessionId, () => next());
});

// Middleware d'authentification
app.post('/mcp', async (req, res, next) => {
    try {
        if (req.body?.method === 'initialize') return next();

        const auth = req.get('authorization') ?? req.get('Authorization');
        if (auth?.startsWith('Bearer ')) {
            const { apiKey, shopId } = await bearerValidator(auth);
            setSessionAuth({ ok: true, SHOPID: shopId, APIKEY: apiKey, scopes: ['mcp:invoke'] });
            return next();
        }

        const apiKey = req.get('x-api-key') ?? req.get('x-apikey') ?? '';
        const shopId = req.get('x-shop-id') ?? req.get('x-shopid') ?? '';
        if (apiKey && shopId) {
            setSessionAuth({ ok: true, SHOPID: shopId, APIKEY: apiKey, scopes: ['*'] });
            return next();
        }

        return next();
    } catch {
        return next();
    }
});

const mcpServer = new McpServer({
    name: 'caisse-enregistreuse-api',
    version: '1.4.1',
});

registerAuthTools(mcpServer);
registerSalesTools(mcpServer);
registerDataTools(mcpServer);
registerVatTools(mcpServer);
registerCatalogTools(mcpServer);
registerClientTools(mcpServer);
registerPaymentModeTools(mcpServer);
registerPrompts(mcpServer);
registerResources(mcpServer);

const transports = new Map<string, StreamableHTTPServerTransport>();

const asyncHandler =
    (fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<any>) =>
        (req: express.Request, res: express.Response, next: express.NextFunction) =>
            Promise.resolve(fn(req, res, next)).catch(next);

app.post(
    '/mcp',
    asyncHandler(async (req: express.Request, res: express.Response) => {
        const sessionId = getSessionId(req);

        if (sessionId) {
            let transport = transports.get(sessionId);

            if (!transport) {
                const method = (req.body as any)?.method;
                if (method !== 'initialize') {
                    return res.status(400).json({
                        jsonrpc: '2.0',
                        error: { code: -32000, message: 'Bad Request: Session expirée, veuillez réinitialiser' },
                        id: null,
                    });
                }

                // Reprise de session après redémarrage
                process.stderr.write('[mcp] Reprise de session ' + sessionId + '\n');
                const storedAuth = await loadSessionAuth(sessionId);

                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => sessionId,
                    onsessioninitialized: (sid: string) => {
                        transports.set(sid, transport!);
                        if (storedAuth) {
                            setSessionAuth(storedAuth);
                            process.stderr.write('[mcp] Auth restaurée pour ' + sid + '\n');
                        }
                    },
                });

                transport.onclose = () => { transports.delete(sessionId); };
                await mcpServer.connect(transport);
            }

            await transport.handleRequest(req, res, req.body);
            return;
        }

        // Nouvelle session
        const method = (req.body as any)?.method;
        if (method !== 'initialize') {
            return res.status(400).json({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'Bad Request: Server not initialized' },
                id: null,
            });
        }

        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId: string) => {
                transports.set(newSessionId, transport!);
                updateSessionId(newSessionId);
            },
        });

        transport.onclose = () => {
            const id = transport?.sessionId;
            if (id) transports.delete(id);
        };

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
    })
);

const handleSessionRequest = asyncHandler(async (req: express.Request, res: express.Response) => {
    const sessionId = getSessionId(req);
    if (!sessionId) { res.status(400).send('Invalid or missing session ID'); return; }
    const transport = transports.get(sessionId);
    if (!transport) { res.status(404).send('Unknown session'); return; }
    await transport.handleRequest(req, res);
});

app.get('/mcp', handleSessionRequest);
app.delete('/mcp', handleSessionRequest);

app.get("/", (req, res) => {
    res.redirect("https://kash.click/free-pos-software/ChatGPT");
});

const port = Number(process.env.PORT || 8787);
app
    .listen(port, () => console.log(`MCP server running at http://localhost:${port}/mcp`))
    .on('error', (error) => { console.error('Server error:', error); process.exit(1); });