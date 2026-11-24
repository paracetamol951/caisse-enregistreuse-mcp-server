import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import express from 'express';

test('STDIO forwards sale keys, exposes recovery states and guards payment amounts', async (t) => {
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    const calls = [];
    const completed = new Map();
    let nextReply;
    let disconnectAfterWrite = false;
    app.post(['/workers/webapp.php', '/workers/editOrder.php'], (req, res) => {
        const key = req.get('Idempotency-Key');
        calls.push({ path: req.path, key, form: { ...req.body } });
        if (nextReply) return nextReply(res);

        const fingerprint = JSON.stringify(req.body);
        const previous = completed.get(req.path + '/' + key);
        if (previous) {
            if (previous.fingerprint !== fingerprint) {
                return res.status(409).json({ success: false, code: 'idempotency_conflict', result: 'php-internal-detail' });
            }
            return res.set('Idempotency-Replayed', 'true').json(previous.result);
        }
        const result = req.path === '/workers/webapp.php'
            ? { result: 'ok', orderID: '801', receiptLink: 'https://example.test/receipt/801' }
            : { success: true, result: 'ok', orderID: req.body.orderID, invoice: 'https://example.test/invoice/801' };
        completed.set(req.path + '/' + key, { fingerprint, result });
        if (disconnectAfterWrite) {
            disconnectAfterWrite = false;
            return res.destroy();
        }
        res.json(result);
    });

    const worker = app.listen(0, '127.0.0.1');
    t.after(() => new Promise((resolve, reject) => {
        worker.close((error) => error ? reject(error) : resolve());
        worker.closeAllConnections();
    }));
    await once(worker, 'listening');

    const client = new Client({ name: 'stdio-sales-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', 'src/stdio.ts'],
        env: { API_BASE: 'http://127.0.0.1:' + worker.address().port, APIKEY: 'fixture-api-key', SHOPID: '31', MCP_LANG: 'en' },
        stderr: 'pipe',
    });
    t.after(() => client.close());
    transport.stderr?.resume();
    await client.connect(transport);

    const call = (name, args) => client.callTool({ name, arguments: args });
    const assertInvalidArgs = (name, args) => call(name, args).then(
        (result) => assert.equal(result.isError, true),
        (error) => assert.equal(error.code, -32602),
    );
    const create = { items: [{ productId: '4' }] };
    const edit = { orderID: 801, payment: '9' };
    const { tools } = await client.listTools();
    for (const [name, args] of [['order_create', create], ['order_edit', edit]]) {
        const tool = tools.find(({ name: toolName }) => toolName === name);
        assert.ok(tool.inputSchema.required.includes('idempotencyKey'));
        assert.equal(tool.annotations.idempotentHint, true);
        assert.equal(tool.annotations.destructiveHint, true);
        await assertInvalidArgs(name, args);
        await assertInvalidArgs(name, { ...args, idempotencyKey: 'short' });
        for (const paymentAmount of [0, '0', '0.00', '000.000']) {
            const zero = await call(name, { ...args, idempotencyKey: 'zero-amount-fixture', payment: 9, paymentAmount });
            assert.equal(zero.isError, true);
            assert.deepEqual(zero.structuredContent, { code: 'validation_failed' });
        }
    }
    assert.deepEqual(calls, []);

    const sale = { ...create, idempotencyKey: 'order-create-unique', payment: '9', paymentAmount: '2.50' };
    const partial = await call('order_create', sale);
    assert.equal(!!partial.isError, false);
    assert.deepEqual(partial.structuredContent, { orderID: '801', replayed: false, result: 'ok', receiptLink: 'https://example.test/receipt/801' });
    const replay = await call('order_create', sale);
    assert.deepEqual(replay.structuredContent, { ...partial.structuredContent, replayed: true });
    assert.deepEqual(calls[0], {
        path: '/workers/webapp.php', key: sale.idempotencyKey,
        form: { idboutique: '31', key: 'fixture-api-key', payment: '9', paymentAmount: '2.50', 'itemsList[]': '4_1__' },
    });
    assert.deepEqual(calls[1], calls[0]);

    const conflict = await call('order_create', { ...sale, paymentAmount: '2.75' });
    assert.equal(conflict.isError, true);
    assert.deepEqual(conflict.structuredContent, { code: 'idempotency_conflict', replayed: false });
    assert.equal(JSON.stringify(conflict).includes('php-internal-detail'), false);

    const change = { ...edit, idempotencyKey: 'order-edit-unique', paymentAmount: 3.75 };
    const edited = await call('order_edit', change);
    assert.deepEqual(edited.structuredContent, { orderID: '801', replayed: false, result: 'ok', success: true, invoice: 'https://example.test/invoice/801' });
    assert.deepEqual(calls[3], {
        path: '/workers/editOrder.php', key: change.idempotencyKey,
        form: { shopID: '31', key: 'fixture-api-key', orderID: '801', payment: '9', paymentAmount: '3.75' },
    });
    const editedReplay = await call('order_edit', change);
    assert.deepEqual(editedReplay.structuredContent, { ...edited.structuredContent, replayed: true });
    assert.deepEqual(calls[4], calls[3]);
    assert.equal(completed.size, 2);

    const defaultCreate = await call('order_create', { ...create, idempotencyKey: 'order-default-create', payment: 9 });
    assert.equal(!!defaultCreate.isError, false);
    assert.equal(Object.hasOwn(calls[5].form, 'paymentAmount'), false);
    const defaultEdit = await call('order_edit', { ...edit, idempotencyKey: 'order-default-edit' });
    assert.equal(!!defaultEdit.isError, false);
    assert.equal(Object.hasOwn(calls[6].form, 'paymentAmount'), false);
    const unpaid = await call('order_edit', { ...edit, payment: 0, paymentAmount: 0, idempotencyKey: 'order-unpaid-fixture' });
    assert.equal(!!unpaid.isError, false);
    assert.equal(calls[7].form.payment, '0');

    const internalDetail = 'php-internal-detail';
    const phpError = (status, fields) => (res) => res.status(status).json({ success: false, result: internalDetail, ...fields });
    const failureCases = [
        [phpError(409, { code: 'idempotency_unresolved', orderID: 801 }), { code: 'idempotency_unresolved', orderID: 801, replayed: false }],
        [phpError(503, { code: 'idempotency_unavailable' }), { code: 'idempotency_unavailable', replayed: false }],
        [phpError(400, { code: 'idempotency_files_unsupported' }), { code: 'idempotency_files_unsupported', replayed: false }],
        [phpError(200, {}), { code: 'validation_failed', replayed: false }],
        [(res) => res.status(503).send(internalDetail), { code: 'unexpected_response', replayed: false }],
    ];
    for (const [reply, expected] of failureCases) {
        nextReply = reply;
        const failed = await call('order_edit', { ...edit, idempotencyKey: 'order-without-result' });
        assert.equal(failed.isError, true);
        assert.deepEqual(failed.structuredContent, expected);
        assert.equal(JSON.stringify(failed).includes(internalDetail), false);
        assert.equal(calls.at(-1).key, 'order-without-result');
    }

    nextReply = undefined;
    disconnectAfterWrite = true;
    const lostReplyArgs = { ...edit, idempotencyKey: 'order-lost-reply', paymentAmount: '3.00' };
    const lostReply = await call('order_edit', lostReplyArgs);
    assert.equal(lostReply.isError, true);
    assert.deepEqual(lostReply.structuredContent, { code: 'network_outcome_unknown' });
    const completedCount = completed.size;
    const recovered = await call('order_edit', lostReplyArgs);
    assert.deepEqual(recovered.structuredContent, { ...edited.structuredContent, replayed: true });
    assert.deepEqual(calls.at(-1), calls.at(-2));
    assert.equal(completed.size, completedCount);

    for (const payment of [-1, -2]) {
        const legacy = await call('order_create', { ...create, payment, idempotencyKey: 'legacy-stdio-create-' + payment });
        assert.equal(!!legacy.isError, false);
        assert.equal(calls.at(-1).form.payment, String(payment));
    }
});
