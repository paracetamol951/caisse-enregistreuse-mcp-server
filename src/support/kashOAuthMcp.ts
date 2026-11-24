import express, { type Express, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { asyncOperationScopes, registerOAuthAsyncOperationTools } from '../tools/asyncOperations.js';
import { registerOAuthCartQuoteTool } from '../tools/cartQuote.js';
import { registerOAuthDiscountVoucherTools } from '../tools/discountVouchers.js';
import { registerOAuthLoyaltyGiftCardTools } from '../tools/loyaltyGiftCards.js';
import { registerOAuthPartnerReadTools } from '../tools/partnerReads.js';
import { kashOAuthScopes, kashOAuthToolScopes, kashProductScope, registerKashOAuthWorkerTools, type KashOAuthGrant } from './kashOAuthTools.js';
import { callPartnerRead, KashReadError } from './partnerReadTransport.js';

// A 1 MiB CSV needs about 1.34 MiB in Base64, plus the JSON-RPC envelope.
const mcpRequestBodyLimit = 1536 * 1024;
// OAuth orders allow 150 items with six fields and five variation IDs per item.
const maxToolInputElements = 2048;

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
        shop_id: z.union([
            z.string().regex(/^[1-9][0-9]{0,18}$/),
            z.number().int().positive().safe().transform(String),
        ]).optional(),
    }),
]);
const product = z.object({ id: z.string(), title: z.string(), price: z.string() });
const catalogResponse = z.object({
    items: z.array(product).max(50),
    nextCursor: z.string().nullable(),
});
const partnerCatalogPage = z.object({
    data: z.array(z.object({
        id: z.number().int().positive().safe(), name: z.string(), short_name: z.string(), price: z.string(),
    })).max(50),
    pagination: z.object({ next_cursor: z.string().nullable() }),
});

function logCatalogFailure(upstream: 'partner' | 'oauth', error: unknown): void {
    const reason = error instanceof KashReadError ? `status ${error.status}`
        : error instanceof z.ZodError ? 'invalid response schema'
        : error instanceof SyntaxError ? 'invalid JSON response'
        : 'request failed';
    console.warn(`Kash MCP catalog: ${upstream} read failed (${reason})`);
}

function parseBearer(auth: string | undefined): string | undefined {
    const token = auth?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return;
    if (/^[a-f0-9]{80}$/i.test(token) || /^mcp2_[a-f0-9]{80}$/.test(token)) return token;
}

function requestedScopes(messages: unknown[]): string[] {
    const scopes = new Set<string>();
    for (const message of messages) {
        const call = message as { method?: unknown; params?: { name?: unknown; arguments?: unknown } } | null;
        if (call?.method !== 'tools/call' || typeof call.params?.name !== 'string') continue;
        for (const scope of kashOAuthToolScopes(call.params.name, call.params.arguments)) scopes.add(scope);
        for (const scope of asyncOperationScopes(call.params.name, call.params.arguments)) scopes.add(scope);
    }
    return [...scopes];
}

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
    const challenge = (scopes: string[], error?: string) => 'Bearer resource_metadata="' + metadataUrl + '"'
        + (scopes.length ? ', scope="' + scopes.join(' ') + '"' : '')
        + (error ? ', error="' + error + '", error_description="Authorize access to Kash to continue"' : '');

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

    function reject(res: Response, status: number, scopes: string[], error?: string): void {
        res.set('WWW-Authenticate', challenge(scopes, error)).status(status).json({ error: error ?? 'unauthorized' });
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
        const scopes = requestedScopes(messages);
        const auth = req.get('Authorization');
        let grant: KashOAuthGrant | undefined;
        if (protectedRequest || auth) {
            const token = parseBearer(auth);
            if (!token) {
                reject(res, 401, scopes, auth ? 'invalid_token' : undefined);
                return;
            }
            const check = await callKash('/oauth/introspect', { token });
            if (!check.ok) throw new Error('Kash introspection unavailable');
            const authResult = introspectionResponse.parse(await check.json());
            if (!authResult.active || authResult.iss !== issuer || authResult.aud !== resourceId
                || authResult.exp <= Math.floor(Date.now() / 1000)) {
                reject(res, 401, scopes, 'invalid_token');
                return;
            }
            const granted = new Set(authResult.scope.split(/\s+/));
            const message = req.body as { method?: unknown; params?: { name?: unknown } } | null;
            if (!token.startsWith('mcp2_') && message?.method === 'tools/call' && message.params?.name === 'data_list_products'
                && !granted.has(kashProductScope)) {
                reject(res, 403, scopes, 'insufficient_scope');
                return;
            }
            grant = { scopes: granted, tokenRef: authResult.token_ref, shopId: authResult.shop_id };
        }

        const server = new McpServer({ name: 'kash-catalog', version: '1.0.0' }, { maxToolInputElements });
        const securitySchemes = [{ type: 'oauth2', scopes: [kashProductScope] }];
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
                _meta: { 'mcp/www_authenticate': [challenge([kashProductScope], 'invalid_token')] },
            });
            if (!grant) return reconnect();
            if (!grant.scopes.has(kashProductScope)) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: 'Authorize access to the Kash catalog.' }],
                    _meta: { 'mcp/www_authenticate': [challenge([kashProductScope], 'insufficient_scope')] },
                };
            }
            let upstream: 'partner' | 'oauth' = 'partner';
            try {
                if (grant.shopId) {
                    try {
                        const query = new URLSearchParams({ limit: String(limit) });
                        if (cursor !== '0') query.set('after_id', cursor);
                        const raw = await callPartnerRead(issuer, grant.shopId, { path: '/products', query }, (url) => fetch(url, {
                            method: 'GET',
                            headers: { Authorization: 'Bearer ' + serviceToken, 'X-Kash-Mcp-Token-Ref': grant.tokenRef, Accept: 'application/json' },
                            signal: AbortSignal.timeout(8000), redirect: 'error',
                        }));
                        const page = partnerCatalogPage.parse(raw);
                        const items = page.data.map((item) => ({ id: String(item.id), title: item.name || item.short_name, price: item.price }));
                        const data = { items, nextCursor: page.pagination.next_cursor === null ? null : items.at(-1)?.id ?? null };
                        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
                    } catch (error) {
                        if (error instanceof KashReadError && error.status < 500 && error.status !== 404) throw error;
                        logCatalogFailure(upstream, error);
                    }
                }
                // The issuer rechecks catalog.read and resolves the shop from the same token reference.
                upstream = 'oauth';
                const reply = await callKash('/oauth/catalog', { token_ref: grant.tokenRef, after: cursor, limit: String(limit) });
                if (!reply.ok) throw new KashReadError(reply.status);
                const data = catalogResponse.parse(await reply.json());
                return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
            } catch (error) {
                if (error instanceof KashReadError && error.status === 401) return reconnect();
                logCatalogFailure(upstream, error);
                return { isError: true, content: [{ type: 'text', text: 'The Kash catalog is temporarily unavailable.' }] };
            }
        });
        registerKashOAuthWorkerTools(server, { grant, issuer, serviceToken, challenge });
        registerOAuthAsyncOperationTools(server, { grant, issuer, serviceToken, challenge });
        registerOAuthCartQuoteTool(server, { grant, issuer, serviceToken, challenge });
        registerOAuthDiscountVoucherTools(server, { grant, issuer, serviceToken, challenge });
        registerOAuthLoyaltyGiftCardTools(server, { grant, issuer, serviceToken, challenge });
        registerOAuthPartnerReadTools(server, { grant, issuer, serviceToken, challenge });
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
            maxRequestBodySize: mcpRequestBodyLimit,
        });
        await server.connect(transport);
        res.once('close', () => { void server.close().catch(() => {}); });
        await transport.handleRequest(req, res, req.body);
    }

    app.get(metadataPath, (_req, res) => {
        if (!serviceToken) { res.sendStatus(503); return; }
        res.json({ resource: resourceId, authorization_servers: [issuer], scopes_supported: kashOAuthScopes, bearer_methods_supported: ['header'] });
    });
    const parseMcpJson = express.json({ limit: mcpRequestBodyLimit });
    app.post('/mcp', (req, res) => {
        res.set('Cache-Control', 'no-store');
        parseMcpJson(req, res, (error?: { status?: number }) => {
            if (error) {
                // Body-parser errors can carry fragments of the submitted JSON.
                const status = error.status ?? 400;
                const code = status === 413 ? 'request_too_large' : status === 415 ? 'unsupported_media_type' : 'invalid_request';
                res.status(status).json({ error: code });
                return;
            }
            void serve(req, res).catch(() => {
                if (!res.headersSent) res.status(503).json({ error: 'temporarily_unavailable' });
                else res.end();
            });
        });
    });
    app.all('/mcp', (_req, res) => { res.set('Allow', 'POST').sendStatus(405); });
}
