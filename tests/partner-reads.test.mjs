import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import express from 'express';
import { mountKashOAuthMcp } from '../src/support/kashOAuthMcp.ts';

const salesInput = { from: '2026-10-18', to: '2026-10-18', cash_register_id: 2 };
const totals = {
    gross_sales_amount: '60.025', refund_amount: '-12.00', net_sales_amount: '48.025', sale_count: 1, refund_count: 1,
};
const sales = {
    currency: 'EUR',
    timezone: '+02:00',
    period: {
        from: salesInput.from, to: salesInput.to,
        start_at: '2026-10-18T05:00:00+02:00', end_at_exclusive: '2026-10-19T05:00:00+02:00',
    },
    business_day: { opening_time: '05:00:00', date_field: 'datevaleur' },
    totals,
    by_business_day: [{ date: salesInput.from, ...totals }],
    by_cash_register: [{ cash_register_id: 2, ...totals }],
    by_payment_method: [
        { payment_method_id: 3, payment_type_id: 1, payment_count: 1, applied_amount: '25.00' },
        { payment_method_id: 4, payment_type_id: 2, payment_count: 2, applied_amount: '23.025' },
    ],
};
const invoice = {
    invoice: { id: 517, reference: 'FAC-517', issued_at: '2026-10-18T12:37:00+02:00' },
    documents: [{
        id: 'pdf', type: 'invoice', format: 'factur_x', content_type: 'application/pdf',
        availability: 'available', download_path: '/api/partner/v1/invoices/517/documents/pdf?shop_id=42',
    }],
    credit_notes: [{
        id: 518, reference: 'AV-518', issued_at: '2026-10-18T14:50:00+02:00',
        documents: [{
            id: 'pdf', type: 'credit_note', format: 'pdf', content_type: 'application/pdf',
            availability: 'unavailable', download_path: null,
        }],
        transmission: { pennylane: { status: 'unavailable', records: [] } },
    }],
    transmission: {
        pennylane: {
            status: 'sent',
            records: [{ status: 'sent', reference: 'PL-928', updated_at: '2026-10-18T15:00:00+02:00' }],
        },
    },
};
const invoiceWithoutAccounting = {
    ...invoice, transmission: null, credit_notes: invoice.credit_notes.map((note) => ({ ...note, transmission: null })),
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

test('HTTP OAuth scopes and selected shop constrain both partner read tools', async (t) => {
    const issuer = 'https://partner.example';
    const resource = 'https://mcp.example/mcp';
    const serviceToken = 's'.repeat(64);
    const tokenRef = 'e'.repeat(64);
    const accessToken = 'mcp2_' + 'f'.repeat(80);
    const config = {
        MCP_KASH_OAUTH_ISSUER: issuer,
        MCP_KASH_OAUTH_RESOURCE: resource,
        MCP_KASH_OAUTH_SERVICE_TOKEN: serviceToken,
    };
    const previousConfig = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]]));
    const originalFetch = globalThis.fetch;
    Object.assign(process.env, config);
    t.after(() => {
        globalThis.fetch = originalFetch;
        for (const [key, value] of Object.entries(previousConfig)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    let scope = 'reports.read';
    let responseStatus = 200;
    let invoicePayload = invoice;
    const partnerCalls = [];
    globalThis.fetch = async (target, options) => {
        const url = new URL(target);
        assert.equal(url.origin, issuer);
        assert.equal(options.headers.Authorization, 'Bearer ' + serviceToken);
        if (url.pathname === '/oauth/introspect') {
            assert.equal(options.body.get('token'), accessToken);
            return Response.json({
                active: true, iss: issuer, aud: resource, scope,
                exp: Math.floor(Date.now() / 1000) + 120, token_ref: tokenRef, shop_id: '42',
            });
        }
        assert.equal(options.method, 'GET');
        assert.equal(options.headers['X-Kash-Mcp-Token-Ref'], tokenRef);
        assert.equal(options.redirect, 'error');
        partnerCalls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
        const payload = url.pathname.endsWith('/sales-summary') ? sales
            : scope.includes('accounting_transmissions.read') ? invoicePayload : invoiceWithoutAccounting;
        return Response.json(responseStatus === 200 ? payload : { diagnostics: serviceToken }, { status: responseStatus });
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
    const call = async (name, args) => (await (await request('tools/call', { name, arguments: args })).json());

    const metadata = await (await originalFetch(base + '/.well-known/oauth-protected-resource/mcp')).json();
    for (const requestedScope of ['reports.read', 'invoices.read', 'accounting_transmissions.read']) {
        assert.ok(metadata.scopes_supported.includes(requestedScope));
    }
    const tools = (await (await request('tools/list', {}, false)).json()).result.tools;
    for (const [name, required] of [['sales_summary', 'reports.read'], ['list_invoice_documents', 'invoices.read']]) {
        const tool = tools.find((entry) => entry.name === name);
        assert.equal(tool.annotations.readOnlyHint, true);
        assert.equal(tool.inputSchema.additionalProperties, false);
        assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: [required] }]);
        const unauthorized = await request('tools/call', { name }, false);
        assert.equal(unauthorized.status, 401);
        assert.ok(unauthorized.headers.get('WWW-Authenticate').includes('scope="' + required + '"'));
    }

    const denied = (await call('list_invoice_documents', { invoice_id: 517 })).result;
    assert.equal(denied.isError, true);
    assert.equal(denied.structuredContent.error.code, 'insufficient_scope');
    assert.match(denied._meta['mcp/www_authenticate'][0], /invoices\.read/);
    assert.equal((await call('sales_summary', { ...salesInput, shop_id: 999 })).result?.isError, true);
    assert.equal((await call('list_invoice_documents', { invoice_id: '../518' })).result?.isError, true);
    assert.deepEqual(partnerCalls, []);

    const salesResult = (await call('sales_summary', salesInput)).result;
    assert.deepEqual(salesResult.structuredContent, sales);
    assert.deepEqual(partnerCalls.pop(), {
        path: '/api/partner/v1/reports/sales-summary',
        query: { from: salesInput.from, to: salesInput.to, cash_register_id: '2', shop_id: '42' },
    });

    scope = 'invoices.read';
    const limited = (await call('list_invoice_documents', { invoice_id: '517' })).result;
    assert.deepEqual(limited.structuredContent, invoiceWithoutAccounting);
    assert.deepEqual(partnerCalls.pop(), { path: '/api/partner/v1/invoices/517/documents', query: { shop_id: '42' } });
    assert.equal((await call('sales_summary', salesInput)).result.structuredContent.error.code, 'insufficient_scope');
    assert.deepEqual(partnerCalls, []);

    scope += ' accounting_transmissions.read';
    const tracked = (await call('list_invoice_documents', { invoice_id: 517 })).result;
    assert.deepEqual(tracked.structuredContent, invoice);
    assert.doesNotMatch(JSON.stringify(tracked), new RegExp([serviceToken, tokenRef, accessToken].join('|')));

    invoicePayload = { ...invoice, documents: [{ ...invoice.documents[0], download_path: invoice.documents[0].download_path + '&key=' + serviceToken }] };
    const rejectedPath = (await call('list_invoice_documents', { invoice_id: 517 })).result;
    assert.equal(rejectedPath.structuredContent.error.code, 'unavailable');
    assert.doesNotMatch(JSON.stringify(rejectedPath), new RegExp(serviceToken));

    for (const [status, code] of [[404, 'not_found'], [503, 'unavailable'], [401, 'invalid_token']]) {
        responseStatus = status;
        const result = (await call('list_invoice_documents', { invoice_id: 517 })).result;
        assert.equal(result.structuredContent.error.code, code);
        assert.doesNotMatch(JSON.stringify(result), new RegExp(serviceToken));
    }
});

test('STDIO requires a managed key and reads both routes via the selected shop', async (t) => {
    const partnerKey = 'kash_' + 'c'.repeat(64);
    const legacyReport = '<table><tr><td>60,00</td></tr></table>';
    const legacyCsv = '"id","nom"\r\n"1","Camille"\r\n';
    const requestOptions = { timeout: 180_000 };
    const received = [];
    const app = express();
    app.get('/workers/getSales.php', (req, res) => {
        assert.equal(req.query.formatExport, 'Std');
        assert.equal(req.query.shopID, '42');
        res.type('html').send(legacyReport);
    });
    let historicListCalls = 0;
    app.get('/workers/getClients.php', (req, res) => {
        historicListCalls++;
        assert.equal(req.query.format, 'csv');
        res.type('csv').send(legacyCsv);
    });
    app.get('/api/partner/v1/reports/sales', (req, res) => {
        received.push({ query: req.query, path: req.path });
        assert.equal(req.get('Authorization'), 'Bearer ' + partnerKey);
        res.type('html').send(legacyReport);
    });
    app.get('/api/partner/v1/customers', (req, res) => {
        received.push({ query: req.query, path: req.path });
        assert.equal(req.get('Authorization'), 'Bearer ' + partnerKey);
        const continued = req.query.cursor === 'opaque-sample';
        res.json({ data: [{ id: continued ? 2 : 1, nom: continued ? 'Robert' : 'Camille' }],
            pagination: { next_cursor: continued ? null : 'opaque-sample' } });
    });
    app.get(['/api/partner/v1/reports/sales-summary', '/api/partner/v1/invoices/517/documents'], (req, res) => {
        received.push({ query: req.query, path: req.path });
        assert.equal(req.get('Authorization'), 'Bearer ' + partnerKey);
        assert.equal(req.get('X-Kash-Mcp-Token-Ref'), undefined);
        res.json(req.path.endsWith('/sales-summary') ? sales : invoice);
    });
    const base = await listen(app, t);

    async function start(key) {
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: ['--import', 'tsx', 'src/stdio.ts'],
            env: { API_BASE: base, SHOPID: '42', APIKEY: key || 'legacy-value', KASH_PARTNER_API_KEY: key },
            stderr: 'pipe',
        });
        let diagnostics = '';
        transport.stderr?.setEncoding('utf8').on('data', (chunk) => { diagnostics += chunk; });
        const client = new Client({ name: 'partner-read-test', version: '1.0.0' });
        t.after(() => client.close());
        try {
            await client.connect(transport, requestOptions);
        } catch (error) {
            throw new Error('STDIO initialization failed. ' + diagnostics, { cause: error });
        }
        return client;
    }

    const legacy = await start('');
    const legacyTools = (await legacy.listTools(undefined, requestOptions)).tools.map(({ name }) => name);
    assert.ok(legacyTools.includes('report_get'));
    assert.ok(!legacyTools.includes('list_invoice_documents'));
    assert.ok(!legacyTools.includes('sales_summary'));
    const report = await legacy.callTool({ name: 'report_get', arguments: {} }, undefined, requestOptions);
    assert.deepEqual(report.content, [{ type: 'text', text: legacyReport }]);
    await legacy.close();

    const managed = await start(partnerKey);
    const managedReport = await managed.callTool({ name: 'report_get', arguments: { d: 18, m: 10, y: 2026 } }, undefined, requestOptions);
    assert.deepEqual(managedReport.structuredContent, { report: legacyReport });
    const clients = await managed.callTool({ name: 'data_list_clients', arguments: {} }, undefined, requestOptions);
    assert.deepEqual(clients.structuredContent, { data: [{ id: '1', nom: 'Camille' }, { id: '2', nom: 'Robert' }] });
    const clientsCsv = await managed.callTool({ name: 'data_list_clients', arguments: { format: 'csv' } }, undefined, requestOptions);
    assert.deepEqual(clientsCsv.structuredContent, { data: legacyCsv });
    assert.equal(historicListCalls, 1);
    for (const [name, args, expected] of [
        ['sales_summary', salesInput, sales],
        ['list_invoice_documents', { invoice_id: '517' }, invoice],
    ]) {
        const result = await managed.callTool({ name, arguments: args }, undefined, requestOptions);
        assert.deepEqual(result.structuredContent, expected);
        assert.doesNotMatch(JSON.stringify(result), new RegExp(partnerKey));
    }
    assert.deepEqual(received, [
        { path: '/api/partner/v1/reports/sales', query: { format: 'Std', d: '18', m: '10', y: '2026', shop_id: '42' } },
        { path: '/api/partner/v1/customers', query: { shop_id: '42', limit: '200' } },
        { path: '/api/partner/v1/customers', query: { shop_id: '42', limit: '200', cursor: 'opaque-sample' } },
        { path: '/api/partner/v1/reports/sales-summary', query: { from: salesInput.from, to: salesInput.to, cash_register_id: '2', shop_id: '42' } },
        { path: '/api/partner/v1/invoices/517/documents', query: { shop_id: '42' } },
    ]);
});
