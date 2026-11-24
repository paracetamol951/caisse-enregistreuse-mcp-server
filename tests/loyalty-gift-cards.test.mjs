import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mountKashOAuthMcp } from '../src/support/kashOAuthMcp.ts';

const issuer = 'https://kash-loyalty.test';
const resource = 'https://mcp.kash-loyalty.test/mcp';
const token = 'mcp2_' + 'a'.repeat(80);
const tokenRef = 'b'.repeat(64);
const serviceToken = 'c'.repeat(43);
const managedKey = 'kash_' + 'd'.repeat(64);
const code = '734530142274152831';
const cursor = 'test_page.' + 'x'.repeat(43);
const cart = { lines: [{ item_id: 24, quantity: 2 }], context: 'on_premises' };
const scopes = {
    loyalty_get_program: ['customers.read'],
    loyalty_get_account: ['customers.read'],
    loyalty_list_movements: ['customers.read'],
    loyalty_quote: ['customers.read', 'catalog.read'],
    gift_card_check: ['sales.read'],
    gift_card_list_movements: ['sales.read'],
};

const card = {
    state: 'active', currency: 'EUR', use_mode: 'multiple', balance: '10.00', usable_balance: '10.00',
    issued_at: '2026-10-10T09:00:00+02:00', expires_at: null, validity_seconds: 0,
    check: { amount: '15.00', covered: false, applicable_amount: '10.00', single_use_consumes_balance: false },
};

async function listen(t, app) {
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return 'http://127.0.0.1:' + server.address().port;
}

test('HTTP OAuth shares the partner loyalty and gift card routes and their permissions', async (t) => {
    const settings = {
        MCP_KASH_OAUTH_ISSUER: issuer,
        MCP_KASH_OAUTH_RESOURCE: resource,
        MCP_KASH_OAUTH_SERVICE_TOKEN: serviceToken,
    };
    const original = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
    Object.assign(process.env, settings);
    t.after(() => {
        for (const [key, val] of Object.entries(original)) {
            if (val === undefined) delete process.env[key];
            else process.env[key] = val;
        }
    });

    const app = express();
    app.use(express.json());
    mountKashOAuthMcp(app);
    const address = await listen(t, app);
    const fetchReal = globalThis.fetch;
    const upstream = [];
    let shop = '45';
    let granted = 'customers.read catalog.read sales.read';
    let refuseGiftCard = false;
    globalThis.fetch = async (input, init) => {
        const url = new URL(input);
        if (url.origin !== issuer) return fetchReal(input, init);
        if (url.pathname === '/oauth/introspect') {
            assert.equal(init.headers.Authorization, 'Bearer ' + serviceToken);
            assert.equal(init.body.get('token'), token);
            return Response.json({
                active: true, iss: issuer, aud: resource, scope: granted, exp: Math.floor(Date.now() / 1000) + 3600,
                token_ref: tokenRef, shop_id: shop,
            });
        }

        const body = init.body === undefined ? undefined : JSON.parse(init.body);
        upstream.push({ url, body, method: init.method });
        assert.equal(init.headers.Authorization, 'Bearer ' + serviceToken);
        assert.equal(init.headers['X-Kash-Mcp-Token-Ref'], tokenRef);
        assert.equal(init.redirect, 'error');
        assert.equal(url.searchParams.get('shop_id'), shop);
        if (url.pathname.endsWith('/gift-cards/check')) {
            if (refuseGiftCard) return Response.json({ error: { message: 'Unknown card ' + code } }, { status: 404 });
            return Response.json({ data: { ...card, code, unexpected: { secret: code } } });
        }
        if (url.pathname.endsWith('/gift-cards/movements')) {
            return Response.json({
                data: [{ payment_id: '8', order_id: '31', kind: 'refund_payment', recorded_at: null,
                    applied_amount: '-4.00', tendered_amount: null, code }],
                pagination: { next_cursor: cursor }, meta: { coverage: 'recorded_payments', currency: 'EUR', unlisted: code },
            });
        }
        if (url.pathname.endsWith('/loyalty/customers/12/movements')) {
            return Response.json({ data: [{ order_id: 115, recorded_at: null, is_return: true, source_order_id: 25,
                recorded_points: -2, points_on_reward_lines: null }], pagination: { next_cursor: cursor } });
        }
        if (url.pathname.endsWith('/loyalty/program')) {
            return Response.json({ data: { currency: 'EUR', points: { enabled: true }, stamp_cards: { enabled: false, templates: [] } } });
        }
        if (url.pathname.endsWith('/loyalty/quotes')) {
            return Response.json({ data: { customer_id: 12, currency: 'EUR', cart: { totals: { gross: '12.00' } },
                points: { earned: 12 }, stamp_cards: [] } });
        }
        return Response.json({ data: { customer_id: 12, currency: 'EUR', points: { balance: 52 }, stamp_cards: [] } });
    };
    t.after(() => { globalThis.fetch = fetchReal; });

    async function request(method, params, authorized = true) {
        return fetchReal(address + '/mcp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
                ...(authorized ? { Authorization: 'Bearer ' + token } : {}) },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
    }
    const call = (name, args, authorized) => request('tools/call', { name, arguments: args }, authorized);

    const tools = (await (await request('tools/list', {}, false)).json()).result.tools;
    for (const [name, required] of Object.entries(scopes)) {
        const tool = tools.find((item) => item.name === name);
        assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: required }]);
        assert.equal(tool.annotations.readOnlyHint, true);
        assert.ok(tool.outputSchema);
    }

    const anonymous = await call('loyalty_quote', { cart }, false);
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get('www-authenticate'), /scope="customers.read catalog.read"/);
    granted = 'customers.read';
    const missingQuote = (await (await call('loyalty_quote', { cart })).json()).result;
    assert.equal(missingQuote.isError, true);
    assert.match(missingQuote._meta['mcp/www_authenticate'][0], /scope="customers.read catalog.read".*insufficient_scope/);
    const missingCard = (await (await call('gift_card_check', { code })).json()).result;
    assert.equal(missingCard.isError, true);
    assert.match(missingCard._meta['mcp/www_authenticate'][0], /scope="sales.read".*insufficient_scope/);
    assert.equal(upstream.length, 0);

    granted = 'customers.read catalog.read sales.read';
    const requests = [
        ['loyalty_get_program', {}, 'GET', '/loyalty/program', undefined],
        ['loyalty_get_account', { customer_id: 12 }, 'GET', '/loyalty/customers/12', undefined],
        ['loyalty_list_movements', { customer_id: 12, cursor, limit: 1 }, 'GET', '/loyalty/customers/12/movements', undefined],
        ['loyalty_quote', { customer_id: 12, cart }, 'POST', '/loyalty/quotes', { customer_id: 12, cart }],
        ['gift_card_check', { code, amount: '15.00' }, 'POST', '/gift-cards/check', { code, amount: '15.00' }],
        ['gift_card_list_movements', { code, cursor, limit: 5 }, 'POST', '/gift-cards/movements', { code }],
    ];

    for (const [name, args, method, path, body] of requests) {
        const callResponse = await call(name, { ...args, shop_id: '99', unexpected: 'ignored' });
        assert.equal(callResponse.headers.get('cache-control'), 'no-store');
        const reply = await callResponse.json();
        assert.ok(reply.result.structuredContent, JSON.stringify(reply));
        assert.equal(upstream.at(-1).url.pathname, '/api/partner/v1' + path);
        assert.equal(upstream.at(-1).url.searchParams.get('shop_id'), '45');
        assert.equal(upstream.at(-1).url.searchParams.get('cursor'), args.cursor ?? null);
        assert.equal(upstream.at(-1).url.searchParams.get('limit'), args.limit === undefined ? null : String(args.limit));
        assert.equal(upstream.at(-1).method, method);
        assert.deepEqual(upstream.at(-1).body, body);
        assert.ok(!upstream.at(-1).url.href.includes(code));
        assert.ok(!JSON.stringify(reply).includes(code));
        if (name === 'gift_card_check') assert.deepEqual(reply.result.structuredContent.data.check, card.check);
        if (name === 'loyalty_get_account') assert.equal(reply.result.structuredContent.data.points.balance, 52);
        if (name === 'loyalty_list_movements') assert.equal(reply.result.structuredContent.data[0].points_on_reward_lines, null);
        if (name === 'loyalty_quote') assert.equal(reply.result.structuredContent.data.cart.totals.gross, '12.00');
    }

    const observed = upstream.length;
    const invalidCursor = await (await call('gift_card_list_movements', { code, cursor: code })).text();
    const invalidCode = await (await call('gift_card_check', { code: '9223372036854775808' })).text();
    assert.ok(!invalidCursor.includes(code));
    assert.ok(!invalidCode.includes('9223372036854775808'));
    assert.equal(upstream.length, observed);

    shop = '73';
    refuseGiftCard = true;
    const refused = await (await call('gift_card_check', { code })).json();
    assert.equal(upstream.at(-1).url.searchParams.get('shop_id'), '73');
    assert.equal(refused.result.isError, true);
    assert.ok(!JSON.stringify(refused).includes(code));
});

test('STDIO uses a managed partner key, and keeps the card code out of its output', async (t) => {
    const app = express();
    app.use(express.json());
    const calls = [];
    app.post('/api/partner/v1/gift-cards/check', (req, res) => {
        calls.push({ url: req.originalUrl, auth: req.get('Authorization'), body: req.body });
        res.json({ data: { ...card, code } });
    });
    const address = await listen(t, app);
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', fileURLToPath(new URL('../src/stdio.ts', import.meta.url))],
        env: { API_BASE: address, KASH_PARTNER_API_KEY: managedKey, SHOPID: '84' },
        stderr: 'pipe',
    });
    let logs = '';
    transport.stderr.on('data', (chunk) => { logs += chunk.toString(); });
    const client = new Client({ name: 'loyalty-gift-cards-test', version: '1.0.0' });
    t.after(() => client.close());
    await client.connect(transport);
    const { tools } = await client.listTools();
    for (const name of Object.keys(scopes)) assert.ok(tools.some((tool) => tool.name === name));
    const result = await client.callTool({ name: 'gift_card_check', arguments: { code, amount: '15.00' } });
    assert.deepEqual(result.structuredContent.data, card);
    assert.deepEqual(calls, [{ url: '/api/partner/v1/gift-cards/check?shop_id=84', auth: 'Bearer ' + managedKey,
        body: { code, amount: '15.00' } }]);
    assert.ok(!JSON.stringify(result).includes(code));
    assert.ok(!logs.includes(code));
});
