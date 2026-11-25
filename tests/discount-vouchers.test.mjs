import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mountKashOAuthMcp } from '../src/support/kashOAuthMcp.ts';

const issuer = 'https://kash-vouchers.test';
const resource = 'https://mcp.kash-vouchers.test/mcp';
const serviceToken = 'a'.repeat(43);
const tokenRef = 'b'.repeat(64);
const token = 'mcp2_' + 'c'.repeat(80);
const managedKey = 'kash_' + 'd'.repeat(64);
const code = 'EXEMPLE2026-PRIVATE';
const couponKey = 'e4ac2aa0-0cce-42cf-a0df-49711445687f';
const voucherKey = 'a';
const cursor = 'test_page.' + 'x'.repeat(43);
const cart = { lines: [{ item_id: 24, quantity: 2 }], context: 'on_premises' };
const checkInput = { code, cart, customer_id: '9223372036854775807', cashbox_id: '-9' };
const couponInput = { code, confirm: true, name: 'Offre exemple', reduction_id: '14', valid_until: '2026-12-31', max_uses: 50 };
const voucherInput = { confirm: true, kind: 'fixed', value: '10.00', label: 'Geste commercial', minimum: '30.00' };
const check = {
    coupon_id: '5', status: 'ineligible', reason: 'minimum_order_amount', currency: 'EUR',
    reduction: { rate: -5, amount: '0.00', fixed_price: null },
    cart: { gross: '12.00', estimated_discount: null, estimated_gross: null },
};
const voucher = {
    id: '81', customer_id: '12', kind: 'fixed', value: '10.00', label: 'Geste commercial', minimum: '30.00',
    expires_on: null, issued_at: '2026-11-23T12:00:00+01:00', status: 'available',
    order_id: null, applied_amount: null, used_at: null, cancelled_at: null,
};
const quote = {
    customer_id: '12', currency: 'EUR', mode: 'manual', subtotal: '42.00', eligible_subtotal: '42.00',
    discount: '10.00', total: '32.00', selected_voucher_id: '81',
    options: [{ voucher_id: '81', amount: '10.00', eligible: true, limited: false }],
};

async function listen(t, app) {
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return 'http://127.0.0.1:' + server.address().port;
}

test('HTTP OAuth enforces coupon and voucher scopes, confirms issuance and forwards stable keys', async (t) => {
    const settings = { MCP_KASH_OAUTH_ISSUER: issuer, MCP_KASH_OAUTH_RESOURCE: resource, MCP_KASH_OAUTH_SERVICE_TOKEN: serviceToken };
    const original = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
    Object.assign(process.env, settings);
    t.after(() => {
        for (const [key, val] of Object.entries(original)) {
            if (val === undefined) delete process.env[key];
            else process.env[key] = val;
        }
    });

    const app = express();
    mountKashOAuthMcp(app);
    const address = await listen(t, app);
    const fetchReal = globalThis.fetch;
    const upstream = [];
    const issued = new Map();
    let granted = 'catalog.read customers.read';
    let malformedCheck = false;
    globalThis.fetch = async (input, init) => {
        const url = new URL(input);
        if (url.origin !== issuer) return fetchReal(input, init);
        if (url.pathname === '/oauth/introspect') {
            assert.equal(init.body.get('token'), token);
            return Response.json({ active: true, iss: issuer, aud: resource, scope: granted, exp: Math.floor(Date.now() / 1000) + 3600,
                token_ref: tokenRef, shop_id: '42' });
        }

        assert.equal(init.headers.Authorization, 'Bearer ' + serviceToken);
        assert.equal(init.headers['X-Kash-Mcp-Token-Ref'], tokenRef);
        assert.equal(init.redirect, 'error');
        assert.equal(url.searchParams.get('shop_id'), '42');
        assert.ok(!url.href.includes(code));
        const body = init.body === undefined ? undefined : JSON.parse(init.body);
        const key = init.headers['Idempotency-Key'];
        upstream.push({ url, method: init.method, body, key });

        switch (url.pathname) {
            case '/api/partner/v1/coupons/check':
                return Response.json({ data: { ...check, code, reason: malformedCheck ? code : check.reason,
                    reduction: { ...check.reduction, secret: code } } });
            case '/api/partner/v1/personal-vouchers/quotes':
                return Response.json({ data: quote });
            case '/api/partner/v1/personal-vouchers/customers/12':
                if (init.method === 'GET') return Response.json({ data: [voucher], pagination: { next_cursor: cursor } });
                break;
            case '/api/partner/v1/coupons':
                break;
            default:
                return Response.json({}, { status: 404 });
        }

        const record = issued.get(url.pathname + ':' + key);
        if (record && JSON.stringify(record.body) !== init.body) {
            return Response.json({ error: { code: 'conflict', message: 'Conflicting request for ' + code } }, { status: 409 });
        }
        const data = url.pathname.endsWith('/coupons') ? { coupon_id: '5', code } : voucher;
        if (!record) issued.set(url.pathname + ':' + key, { body });
        return Response.json({ data });
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
    const call = async (name, args) => (await request('tools/call', { name, arguments: args })).json();
    const discovered = (await (await request('tools/list', {}, false)).json()).result.tools;
    for (const [name, scopes, readOnly] of [
        ['coupon_check', ['catalog.read', 'customers.read'], true],
        ['coupon_issue', ['catalog.write'], false],
        ['personal_voucher_list', ['customers.read'], true],
        ['personal_voucher_quote', ['customers.read', 'catalog.read'], true],
        ['personal_voucher_issue', ['customers.write'], false],
    ]) {
        const tool = discovered.find((item) => item.name === name);
        assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes }]);
        assert.equal(tool.annotations.readOnlyHint, readOnly);
        assert.equal(tool.annotations.destructiveHint, !readOnly);
        assert.equal(tool.annotations.idempotentHint, true);
        if (!readOnly) {
            assert.ok(tool.inputSchema.required.includes('confirm'));
            assert.ok(tool.inputSchema.required.includes('idempotency_key'));
        }
    }

    const anonymous = await request('tools/call', { name: 'coupon_check', arguments: checkInput }, false);
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get('www-authenticate'), /scope="catalog.read customers.read"/);
    const badJson = await fetchReal(address + '/mcp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(code),
    });
    assert.equal(badJson.status, 400);
    assert.equal(badJson.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await badJson.json(), { error: 'invalid_request' });
    const deniedCoupon = await call('coupon_issue', { ...couponInput, idempotency_key: couponKey });
    const deniedVoucher = await call('personal_voucher_issue', { ...voucherInput, customer_id: 12, idempotency_key: voucherKey });
    assert.match(deniedCoupon.result._meta['mcp/www_authenticate'][0], /scope="catalog.write".*insufficient_scope/);
    assert.match(deniedVoucher.result._meta['mcp/www_authenticate'][0], /scope="customers.write".*insufficient_scope/);
    assert.equal(upstream.length, 0);

    const checked = await call('coupon_check', { ...checkInput, shop_id: 99 });
    assert.deepEqual(checked.result.structuredContent.data, check);
    assert.deepEqual(upstream.at(-1).body, checkInput);
    assert.ok(!JSON.stringify(checked).includes(code));
    const legacyCode = 'Anniversaire.été 2020';
    const legacyCheck = await call('coupon_check', { code: legacyCode });
    assert.deepEqual(legacyCheck.result.structuredContent.data, check);
    assert.deepEqual(upstream.at(-1).body, { code: legacyCode });
    const callsBeforeInvalidCode = upstream.length;
    for (const invalidCode of ['PROMO\u0001', 'PROMO\u{1F381}']) {
        const invalid = await call('coupon_check', { code: invalidCode });
        assert.equal(invalid.result?.isError, true);
    }
    assert.equal(upstream.length, callsBeforeInvalidCode);
    malformedCheck = true;
    const malformed = await call('coupon_check', checkInput);
    assert.equal(malformed.result.isError, true);
    assert.ok(!JSON.stringify(malformed).includes(code));

    const listed = await call('personal_voucher_list', { customer_id: 12, limit: 3, cursor });
    assert.deepEqual(listed.result.structuredContent, { data: [voucher], pagination: { next_cursor: cursor } });
    assert.equal(upstream.at(-1).method, 'GET');
    assert.equal(upstream.at(-1).url.searchParams.get('limit'), '3');
    assert.equal(upstream.at(-1).url.searchParams.get('cursor'), cursor);
    const quoteInput = { customer_id: '12', cart, voucher_id: 81 };
    const preview = await call('personal_voucher_quote', quoteInput);
    assert.deepEqual(preview.result.structuredContent.data, quote);
    assert.deepEqual(upstream.at(-1).body, quoteInput);
    assert.equal(upstream.at(-1).key, undefined);

    granted += ' catalog.write customers.write';
    const callsBeforeInvalid = upstream.length;
    const unconfirmed = await call('coupon_issue', { ...couponInput, confirm: false, idempotency_key: couponKey });
    const missingKey = await call('personal_voucher_issue', { ...voucherInput, customer_id: 12 });
    const unsupportedNewCode = await call('coupon_issue', { ...couponInput, code: legacyCode, idempotency_key: couponKey });
    const invalidName = await call('coupon_issue', { ...couponInput, name: 'Offre\u{1F381}', idempotency_key: couponKey });
    assert.equal(unconfirmed.result?.isError, true);
    assert.equal(missingKey.result?.isError, true);
    assert.equal(unsupportedNewCode.result?.isError, true);
    assert.equal(invalidName.result?.isError, true);
    assert.ok(!JSON.stringify(unsupportedNewCode).includes(legacyCode));
    assert.equal(upstream.length, callsBeforeInvalid);

    const issueArgs = { ...couponInput, idempotency_key: couponKey, shop_id: 99 };
    const replies = await Promise.all([call('coupon_issue', issueArgs), call('coupon_issue', issueArgs)]);
    for (const reply of replies) {
        assert.deepEqual(reply.result.structuredContent.data, { coupon_id: '5' });
        assert.ok(!JSON.stringify(reply).includes(code));
    }
    assert.equal(issued.size, 1);
    assert.deepEqual(upstream.slice(-2).map((item) => item.key), [couponKey, couponKey]);
    assert.deepEqual(upstream.at(-1).body, couponInput);
    const conflict = await call('coupon_issue', { ...issueArgs, name: 'Conflit' });
    assert.equal(conflict.result.isError, true);
    assert.match(conflict.result.content[0].text, /same key and arguments/);
    assert.ok(!JSON.stringify(conflict).includes(code));

    const created = await call('personal_voucher_issue', { ...voucherInput, customer_id: 12, idempotency_key: voucherKey, actor_id: 99 });
    assert.deepEqual(created.result.structuredContent.data, voucher);
    assert.deepEqual(upstream.at(-1).body, voucherInput);
    assert.equal(upstream.at(-1).key, voucherKey);
});

test('STDIO forwards promo codes in JSON and issuance keys in headers using a managed partner key', async (t) => {
    const app = express();
    app.use(express.json());
    const calls = [];
    app.post(['/api/partner/v1/coupons/check', '/api/partner/v1/personal-vouchers/customers/12'], (req, res) => {
        calls.push({ url: req.originalUrl, auth: req.get('Authorization'), key: req.get('Idempotency-Key'), body: req.body });
        res.json({ data: req.path.endsWith('/check') ? { ...check, code } : voucher });
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
    const client = new Client({ name: 'discount-voucher-test', version: '1.0.0' });
    t.after(() => client.close());
    await client.connect(transport);
    const checked = await client.callTool({ name: 'coupon_check', arguments: checkInput });
    const issued = await client.callTool({ name: 'personal_voucher_issue',
        arguments: { ...voucherInput, customer_id: 12, idempotency_key: voucherKey } });
    assert.deepEqual(checked.structuredContent.data, check);
    assert.deepEqual(issued.structuredContent.data, voucher);
    assert.deepEqual(calls, [
        { url: '/api/partner/v1/coupons/check?shop_id=84', auth: 'Bearer ' + managedKey, key: undefined, body: checkInput },
        { url: '/api/partner/v1/personal-vouchers/customers/12?shop_id=84', auth: 'Bearer ' + managedKey, key: voucherKey, body: voucherInput },
    ]);
    assert.ok(!JSON.stringify(checked).includes(code));
    assert.ok(!logs.includes(code));
});
