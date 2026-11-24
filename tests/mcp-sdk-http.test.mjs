import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import { mountKashOAuthMcp } from '../src/support/kashOAuthMcp.ts';

test('stateless OAuth MCP enforces SDK input and HTTP body limits', async (t) => {
    const issuer = 'https://issuer.example';
    const resource = 'https://mcp.example/mcp';
    const config = {
        MCP_KASH_OAUTH_ISSUER: issuer,
        MCP_KASH_OAUTH_RESOURCE: resource,
        MCP_KASH_OAUTH_SERVICE_TOKEN: 's'.repeat(64),
    };
    for (const [key, value] of Object.entries(config)) {
        const previous = process.env[key];
        process.env[key] = value;
        t.after(() => {
            if (previous === undefined) delete process.env[key];
            else process.env[key] = previous;
        });
    }

    const request = globalThis.fetch;
    const operation = { id: 'd'.repeat(32), state: 'queued' };
    let catalogReads = 0;
    let saleItems;
    let importBytes;
    const backend = t.mock.method(globalThis, 'fetch', async (url, options) => {
        const target = new URL(url);
        assert.equal(target.origin, issuer);
        switch (target.pathname) {
            case '/oauth/introspect':
                return Response.json({
                    active: true, iss: issuer, aud: resource, scope: 'catalog.read sales.write',
                    exp: Math.floor(Date.now() / 1000) + 60, shop_id: '31', token_ref: 'c'.repeat(64),
                });
            case '/api/partner/v1/products':
                catalogReads++;
                assert.equal(target.searchParams.get('shop_id'), '31');
                return Response.json({ data: [], pagination: { next_cursor: null } });
            case '/workers/webapp.php':
                saleItems = options.body.getAll('itemsList[]').length;
                return Response.json({ orderID: 42, result: 'ok' });
            case '/api/partner/v1/imports':
                importBytes = Buffer.from(JSON.parse(options.body).contentBase64, 'base64').length;
                return Response.json({ data: operation }, { status: 202 });
            default:
                assert.fail('Unexpected test backend route: ' + target.pathname);
        }
    });

    const app = express();
    mountKashOAuthMcp(app);
    const server = app.listen(0, '127.0.0.1');
    t.after(async () => { await new Promise((resolve) => server.close(resolve)); });
    await once(server, 'listening');

    const url = 'http://127.0.0.1:' + server.address().port + '/mcp';
    const rpc = (method, params) => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const post = (body, headers = {}) => request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
        body,
    });
    const call = async (name, args) => {
        const response = await post(rpc('tools/call', { name, arguments: args }), {
            Authorization: 'Bearer mcp2_' + 'a'.repeat(80),
            'MCP-Protocol-Version': '2025-11-25',
        });
        assert.equal(response.status, 200);
        return (await response.json()).result;
    };

    for (const protocolVersion of ['2025-06-18', '2025-11-25']) {
        const response = await post(rpc('initialize', {
            protocolVersion, capabilities: {}, clientInfo: { name: 'sdk-test', version: '1' },
        }));
        assert.equal(response.status, 200);
        assert.equal(response.headers.has('mcp-session-id'), false);
        assert.equal((await response.json()).result.protocolVersion, protocolVersion);
    }
    const unsupported = await post(rpc('ping'), { 'MCP-Protocol-Version': '2000-01-01' });
    assert.equal(unsupported.status, 400);
    await unsupported.json();

    const invalid = await call('data_list_products', { limit: 0 });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /Input validation error/i);

    const tooManyElements = await call('data_list_products', {
        limit: 1, extra: Array(2047).fill('example'),
    });
    assert.equal(tooManyElements.isError, true);
    assert.match(tooManyElements.content[0].text, /maximum of 2048 elements/);
    assert.equal(catalogReads, 0);
    assert.deepEqual((await call('data_list_products', { limit: 1 })).structuredContent, { items: [], nextCursor: null });

    const idempotencyKey = '550e8400-e29b-41d4-a716-446655440000';
    const item = {
        type: 'catalog', productId: '4', quantity: '2', titleOverride: 'Coffee', priceOverride: '3.5',
        declinaisons: ['1', '2', '3', '4', '5'],
    };
    const sale = await call('order_create', { items: Array(150).fill(item), idempotencyKey });
    assert.equal(sale.isError ?? false, false);
    assert.equal(sale.structuredContent.orderID, 42);
    assert.equal(saleItems, 150);

    const csvBytes = 1024 * 1024;
    const csvHeader = 'Name,Price\n';
    const row = 'Coffee,2\n';
    const rows = row.repeat(Math.floor((csvBytes - csvHeader.length - 3) / row.length));
    const csv = csvHeader + rows + 'A'.repeat(csvBytes - csvHeader.length - rows.length - 3) + ',2\n';
    const prepared = await call('prepare_catalog_import', {
        contentBase64: Buffer.from(csv).toString('base64'), idempotencyKey,
    });
    assert.deepEqual(prepared.structuredContent, operation);
    assert.equal(importBytes, csvBytes);

    const bodyLimit = 1536 * 1024;
    const ping = rpc('ping').padEnd(bodyLimit);
    const accepted = await post(ping);
    assert.equal(accepted.status, 200);
    assert.deepEqual((await accepted.json()).result, {});
    const callsBefore = backend.mock.callCount();
    const oversized = await post(ping + ' ', { Authorization: 'Bearer mcp2_' + 'a'.repeat(80) });
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), { error: 'request_too_large' });
    assert.equal(backend.mock.callCount(), callsBefore);
});
