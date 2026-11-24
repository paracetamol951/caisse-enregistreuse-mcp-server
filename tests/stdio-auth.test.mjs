import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import express from 'express';

test('STDIO keeps login and account creation credentials in the session', async (t) => {
    const loginKey = 'fake-login-key';
    const creationKey = 'fake-creation-key';
    const proof = 'fake-email-proof';
    const email = 'cashier@example.test';
    const otp = '123456';
    const challengeId = 'a'.repeat(32);
    const accountID = '73';
    const shopName = 'New Shop';
    const login = { name: 'auth_login_with_otp', arguments: { email, otp, challengeId, accountID } };
    const create = { name: 'account_create', arguments: { email, accountTitle: shopName } };
    const shopInfo = { name: 'account_show_infos', arguments: {} };
    const loginResponse = {
        success: true, SHOPID: '42', APIKEY: loginKey, result: loginKey, nested: { proof },
    };
    const creationResponse = {
        success: true, SHOPID: 87, APIKEY: creationKey, result: creationKey, nested: { proof },
    };
    let loginReply = loginResponse;
    let creationReply = creationResponse;
    const requests = [];
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.post('/workers/getOTPForAccount.php', (req, res) => {
        assert.deepEqual({ ...req.body }, { email, accountID });
        res.json({ success: true, challengeId, expiresIn: 600 });
    });
    app.post('/workers/getAuthTokenWithOTP.php', (req, res) => {
        requests.push({ ...req.body });
        res.status(loginReply.success ? 200 : 401).json(loginReply);
    });
    app.post('/workers/addShop.php', (req, res) => {
        requests.push({ ...req.body });
        res.send(creationReply);
    });
    app.post('/workers/getShopInfos.php', (req, res) => {
        const authenticated = [loginResponse, creationResponse].some(
            ({ SHOPID, APIKEY }) => req.body.shopID === String(SHOPID) && req.body.key === APIKEY,
        );
        res.json(authenticated ? { shopID: req.body.shopID } : { success: false });
    });

    const service = app.listen(0, '127.0.0.1');
    t.after(() => new Promise((resolve, reject) => {
        service.close((error) => error ? reject(error) : resolve());
        service.closeAllConnections();
    }));
    await once(service, 'listening');

    const client = new Client({ name: 'stdio-auth-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', 'src/stdio.ts'],
        env: { API_BASE: 'http://127.0.0.1:' + service.address().port, MCP_LANG: 'en' },
        stderr: 'pipe',
    });
    t.after(() => client.close());
    transport.stderr?.resume();
    await client.connect(transport);

    const { tools } = await client.listTools();
    for (const { name } of [login, create]) {
        const description = tools.find((tool) => tool.name === name)?.description;
        assert.match(description, /shop ID and open the session/);
    }

    async function checkResult(call, { success, ...expected }) {
        const reply = await client.callTool(call);
        assert.equal(!!reply.isError, !success);
        const { result, ...fields } = reply.structuredContent;
        assert.deepEqual(fields, { success, ...expected });
        assert.ok(typeof result === 'string' && result.length > 0);
        assert.deepEqual(reply.content, [{ type: 'text', text: JSON.stringify(reply.structuredContent, null, 2) }]);
        for (const secret of [loginKey, creationKey, proof]) {
            assert.ok(!JSON.stringify(reply).includes(secret), 'MCP response contains confidential data');
        }
    }

    const requestedOtp = await client.callTool({ name: 'auth_request_otp', arguments: { email, accountID } });
    assert.deepEqual(requestedOtp.structuredContent, { success: true, challengeId, expiresIn: 600 });
    await checkResult(login, { success: true, SHOPID: '42' });
    assert.deepEqual((await client.callTool(shopInfo)).structuredContent, { shopID: '42' });

    loginReply = { success: false, code: 'invalid_otp', result: loginKey, emailProof: proof };
    await checkResult(login, { success: false, code: 'invalid_otp' });
    assert.deepEqual((await client.callTool(shopInfo)).structuredContent, { shopID: '42' });

    await checkResult(create, { success: true, SHOPID: 87 });
    assert.deepEqual((await client.callTool(shopInfo)).structuredContent, { shopID: '87' });

    creationReply = { success: true, SHOPID: '99', result: creationKey };
    await checkResult(create, { success: false, code: 'session_unavailable' });
    creationReply = 'This email is already registered, connect with your existing account';
    await checkResult(create, { success: false, code: 'account_already_exists' });
    creationReply = 'Unexpected upstream text containing ' + creationKey;
    await checkResult(create, { success: false, code: 'account_creation_failed' });
    assert.deepEqual((await client.callTool(shopInfo)).structuredContent, { shopID: '87' });

    assert.deepEqual(requests[0], { email, otp, challengeId, accountID });
    assert.deepEqual(requests[2], { email, accountTitle: shopName });
});
