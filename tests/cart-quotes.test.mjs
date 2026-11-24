import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import express from 'express';
import { mountKashOAuthMcp } from '../src/support/kashOAuthMcp.ts';
import { registerStdioCartQuoteTool } from '../src/tools/cartQuote.ts';

const input = { lines: [{ item_id: 2, quantity: 1.25, variant_ids: [3] }], context: 'takeaway' };
const amounts = { net: '2.50', vat: '0.50', gross: '3.00' };
const data = {
    currency: 'EUR',
    context: 'takeaway',
    pricing_scale: 2,
    lines: [{
        item_id: 2,
        name: 'Coffee',
        quantity: 1.25,
        variants: [{ id: 3, name: 'Oat milk', unit_supplement: '0.60' }],
        unit_price: '1.80',
        vat_rate: '20.00',
        ...amounts,
        discount: '0.00',
        supplement: '0.75',
    }],
    totals: { ...amounts, discount: '0.00', supplement: '0.75', fees: '0.00' },
    taxes: [{ rate: '20.00', ...amounts }],
};
const { context, ...cartWithoutContext } = input;

async function listen(app, t) {
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
    }));
    return 'http://127.0.0.1:' + server.address().port;
}

test('HTTP OAuth binds cart quotes to the introspected shop and catalog scope', async (t) => {
    const issuer = 'https://issuer.example';
    const resource = 'https://mcp.example/mcp';
    const serviceToken = 's'.repeat(64);
    const reference = 'b'.repeat(64);
    const accessToken = 'mcp2_' + 'a'.repeat(80);
    const originalFetch = globalThis.fetch;
    const config = {
        MCP_KASH_OAUTH_ISSUER: issuer,
        MCP_KASH_OAUTH_RESOURCE: resource,
        MCP_KASH_OAUTH_SERVICE_TOKEN: serviceToken,
    };
    const previousConfig = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]]));
    Object.assign(process.env, config);
    t.after(() => {
        globalThis.fetch = originalFetch;
        for (const [key, value] of Object.entries(previousConfig)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    let scope = 'catalog.read';
    let quoteStatus = 200;
    const quotes = [];
    globalThis.fetch = async (target, options) => {
        const url = new URL(target);
        assert.equal(url.origin, issuer);
        assert.equal(options.headers.Authorization, 'Bearer ' + serviceToken);
        if (url.pathname === '/oauth/introspect') {
            assert.equal(options.body.get('token'), accessToken);
            return Response.json({
                active: true,
                iss: issuer,
                aud: resource,
                scope,
                exp: Math.floor(Date.now() / 1000) + 120,
                token_ref: reference,
                shop_id: 42,
            });
        }
        assert.equal(url.pathname, '/api/partner/v1/cart-quotes');
        assert.equal(options.method, 'POST');
        assert.equal(options.headers['Content-Type'], 'application/json');
        assert.equal(options.headers['X-Kash-Mcp-Token-Ref'], reference);
        assert.equal(options.redirect, 'error');
        quotes.push({ shopId: url.searchParams.get('shop_id'), body: JSON.parse(options.body) });
        return Response.json(quoteStatus === 200 ? data : {}, { status: quoteStatus });
    };

    const app = express();
    app.use(express.json());
    mountKashOAuthMcp(app);
    const base = await listen(app, t);
    async function request(method, params, authorize = true) {
        return originalFetch(base + '/mcp', {
            method: 'POST',
            headers: {
                Accept: 'application/json, text/event-stream',
                'Content-Type': 'application/json',
                'X-Shop-Id': '999',
                ...(authorize ? { Authorization: 'Bearer ' + accessToken } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
    }
    const call = (args, authorize) => request('tools/call', { name: 'calculate_cart', arguments: args }, authorize);

    const list = (await (await request('tools/list', {}, false)).json()).result.tools;
    const tool = list.find(({ name }) => name === 'calculate_cart');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: ['catalog.read'] }]);

    const unauthorized = await call(input, false);
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get('www-authenticate'), /scope="catalog.read"/);

    scope = 'sales.read';
    assert.equal((await (await call(input)).json()).result.isError, true);
    assert.deepEqual(quotes, []);
    scope = 'catalog.read';
    for (const invalid of [
        { ...input, shop_id: 999 },
        { ...input, lines: [{ item_id: 2, quantity: 0 }] },
        { ...input, lines: [{ item_id: 2, quantity: 0.0012 }] },
        { ...input, lines: [{ item_id: 2, quantity: 1, variant_ids: [3, 3] }] },
        { ...input, lines: [input.lines[0], { ...input.lines[0], quantity: 2 }] },
        { ...input, lines: [{ item_id: 2, quantity: 1, price: 0 }] },
    ]) {
        assert.equal((await (await call(invalid)).json()).result?.isError, true);
    }
    assert.deepEqual(quotes, []);

    const calculation = (await (await call(input)).json()).result;
    assert.deepEqual(calculation.structuredContent, data);
    assert.deepEqual(quotes.splice(0), [{ shopId: '42', body: input }]);

    quoteStatus = 404;
    const missing = (await (await call(cartWithoutContext)).json()).result;
    assert.equal(missing.isError, true);
    assert.equal(missing.structuredContent, undefined);
    assert.deepEqual(quotes.splice(0), [{ shopId: '42', body: cartWithoutContext }]);

    quoteStatus = 401;
    const revoked = (await (await call(input)).json()).result;
    assert.match(revoked._meta['mcp/www_authenticate'][0], /scope="catalog.read".*error="invalid_token"/);
});

test('STDIO uses the managed key for the same JSON route and contract', async (t) => {
    const partnerKey = 'kash_' + 'c'.repeat(64);
    const previousKey = process.env.KASH_PARTNER_API_KEY;
    process.env.KASH_PARTNER_API_KEY = '';
    try {
        assert.equal(registerStdioCartQuoteTool({
            registerTool: () => assert.fail('The cart tool requires a managed partner key.'),
        }), false);
    } finally {
        if (previousKey === undefined) delete process.env.KASH_PARTNER_API_KEY;
        else process.env.KASH_PARTNER_API_KEY = previousKey;
    }

    const received = [];
    const app = express();
    app.use(express.json());
    app.post('/api/partner/v1/cart-quotes', (req, res) => {
        received.push({
            shopId: req.query.shop_id,
            auth: req.get('Authorization'),
            ref: req.get('X-Kash-Mcp-Token-Ref'),
            body: req.body,
        });
        res.json(data);
    });
    const base = await listen(app, t);

    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', 'src/stdio.ts'],
        env: { API_BASE: base, SHOPID: '42', APIKEY: 'legacy-value', KASH_PARTNER_API_KEY: partnerKey },
        stderr: 'pipe',
    });
    transport.stderr?.resume();
    const managed = new Client({ name: 'cart-test', version: '1.0.0' });
    t.after(() => managed.close());
    await managed.connect(transport, { timeout: 600_000 });
    const tools = (await managed.listTools()).tools;
    assert.equal(tools.find(({ name }) => name === 'calculate_cart').annotations.readOnlyHint, true);
    const result = await managed.callTool({ name: 'calculate_cart', arguments: input });
    assert.deepEqual(result.structuredContent, data);
    assert.deepEqual(received, [{ shopId: '42', auth: 'Bearer ' + partnerKey, ref: undefined, body: input }]);
});
