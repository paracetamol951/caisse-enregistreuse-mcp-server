﻿// src/support/oauth.ts
import 'dotenv/config';
import express, { Request, Response } from 'express';
import crypto from 'node:crypto';
import { generateKeyPair, exportJWK, importPKCS8, SignJWT, jwtVerify, createLocalJWKSet, importSPKI } from 'jose';
import { URL } from 'node:url';
import { postForm } from './http.js';
import { saveCode, loadCode, deleteCode, type PendingCode } from './oauth-store.js';
import { saveClient, getClient, clientExists, type OAuthClient } from './oauth-clients-store.js';


// ---------- CONFIG ----------
const ISSUER = process.env.MCP_OAUTH_ISSUER || 'https://mcp.enregistreuse.fr';
const AUD = process.env.MCP_OAUTH_AUDIENCE || 'https://mcp.enregistreuse.fr';
const AUTH_WS = process.env.MCP_AUTH_WS_BASE || 'https://caisse.enregistreuse.fr'; // base pour getAuthToken.php

// Clés pour RS256 (publiques via JWKS)

let privateKey: crypto.KeyObject | CryptoKey | null = null;
let jwks: any = null;




// --- LOGGING UTILS ---
const LOG_PREFIX = '[oauth]';
const isProd = process.env.NODE_ENV === 'production';

function mask(val?: string | number | null, show = 4) {
    if (!val && val !== 0) return '';
    const s = String(val);
    if (s.length <= show * 2) return s.replace(/./g, '•');
    return s.slice(0, show) + '…' + s.slice(-show);
}
function j(x: any) {
    try { return JSON.stringify(x); } catch { return String(x); }
}
function logInfo(msg: string) { process.stderr.write(`${LOG_PREFIX} ${msg}\n`); }
function logWarn(msg: string) { process.stderr.write(`${LOG_PREFIX}[warn] ${msg}\n`); }
function logErr(msg: string, e?: unknown) {
    const detail = e instanceof Error ? ` (${e.name}: ${e.message})\n${e.stack || ''}` : e ? ` ${j(e)}` : '';
    process.stderr.write(`${LOG_PREFIX}[error] ${msg}${detail}\n`);
}


async function ensureKeyPair() {
    if (privateKey) return;

    const normalizePem = (s: string) =>
        s.replace(/\r\n/g, '\n').replace(/\\n/g, '\n').replace(/\r/g, '\n').trim();

    try {
        if (process.env.MCP_OAUTH_PUBLIC_KEY_PEM && process.env.MCP_OAUTH_PRIVATE_KEY_PEM) {
            privateKey = await importPKCS8(normalizePem(process.env.MCP_OAUTH_PRIVATE_KEY_PEM), 'RS256');
            const publicKey = await importSPKI(normalizePem(process.env.MCP_OAUTH_PUBLIC_KEY_PEM), 'RS256');
            const pubJwk = await exportJWK(publicKey);
            jwks = { keys: [{ ...pubJwk, kid: 'mcp-kid-1', alg: 'RS256', use: 'sig' }] };
            logInfo('ensureKeyPair: loaded RSA keys from ENV');
        } else {
            const { privateKey: pk, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
            privateKey = pk;
            const pubJwk = await exportJWK(publicKey);
            jwks = { keys: [{ ...pubJwk, kid: 'mcp-kid-1', alg: 'RS256', use: 'sig' }] };
            logWarn('ensureKeyPair: generated ephemeral RSA keys (dev only)');
        }
    } catch (e) {
        logErr('ensureKeyPair failed', e);
        throw e;
    }
}



/*
async function ensureKeyPair() {
    if (privateKey) return;

    const normalizePem = (s: string) =>
        s.replace(/\r\n/g, '\n').replace(/\\n/g, '\n').replace(/\r/g, '\n').trim();

    

    // Public: soit depuis MCP_OAUTH_PUBLIC_KEY_PEM...
    if (process.env.MCP_OAUTH_PUBLIC_KEY_PEM && process.env.MCP_OAUTH_PRIVATE_KEY_PEM) {
        privateKey = await importPKCS8(normalizePem(process.env.MCP_OAUTH_PRIVATE_KEY_PEM), 'RS256');
        const publicKey = await importSPKI(normalizePem(process.env.MCP_OAUTH_PUBLIC_KEY_PEM), 'RS256');
        const pubJwk = await exportJWK(publicKey);
        jwks = { keys: [{ ...pubJwk, kid: 'mcp-kid-1', alg: 'RS256', use: 'sig' }] };
    } else {
        // Génère une paire à chaud si rien en env (OK pour dev ; en prod, mettre MCP_OAUTH_PRIVATE_KEY_PEM)
        //const { privateKey: pk, publicKey } = await generateKeyPair('RS256');
        const { privateKey: pk, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

        privateKey = pk;
        const pubJwk = await exportJWK(publicKey);
        jwks = { keys: [{ ...pubJwk, kid: 'mcp-kid-1', alg: 'RS256', use: 'sig' }] };
    }
}*/

function base64url(input: Buffer | string) {
    return Buffer.from(input).toString('base64url');
}

function sha256(input: string) {
    return crypto.createHash('sha256').update(input).digest();
}

// ---------- Mémoire (démos) ----------
/*type PendingCode = {
    client_id: string;
    redirect_uri: string;
    code_challenge: string;    // PKCE (S256)
    login: string;
    apiKey: string;
    shopId: string;
    scope: string;
    exp: number;
};
const codes = new Map<string, PendingCode>(); // code -> record*/
//const clients = new Map<string, { redirect_uris: string[]; public: true }>();

// En dev on autorise un client "mcp-client" avec une redirect fournie en env
const DEV_CLIENT_ID = process.env.MCP_OAUTH_CLIENT_ID || 'mcp-client';
const DEV_REDIRECT = process.env.MCP_OAUTH_REDIRECT_URI || 'http://localhost:1234/callback';
const bootClient: OAuthClient = { redirect_uris: [DEV_REDIRECT], public: true };
if (!(await clientExists(DEV_CLIENT_ID))) {
    await saveClient(DEV_CLIENT_ID, bootClient);
}

//clients.set(DEV_CLIENT_ID, { redirect_uris: [DEV_REDIRECT], public: true });
logInfo(`boot: allowed client ${DEV_CLIENT_ID} redirect=${DEV_REDIRECT}`);

// ---------- Router ----------
export default async function oauthRouter() {
    await ensureKeyPair();
    logInfo(`router: issuer=${ISSUER} aud=${AUD} auth_ws=${AUTH_WS}`);

    const router = express.Router();

    router.use(express.urlencoded({ extended: false }));
    router.use(express.json());

    // a) Well-known discovery côté resource server (requis par MCP)
    router.get('/.well-known/oauth-protected-resource', (_req, res) => {
        res.json({
            authorization_servers: [ISSUER],
            resource: AUD,
            scopes_supported: ['mcp:invoke', 'shop:read'], // à adapter si besoin
        });
    });

    // b) OIDC discovery de l’AS
    router.get('/.well-known/openid-configuration', (req, res) => {
        const base = new URL(ISSUER);
        const authz = new URL('/oauth/authorize', base).toString();
        const token = new URL('/oauth/token', base).toString();
        const jwksUri = new URL('/oauth/jwks.json', base).toString();
        const reg = new URL('/oauth/register', base).toString();
        res.json({
            issuer: ISSUER,
            authorization_endpoint: authz,
            token_endpoint: token,
            jwks_uri: jwksUri,
            registration_endpoint: reg,
            code_challenge_methods_supported: ['S256'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            response_types_supported: ['code'],
            token_endpoint_auth_methods_supported: ['none'],
        });
    });

    // c) JWKS (clé publique uniquement)
    router.get('/oauth/jwks.json', (_req, res) => { res.json(jwks); });

    // d) Enregistrement dynamique (optionnel – ici no-op minimal)
    router.post('/oauth/register', async (req, res) => {
        const { redirect_uris = [], client_id } = req.body || {};
        const id = client_id || `pub-${crypto.randomUUID()}`;
        //clients.set(id, { redirect_uris, public: true });
        const rec: OAuthClient = { redirect_uris, public: true };
        await saveClient(id, rec);

        res.json({ client_id: id, token_endpoint_auth_method: 'none', redirect_uris });
    });

    // e) Formulaire de login (GET -> HTML)
    router.get('/oauth/authorize', async (req, res) => {
        const { client_id, redirect_uri, state = '', code_challenge = '', scope = 'mcp:invoke' } = req.query as any;

        const c = await getClient(client_id || '');
        logInfo(`authorize[GET]: client=${client_id} redirect=${redirect_uri} ...`);
        if (!c) {
            logWarn(`authorize[GET]: unknown client ${client_id}`);
            return res.status(400).send('invalid_client or redirect_uri');
        }
        if (!c.redirect_uris.includes(redirect_uri)) {
            logWarn(`authorize[GET]: redirect mismatch for client=${client_id} got=${redirect_uri} allowed=${c.redirect_uris.join(',')}`);
            return res.status(400).send('invalid_client or redirect_uri');
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`
      <!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connect free-cash-register.net account MCP server</title>
  <style>
    :root{
      --bg1: #e0f2fe;
      --bg2: #bfdbfe;
      --acc1:#3b82f6;
      --acc2:#60a5fa;
      --acc3:#93c5fd;
      --card: rgba(255,255,255,0.95);
      --card-border: rgba(0,0,0,0.08);
      --text: #1e3a8a;
      --muted:#475569;
      --error:#ef4444;
      --shadow: 0 8px 20px rgba(59,130,246,0.15);
      --radius: 16px;
    }

    *{box-sizing:border-box}
    html,body{height:100%}
    body{
      margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
      color:var(--text);
      background:
        radial-gradient(1000px 600px at 80% -10%, rgba(147,197,253,0.3), transparent 60%),
        radial-gradient(800px 500px at -10% 110%, rgba(191,219,254,0.3), transparent 60%),
        linear-gradient(135deg, var(--bg1) 0%, var(--bg2) 100%);
      min-height:100vh;
      display:grid; place-items:center;
      overflow:hidden;
    }

    .wrapper{ width:min(96%, 1100px); padding:24px; position:relative; }

    .brand{ display:flex; align-items:center; gap:12px; justify-content:center; margin-bottom:28px; }
    .logo{
      width:44px; height:44px; border-radius:12px; display:grid; place-items:center;
      background: conic-gradient(from 210deg, var(--acc1), var(--acc2), var(--acc3), var(--acc1));
      box-shadow: 0 6px 14px rgba(59,130,246,0.25);
    }
    .logo svg{ filter: drop-shadow(0 2px 4px rgba(0,0,0,0.25)); }
    .brand h1{ font-size:1.35rem; margin:0; font-weight:700; color:var(--text); }

    .card{
      width: min(420px, 100%);
      margin: 0 auto;
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      backdrop-filter: blur(6px);
    }

    .card-header{ padding: 22px 22px 8px; }
    .card-header h2{ margin:0; font-size:1.1rem; font-weight:700; }
    .hint{ color:var(--muted); font-size:.9rem; }

    .card-body{ padding: 22px; }

    .field{ position:relative; margin:18px 0 6px; }
    .input{
      width:100%; padding: 18px 14px 14px; border-radius:12px; border:1px solid var(--card-border);
      background: white;
      color:var(--text); outline:none; transition: border-color .2s, box-shadow .2s;
    }
    .input:focus{
      border-color: var(--acc1);
      box-shadow: 0 0 0 3px rgba(59,130,246,0.2);
    }

    .floating-label{
      position:absolute; left:16px; top:50%; transform: translateY(-50%);
      color: var(--muted); pointer-events:none; transition: all .18s ease;
      background: white; padding: 0 4px;
    }
    .input:focus + .floating-label,
    .input:not(:placeholder-shown) + .floating-label{
      top:6px; font-size:.75rem; color: var(--acc1);
      transform: translateY(0);
    }

    .row{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin:10px 0 6px; }
    .checkbox{ display:flex; align-items:center; gap:8px; color:var(--muted); font-size:.9rem; }
    .checkbox input{ width:16px; height:16px; accent-color: var(--acc1); }

    .btn{
      display:inline-grid; place-items:center; width:100%;
      border:none; cursor:pointer; padding:14px 18px; border-radius:14px; font-weight:700; letter-spacing:.3px;
      background: linear-gradient(135deg, var(--acc1), var(--acc2));
      color:white; box-shadow: 0 6px 14px rgba(59,130,246,0.25);
      transition: transform .08s ease, filter .2s ease;
    }
    .btn:hover{ filter: brightness(1.05); }
    .btn:active{ transform: translateY(1px) scale(.997); }

    .btn-secondary{
      background: linear-gradient(135deg, #e0f2fe, #bfdbfe);
      color: var(--acc1);
      border: 1px solid var(--acc2);
      margin-top:10px;
    }
    .btn-secondary:hover{ filter: brightness(0.97); }

    .password-toggle{
      position:absolute; right:10px; top:50%; transform: translateY(-50%);
      background: none; border:none; color: var(--muted); cursor:pointer; padding:6px; border-radius:8px;
    }
    .password-toggle:hover{ color:var(--text); }

    .link{ color: var(--acc1); text-decoration:none; font-size:.9rem; }
    .link:hover{ text-decoration:underline; }

    footer{ margin-top:24px; text-align:center; color:var(--muted); font-size:.85rem; }
  </style>
</head>
<body>
  <main class="wrapper">
    <div class="brand">
      <div class="logo">

<svg xmlns="http://www.w3.org/2000/svg" viewBox="119.4963 77.7365 111.4921 111.4921" width="26px" height="26px"><g id="object-4" transform="matrix(0.9999999999999999, 0, 0, 0.9999999999999999, 125.24235534667969, 83.48248291015624)">

<rect width="51" height="51" style="fill: rgb(54, 54, 54);" id="object-0" transform="matrix(0.992475, 0.122446, -0.122446, 0.992475, 6.498501, -5.746029)"/>
<rect width="51" height="51" style="fill: #44AA55;" x="49" id="object-3" transform="matrix(0.992475, 0.122446, -0.122446, 0.992475, 6.498501, -5.746029)"/>
<rect y="49" width="51" height="51" style="fill: #44AA55;" id="object-2" transform="matrix(0.992475, 0.122446, -0.122446, 0.992475, 6.498501, -5.746029)"/>
<rect x="49" y="49" width="51" height="51" style="fill: #4455AA;" id="object-1" transform="matrix(0.992475, 0.122446, -0.122446, 0.992475, 6.498501, -5.746029)"/></g></svg>
      </div>
      <h1>Connect</h1>
    </div>

    <section class="card">
      <div class="card-body">
        <form method="post" action="/oauth/authorize">
        <input type="hidden" name="client_id" value="${client_id}"/>
        <input type="hidden" name="redirect_uri" value="${redirect_uri}"/>
        <input type="hidden" name="state" value="${state}"/>
        <input type="hidden" name="code_challenge" value="${code_challenge}"/>
        <input type="hidden" name="scope" value="${scope}"/>
          <div class="field">
            <input class="input" id="login" name="login" type="text" placeholder=" " autocomplete="username" required />
            <label class="floating-label" for="login">Login</label>
          </div>

          <div class="field">
            <input class="input" id="password" name="password" type="password" placeholder=" " autocomplete="current-password" required />
            <label class="floating-label" for="password">Password</label>
            <button class="password-toggle" type="button" aria-label="Show / Hide password" onclick="togglePassword()">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 5c-5 0-9 4-10 7 1 3 5 7 10 7s9-4 10-7c-1-3-5-7-10-7zm0 12a5 5 0 110-10 5 5 0 010 10z" fill="currentColor"/>
              </svg>
            </button>
          </div>


          <button class="btn" type="submit">Connect</button>
          <a class="btn btn-secondary" target="_blank" href="https://www.free-cash-register.net" >Create account</a>
        </form>
        <footer>© <span id="year"></span> <a href="https://www.free-cash-register.net">free-cash-register.net</a></footer>
      </div>
    </section>
  </main>

  <script>
    function togglePassword(){
      const input = document.getElementById('password');
      input.type = input.type === 'password' ? 'text' : 'password';
      input.focus();
    }

    document.getElementById('year').textContent = new Date().getFullYear();
  </script>
</body>
</html>

    `);
    });

    // f) Traitement du login (POST) → appelle getAuthToken.php puis redirige avec code
    router.post('/oauth/authorize', async (req, res) => {
        try {
            const { login, password, client_id, redirect_uri, state = '', code_challenge = '', scope = 'mcp:invoke' } = req.body;
            const c = await getClient(client_id || '');
            if (!c || !c.redirect_uris.includes(redirect_uri)) {
                logWarn(`authorize[POST]: invalid client or redirect (client=${client_id}, redirect=${redirect_uri})`);
                return res.status(400).send('invalid_client or redirect_uri');
            }
            if (!code_challenge) return res.status(400).send('missing PKCE code_challenge');

            // Appel serveur→serveur vers getAuthToken.php (doit renvoyer { APIKEY, SHOPID })
            const out = await postForm('/workers/getAuthToken.php', { login, password });

            //const out = await postForm(new URL('/workers/getAuthToken.php', AUTH_WS).pathname, { login, password });
            if (!out || typeof out !== 'object' || !('APIKEY' in out) || !('SHOPID' in out)) {
                return res.status(401).send('Bad credentials');
            }
            const { APIKEY, SHOPID } = out as any;

            const code = crypto.randomBytes(24).toString('base64url');
            const exp = Math.floor(Date.now() / 1000) + 300;
            await saveCode(code, {
                client_id, redirect_uri, code_challenge, login,
                apiKey: APIKEY, shopId: SHOPID, scope, exp,
            }, 300);


            const u = new URL(redirect_uri);
            u.searchParams.set('code', code);
            if (state) u.searchParams.set('state', state);
            return res.redirect(u.toString());
        } catch (e) {
            return res.status(500).send('authorize_error');
        }
    });

    // g) Échange code → token (PKCE S256)
    router.post('/oauth/token', async (req, res) => {
        const started = Date.now();
        try {
            const { grant_type, code, code_verifier, client_id, redirect_uri } = req.body || {};
            logInfo(`token: grant=${grant_type} client=${client_id} redirect=${redirect_uri} code=${mask(code)} verifierLen=${(code_verifier || '').length}`);

            if (grant_type !== 'authorization_code') {
                logWarn(`token: unsupported grant_type=${grant_type}`);
                return res.status(400).json({ error: 'unsupported_grant_type' });
            }
            if (!code || !code_verifier) {
                logWarn('token: missing code or code_verifier');
                return res.status(400).json({ error: 'invalid_request' });
            }

            const rec = await loadCode(code);
            if (!rec) {
                // log: invalid_grant (code not found)
                return res.status(400).json({ error: 'invalid_grant' });
            }
            await deleteCode(code); // one-time use
            if (rec.exp < Math.floor(Date.now() / 1000)) {
                // log: expired_code
                return res.status(400).json({ error: 'expired_code' });
            }

            if (client_id !== rec.client_id || redirect_uri !== rec.redirect_uri) {
                logWarn(`token: invalid_client mismatch client_id=${client_id} vs ${rec.client_id}, redirect=${redirect_uri} vs ${rec.redirect_uri}`);
                return res.status(400).json({ error: 'invalid_client' });
            }

            const expected = base64url(sha256(code_verifier));
            if (expected !== rec.code_challenge) {
                logWarn(`token: PKCE mismatch code=${mask(code)}`);
                return res.status(400).json({ error: 'invalid_grant' });
            }

            const now = Math.floor(Date.now() / 1000);
            const jwt = await new SignJWT({
                sub: rec.login,
                shop: { id: rec.shopId },
                api: { key: rec.apiKey },
                scope: rec.scope,
                aud: AUD,
            })
                .setProtectedHeader({ alg: 'RS256', kid: 'mcp-kid-1', typ: 'JWT' })
                .setIssuer(ISSUER)
                .setIssuedAt(now)
                .setExpirationTime(now + 3600)
                .sign(privateKey!);

            logInfo(`token: success for sub=${rec.login} shop=${rec.shopId} in ${Date.now() - started}ms`);
            return res.json({
                access_token: jwt,
                token_type: 'Bearer',
                expires_in: 3600,
                scope: rec.scope,
            });
        } catch (e) {
            logErr('token: exception', e);
            return res.status(500).json({ error: 'token_error' });
        }
    });


    return router;
}

// ---------- Validation côté Resource Server (helper) ----------
export async function bearerValidator(authorization?: string) {
    if (!authorization) throw new Error('Missing token');
    const m = /^Bearer\s+(.+)$/i.exec(authorization);
    const token = m?.[1] ?? authorization;
    await ensureKeyPair();
    const JWKS = createLocalJWKSet(jwks);
    const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER, audience: AUD });
    const scopes = String(payload.scope || '').split(/\s+/).filter(Boolean);
    if (!scopes.includes('mcp:invoke')) throw new Error('Insufficient scope');
    const apiKey = (payload as any)?.api?.key;
    const shopId = (payload as any)?.shop?.id;
    return { apiKey, shopId, sub: payload.sub };
}
