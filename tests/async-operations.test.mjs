import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import express from 'express';
import { mountKashOAuthMcp } from '../src/support/kashOAuthMcp.ts';
import { asyncOperationToolNames as tools } from '../src/tools/asyncOperations.ts';

const exportId = 'a'.repeat(32);
const importId = 'b'.repeat(32);
const previewToken = 'c'.repeat(64);
const requestKey = '98827135-5e12-47c9-875c-bf3978ca7591';
const salesDates = { from: '2026-11-01', to: '2026-11-08', cashbox_id: 42 };
const csv = Buffer.from('date;gross\n2026-11-07;2.50\n');
const file = {
    id: exportId,
    state: 'succeeded',
    filename: 'sales.csv',
    mediaType: 'text/csv',
    contentBase64: csv.toString('base64'),
    sha256: createHash('sha256').update(csv).digest('hex'),
};

async function listen(app, t) {
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
    }));
    return 'http://127.0.0.1:' + server.address().port;
}

test('HTTP OAuth sends partner operations for the introspected shop and checks intent and permissions', async (t) => {
    const originalFetch = globalThis.fetch;
    const issuer = 'https://issuer.example';
    const resource = 'https://mcp.example/mcp';
    const serviceToken = 'd'.repeat(64);
    const tokenRef = 'e'.repeat(64);
    const access = 'mcp2_' + 'f'.repeat(80);
    const other = 'mcp2_' + 'a'.repeat(80);
    const config = {
        MCP_KASH_OAUTH_ISSUER: issuer,
        MCP_KASH_OAUTH_RESOURCE: resource,
        MCP_KASH_OAUTH_SERVICE_TOKEN: serviceToken,
    };
    const previous = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]]));
    Object.assign(process.env, config);
    t.after(() => {
        globalThis.fetch = originalFetch;
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    let scope = 'reports.read catalog.read';
    let submittedExport = false;
    let confirmed = false;
    const requests = [];
    const prefix = '/api/partner/v1';
    globalThis.fetch = async (target, options) => {
        const url = new URL(target);
        assert.equal(url.origin, issuer);
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, 'Bearer ' + serviceToken);
        if (url.pathname === '/oauth/introspect') {
            const token = options.body.get('token');
            assert.ok([access, other].includes(token));
            return Response.json({
                active: true,
                iss: issuer,
                aud: resource,
                scope,
                exp: Math.floor(Date.now() / 1000) + 120,
                token_ref: tokenRef,
                shop_id: token === other ? '87' : '42',
            });
        }
        assert.equal(options.headers['X-Kash-Mcp-Token-Ref'], tokenRef);
        assert.equal(options.headers.Accept, 'application/json');
        const shop = url.searchParams.get('shop_id');
        const path = url.pathname;
        const body = options.body && JSON.parse(options.body);
        requests.push({ path, body, shop, key: options.headers['Idempotency-Key'], method: options.method });
        if (shop === '87') return Response.json({ error: { code: 'not_found' } }, { status: 404 });
        assert.equal(shop, '42');
        if (path === prefix + '/exports') {
            assert.deepEqual(body, { type: 'sales', format: 'csv', parameters: salesDates });
            assert.equal(options.headers['Idempotency-Key'], requestKey);
            const state = submittedExport ? 'succeeded' : 'queued';
            submittedExport = true;
            return Response.json({ data: { id: exportId, state } }, { status: 202 });
        }
        if (path === prefix + '/operations/' + exportId) {
            return Response.json({ data: { id: exportId, state: 'succeeded' } });
        }
        if (path === prefix + '/operations/' + exportId + '/result') return Response.json({ data: file });
        if (path === prefix + '/imports') {
            assert.equal(body.type, 'catalog');
            assert.equal(body.format, 'csv');
            assert.ok(body.contentBase64.length > 65536);
            return Response.json({ data: { id: importId, state: 'queued' } }, { status: 202 });
        }
        if (path === prefix + '/operations/' + importId) {
            return Response.json({ data: {
                id: importId, state: confirmed ? 'partial' : 'awaiting_confirmation', previewToken,
            } });
        }
        if (path === prefix + '/operations/' + importId + '/result') {
            assert.equal(url.searchParams.get('after'), '2');
            assert.equal(url.searchParams.get('limit'), '10');
            return Response.json({ data: {
                id: importId,
                state: confirmed ? 'partial' : 'awaiting_confirmation',
                summary: { rows: 2 },
                rows: [{ line: 3, status: 'rejected', error: 'invalid_reference' }],
                nextAfter: null,
            } });
        }
        if (path === prefix + '/operations/' + importId + '/confirm') {
            assert.deepEqual(body, { previewToken });
            confirmed = true;
            return Response.json({ data: { id: importId, state: 'queued' } }, { status: 202 });
        }
        assert.fail('Unexpected partner request ' + path);
    };

    const app = express();
    mountKashOAuthMcp(app);
    const base = await listen(app, t);
    const request = (method, params, token = access) => originalFetch(base + '/mcp', {
        method: 'POST',
        headers: {
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            'X-Shop-Id': '999',
            ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const call = async (name, args, token) => (await request('tools/call', { name, arguments: args }, token)).json();
    const listed = (await (await request('tools/list', {}, '')).json()).result.tools;
    for (const name of Object.values(tools)) assert.ok(listed.some((tool) => tool.name === name));
    assert.equal(listed.find(({ name }) => name === tools.prepareImport).annotations.readOnlyHint, true);
    assert.equal(listed.find(({ name }) => name === tools.confirmImport).annotations.readOnlyHint, false);
    const unauthorized = await request('tools/call', {
        name: tools.exportSales,
        arguments: { ...salesDates, idempotencyKey: requestKey },
    }, '');
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get('www-authenticate'), /scope="reports.read"/);
    assert.deepEqual(requests, []);

    assert.equal((await call(tools.exportSales, { ...salesDates, idempotencyKey: requestKey })).result.structuredContent.id, exportId);
    assert.equal((await call(tools.exportSales, { ...salesDates, idempotencyKey: requestKey })).result.structuredContent.id, exportId);
    assert.equal((await call(tools.status, { operationId: exportId, operationKind: 'export' })).result.structuredContent.state, 'succeeded');

    const exported = (await call(tools.result, { operationId: exportId, operationKind: 'export' })).result;
    assert.equal(exported.structuredContent.sha256, file.sha256);
    assert.equal(exported.structuredContent.contentBase64, undefined);
    assert.deepEqual(Buffer.from(exported.content.find((item) => item.type === 'resource').resource.blob, 'base64'), csv);
    const wrongKind = (await call(tools.result, { operationId: exportId, operationKind: 'import' })).result;
    assert.equal(wrongKind.isError, true);
    assert.equal(wrongKind.structuredContent, undefined);
    const foreign = (await call(tools.result, { operationId: exportId, operationKind: 'export' }, other)).result;
    assert.equal(foreign.isError, true);
    assert.equal(foreign.structuredContent, undefined);

    const payload = Buffer.from('reference;name;price;vat_id;department_id\n' + 'REF;Coffee;2.50;1;4\n'.repeat(5000));
    const preview = await call(tools.prepareImport, { contentBase64: payload.toString('base64'), idempotencyKey: requestKey });
    assert.equal(preview.result.structuredContent.id, importId);
    const statusArgs = { operationId: importId, operationKind: 'import' };
    const rowsArgs = { ...statusArgs, after: 2, limit: 10 };
    const confirmArgs = { operationId: importId, previewToken, apply: true };
    assert.equal((await call(tools.status, statusArgs)).result.structuredContent.previewToken, previewToken);
    assert.equal((await call(tools.result, rowsArgs)).result.structuredContent.rows[0].error, 'invalid_reference');
    const rejected = (await call(tools.confirmImport, confirmArgs)).result;
    assert.equal(rejected.isError, true);
    assert.match(rejected._meta['mcp/www_authenticate'][0], /scope="catalog.write".*error="insufficient_scope"/);
    scope += ' catalog.write';
    assert.equal((await call(tools.confirmImport, { ...confirmArgs, apply: false })).result?.isError, true);
    assert.equal((await call(tools.confirmImport, { ...confirmArgs, shop_id: 999 })).result?.isError, true);
    assert.equal(confirmed, false);
    assert.equal((await call(tools.confirmImport, confirmArgs)).result.structuredContent.state, 'queued');
    assert.equal((await call(tools.result, rowsArgs)).result.structuredContent.state, 'partial');
});

test('STDIO preserves legacy registrations and uses managed keys for asynchronous operations', async (t) => {
    const partnerKey = 'kash_' + 'a'.repeat(64);
    const received = [];
    const app = express();
    app.use(express.json());
    app.post('/api/partner/v1/exports', (req, res) => {
        received.push({
            shop: req.query.shop_id,
            auth: req.get('Authorization'),
            tokenRef: req.get('X-Kash-Mcp-Token-Ref'),
            key: req.get('Idempotency-Key'),
            body: req.body,
        });
        res.status(202).json({ data: { id: exportId, state: 'queued' } });
    });
    app.get('/api/partner/v1/operations/' + exportId + '/result', (_req, res) => res.json({ data: file }));
    const base = await listen(app, t);

    async function start(key) {
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: ['--import', 'tsx', 'src/stdio.ts'],
            env: { API_BASE: base, SHOPID: '42', APIKEY: 'legacy-value', KASH_PARTNER_API_KEY: key },
            stderr: 'pipe',
        });
        transport.stderr?.resume();
        const client = new Client({ name: 'async-operations-test', version: '1.0.0' });
        t.after(() => client.close());
        await client.connect(transport, { timeout: 120000 });
        return client;
    }
    const legacy = await start('');
    const legacyTools = (await legacy.listTools()).tools.map(({ name }) => name);
    assert.ok(legacyTools.includes('report_get'));
    assert.equal(legacyTools.includes(tools.exportSales), false);

    const managed = await start(partnerKey);
    const managedTools = (await managed.listTools()).tools.map(({ name }) => name);
    assert.ok(managedTools.includes('report_get'));
    for (const name of Object.values(tools)) assert.ok(managedTools.includes(name));
    const queued = await managed.callTool({
        name: tools.exportSales, arguments: { ...salesDates, idempotencyKey: requestKey },
    });
    assert.equal(queued.structuredContent.id, exportId);
    const result = await managed.callTool({
        name: tools.result, arguments: { operationId: exportId, operationKind: 'export' },
    });
    assert.equal(result.content.find((item) => item.type === 'resource').resource.blob, file.contentBase64);
    assert.deepEqual(received, [{
        shop: '42', auth: 'Bearer ' + partnerKey, tokenRef: undefined, key: requestKey,
        body: { type: 'sales', format: 'csv', parameters: salesDates },
    }]);
});
