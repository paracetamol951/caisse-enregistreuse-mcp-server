import type { Express, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const scope = 'catalog.read';
const discoveryMethods = new Set(['initialize', 'notifications/initialized', 'tools/list', 'ping']);
const introspectionResponse = z.discriminatedUnion('active', [
    z.object({ active: z.literal(false) }),
    z.object({
        active: z.literal(true),
        iss: z.string(),
        aud: z.string(),
        scope: z.string(),
        exp: z.number().int(),
        token_ref: z.string().regex(/^[a-f0-9]{64}$/),
    }),
]);
const product = z.object({ id: z.string(), title: z.string(), price: z.string() });
const catalogResponse = z.object({
    items: z.array(product).max(50),
    nextCursor: z.string().nullable(),
});

function httpsUrl(value: string): URL {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw new Error('Invalid Kash OAuth URL');
    }
    return url;
}

export function mountKashOAuthMcp(app: Express): void {
    const issuerUrl = httpsUrl(process.env.MCP_KASH_OAUTH_ISSUER || 'https://kash.click');
    const issuer = issuerUrl.origin;
    const resource = httpsUrl(process.env.MCP_KASH_OAUTH_RESOURCE || 'https://mcp.kash.click/mcp');
    const serviceToken = process.env.MCP_KASH_OAUTH_SERVICE_TOKEN ?? '';
    if (issuerUrl.pathname !== '/' || resource.pathname !== '/mcp' || (serviceToken && !/^[A-Za-z0-9_-]{43,128}$/.test(serviceToken))) {
        throw new Error('Invalid Kash MCP OAuth configuration');
    }
    const resourceId = resource.toString();
    const metadataPath = '/.well-known/oauth-protected-resource/mcp';
    const metadataUrl = resource.origin + metadataPath;
    const acceptedOrigins = new Set([
        resource.origin,
        ...(process.env.MCP_KASH_OAUTH_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean),
    ]);
    const challenge = (error?: string) => 'Bearer resource_metadata="' + metadataUrl + '", scope="' + scope + '"'
        + (error ? ', error="' + error + '", error_description="Authorize Kash catalog access to continue"' : '');

    async function callKash(path: string, body: Record<string, string>): Promise<globalThis.Response> {
        return fetch(new URL(path, issuer), {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + serviceToken,
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body: new URLSearchParams(body),
            signal: AbortSignal.timeout(8000),
            redirect: 'error',
        });
    }

    function reject(res: Response, status: number, error?: string): void {
        res.set('WWW-Authenticate', challenge(error)).status(status).json({ error: error ?? 'unauthorized' });
    }

    async function serve(req: Request, res: Response): Promise<void> {
        if (!serviceToken) {
            res.status(503).json({ error: 'temporarily_unavailable' });
            return;
        }
        const origin = req.get('Origin');
        if (origin && !acceptedOrigins.has(origin)) {
            res.status(403).json({ error: 'origin_not_allowed' });
            return;
        }
        const messages: unknown[] = Array.isArray(req.body) ? req.body : [req.body];
        const protectedRequest = messages.some((message) => {
            const method = (message as { method?: unknown } | null)?.method;
            return typeof method === 'string' && !discoveryMethods.has(method);
        });
        const auth = req.get('Authorization');
        let tokenRef: string | undefined;
        if (protectedRequest || auth) {
            const token = auth?.match(/^Bearer ([a-f0-9]{80})$/i)?.[1];
            if (!token) {
                reject(res, 401, auth ? 'invalid_token' : undefined);
                return;
            }
            const check = await callKash('/oauth/introspect', { token });
            if (!check.ok) throw new Error('Kash introspection unavailable');
            const authResult = introspectionResponse.parse(await check.json());
            if (!authResult.active || authResult.iss !== issuer || authResult.aud !== resourceId
                || authResult.exp <= Math.floor(Date.now() / 1000)) {
                reject(res, 401, 'invalid_token');
                return;
            }
            if (protectedRequest && !authResult.scope.split(/\s+/).includes(scope)) {
                reject(res, 403, 'insufficient_scope');
                return;
            }
            tokenRef = authResult.token_ref;
        }

        const server = new McpServer({ name: 'kash-catalog', version: '1.0.0' });
        const securitySchemes = [{ type: 'oauth2', scopes: [scope] }];
        server.registerTool('data_list_products', {
            title: 'List Kash products',
            description: 'Lists products, their names and prices from the connected Kash shop. Use nextCursor to request the next page.',
            inputSchema: {
                limit: z.number().int().min(1).max(50).optional(),
                cursor: z.string().regex(/^[1-9][0-9]{0,18}$/).optional(),
            },
            outputSchema: catalogResponse.shape,
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
            _meta: { securitySchemes },
        }, async ({ limit = 25, cursor = '0' }) => {
            const reconnect = () => ({
                isError: true as const,
                content: [{ type: 'text' as const, text: 'Reconnect your Kash account to read the catalog.' }],
                _meta: { 'mcp/www_authenticate': [challenge('invalid_token')] },
            });
            if (!tokenRef) return reconnect();
            try {
                const reply = await callKash('/oauth/catalog', { token_ref: tokenRef, after: cursor, limit: String(limit) });
                if (reply.status === 401) return reconnect();
                if (!reply.ok) throw new Error('Kash catalog unavailable');
                const data = catalogResponse.parse(await reply.json());
                return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
            } catch {
                return { isError: true, content: [{ type: 'text', text: 'The Kash catalog is temporarily unavailable.' }] };
            }
        });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        await server.connect(transport);
        res.once('close', () => { void server.close().catch(() => {}); });
        await transport.handleRequest(req, res, req.body);
    }

    app.get(metadataPath, (_req, res) => {
        if (!serviceToken) { res.sendStatus(503); return; }
        res.json({ resource: resourceId, authorization_servers: [issuer], scopes_supported: [scope], bearer_methods_supported: ['header'] });
    });
    app.post('/mcp', (req, res) => {
        res.set('Cache-Control', 'no-store');
        void serve(req, res).catch(() => {
            if (!res.headersSent) res.status(503).json({ error: 'temporarily_unavailable' });
            else res.end();
        });
    });
    app.all('/mcp', (_req, res) => { res.set('Allow', 'POST').sendStatus(405); });
}
