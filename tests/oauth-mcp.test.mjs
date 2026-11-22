import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import { mountKashOAuthMcp } from '../src/support/kashOAuthMcp.ts';

test('PHP OAuth protects the stateless Kash MCP catalog', async () => {
    const issuer = 'https://issuer.example';
    const resource = 'https://mcp.example/mcp';
    const serviceToken = 's'.repeat(64);
    const token = 'a'.repeat(80);
    const reference = 'b'.repeat(64);
    const originalFetch = globalThis.fetch;
    process.env.MCP_KASH_OAUTH_ISSUER = issuer;
    process.env.MCP_KASH_OAUTH_RESOURCE = resource;
    process.env.MCP_KASH_OAUTH_SERVICE_TOKEN = serviceToken;
    let authMode = 'allowed';
    let calls = 0;
    let products = 0;
    globalThis.fetch = async (url, options) => {
        const target = new URL(url);
        assert.equal(target.origin, issuer);
        assert.equal(options.headers.Authorization, 'Bearer ' + serviceToken);
        if (target.pathname === '/oauth/introspect') {
            calls++;
            assert.equal(options.body.get('token'), token);
            if (authMode === 'revoked') return Response.json({ active: false });
            if (authMode === 'down') return Response.json({}, { status: 503 });
            return Response.json({
                active: true, iss: issuer, aud: authMode === 'audience' ? issuer : resource,
                scope: authMode === 'scope' ? 'sales.read' : 'catalog.read',
                exp: Math.floor(Date.now() / 1000) + (authMode === 'expired' ? -10 : 60), token_ref: reference,
            });
        }
        products++;
        assert.equal(target.pathname, '/oauth/catalog');
        assert.equal(options.body.has('token'), false);
        assert.equal(options.body.get('token_ref'), reference);
        assert.equal(options.body.has('shop'), false);
        if (authMode === 'mid-call') return Response.json({}, { status: 401 });
        return Response.json({ items: [{ id: '2', title: 'Coffee', price: '2.00' }], nextCursor: null });
    };

    const app = express();
    app.use(express.json());
    mountKashOAuthMcp(app);
    const http = app.listen(0, '127.0.0.1');
    await once(http, 'listening');
    const base = 'http://127.0.0.1:' + http.address().port;
    const request = (method, params, headers = {}) => originalFetch(base + '/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const call = (headers) => request('tools/call', { name: 'data_list_products', arguments: { limit: 1 } }, headers);
    const bearer = { Authorization: 'Bearer ' + token };
    try {
        const metadata = await originalFetch(base + '/.well-known/oauth-protected-resource/mcp');
        assert.deepEqual(await metadata.json(), {
            resource, authorization_servers: [issuer], scopes_supported: ['catalog.read'], bearer_methods_supported: ['header'],
        });
        const initialized = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
        assert.equal((await initialized.json()).result.serverInfo.name, 'kash-catalog');
        assert.equal(initialized.headers.has('mcp-session-id'), false);
        const list = await request('tools/list', {});
        const tools = (await list.json()).result.tools;
        assert.deepEqual(tools.map(tool => tool.name), ['data_list_products']);
        assert.deepEqual(tools[0]._meta.securitySchemes, [{ type: 'oauth2', scopes: ['catalog.read'] }]);
        const missing = await call();
        assert.equal(missing.status, 401);
        assert.match(missing.headers.get('www-authenticate'), /resource_metadata="https:\/\/mcp\.example\/\.well-known\/oauth-protected-resource\/mcp"/);
        assert.equal((await call({ ...bearer, Origin: 'https://unregistered.example' })).status, 403);
        assert.equal(calls, 0);
        assert.equal((await call({ 'x-shop-id': '2', 'x-api-key': 'legacy' })).status, 401);
        const result = await call(bearer);
        assert.equal(result.status, 200);
        assert.deepEqual((await result.json()).result.structuredContent.items, [{ id: '2', title: 'Coffee', price: '2.00' }]);
        for (const [mode, status] of [['revoked', 401], ['audience', 401], ['expired', 401], ['scope', 403], ['down', 503]]) {
            authMode = mode;
            assert.equal((await call(bearer)).status, status);
        }
        assert.equal(products, 1);
        authMode = 'mid-call';
        const expired = (await (await call(bearer)).json()).result;
        assert.equal(expired.isError, true);
        assert.match(expired._meta['mcp/www_authenticate'][0], /error="invalid_token"/);
    } finally {
        globalThis.fetch = originalFetch;
        await new Promise((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    }
});
