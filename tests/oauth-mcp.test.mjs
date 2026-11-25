import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import { Client as ModernClient, StreamableHTTPClientTransport as ModernHttpTransport } from '@modelcontextprotocol/client';
import { mountKashOAuthMcp } from '../src/support/kashOAuthMcp.ts';

function assertPortablePatterns(schema, path) {
    if (!schema || typeof schema !== 'object') return;
    if (typeof schema.pattern === 'string') {
        assert.doesNotThrow(() => new RegExp(schema.pattern), path + '.pattern');
    }
    for (const [key, value] of Object.entries(schema)) {
        assertPortablePatterns(value, path + '.' + key);
    }
}

let legacyTools;
const testProtocol = protocolVersion => test(`PHP OAuth protects Kash MCP tools over ${protocolVersion}`, async () => {
    const modern = protocolVersion === '2026-07-28';
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
    const workerCalls = [];
    const v1MailboxPaths = {
        getMailbox: '/mailbox', getMailboxMessages: '/mailbox/messages',
        getMailboxMessage: '/mailbox/message', getMailboxReplies: '/mailbox/replies',
        getMailboxFolders: '/mailbox/folders', downloadMailboxAttachment: '/mailbox/attachment',
    };
    const shopToken = 'mcp2_' + 'c'.repeat(80);
    const otherToken = 'mcp2_' + 'd'.repeat(80);
    const shopReference = 'e'.repeat(64);
    const otherReference = 'f'.repeat(64);
    let workerStatus = 200;
    let saleReply;
    let shopCanWriteCustomers = false;
    let shopCanReadSales = false;
    let mailboxAccess = 'mailbox.read mailbox.write mailbox.send';
    const mailboxRequestId = 'c'.repeat(64);
    const mailboxKey = 'd'.repeat(32);
    const approvalUrl = issuer + '/oauth/mailbox/approve?request=' + mailboxRequestId;
    const downloadUrl = issuer + '/oauth/mailbox/attachment?ref=' + 'e'.repeat(1024);
    const inboxMessage = { id: 12, box: 'inbox', subject: 'Example', read: false };
    const mailboxCounts = { total: 1, unread: 1 };
    const listPage = { total: 1, page: 1, per_page: 25, pages: 1, has_more: false };
    const pendingApproval = { approval_required: true, status: 'pending', request_id: mailboxRequestId, expires_at: 1900000000, approval_url: approvalUrl };
    const mailboxCases = [
        ['mailbox_get', 'mailbox.read', 'GET', 'getMailbox', {}, {},
            { mailbox: { address: null, sender_address: null, sending_enabled: false, provisioned: false,
                all: mailboxCounts, inbox: mailboxCounts, sent: { total: 0, statuses: [] } } }],
        ['mailbox_list_messages', 'mailbox.read', 'GET', 'getMailboxMessages',
            { page: 1, read: false, search: 'Example', from: '2026-01-10' },
            { box: 'inbox', page: '1', read: '0', search: 'Example', from: '2026-01-10' },
            { box: 'inbox', messages: [inboxMessage], ...listPage }],
        ['mailbox_get_message', 'mailbox.read', 'GET', 'getMailboxMessage', { id: 12, box: 'inbox' }, { id: '12', box: 'inbox' },
            { message: { ...inboxMessage, text_body: 'Hello', text_truncated: false, html_body: '<img src="example">',
                has_html_body: true, attachment_count: 1,
                attachments: [{ id: 7, name: 'receipt.pdf', available: true, content_type: 'application/pdf',
                    download_url: '/legacy?key=secret', content_base64: 'binary' }], postmark_message_id: 'private' } }],
        ['mailbox_list_replies', 'mailbox.read', 'GET', 'getMailboxReplies', { message_id: 12, status: 'sent' },
            { message_id: '12', status: 'sent' }, { box: 'sent', messages: [{ id: 13, box: 'sent', status: 'sent' }], ...listPage }],
        ['mailbox_open_attachment', 'mailbox.read', 'GET', 'downloadMailboxAttachment', { id: 7, box: 'inbox' },
            { id: '7', box: 'inbox' },
            { attachment: { id: 7, box: 'inbox', name: 'receipt.pdf', available: true, open_url: downloadUrl, content_base64: 'binary' } }],
        ['mailbox_list_folders', 'mailbox.read', 'GET', 'getMailboxFolders', {}, {},
            { folders: [{ id: 5, name: 'Example', ...mailboxCounts }], all: mailboxCounts, inbox: mailboxCounts }],
        ['mailbox_update_message', 'mailbox.write', 'POST', 'editMailboxMessage',
            { message_id: 12, read: false, replied: true }, { message_id: '12', read: '0', replied: '1' }, { message: inboxMessage }],
        ['mailbox_move_message', 'mailbox.write', 'POST', 'moveMailboxMessage',
            { message_id: 12, folder_id: 0 }, { message_id: '12', folder_id: '0' }, { message_id: 12, folder_id: null }],
        ['mailbox_create_folder', 'mailbox.write', 'POST', 'addMailboxFolder',
            { name: 'Example' }, { name: 'Example' }, { folder_id: 5 }],
        ['mailbox_rename_folder', 'mailbox.write', 'POST', 'editMailboxFolder',
            { folder_id: 5, name: 'Renamed' }, { folder_id: '5', name: 'Renamed' }, { folder_id: 5 }],
        ['mailbox_delete_folder', 'mailbox.write', 'POST', 'delMailboxFolder', { folder_id: 5 }, { folder_id: '5' }, { folder_id: 5 }],
        ['mailbox_request_send', 'mailbox.send', 'POST', 'sendMailboxMessage',
            { to: 'client@example.test', subject: 'Order', body: 'Hello\nWorld', request_key: mailboxKey },
            { to: 'client@example.test', subject: 'Order', body: 'Hello\nWorld', request_key: mailboxKey }, pendingApproval],
        ['mailbox_request_reply', 'mailbox.send', 'POST', 'replyMailboxMessage',
            { message_id: 12, body: 'Thanks', request_key: mailboxKey },
            { message_id: '12', body: 'Thanks', request_key: mailboxKey }, pendingApproval],
    ];
    const mailboxResponses = new Map(mailboxCases.map(([, , , worker, , , data]) => [worker, data]));
    globalThis.fetch = async (url, options) => {
        const target = new URL(url);
        assert.equal(target.origin, issuer);
        assert.equal(options.headers.Authorization, 'Bearer ' + serviceToken);
        if (target.pathname === '/oauth/introspect') {
            calls++;
            const received = options.body.get('token');
            assert.ok([token, shopToken, otherToken].includes(received));
            if (received !== token) {
                const mine = received === shopToken;
                return Response.json({
                    active: true, iss: issuer, aud: resource,
                    scope: mine
                        ? 'catalog.read catalog.write customers.read sales.write settings.read settings.write'
                            + (shopCanWriteCustomers ? ' customers.write' : '')
                            + (shopCanReadSales ? ' sales.read' : '')
                            + ' ' + mailboxAccess
                        : 'customers.read',
                    exp: Math.floor(Date.now() / 1000) + 60,
                    token_ref: mine ? shopReference : otherReference,
                    shop_id: mine ? '31' : 32,
                });
            }
            if (authMode === 'revoked') return Response.json({ active: false });
            if (authMode === 'down') return Response.json({}, { status: 503 });
            return Response.json({
                active: true, iss: authMode === 'issuer' ? 'https://other-issuer.example' : issuer,
                aud: authMode === 'audience' ? issuer : resource,
                scope: authMode === 'scope' ? 'sales.read' : 'catalog.read',
                exp: Math.floor(Date.now() / 1000) + (authMode === 'expired' ? -10 : 60), token_ref: reference,
            });
        }
        if (target.pathname.startsWith('/api/partner/v1/')) {
            assert.equal(options.method, 'GET');
            assert.equal(options.redirect, 'error');
            const { searchParams } = target;
            assert.equal(searchParams.has('key'), false);
            const ref = options.headers['X-Kash-Mcp-Token-Ref'];
            assert.equal(searchParams.get('shop_id'), ref === shopReference ? '31' : '32');
            workerCalls.push({ path: target.pathname, method: 'GET', ref, idempotencyKey: undefined,
                values: Object.fromEntries(searchParams) });
            if (target.pathname === '/api/partner/v1/customers') {
                return Response.json({ data: [{ id: Number(searchParams.get('shop_id')) }], pagination: { next_cursor: null } }, { status: workerStatus });
            }
            if (target.pathname === '/api/partner/v1/products') {
                const after = searchParams.get('after_id');
                return Response.json({ data: [{ id: after === null ? 2 : 4, name: '', short_name: 'Coffee', price: '2.00' }],
                    pagination: { next_cursor: after === null ? 'opaque-sample' : null } }, { status: workerStatus });
            }
            const worker = Object.keys(v1MailboxPaths).find(key => '/api/partner/v1' + v1MailboxPaths[key] === target.pathname);
            assert.ok(worker, 'registered V1 read');
            return Response.json(mailboxResponses.get(worker), { status: workerStatus });
        }
        if (target.pathname.startsWith('/workers/')) {
            const parameters = options.body || target.searchParams;
            assert.equal(options.redirect, 'error');
            assert.equal(parameters.has('key'), false);
            assert.equal(parameters.has('token'), false);
            assert.equal(parameters.has('token_ref'), false);
            assert.equal(parameters.has('idUser'), false);
            workerCalls.push({
                path: target.pathname, method: options.method, ref: options.headers['X-Kash-Mcp-Token-Ref'],
                idempotencyKey: options.headers['Idempotency-Key'],
                values: Object.fromEntries(parameters),
            });
            if (target.pathname === '/workers/getLivreurs.php') {
                return Response.json([{ id: '7', nom: 'Martin', prenom: 'Alex' }]);
            }
            if (target.pathname === '/workers/getOrders.php') {
                const orders = parameters.get('validatedOrders') === 'true' ? [{ id: 7 }] : null;
                return Response.json(orders, { status: workerStatus });
            }
            if (target.pathname === '/workers/webapp.php' || target.pathname === '/workers/editOrder.php') {
                return saleReply ? saleReply() : Response.json({ result: 'ok', orderID: 456 }, { status: workerStatus });
            }
            const mailboxReply = mailboxResponses.get(target.pathname.slice('/workers/'.length, -'.php'.length));
            if (mailboxReply) return Response.json({ success: true, ...mailboxReply }, { status: workerStatus });
            return Response.json({ shop: parameters.get('shopID') }, { status: workerStatus });
        }
        products++;
        assert.equal(target.pathname, '/oauth/catalog');
        assert.equal(options.body.has('token'), false);
        assert.equal(options.body.has('shop'), false);
        const tokenRef = options.body.get('token_ref');
        if (tokenRef === shopReference) {
            assert.deepEqual(Object.fromEntries(options.body), { token_ref: shopReference, after: '2', limit: '1' });
            return Response.json({ items: [{ id: '4', title: 'Coffee', price: '2.00' }], nextCursor: null });
        }
        assert.equal(tokenRef, reference);
        if (authMode === 'mid-call') return Response.json({}, { status: 401 });
        return Response.json({ items: [{ id: '2', title: 'Coffee', price: '2.00' }], nextCursor: null });
    };

    const app = express();
    mountKashOAuthMcp(app);
    const http = app.listen(0, '127.0.0.1');
    await once(http, 'listening');
    const base = 'http://127.0.0.1:' + http.address().port;
    const clientInfo = { name: 'kash-test', version: '1' };
    const request = (method, params, headers = {}) => originalFetch(base + '/mcp', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'MCP-Protocol-Version': protocolVersion,
            ...(modern ? {
                'Mcp-Method': method,
                ...(method === 'tools/call' ? { 'Mcp-Name': params.name } : {}),
            } : {}),
            ...headers,
        },
        body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method,
            params: modern ? { ...params, _meta: {
                'io.modelcontextprotocol/protocolVersion': protocolVersion,
                'io.modelcontextprotocol/clientInfo': clientInfo,
                'io.modelcontextprotocol/clientCapabilities': {},
            } } : params,
        }),
    });
    const call = (headers) => request('tools/call', { name: 'data_list_products', arguments: { limit: 1 } }, headers);
    const bearer = { Authorization: 'Bearer ' + token };
    const toolsCall = (name, args, id = shopToken) => request('tools/call', {
        name, arguments: args,
    }, { Authorization: 'Bearer ' + id, 'X-Shop-Id': '99', 'X-Api-Key': 'legacy' });
    try {
        const metadata = await originalFetch(base + '/.well-known/oauth-protected-resource/mcp');
        assert.deepEqual(await metadata.json(), {
            resource, authorization_servers: [issuer],
            scopes_supported: [
                'catalog.read', 'catalog.write', 'customers.read', 'customers.write',
                'sales.read', 'sales.write', 'reports.read', 'settings.read', 'settings.write',
                'invoices.read', 'accounting_transmissions.read',
                'mailbox.read', 'mailbox.write', 'mailbox.send',
            ],
            bearer_methods_supported: ['header'],
        });
        const initialized = modern ? await request('server/discover', {}) :
            await request('initialize', { protocolVersion, capabilities: {}, clientInfo });
        assert.equal(initialized.status, 200, await initialized.clone().text());
        const discovery = (await initialized.json()).result;
        assert.match(JSON.stringify(discovery), /kash-catalog/);
        assert.ok(JSON.stringify(discovery).includes(protocolVersion));
        assert.equal(initialized.headers.has('mcp-session-id'), false);
        if (!modern) {
            const unsupportedDiscovery = await request('server/discover', {});
            assert.equal(unsupportedDiscovery.status, 401);
        }
        const list = await request('tools/list', {});
        assert.equal(list.status, 200, await list.clone().text());
        const tools = (await list.json()).result.tools;
        assert.equal(tools.length, 78);
        for (const tool of tools) {
            assert.ok(tool.securitySchemes?.length, tool.name);
            assert.deepEqual(tool.securitySchemes, tool._meta.securitySchemes, tool.name);
            assertPortablePatterns(tool.inputSchema, tool.name + '.inputSchema');
            assertPortablePatterns(tool.outputSchema, tool.name + '.outputSchema');
        }
        if (modern) {
            for (const [index, tool] of tools.entries()) {
                const { execution, ...legacyTool } = legacyTools[index];
                assert.deepEqual(execution, { taskSupport: 'forbidden' });
                assert.deepEqual(tool, legacyTool, tool.name);
            }
        } else legacyTools = tools;
        const toolByName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
        assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length);
        for (const [name, scope] of Object.entries({
            data_list_products: 'catalog.read', data_list_departments: 'catalog.read', variation_choice_add: 'catalog.write',
            data_list_clients: 'customers.read', client_add: 'customers.write', order_detail: 'sales.read',
            order_create: 'sales.write', report_get: 'reports.read', account_show_infos: 'settings.read',
            account_edit: 'settings.write', data_list_delivery_men: 'settings.read', data_list_delivery_methods: 'settings.read',
        })) {
            assert.deepEqual(toolByName[name]._meta.securitySchemes, [{ type: 'oauth2', scopes: [scope] }]);
            assert.equal(toolByName[name].annotations.readOnlyHint, scope.endsWith('.read'));
        }
        assert.notEqual(toolByName.data_list_delivery_men.title, toolByName.data_list_delivery_methods.title);
        for (const name of ['account_list', 'account_create', 'auth_logout']) {
            assert.equal(toolByName[name], undefined);
        }
        assert.equal(tools.some(tool => /otp|\blogin\b/i.test(tool.name)), false);
        assert.equal(toolByName.account_edit.inputSchema.properties.yavinSecret, undefined);
        assert.equal(toolByName.order_create.inputSchema.properties.idUser, undefined);
        for (const name of ['order_create', 'order_edit']) {
            assert.ok(toolByName[name].inputSchema.required.includes('idempotencyKey'));
            assert.equal(toolByName[name].annotations.idempotentHint, true);
        }
        for (const name of ['order_create', 'order_edit', 'client_delete', 'plu_edit', 'account_edit']) {
            assert.equal(toolByName[name].annotations.destructiveHint, true);
        }
        const missing = await call();
        assert.equal(missing.status, 401);
        assert.match(missing.headers.get('www-authenticate'), /resource_metadata="https:\/\/mcp\.example\/\.well-known\/oauth-protected-resource\/mcp"/);
        const oversized = await request('tools/call', {
            name: 'data_list_products', arguments: { padding: 'x'.repeat(1536 * 1024) },
        }, bearer);
        assert.equal(oversized.status, 413);
        assert.deepEqual(await oversized.json(), { error: 'request_too_large' });
        assert.equal((await call({ ...bearer, Origin: 'https://unregistered.example' })).status, 403);
        assert.equal(calls, 0);
        assert.equal((await call({ 'x-shop-id': '2', 'x-api-key': 'legacy' })).status, 401);
        const result = await call(bearer);
        assert.equal(result.status, 200);
        assert.deepEqual((await result.json()).result.structuredContent.items, [{ id: '2', title: 'Coffee', price: '2.00' }]);
        for (const [mode, status] of [['revoked', 401], ['issuer', 401], ['audience', 401], ['expired', 401], ['scope', 403], ['down', 503]]) {
            authMode = mode;
            assert.equal((await call(bearer)).status, status);
        }
        assert.equal(products, 1);
        authMode = 'mid-call';
        const expired = (await (await call(bearer)).json()).result;
        assert.equal(expired.isError, true);
        assert.match(expired._meta['mcp/www_authenticate'][0], /error="invalid_token"/);

        authMode = 'allowed';
        const legacyGrant = await toolsCall('data_list_departments', {}, token);
        assert.match((await legacyGrant.json()).result._meta['mcp/www_authenticate'][0], /error="invalid_token"/);
        assert.equal(workerCalls.length, 0);
        const rejected = await toolsCall('plu_add', { title: 'Coffee', idempotencyKey: 'test-create-key-189' }, token);
        assert.equal(rejected.status, 200);
        assert.match((await rejected.json()).result._meta['mcp/www_authenticate'][0], /scope="catalog.write".*error="insufficient_scope"/);
        const wrongPrefix = await toolsCall('data_list_clients', {}, shopToken.toUpperCase());
        assert.equal(wrongPrefix.status, 401);
        const missingSalesRead = await toolsCall('order_detail', { order_id: 7 });
        assert.equal(missingSalesRead.status, 200);
        assert.match((await missingSalesRead.json()).result._meta['mcp/www_authenticate'][0], /scope="sales.read".*error="insufficient_scope"/);
        const missingCatalog = await toolsCall('data_list_products', {}, otherToken);
        assert.match((await missingCatalog.json()).result._meta['mcp/www_authenticate'][0], /scope="catalog.read".*error="insufficient_scope"/);
        assert.equal(workerCalls.length, 0);

        shopCanReadSales = true;
        const offsetRange = {
            from_date_ISO8601: '2026-11-24T12:00:00+01:00',
            to_date_ISO8601: '2026-11-24T12:01:00+01:00',
        };
        const utcRange = {
            from_date_ISO8601: '2026-11-24T11:00:00Z',
            to_date_ISO8601: '2026-11-24T11:01:00Z',
        };
        for (const [range, validatedOrders, expected] of [
            [offsetRange, false, []],
            [utcRange, true, [{ id: 7 }]],
        ]) {
            const response = await toolsCall('data_list_orders', { ...range, validatedOrders });
            assert.equal(response.status, 200);
            assert.deepEqual((await response.json()).result.structuredContent, { data: expected });
            assert.deepEqual(workerCalls.splice(0), [{
                path: '/workers/getOrders.php', method: 'GET', ref: shopReference, idempotencyKey: undefined,
                values: { idboutique: '31', shopID: '31', ...range, validatedOrders: String(validatedOrders) },
            }]);
        }
        workerStatus = 503;
        const failedOrders = await toolsCall('data_list_orders', { ...offsetRange, validatedOrders: false });
        assert.equal((await failedOrders.json()).result.isError, true);
        assert.equal(workerCalls.splice(0).length, 1);
        workerStatus = 200;
        shopCanReadSales = false;

        const [client31, client32] = await Promise.all([
            toolsCall('data_list_clients', { shopID: 32, idboutique: 33, key: 'wrong' }),
            toolsCall('data_list_clients', { shopID: 31 }, otherToken),
        ]);
        assert.deepEqual((await client31.json()).result.structuredContent, { data: [{ id: '31' }] });
        assert.deepEqual((await client32.json()).result.structuredContent, { data: [{ id: '32' }] });
        assert.deepEqual(workerCalls.splice(0).sort((a, b) => a.ref.localeCompare(b.ref)), [
            { path: '/api/partner/v1/customers', method: 'GET', ref: shopReference,
                values: { shop_id: '31', limit: '200' }, idempotencyKey: undefined },
            { path: '/api/partner/v1/customers', method: 'GET', ref: otherReference,
                values: { shop_id: '32', limit: '200' }, idempotencyKey: undefined },
        ]);
        const catalog = await toolsCall('data_list_products', { limit: 1 });
        assert.deepEqual((await catalog.json()).result.structuredContent,
            { items: [{ id: '2', title: 'Coffee', price: '2.00' }], nextCursor: '2' });
        const nextCatalog = await toolsCall('data_list_products', { limit: 1, cursor: '2' });
        assert.deepEqual((await nextCatalog.json()).result.structuredContent,
            { items: [{ id: '4', title: 'Coffee', price: '2.00' }], nextCursor: null });
        assert.deepEqual(workerCalls.splice(0).map(({ path, values }) => ({ path, values })), [
            { path: '/api/partner/v1/products', values: { limit: '1', shop_id: '31' } },
            { path: '/api/partner/v1/products', values: { limit: '1', after_id: '2', shop_id: '31' } },
        ]);

        const previousCatalogCalls = products;
        workerStatus = 503;
        const fallbackCatalog = await toolsCall('data_list_products', { limit: 1, cursor: '2' });
        assert.deepEqual((await fallbackCatalog.json()).result.structuredContent,
            { items: [{ id: '4', title: 'Coffee', price: '2.00' }], nextCursor: null });
        workerStatus = 403;
        const deniedCatalog = await toolsCall('data_list_products', { limit: 1, cursor: '2' });
        assert.equal((await deniedCatalog.json()).result.isError, true);
        workerStatus = 200;
        assert.equal(products, previousCatalogCalls + 1, 'An access denial must not use the fallback');
        assert.deepEqual(workerCalls.splice(0).map(({ path, values }) => ({ path, values })), [
            { path: '/api/partner/v1/products', values: { limit: '1', after_id: '2', shop_id: '31' } },
            { path: '/api/partner/v1/products', values: { limit: '1', after_id: '2', shop_id: '31' } },
        ]);

        const key = '550e8400-e29b-41d4-a716-446655440000';
        const args = { items: [{ type: 'catalog', productId: '4' }], idUser: '99' };
        const assertInvalidArgs = async (response) => {
            const { error, result } = await (await response).json();
            if (error) assert.equal(error.code, -32602);
            else assert.equal(result?.isError, true);
        };
        await assertInvalidArgs(toolsCall('order_create', args));
        await assertInvalidArgs(toolsCall('order_create', { ...args, idempotencyKey: key, payment: -1 }));
        await assertInvalidArgs(toolsCall('order_create', { ...args, idempotencyKey: key, payment: '-1' }));
        assert.equal(workerCalls.length, 0);
        const created = await toolsCall('order_create', { ...args, idempotencyKey: key });
        const completed = { orderID: 456, replayed: false, result: 'ok' };
        assert.deepEqual((await created.json()).result.structuredContent, completed);
        assert.deepEqual(workerCalls.splice(0), [{
            path: '/workers/webapp.php', method: 'POST', ref: shopReference, idempotencyKey: key,
            values: { idboutique: '31', shopID: '31', 'itemsList[]': '4_1__' },
        }]);
        const quoteKey = '550e8400-e29b-41d4-a716-446655440008';
        for (const payment of [0, -2, '-2']) {
            const quote = await toolsCall('order_create', { ...args, idempotencyKey: quoteKey, payment });
            assert.equal(quote.status, 200);
            assert.deepEqual((await quote.json()).result.structuredContent, completed);
            assert.deepEqual(workerCalls.splice(0), [{
                path: '/workers/webapp.php', method: 'POST', ref: shopReference, idempotencyKey: quoteKey,
                values: { idboutique: '31', shopID: '31', payment: '0', 'itemsList[]': '4_1__' },
            }]);
        }
        const inlineArgs = {
            items: [{ type: 'free', title: 'Coffee', price: '2,00' }],
            client: { firstname: 'Jane', country: 'France' },
            idempotencyKey: '550e8400-e29b-41d4-a716-446655440001',
        };
        const anonymousSale = await request('tools/call', { name: 'order_create', arguments: inlineArgs });
        assert.equal(anonymousSale.status, 401);
        assert.match(anonymousSale.headers.get('www-authenticate'), /scope="sales.write customers.write"/);
        const inlineDenied = await toolsCall('order_create', inlineArgs);
        assert.match((await inlineDenied.json()).result._meta['mcp/www_authenticate'][0],
            /scope="sales.write customers.write".*error="insufficient_scope"/);
        assert.equal(workerCalls.length, 0);
        shopCanWriteCustomers = true;
        const inlineCreated = await toolsCall('order_create', inlineArgs);
        assert.deepEqual((await inlineCreated.json()).result.structuredContent, completed);
        assert.deepEqual(workerCalls.splice(0), [{
            path: '/workers/webapp.php', method: 'POST', ref: shopReference, idempotencyKey: inlineArgs.idempotencyKey,
            values: { idboutique: '31', shopID: '31', 'itemsList[]': 'Free_2.00_Coffee',
                'client[firstname]': 'Jane', 'client[country]': 'France' },
        }]);
        shopCanWriteCustomers = false;
        const editKey = '550e8400-e29b-41d4-a716-446655440002';
        const editArgs = { orderID: 456, payment: 9, paymentAmount: '2.00', idClient: 17,
            client: inlineArgs.client, idempotencyKey: editKey };
        const edited = await toolsCall('order_edit', editArgs);
        assert.deepEqual((await edited.json()).result.structuredContent, completed);
        const [editRequest] = workerCalls.splice(0);
        // PHP hashes the parsed form in parameter order, including on replays of older edits.
        assert.deepEqual(Object.keys(editRequest.values), ['shopID', 'orderID', 'payment', 'paymentAmount', 'idClient']);
        assert.deepEqual(editRequest, {
            path: '/workers/editOrder.php', method: 'POST', ref: shopReference, idempotencyKey: editKey,
            values: { shopID: '31', orderID: '456', payment: '9', paymentAmount: '2.00', idClient: '17' },
        });
        saleReply = () => Response.json({ result: 'ok', orderID: 456 }, { headers: { 'Idempotency-Replayed': 'true' } });
        const replayedEdit = await toolsCall('order_edit', editArgs);
        assert.deepEqual((await replayedEdit.json()).result.structuredContent, { ...completed, replayed: true });
        assert.deepEqual(workerCalls.splice(0), [editRequest]);
        saleReply = undefined;

        const partialCreate = await toolsCall('order_create', { ...args, idempotencyKey: 'order-partial-payment', payment: '9', paymentAmount: 2.5 });
        assert.deepEqual((await partialCreate.json()).result.structuredContent, completed);
        assert.deepEqual(workerCalls.splice(0), [{
            path: '/workers/webapp.php', method: 'POST', ref: shopReference, idempotencyKey: 'order-partial-payment',
            values: { idboutique: '31', shopID: '31', payment: '9', paymentAmount: '2.5', 'itemsList[]': '4_1__' },
        }]);

        for (const [name, saleArgs] of [['order_create', args], ['order_edit', { orderID: 456 }]]) {
            for (const paymentAmount of [0, '0', '000.000']) {
                const zero = await toolsCall(name, { ...saleArgs, idempotencyKey: 'zero-amount-sample', payment: '9', paymentAmount });
                const { result } = await zero.json();
                assert.equal(result.isError, true);
                assert.deepEqual(result.structuredContent, { code: 'validation_failed' });
                assert.equal(workerCalls.length, 0);
            }
        }
        const defaultPayment = await toolsCall('order_edit', { orderID: 456, payment: 9, idempotencyKey: 'order-default-payment' });
        assert.deepEqual((await defaultPayment.json()).result.structuredContent, completed);
        assert.deepEqual(workerCalls.shift().values, { shopID: '31', orderID: '456', payment: '9' });

        await assertInvalidArgs(toolsCall('order_edit', { orderID: 456, payment: -3, idempotencyKey: editKey }));
        assert.equal(workerCalls.length, 0);
        const validatedUnpaid = await toolsCall('order_edit', { orderID: 456, payment: -1, idempotencyKey: 'order-validate-unpaid' });
        assert.deepEqual((await validatedUnpaid.json()).result.structuredContent, completed);
        assert.equal(workerCalls.shift().values.payment, '-1');

        const internalDetail = 'php-internal-detail';
        const jsonReply = (status, body) => () => Response.json({ result: internalDetail, ...body }, { status });
        const failureCases = [
            [jsonReply(409, { success: false, code: 'idempotency_conflict' }), { code: 'idempotency_conflict', replayed: false }],
            [jsonReply(409, { success: false, code: 'idempotency_unresolved', orderID: 456 }), { code: 'idempotency_unresolved', orderID: 456, replayed: false }],
            [jsonReply(503, { success: false, code: 'idempotency_unavailable' }), { code: 'idempotency_unavailable', replayed: false }],
            [jsonReply(400, { error: 'invalid_reference' }), { code: 'validation_failed', replayed: false }],
            [jsonReply(400, { success: false, code: 'idempotency_key_invalid' }), { code: 'idempotency_key_invalid', replayed: false }],
            [jsonReply(200, { success: false }), { code: 'validation_failed', replayed: false }],
            [jsonReply(503, { error: 'temporarily_unavailable' }), { code: 'unexpected_response', replayed: false }],
            [() => new Response(internalDetail, { status: 500 }), { code: 'unexpected_response', replayed: false }],
            [() => { throw new Error(internalDetail); }, { code: 'network_outcome_unknown' }],
            [() => new Response(new ReadableStream({ start(controller) { controller.error(new Error(internalDetail)); } })),
                { code: 'network_outcome_unknown' }],
        ];
        for (const [reply, expected] of failureCases) {
            saleReply = reply;
            const failed = await toolsCall('order_edit', editArgs);
            const { result } = await failed.json();
            assert.equal(result.isError, true);
            assert.deepEqual(result.structuredContent, expected);
            assert.equal(JSON.stringify(result).includes(internalDetail), false);
            assert.deepEqual(workerCalls.splice(0), [editRequest]);
        }

        for (const status of [401, 403]) {
            saleReply = jsonReply(status, { error: internalDetail });
            const denied = await toolsCall('order_edit', editArgs);
            const { result } = await denied.json();
            assert.equal(result.isError, true);
            assert.equal(JSON.stringify(result).includes(internalDetail), false);
            if (status === 401) assert.match(result._meta['mcp/www_authenticate'][0], /scope="sales.write".*error="invalid_token"/);
            assert.deepEqual(workerCalls.splice(0), [editRequest]);
        }
        saleReply = undefined;

        const payment = await toolsCall('payment_mode_add', { title: 'Cash', type: 'Cash', cashboxLock: 8 });
        assert.deepEqual((await payment.json()).result.structuredContent, { shop: '31' });
        assert.deepEqual(workerCalls.splice(0), [{
            path: '/workers/addPaymentMethod.php', method: 'POST', ref: shopReference, idempotencyKey: undefined,
            values: { shopID: '31', 'data[title]': 'Cash', 'data[type]': 'Cash', 'data[cashboxLock]': '8' },
        }]);
        const missingSettings = await toolsCall('data_list_delivery_men', {}, otherToken);
        assert.match((await missingSettings.json()).result._meta['mcp/www_authenticate'][0], /scope="settings.read".*error="insufficient_scope"/);
        const couriers = await toolsCall('data_list_delivery_men', { idboutique: 32 });
        assert.deepEqual((await couriers.json()).result.structuredContent, { data: [{ id: '7', nom: 'Martin', prenom: 'Alex' }] });
        assert.deepEqual(workerCalls.splice(0), [{
            path: '/workers/getLivreurs.php', method: 'GET', ref: shopReference, idempotencyKey: undefined,
            values: { idboutique: '31', shopID: '31', format: 'json' },
        }]);
        const update = await toolsCall('account_edit', { shopName: 'Boutique', yavinSecret: 'ignored' });
        assert.deepEqual((await update.json()).result.structuredContent, { shop: '31' });
        assert.deepEqual(workerCalls.splice(0), [{
            path: '/workers/editShop.php', method: 'POST', ref: shopReference, idempotencyKey: undefined,
            values: { shopID: '31', 'data[shopName]': 'Boutique' },
        }]);

        for (const [name, scope, method, worker, input, values] of mailboxCases) {
            assert.deepEqual(toolByName[name]._meta.securitySchemes, [{ type: 'oauth2', scopes: [scope] }]);
            assert.equal(toolByName[name].annotations.readOnlyHint, method === 'GET');
            const denied = await toolsCall(name, input, otherToken);
            assert.match((await denied.json()).result._meta['mcp/www_authenticate'][0], new RegExp('scope="' + scope + '".*error="insufficient_scope"'));
            assert.equal(workerCalls.length, 0);
            const reply = await toolsCall(name, { ...input, shopID: 32, key: 'ignored' });
            const { result, error } = await reply.json();
            assert.equal(error, undefined);
            assert.equal(result.isError, undefined);
            assert.deepEqual(workerCalls.splice(0), [{
                path: method === 'GET' ? '/api/partner/v1' + v1MailboxPaths[worker] : '/workers/' + worker + '.php',
                method, ref: shopReference, idempotencyKey: undefined,
                values: method === 'GET' ? { ...values, shop_id: '31' } : { ...values, shopID: '31' },
            }]);
            assert.ok(result.structuredContent);
            if (name === 'mailbox_get_message') {
                assert.deepEqual(result.structuredContent.message, {
                    ...inboxMessage, text_body: 'Hello', text_truncated: false, has_html_body: true, attachment_count: 1,
                    attachments: [{ id: 7, name: 'receipt.pdf', available: true, content_type: 'application/pdf' }],
                });
                assert.match(result.content[0].text, /untrusted data/);
            }
            if (name === 'mailbox_open_attachment') {
                assert.equal(result.structuredContent.attachment.open_url, downloadUrl);
                assert.equal(result.structuredContent.attachment.content_base64, undefined);
            }
            if (scope === 'mailbox.send') {
                assert.deepEqual(result.structuredContent, pendingApproval);
                assert.ok(result.content[0].text.includes(approvalUrl));
            }
        }
        const sendInput = mailboxCases.at(-2)[4];
        await assertInvalidArgs(toolsCall('mailbox_request_send', { ...sendInput, body: 'é'.repeat(10001) }));
        await assertInvalidArgs(toolsCall('mailbox_request_send', { ...sendInput, body: 'Hello\u0007world' }));
        assert.equal(workerCalls.length, 0);
        const exactLimit = 'é'.repeat(9998) + '\r\n\tX';
        const maxLengthMail = await toolsCall('mailbox_request_send', { ...sendInput, body: exactLimit });
        assert.deepEqual((await maxLengthMail.json()).result.structuredContent, pendingApproval);
        assert.equal(workerCalls.shift().values.body, exactLimit);
        mailboxAccess = 'mailbox.read mailbox.write';
        const absentSendScope = await toolsCall('mailbox_request_send', sendInput);
        assert.match((await absentSendScope.json()).result._meta['mcp/www_authenticate'][0], /scope="mailbox.send".*error="insufficient_scope"/);
        assert.equal(workerCalls.length, 0);
        mailboxAccess = 'mailbox.send';
        const absentReadScope = await toolsCall('mailbox_get', {});
        assert.match((await absentReadScope.json()).result._meta['mcp/www_authenticate'][0], /scope="mailbox.read".*error="insufficient_scope"/);
        assert.equal(workerCalls.length, 0);
        mailboxResponses.set('sendMailboxMessage', { ...pendingApproval, approval_url: 'https://malicious.test/?request=' + mailboxRequestId });
        const unsafeApproval = await toolsCall('mailbox_request_send', sendInput);
        const unsafeResult = (await unsafeApproval.json()).result;
        assert.equal(unsafeResult.isError, true);
        assert.equal(unsafeResult.structuredContent, undefined);
        mailboxResponses.set('sendMailboxMessage', { accepted: true, message: { id: 14 } });
        const unexpectedSend = await toolsCall('mailbox_request_send', sendInput);
        assert.equal((await unexpectedSend.json()).result.isError, true);
        const { approval_url, ...terminal } = pendingApproval;
        mailboxResponses.set('sendMailboxMessage', { ...terminal, approval_required: false, status: 'declined' });
        const declined = await toolsCall('mailbox_request_send', sendInput);
        assert.deepEqual((await declined.json()).result.structuredContent, { ...terminal, approval_required: false, status: 'declined' });
        workerStatus = 401;
        const revoked = await toolsCall('data_list_clients', {});
        const revokedResult = (await revoked.json()).result;
        assert.equal(revokedResult.isError, true);
        assert.match(revokedResult._meta['mcp/www_authenticate'][0], /scope="customers.read".*error="invalid_token"/);

        if (modern) {
            authMode = 'allowed';
            const previousCatalogCalls = products;
            const conflicting = await call({ ...bearer, 'Mcp-Method': 'tools/list' });
            assert.equal(conflicting.status, 400);
            assert.equal(products, previousCatalogCalls);
            const incomplete = await originalFetch(base + '/mcp', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream',
                    'MCP-Protocol-Version': protocolVersion,
                    'Mcp-Method': 'tools/list',
                },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
            });
            assert.equal(incomplete.status, 400);
            assert.match((await incomplete.json()).error.message, /missing.*_meta/);

            const wireVersions = [];
            const client = new ModernClient(clientInfo, { versionNegotiation: { mode: 'auto' } });
            const transport = new ModernHttpTransport(new URL(base + '/mcp'), {
                requestInit: { headers: bearer },
                fetch: (url, options) => {
                    assert.equal(new URL(url).origin, base);
                    wireVersions.push(new Headers(options?.headers).get('MCP-Protocol-Version'));
                    return originalFetch(url, options);
                },
            });
            try {
                await client.connect(transport);
                const refreshed = await client.listTools();
                assert.equal(refreshed.tools.length, 78);
                assert.ok(wireVersions.includes(protocolVersion));
            } finally {
                await client.close();
            }
        }
    } finally {
        globalThis.fetch = originalFetch;
        await new Promise((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    }
});

testProtocol('2025-11-25');
testProtocol('2026-07-28');
