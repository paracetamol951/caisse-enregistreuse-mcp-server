// src/support/oauth.ts
import 'dotenv/config';
import crypto from 'node:crypto';
import {  exportJWK, importPKCS8, SignJWT, jwtVerify, createLocalJWKSet, importSPKI } from 'jose';
import { URL } from 'node:url';
import { postForm } from './http.js';
import { saveCode, loadCode, deleteCode } from './oauth-store.js';
import { saveClient, getClient, clientExists, type OAuthClient } from './oauth-clients-store.js';


import express, { type Application, type Request, type Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';


// ---------- CONFIG ----------
const ISSUER = process.env.MCP_OAUTH_ISSUER || 'https://mcp.kash.click';
const AUD = process.env.MCP_OAUTH_AUDIENCE || 'https://mcp.kash.click';
const AUTH_WS = process.env.MCP_AUTH_WS_BASE || 'https://kash.click'; // base pour getAuthToken.php

// Clés pour RS256 (publiques via JWKS)

let privateKey: crypto.KeyObject | CryptoKey | null = null;
let jwks: any = null;


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function deepGet(obj: any, key: string) {
    return key.split('.').reduce((o, k) => (o && typeof o === 'object') ? o[k] : undefined, obj);
}

function render(obj: any, dict: any): any {
    if (typeof obj === 'string') {
        return obj.replace(/\{\{([^}]+)\}\}/g, (_, k) => {
            const v = deepGet(dict, k.trim());
            return v !== undefined ? String(v) : '';
        });
    } else if (Array.isArray(obj)) {
        return obj.map(x => render(x, dict));
    } else if (obj && typeof obj === 'object') {
        const out: any = {};
        for (const k of Object.keys(obj)) out[k] = render(obj[k], dict);
        return out;
    }
    return obj;
}

function loadDict(lang: string) {
    const base = path.resolve(__dirname, '..', '..');
    const p = path.join(base, 'locales', lang, 'common.json');
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
}
function corsLite(req: Request, res: Response, next: NextFunction) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
}


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

    router.get(['/.well-known/mcp/manifest.json', '/mcp/manifest'], (req: Request, res: Response) => {
        // resolve locale preference
        res.setHeader('Cache-Control', 'public, max-age=60');
        let lang = process.env.MCP_LANG || '';
        if (!lang && req.headers['accept-language']) {
            const m = String(req.headers['accept-language']).match(/^[a-z]{2}/i);
            if (m) lang = m[0];
        }
        lang = (lang || 'en').toLowerCase().slice(0, 2);

        const base = path.resolve(__dirname, '..', '..');
        const tmpl = JSON.parse(fs.readFileSync(path.join(base, 'manifest.template.json'), 'utf-8'));
        /*const dict = loadDict(lang);
        const rendered = render(tmpl, dict);*/
        res.json(tmpl);
    });
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
        logErr('/oauth/register');
        const { redirect_uris = [], client_id } = req.body || {};
        const id = client_id || `pub-${crypto.randomUUID()}`;
        //clients.set(id, { redirect_uris, public: true });
        const rec: OAuthClient = { redirect_uris, public: true };
        await saveClient(id, rec);

        res.json({ client_id: id, token_endpoint_auth_method: 'none', redirect_uris });
    });
    /*
    // d) Enregistrement dynamique (optionnel – ici no-op minimal)
    router.post('/oauth/register', async (req, res) => {
        const { redirect_uris = [], client_id, client_name, scope } = req.body || {};
        const id = client_id || `pub-${crypto.randomUUID()}`;
        const rec: OAuthClient = { redirect_uris, public: true };
        await saveClient(id, rec);
        // RFC 7591 exige HTTP 201 + client_id_issued_at
        res.status(201).json({
            client_id: id,
            client_id_issued_at: Math.floor(Date.now() / 1000),
            client_name: client_name || id,
            redirect_uris,
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code'],
            response_types: ['code'],
            scope: scope || 'mcp:invoke',
        });
    });*/

    // e) Formulaire de login (GET -> HTML)
    router.get('/oauth/authorize', async (req, res) => {
        logErr('/oauth/authorize');
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
      <html lang="en">
<head>
<title>Kash.click – Online Cash Register for
	Shops &amp; businesses</title>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, viewport-fit=cover">
<meta name="description"
	content="Free POS software for shops &amp; restaurants. Manage sales, inventory and customer loyalty in one simple system. Start in 2 minutes.">
<meta property="og:title"
	content="Free POS Software | Kash.click – Online Cash Register for Shops &amp; businesses">
<meta property="og:description"
	content="Free POS software for shops &amp; restaurants. Manage sales, inventory and customer loyalty in one simple system. Start in 2 minutes.">
<meta property="og:url" content="https://kash.click">
<meta property="og:site_name" content="kash.click">
<meta property="og:image" content="https://kash.click/PreviewEN.png">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title"
	content="Free POS Software | Kash.click – Online Cash Register for Shops &amp; businesses">
<meta name="twitter:description"
	content="Free POS software for shops &amp; restaurants. Manage sales, inventory and customer loyalty in one simple system. Start in 2 minutes.">
<meta name="twitter:image" content="https://kash.click/PreviewEN.png">
<link rel="alternate" type="application/rss+xml"
	href="https://kash.click/workers/rssfeed.php">
<link rel="shortcut icon" type="image/ico" href="https://kash.click/favicon.ico">
<link rel="manifest" href="https://kash.click/manifesten.json">
<link rel="apple-touch-icon"
	href="https://kash.click/ios/AppIcon.appiconset/Icon-60@2x.png">
<link rel="apple-touch-icon" sizes="180x180"
	href="https://kash.click/ios/AppIcon.appiconset/Icon-60@3x.png">
<link rel="apple-touch-icon" sizes="76x76"
	href="https://kash.click/ios/AppIcon.appiconset/Icon-76.png">
<link rel="apple-touch-icon" sizes="152x152"
	href="https://kash.click/ios/AppIcon.appiconset/Icon-76@2x.png">
<link rel="apple-touch-icon" sizes="58x58"
	href="https://kash.click/ios/AppIcon.appiconset/Icon-Small@2x.png">
<meta name="DC.Title"
	content="Free POS Software | Kash.click – Online Cash Register for Shops &amp; businesses">
<meta name="DC.Type" content="Software">
<meta name="DC.Language" content="en">
<meta name="DC.Description"
	content="Free POS software for shops &amp; restaurants. Manage sales, inventory and customer loyalty in one simple system. Start in 2 minutes.">
<link rel="canonical" href="https://kash.click">
<meta name="google-signin-client_id"
	content="445651494565-hfuqr4fis6mq38k77dc3v1kh1nb4tga7.apps.googleusercontent.com">

<style>
/*! CSS Used from: https://kash.click/css/print.css?4.3.254 ; media=print */
@media print{
*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
body{display:initial!important;}
.card{box-shadow:none!important;}
div.container{margin:0px!important;display:block!important;max-width:none;}
BODY{background:none;}
#htmlzone{overflow-x:none;}
}
/*! CSS Used from: https://kash.click/Memos/unlogCSS4.3.254.css */
:root{--animate-duration:1s;--animate-delay:1s;--animate-repeat:1;}
:root{--swiper-theme-color:#007aff;}
:root{--swiper-navigation-size:44px;}
nav.navbar{padding-top:env(safe-area-inset-top)!important;}
*,::before,::after{--tw-border-spacing-x:0;--tw-border-spacing-y:0;--tw-translate-x:0;--tw-translate-y:0;--tw-rotate:0;--tw-skew-x:0;--tw-skew-y:0;--tw-scale-x:1;--tw-scale-y:1;--tw-scroll-snap-strictness:proximity;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-color:rgb(59 130 246 / 0.5);--tw-ring-offset-shadow:0 0 #0000;--tw-ring-shadow:0 0 #0000;--tw-shadow:0 0 #0000;--tw-shadow-colored:0 0 #0000;}
*,::before,::after{box-sizing:border-box;border-width:0;border-style:solid;border-color:#e5e7eb;}
::before,::after{--tw-content:'';}
html{line-height:1.5;-webkit-text-size-adjust:100%;-moz-tab-size:4;-o-tab-size:4;tab-size:4;font-family:ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";font-feature-settings:normal;font-variation-settings:normal;-webkit-tap-highlight-color:transparent;}
body{margin:0;line-height:inherit;}
.inline{display:inline;}
.logoC{width:38px;}
h2,h3{font-size:inherit;font-weight:inherit;}
a{color:inherit;text-decoration:inherit;}
input{font-family:inherit;font-feature-settings:inherit;font-variation-settings:inherit;font-size:100%;font-weight:inherit;line-height:inherit;letter-spacing:inherit;color:inherit;margin:0;}
input:where([type='submit']){-webkit-appearance:button;background-color:transparent;background-image:none;}
h2,h3,p{margin:0;}
input::placeholder{opacity:1;color:#9ca3af;}
:disabled{cursor:default;}
img,svg{display:block;vertical-align:middle;}
img{max-width:100%;height:auto;}
.container{width:100%;margin-right:auto;margin-left:auto;padding-right:15px;padding-left:15px;}
@media (min-width: 576px){
.container{max-width:576px;}
}
@media (min-width: 768px){
.container{max-width:768px;}
}
@media (min-width: 992px){
.container{max-width:992px;}
}
@media (min-width: 1200px){
.container{max-width:1200px;}
}
@media (min-width: 1400px){
.container{max-width:1400px;}
}
@media (min-width: 1536px){
.container{max-width:1536px;}
}
.container{max-width:100%;}
@media (min-width: 576px) and (max-width: 767.98px){
.container{max-width:540px;}
}
@media (min-width: 768px) and (max-width: 991.98px){
.container{max-width:720px;}
}
@media (min-width: 992px) and (max-width: 1199.98px){
.container{max-width:960px;}
}
@media (min-width: 1200px){
.container{max-width:1140px;}
}
@media (min-width: 1400px){
.container{max-width:1320px;}
}
.pointer-events-none{pointer-events:none;}
.invisible{visibility:hidden;}
.fixed{position:fixed;}
.\\!absolute{position:absolute!important;}
.absolute{position:absolute;}
.\\!relative{position:relative!important;}
.relative{position:relative;}
.bottom-6{bottom:1.5rem;}
.left-0{left:0px;}
.right-3{right:0.75rem;}
.right-6{right:1.5rem;}
.top-0{top:0px;}
.top-2\\/4{top:50%;}
.z-0{z-index:0;}
.z-\\[1010\\]{z-index:1010;}
.z-\\[2\\]{z-index:2;}
.z-\\[3\\]{z-index:3;}
.\\!mx-auto{margin-left:auto!important;margin-right:auto!important;}
.mx-0{margin-left:0px;margin-right:0px;}
.mx-\\[-15px\\]{margin-left:-15px;margin-right:-15px;}
.\\!mb-0{margin-bottom:0px!important;}
.\\!mb-3{margin-bottom:0.75rem!important;}
.\\!mb-4{margin-bottom:1rem!important;}
.\\!mb-6{margin-bottom:1.5rem!important;}
.\\!mt-\\[-9rem\\]{margin-top:-9rem!important;}
.mb-2{margin-bottom:0.5rem;}
.mb-3{margin-bottom:0.75rem;}
.mb-4{margin-bottom:1rem;}
.mr-8{margin-right:2rem;}
.mt-\\[-30px\\]{margin-top:-30px;}
.mt-\\[30px\\]{margin-top:30px;}
.box-border{box-sizing:border-box;}
.block{display:block;}
.inline-block{display:inline-block;}
.inline{display:inline;}
.flex{display:flex;}
.h-\\[2\\.3rem\\]{height:2.3rem;}
.h-\\[calc\\(2\\.5rem_\\+_2px\\)\\]{height:calc(2.5rem + 2px);}
.h-full{height:100%;}
.min-h-\\[calc\\(2\\.5rem_\\+_2px\\)\\]{min-height:calc(2.5rem + 2px);}
.w-\\[2\\.3rem\\]{width:2.3rem;}
.w-full{width:100%;}
.max-w-full{max-width:100%;}
.flex-\\[0_0_auto\\]{flex:0 0 auto;}
.flex-\\[1_0_0\\%\\]{flex:1 0 0%;}
.shrink-0{flex-shrink:0;}
.grow{flex-grow:1;}
.origin-\\[0_0\\]{transform-origin:0 0;}
.-translate-y-2\\/4{--tw-translate-y:-50%;transform:translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));}
.translate-y-3{--tw-translate-y:0.75rem;transform:translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));}
.cursor-pointer{cursor:pointer;}
.appearance-none{-webkit-appearance:none;-moz-appearance:none;appearance:none;}
.flex-row{flex-direction:row;}
.flex-wrap{flex-wrap:wrap;}
.\\!flex-nowrap{flex-wrap:nowrap!important;}
.items-center{align-items:center;}
.justify-between{justify-content:space-between;}
.overflow-hidden{overflow:hidden;}
.text-ellipsis{text-overflow:ellipsis;}
.whitespace-nowrap{white-space:nowrap;}
.\\!rounded-\\[50rem\\]{border-radius:50rem!important;}
.rounded-\\[0\\.4rem\\]{border-radius:0.4rem;}
.rounded-\\[100\\%\\]{border-radius:100%;}
.border{border-width:1px;}
.border-solid{border-style:solid;}
.border-\\[\\#3f78e0\\]{--tw-border-opacity:1;border-color:rgb(63 120 224 / var(--tw-border-opacity));}
.border-\\[rgba\\(8\\2c 60\\2c 130\\2c 0\\.07\\)\\]{border-color:rgba(8,60,130,0.07);}
.border-transparent{border-color:transparent;}
.\\!bg-\\[\\#3f78e0\\]{--tw-bg-opacity:1!important;background-color:rgb(63 120 224 / var(--tw-bg-opacity))!important;}
.\\!bg-\\[\\#ffffff\\]{--tw-bg-opacity:1!important;background-color:rgb(255 255 255 / var(--tw-bg-opacity))!important;}
.bg-\\[\\#fefefe\\]{--tw-bg-opacity:1;background-color:rgb(254 254 254 / var(--tw-bg-opacity));}
.bg-cover{background-size:cover;}
.\\!bg-fixed{background-attachment:fixed!important;}
.bg-clip-padding{background-clip:padding-box;}
.bg-\\[center_center\\]{background-position:center center;}
.bg-no-repeat{background-repeat:no-repeat;}
.fill-none{fill:none;}
.stroke-\\[\\#605dba\\]{stroke:#605dba;}
.stroke-\\[4\\]{stroke-width:4;}
.\\!p-10{padding:2.5rem!important;}
.p-6{padding:1.5rem;}
.px-4{padding-left:1rem;padding-right:1rem;}
.px-\\[15px\\]{padding-left:15px;padding-right:15px;}
.py-16{padding-top:4rem;padding-bottom:4rem;}
.py-\\[0\\.6rem\\]{padding-top:0.6rem;padding-bottom:0.6rem;}
.\\!pb-\\[4\\.5rem\\]{padding-bottom:4.5rem!important;}
.pb-40{padding-bottom:10rem;}
.pt-28{padding-top:7rem;}
.text-left{text-align:left;}
.\\!text-center{text-align:center!important;}
.text-start{text-align:start;}
.\\!text-\\[calc\\(1\\.275rem_\\+_0\\.3vw\\)\\]{font-size:calc(1.275rem + 0.3vw)!important;}
.text-\\[\\.75rem\\]{font-size:.75rem;}
.text-\\[0\\.9rem\\]{font-size:0.9rem;}
.text-\\[12px\\]{font-size:20px;}
.font-medium{font-weight:500;}
.\\!leading-\\[1\\.65\\]{line-height:1.65!important;}
.leading-\\[1\\.25\\]{line-height:1.25;}
.text-\\[\\#60697b\\]{--tw-text-opacity:1;color:rgb(96 105 123 / var(--tw-text-opacity));}
.text-\\[\\#959ca9\\]{--tw-text-opacity:1;color:rgb(149 156 169 / var(--tw-text-opacity));}
.text-white{--tw-text-opacity:1;color:rgb(255 255 255 / var(--tw-text-opacity));}
.opacity-0{opacity:0;}
.\\!shadow-\\[0_0\\.25rem_1\\.75rem_rgba\\(30\\2c 34\\2c 40\\2c 0\\.07\\)\\]{--tw-shadow:0 0.25rem 1.75rem rgba(30,34,40,0.07)!important;--tw-shadow-colored:0 0.25rem 1.75rem var(--tw-shadow-color)!important;box-shadow:var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow)!important;}
.shadow-\\[0_0_1\\.25rem_rgba\\(30\\2c 34\\2c 40\\2c 0\\.04\\)\\]{--tw-shadow:0 0 1.25rem rgba(30,34,40,0.04);--tw-shadow-colored:0 0 1.25rem var(--tw-shadow-color);box-shadow:var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);}
.shadow-\\[inset_0_0_0_0\\.1rem_rgba\\(128\\2c 130\\2c 134\\2c 0\\.25\\)\\]{--tw-shadow:inset 0 0 0 0.1rem rgba(128,130,134,0.25);--tw-shadow-colored:inset 0 0 0 0.1rem var(--tw-shadow-color);box-shadow:var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);}
.transition-all{transition-property:all;transition-timing-function:cubic-bezier(0.4, 0, 0.2, 1);transition-duration:150ms;}
.delay-\\[0s\\]{transition-delay:0s;}
.duration-\\[0\\.2s\\]{transition-duration:0.2s;}
.ease-\\[linear\\2c margin-right\\]{transition-timing-function:linear,margin-right;}
.ease-linear{transition-timing-function:linear;}
:root{font-size:20px;}
*,::after,::before{box-sizing:border-box;}
::selection{background-color:rgba(63,120,224,.7);--tw-text-opacity:1;color:rgb(255 255 255 / var(--tw-text-opacity));}
a{transition-property:all;transition-duration:150ms;transition-duration:0.2s;transition-timing-function:cubic-bezier(0.4, 0, 0.2, 1);}
@media (prefers-reduced-motion: reduce){
a{transition-property:none;}
}
a:focus{outline:0;}
h2,h3{margin-top:0px;margin-bottom:0.5rem;font-weight:700;letter-spacing:-0.01rem;--tw-text-opacity:1;color:rgb(52 63 82 / var(--tw-text-opacity));word-spacing:.1rem;}
h2{line-height:1.35;}
h3{line-height:1.4!important;}
body,html{height:100%;}
body{display:flex;flex-direction:column;margin:0px;--tw-bg-opacity:1;background-color:rgb(254 254 254 / var(--tw-bg-opacity));font-family:Manrope, sans-serif;font-size:0.8rem;font-weight:500;line-height:1.7;--tw-text-opacity:1;color:rgb(96 105 123 / var(--tw-text-opacity));overflow-x:hidden;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;word-spacing:.05rem;}
h2,h3{margin-top:0px;margin-bottom:0.5rem;font-weight:700;line-height:1.2;letter-spacing:-0.01rem;--tw-text-opacity:1;color:rgb(52 63 82 / var(--tw-text-opacity));word-spacing:0.1rem;}
h2{font-size:calc(1.255rem + 0.06vw);}
@media (min-width: 1200px){
h2{font-size:1.3rem;}
}
h3{font-size:1.1rem;}
p{margin-top:0px;margin-bottom:1rem;}
a{color:rgba(63,120,224,1);text-decoration-line:none;}
a:hover{color:#3f78e0;}
img,svg{vertical-align:middle;}
img{max-width:inherit;}
label{display:inline-block;}
input{margin:0px;line-height:inherit;color:inherit;font-family:inherit;}
[type=submit]{-webkit-appearance:button;}
[type=submit]:not(:disabled){cursor:pointer;}
.form-floating>label{transition:opacity .1s ease-in-out,transform .1s ease-in-out;}
.form-floating>.form-control::placeholder{color:transparent;}
.form-floating>.form-control:focus,.form-floating>.form-control:not(:placeholder-shown){padding-top:1rem;padding-bottom:0.2rem;}
.form-floating>.form-control:focus~label,.form-floating>.form-control:not(:placeholder-shown)~label{--tw-translate-y:-0.4rem;--tw-translate-x:0.2rem;--tw-scale-x:0.8;--tw-scale-y:0.8;transform:translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));color:rgba(96,105,123,1);}
.form-floating>.form-control:focus~label::after,.form-floating>.form-control:not(:placeholder-shown)~label::after{position:absolute;inset:0.6rem 0.5rem;z-index:-1;height:1.5em;border-radius:0.4rem;--tw-bg-opacity:1;background-color:rgb(254 254 254 / var(--tw-bg-opacity));--tw-content:"";content:var(--tw-content);}
.form-floating>.form-control:disabled~label{--tw-text-opacity:1;color:rgb(96 105 123 / var(--tw-text-opacity));}
.form-floating>.form-control:disabled~label::after{--tw-bg-opacity:1;background-color:rgb(170 176 188 / var(--tw-bg-opacity));}
.btn{display:inline-block;cursor:pointer;-webkit-user-select:none;-moz-user-select:none;user-select:none;white-space:nowrap;border-radius:0.4rem;border-width:2px;border-style:solid;border-color:transparent;background-color:transparent;padding:0.5rem 1.2rem;text-align:center;vertical-align:middle;font-size:0.8rem;font-weight:700;line-height:1.7;--tw-text-opacity:1;color:rgb(96 105 123 / var(--tw-text-opacity));--tw-shadow-color:unset;--tw-shadow:var(--tw-shadow-colored);transition-property:all;transition-duration:150ms;transition-duration:0.2s;transition-timing-function:cubic-bezier(0.4, 0, 0.2, 1);}
.btn:hover{--tw-border-opacity:1;border-color:rgb(255 255 255 / var(--tw-border-opacity));--tw-bg-opacity:1;background-color:rgb(255 255 255 / var(--tw-bg-opacity));--tw-text-opacity:1;color:rgb(255 255 255 / var(--tw-text-opacity));}
@media (prefers-reduced-motion: reduce){
.btn{transition-property:none;}
}
.navbar{position:relative;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;padding:0px;--tw-text-opacity:1;color:rgb(52 63 82 / var(--tw-text-opacity));}
.navbar>.container{display:flex;align-items:center;justify-content:space-between;flex-wrap:inherit;}
.navbar-brand{margin-right:0px;white-space:nowrap;padding-top:0px;padding-bottom:0px;font-size:0.7rem;--tw-text-opacity:1;color:rgb(63 120 224 / var(--tw-text-opacity));}
.navbar-brand:focus,.navbar-brand:hover{--tw-text-opacity:1;color:rgb(63 120 224 / var(--tw-text-opacity));}
.navbar-collapse{flex-grow:1;flex-basis:100%;align-items:center;}
.card{position:relative;display:flex;min-width:0px;flex-direction:column;border-radius:0.4rem;border-width:1px;border-style:solid;border-color:rgba(164,174,198,0.2);--tw-bg-opacity:1;background-color:rgb(255 255 255 / var(--tw-bg-opacity));background-clip:border-box;--tw-text-opacity:1;color:rgb(96 105 123 / var(--tw-text-opacity));word-wrap:break-word;}
@media (min-width:992px){
.navbar-expand-lg.transparent:not(.modal){padding-top:0.3rem;}
}
@media (min-width:992px){
.navbar-expand-lg.transparent:not(.modal-backdrop){padding-top:0.3rem;}
}
.offcanvas{visibility:hidden;position:fixed;bottom:0px;z-index:1045;display:flex;max-width:100%;flex-direction:column;--tw-bg-opacity:1;background-color:rgb(30 34 40 / var(--tw-bg-opacity));background-clip:padding-box;--tw-text-opacity:1;color:rgb(255 255 255 / var(--tw-text-opacity));--tw-shadow-color:none;--tw-shadow:var(--tw-shadow-colored);outline-width:0px;transition-property:transform 0.3s ease-in-out;transition-timing-function:cubic-bezier(0.4, 0, 0.2, 1);transition-duration:150ms;}
@media (min-width:992px){
.navbar-expand-lg.transparent:not(.offcanvas){padding-top:0.3rem;}
}
@media (prefers-reduced-motion: reduce){
.offcanvas{transition-property:none;}
}
.offcanvas{outline:0;}
.offcanvas.offcanvas-start{left:0px;top:0px;width:15rem;--tw-translate-x:-100%;transform:translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));border-right-width:0;border-style:solid;border-right-color:transparent;}
@media (min-width:992px){
.navbar-expand-lg.transparent:not(.offcanvas-backdrop){padding-top:0.3rem;}
}
[class*=\\!mb-],[class*=\\!mt-]{position:relative;z-index:3;}
.offcanvas{-ms-overflow-style:none;scrollbar-width:none;}
.offcanvas::-webkit-scrollbar{display:none;}
.form-floating:not(.form-control:disabled)::before{background-color:inherit;}
.form-floating>.form-control:focus~label,.form-floating>.form-control:not(:placeholder-shown)~label{--tw-text-opacity:1;color:rgb(149 156 169 / var(--tw-text-opacity));}
.form-floating>.form-control:focus~label::after,.form-floating>.form-control:not(:placeholder-shown)~label::after{background-color:transparent;}
.btn{position:relative;display:inline-flex;--tw-translate-y:0px;transform:translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));align-items:center;justify-content:center;letter-spacing:-0.01rem;}
.btn:not(.btn-link):hover{--tw-translate-y:-0.15rem;transform:translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));--tw-shadow:0 0.25rem 0.75rem rgba(30,34,40,0.15);--tw-shadow-colored:0 0.25rem 0.75rem var(--tw-shadow-color);box-shadow:var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);}
.btn-primary{--tw-text-opacity:1;color:rgb(255 255 255 / var(--tw-text-opacity));}
.btn-primary:hover{--tw-text-opacity:1;color:rgb(255 255 255 / var(--tw-text-opacity));}
.btn-primary:hover{--tw-bg-opacity:1;background-color:rgb(63 120 224 / var(--tw-bg-opacity));}
.btn-primary:active{--tw-border-opacity:1;border-color:rgb(63 120 224 / var(--tw-border-opacity));--tw-bg-opacity:1;background-color:rgb(63 120 224 / var(--tw-bg-opacity));}
@media (min-width:992px){
.navbar-expand-lg.transparent:not(.page-loader){padding-top:0.3rem;}
}
.navbar{z-index:1020;width:100%;}
.navbar .container{position:relative;}
.navbar .navbar-collapse{align-items:center;}
.navbar-clone{position:fixed!important;left:0px;top:0px;z-index:1008;--tw-translate-y:-100%;transform:translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));transition-property:all;transition-timing-function:cubic-bezier(0.4, 0, 0.2, 1);transition-duration:150ms;transition-delay:0s;transition-duration:0.3s;transition-timing-function:ease-in-out,padding-right;}
@media (prefers-reduced-motion: reduce){
.navbar-clone{transition-property:none;}
}
.card{border-width:0px;color:inherit;--tw-shadow:0 0 0 0.05rem rgba(8,60,130,0.06),0 0 1.25rem rgba(30,34,40,0.04);--tw-shadow-colored:0 0 0 0.05rem var(--tw-shadow-color), 0 0 1.25rem var(--tw-shadow-color);box-shadow:var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);}
.image-wrapper.bg-overlay:not(.bg-content) *{position:relative;z-index:2;}
@media (min-width:576px){
.container{max-width:540px;}
}
@media (min-width:768px){
.container{max-width:720px;}
}
@media (min-width:992px){
.container{max-width:960px;}
}
@media (min-width:1200px){
.container{max-width:1140px;}
}
@media (min-width:1400px){
.container{max-width:1320px;}
}
.container{margin-left:auto;margin-right:auto;width:100%;padding-left:15px;padding-right:15px;}
@media (min-width:992px){
.navbar-expand-lg{flex-wrap:nowrap;justify-content:flex-start;}
.navbar-expand-lg .navbar-collapse{display:flex;flex-basis:auto;}
.navbar-expand-lg .offcanvas{visibility:visible;position:static;z-index:auto;height:auto;width:auto;flex-grow:1;transform:none!important;border-width:0px;background-color:transparent;--tw-shadow:0 0 #0000;--tw-shadow-colored:0 0 #0000;box-shadow:var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);transition-property:none;}
.navbar-expand-lg .offcanvas .offcanvas-header{display:none;}
.navbar-expand-lg .offcanvas-nav{flex-direction:row;position:unset;}
.navbar-expand-lg .offcanvas-nav.offcanvas-start{width:100%;}
.navbar-expand-lg.transparent:not(.fixed){padding-top:0.3rem;}
.navbar-expand-lg.transparent.navbar-clone{padding-top:0px;}
}
@media (max-width:991.98px){
.navbar-expand-lg .offcanvas-nav{flex-direction:column;overflow-y:auto;overflow-x:hidden;}
.navbar-expand-lg .offcanvas-nav .offcanvas-header{width:100%;}
.navbar-expand-lg .navbar-brand{padding-top:1.2rem;padding-bottom:1.2rem;}
}
@media (prefers-reduced-motion:reduce){
.form-floating>label{transition-property:none;}
}
.before\\:absolute::before{content:var(--tw-content);position:absolute;}
.before\\:left-0::before{content:var(--tw-content);left:0px;}
.before\\:top-0::before{content:var(--tw-content);top:0px;}
.before\\:z-\\[1\\]::before{content:var(--tw-content);z-index:1;}
.before\\:block::before{content:var(--tw-content);display:block;}
.before\\:h-full::before{content:var(--tw-content);height:100%;}
.before\\:w-full::before{content:var(--tw-content);width:100%;}
.before\\:bg-\\[rgba\\(255\\2c 255\\2c 255\\2c \\.6\\)\\]::before{content:var(--tw-content);background-color:rgba(255,255,255,.6);}
.before\\:content-\\[\\'\\'\\]::before{--tw-content:'';content:var(--tw-content);}
.after\\:absolute::after{content:var(--tw-content);position:absolute;}
.after\\:left-0::after{content:var(--tw-content);left:0px;}
.after\\:top-0::after{content:var(--tw-content);top:0px;}
.after\\:z-\\[1\\]::after{content:var(--tw-content);z-index:1;}
.after\\:block::after{content:var(--tw-content);display:block;}
.after\\:h-\\[2\\.3rem\\]::after{content:var(--tw-content);height:2.3rem;}
.after\\:w-\\[2\\.3rem\\]::after{content:var(--tw-content);width:2.3rem;}
.after\\:cursor-pointer::after{content:var(--tw-content);cursor:pointer;}
.after\\:text-center::after{content:var(--tw-content);text-align:center;}
.after\\:font-Unicons::after{content:var(--tw-content);font-family:Unicons;}
.after\\:text-\\[1\\.2rem\\]::after{content:var(--tw-content);font-size:1.2rem;}
.after\\:leading-\\[2\\.3rem\\]::after{content:var(--tw-content);line-height:2.3rem;}
.after\\:text-\\[\\#605dba\\]::after{content:var(--tw-content);--tw-text-opacity:1;color:rgb(96 93 186 / var(--tw-text-opacity));}
.after\\:transition-all::after{content:var(--tw-content);transition-property:all;transition-timing-function:cubic-bezier(0.4, 0, 0.2, 1);transition-duration:150ms;}
.after\\:duration-\\[0\\.2s\\]::after{content:var(--tw-content);transition-duration:0.2s;}
.after\\:ease-linear::after{content:var(--tw-content);transition-timing-function:linear;}
.after\\:content-\\[\\'\\\\e951\\'\\]::after{--tw-content:'\\e951';content:var(--tw-content);}
.hover\\:border-\\[\\#3f78e0\\]:hover{--tw-border-opacity:1;border-color:rgb(63 120 224 / var(--tw-border-opacity));}
.hover\\:bg-\\[\\#3f78e0\\]:hover{--tw-bg-opacity:1;background-color:rgb(63 120 224 / var(--tw-bg-opacity));}
.hover\\:text-white:hover{--tw-text-opacity:1;color:rgb(255 255 255 / var(--tw-text-opacity));}
.text-white{color:#fff!important;}
.focus\\:\\!border-\\[rgba\\(63\\2c 120\\2c 224\\2c 0\\.5\\)\\]:focus{border-color:rgba(63,120,224,0.5)!important;}
.focus\\:border-\\[\\#9fbcf0\\]:focus{--tw-border-opacity:1;border-color:rgb(159 188 240 / var(--tw-border-opacity));}
.focus\\:bg-\\[\\#fefefe\\]:focus{--tw-bg-opacity:1;background-color:rgb(254 254 254 / var(--tw-bg-opacity));}
.focus\\:text-\\[\\#60697b\\]:focus{--tw-text-opacity:1;color:rgb(96 105 123 / var(--tw-text-opacity));}
.focus\\:shadow-\\[0_0_1\\.25rem_rgba\\(30\\2c 34\\2c 40\\2c 0\\.04\\)\\2c unset\\]:focus{--tw-shadow-color:0 0 1.25rem rgba(30,34,40,0.04),unset;--tw-shadow:var(--tw-shadow-colored);}
.focus\\:shadow-\\[rgba\\(92\\2c 140\\2c 229\\2c 1\\)\\]:focus{--tw-shadow-color:rgba(92,140,229,1);--tw-shadow:var(--tw-shadow-colored);}
.active\\:border-\\[\\#3f78e0\\]:active{--tw-border-opacity:1;border-color:rgb(63 120 224 / var(--tw-border-opacity));}
.active\\:bg-\\[\\#3f78e0\\]:active{--tw-bg-opacity:1;background-color:rgb(63 120 224 / var(--tw-bg-opacity));}
.active\\:text-white:active{--tw-text-opacity:1;color:rgb(255 255 255 / var(--tw-text-opacity));}
.disabled\\:border-\\[\\#3f78e0\\]:disabled{--tw-border-opacity:1;border-color:rgb(63 120 224 / var(--tw-border-opacity));}
.disabled\\:bg-\\[\\#3f78e0\\]:disabled{--tw-bg-opacity:1;background-color:rgb(63 120 224 / var(--tw-bg-opacity));}
.disabled\\:bg-\\[\\#aab0bc\\]:disabled{--tw-bg-opacity:1;background-color:rgb(170 176 188 / var(--tw-bg-opacity));}
.disabled\\:text-white:disabled{--tw-text-opacity:1;color:rgb(255 255 255 / var(--tw-text-opacity));}
.disabled\\:opacity-100:disabled{opacity:1;}
@media (prefers-reduced-motion: reduce){
.motion-reduce\\:transition-none{transition-property:none;}
}
@media (min-width: 768px) and (max-width: 991.98px){
.md\\:w-6\\/12{width:50%;}
.md\\:\\!p-12{padding:3rem!important;}
.md\\:\\!py-20{padding-top:5rem!important;padding-bottom:5rem!important;}
.md\\:\\!pb-24{padding-bottom:6rem!important;}
.md\\:pb-\\[12\\.5rem\\]{padding-bottom:12.5rem;}
.md\\:pt-36{padding-top:9rem;}
}
@media (min-width: 992px) and (max-width: 1199.98px){
.lg\\:mt-0{margin-top:0px;}
.lg\\:hidden{display:none;}
.lg\\:w-3\\/12{width:25%;}
.lg\\:w-6\\/12{width:50%;}
.lg\\:w-8\\/12{width:66.666667%;}
.lg\\:flex-row{flex-direction:row;}
.lg\\:\\!p-\\[4rem\\]{padding:4rem!important;}
.lg\\:\\!py-20{padding-top:5rem!important;padding-bottom:5rem!important;}
.lg\\:\\!pb-24{padding-bottom:6rem!important;}
.lg\\:pb-\\[12\\.5rem\\]{padding-bottom:12.5rem;}
.lg\\:pt-36{padding-top:9rem;}
}
@media (min-width: 1200px){
.xl\\:mt-0{margin-top:0px;}
.xl\\:hidden{display:none;}
.xl\\:w-3\\/12{width:25%;}
.xl\\:w-6\\/12{width:50%;}
.xl\\:w-8\\/12{width:66.666667%;}
.xl\\:flex-row{flex-direction:row;}
.xl\\:\\!p-\\[4rem\\]{padding:4rem!important;}
.xl\\:\\!py-20{padding-top:5rem!important;padding-bottom:5rem!important;}
.xl\\:\\!pb-24{padding-bottom:6rem!important;}
.xl\\:pb-\\[12\\.5rem\\]{padding-bottom:12.5rem;}
.xl\\:pt-36{padding-top:9rem;}
.xl\\:text-\\[1\\.5rem\\]{font-size:1.5rem;}
}
::selection{background:rgb(96 93 186 /.7);}
*{word-spacing:normal!important;}
body{font-family:"Space Grotesk", sans-serif!important;font-size:.85rem!important;}
.lead,body{font-weight:400;}
.btn,h2,h3{font-weight:600!important;}
.btn{font-size:.85rem!important;}
.btn{padding-top:.55rem;padding-bottom:.45rem;}
.lead{font-size:.95rem;line-height:1.6;}
/*! CSS Used from: Embedded */
.clear{clear:both;}
.w120{width:120px;}
.logoD{width:26px;}
@media ( max-width :1160px){
.logoText{display:none;}
}
:root{-:#17223b;-ink -:#0b63b6;-brand -:#5a6473;-muted -:#ffffff;-bg -:#f6f8fb;-panel -:#0f172a;-codebg -:#e5e7eb;}
.kash{width:171px;height:auto;margin-left:20px;}

</style>
</head>
<body>
	<nav
		class="navbar navbar-expand-lg center-nav transparent !absolute navbar-light caret-none navbar-clone fixed navbar-unstick">
		<div
			class="container xl:flex-row lg:flex-row !flex-nowrap items-center">
			<div class="navbar-brand w-full">
				<a href="https://kash.click/" class="navjx" data-navig="Bienvenue"> <img
					src="https://kash.click/assets/img/LogoCaisse.svg" class="inline logoC"
					alt="Logo POS Software"> <img
					src="https://kash.click/assets/img/kash-logo4.svg" class="kash inline mr-8 logoText"
					alt="Online cash register">
				</a>
			</div>
			<div class="navbar-collapse offcanvas offcanvas-nav offcanvas-start">
				<div
					class="offcanvas-header xl:hidden lg:hidden flex items-center justify-between flex-row p-6">
					<h3
						class="text-white xl:text-[1.5rem] !text-[calc(1.275rem_+_0.3vw)] !mb-0">Cash
						register</h3>
				</div>

			</div>

		</div>
	</nav>
	<div id="NEWUI" class="grow shrink-0">
		<header>
			<nav
				class="navbar navbar-expand-lg center-nav transparent !absolute navbar-light caret-none">
				<div
					class="container xl:flex-row lg:flex-row !flex-nowrap items-center">
					<div class="navbar-brand w-full">
						<a href="https://kash.click/" class="navjx" data-navig="Bienvenue"> <img
							src="https://kash.click/assets/img/LogoCaisse.svg" class="inline logoC"
							alt="Logo POS Software"> <img
							src="https://kash.click/assets/img/kash-logo4.svg"
							class="kash inline mr-8 logoText" alt="Online cash register">
						</a>
					</div>
				</div>
			</nav>

		</header>
		<div id="htmlzone">
			<section
				class="wrapper image-wrapper bg-image bg-overlay bg-overlay-light-600 text-white !bg-fixed bg-no-repeat bg-[center_center] bg-cover relative z-0 before:content-[''] before:block before:absolute before:z-[1] before:w-full before:h-full before:left-0 before:top-0 before:bg-[rgba(255,255,255,.6)]"
				data-image-src="./assets/img/photos/bg18.png"
				style="background-image: url(&quot;./assets/img/photos/bg18.png&quot;);">
				<div
					class="container pt-28 pb-40 xl:pt-36 lg:pt-36 md:pt-36 xl:pb-[12.5rem] lg:pb-[12.5rem] md:pb-[12.5rem] !text-center">
					<div class="flex flex-wrap mx-[-15px]">
						<div
							class="xl:w-8/12 lg:w-8/12 w-full flex-[0_0_auto] px-[15px] max-w-full !mx-auto">

						</div>
					</div>
				</div>
			</section>


			<section class="wrapper !bg-[#ffffff]">
				<div class="container !pb-[4.5rem] xl:!pb-24 lg:!pb-24 md:!pb-24">
					<div class="flex flex-wrap mx-[-15px]">
						<div
							class="!mt-[-9rem] w-full flex-[1_0_0%] px-[15px] max-w-full !relative z-[3]">
							<div class="card !shadow-[0_0.25rem_1.75rem_rgba(30,34,40,0.07)]">
								<div class="flex flex-wrap mx-0 !text-center">
									<!--/column -->
									<div
										class="xl:w-6/12 lg:w-6/12 w-full flex-[0_0_auto] max-w-full">
										<div class="!p-10 md:!p-12  xl:!p-[4rem] lg:!p-[4rem]">
											<h2 class="mb-3 text-left">Login</h2>
											<p
												class="lead text-[0.9rem] font-medium !leading-[1.65] !mb-6 text-left">Fill
												your login and password to sign in.</p>
											<span id="mesgLogin"></span>
										        <form method="post" action="/oauth/authorize" class="text-left !mb-3">
										        <input type="hidden" name="client_id" value="${client_id}"/>
										        <input type="hidden" name="redirect_uri" value="${redirect_uri}"/>
										        <input type="hidden" name="state" value="${state}"/>
										        <input type="hidden" name="code_challenge" value="${code_challenge}"/>
										        <input type="hidden" name="scope" value="${scope}"/>
												<div class="form-floating !relative mb-4">
													<input id="login" type="text"
														name="login"
														class="form-control px-4 py-[0.6rem] h-[calc(2.5rem_+_2px)] min-h-[calc(2.5rem_+_2px)] leading-[1.25] block w-full text-[12px] font-medium text-[#60697b] appearance-none bg-[#fefefe] bg-clip-padding border shadow-[0_0_1.25rem_rgba(30,34,40,0.04)] rounded-[0.4rem] border-solid border-[rgba(8,60,130,0.07)] motion-reduce:transition-none focus:text-[#60697b] focus:bg-[#fefefe] focus:shadow-[0_0_1.25rem_rgba(30,34,40,0.04),unset] focus:border-[#9fbcf0] disabled:bg-[#aab0bc] disabled:opacity-100 file:mt-[-0.6rem] file:mr-[-1rem] file:mb-[-0.6rem] file:ml-[-1rem] file:text-[#60697b] file:bg-[#fefefe] file:pointer-events-none file:transition-all file:duration-[0.2s] file:ease-in-out file:px-4 file:py-[0.6rem] file:rounded-none file:border-inherit file:border-solid file:border-0 motion-reduce:file:transition-none focus:!border-[rgba(63,120,224,0.5)] focus-visible:!border-[rgba(63,120,224,0.5)] focus-visible:!outline-0"
														placeholder="Login"> <label
														class=" text-[#959ca9] text-[.75rem] absolute z-[2] h-full overflow-hidden text-start text-ellipsis whitespace-nowrap pointer-events-none border origin-[0_0] px-4 py-[0.6rem] border-solid border-transparent left-0 top-0 inline-block"
														for="login">Login</label>
												</div>
												<div class="form-floating !relative password-field mb-4">
													<input id="password" type="password"
														name="password"
														class="form-control px-4 py-[0.6rem] h-[calc(2.5rem_+_2px)] min-h-[calc(2.5rem_+_2px)] leading-[1.25] block w-full text-[12px] font-medium text-[#60697b] appearance-none bg-[#fefefe] bg-clip-padding border shadow-[0_0_1.25rem_rgba(30,34,40,0.04)] rounded-[0.4rem] border-solid border-[rgba(8,60,130,0.07)] motion-reduce:transition-none focus:text-[#60697b] focus:bg-[#fefefe] focus:shadow-[0_0_1.25rem_rgba(30,34,40,0.04),unset] focus:border-[#9fbcf0] disabled:bg-[#aab0bc] disabled:opacity-100 file:mt-[-0.6rem] file:mr-[-1rem] file:mb-[-0.6rem] file:ml-[-1rem] file:text-[#60697b] file:bg-[#fefefe] file:pointer-events-none file:transition-all file:duration-[0.2s] file:ease-in-out file:px-4 file:py-[0.6rem] file:rounded-none file:border-inherit file:border-solid file:border-0 motion-reduce:file:transition-none focus:!border-[rgba(63,120,224,0.5)] focus-visible:!border-[rgba(63,120,224,0.5)] focus-visible:!outline-0"
														placeholder="Password"> <span
														 onclick="togglePassword()"
														class="password-toggle absolute -translate-y-2/4 cursor-pointer text-[0.9rem] text-[#959ca9] right-3 top-2/4"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 5c-5 0-9 4-10 7 1 3 5 7 10 7s9-4 10-7c-1-3-5-7-10-7zm0 12a5 5 0 110-10 5 5 0 010 10z" fill="currentColor"/>
</svg></span> <label
														class=" text-[#959ca9] text-[.75rem] absolute z-[2] h-full overflow-hidden text-start text-ellipsis whitespace-nowrap pointer-events-none border origin-[0_0] px-4 py-[0.6rem] border-solid border-transparent left-0 top-0 inline-block"
														for="password">Password</label>
												</div>
												<input type="submit" id="conBt"
													class="btn btn-primary text-white !bg-[#3f78e0] border-[#3f78e0] hover:text-white hover:bg-[#3f78e0] hover:border-[#3f78e0] focus:shadow-[rgba(92,140,229,1)] active:text-white active:bg-[#3f78e0] active:border-[#3f78e0] disabled:text-white disabled:bg-[#3f78e0] disabled:border-[#3f78e0] !rounded-[50rem] btn-login w-full mb-2"
													value="Login">
											</form>
										</div>
									</div>


									<div
										class="xl:w-6/12 lg:w-6/12 w-full flex-[0_0_auto] max-w-full">
										<div class="!p-10 md:!p-12  xl:!p-[4rem] lg:!p-[4rem]">
											<h2 class="mb-3 text-left">Create an account</h2>
											<p
												class="lead text-[0.9rem] font-medium !leading-[1.65] !mb-6 text-left">Type
												in your email and your new login details will be emailed to
												you :</p>
											<div id="recovResp" class="response"></div>
											<form method="post" action="/oauth/authorize" class="text-left !mb-3">
										        <input type="hidden" name="client_id" value="${client_id}"/>
										        <input type="hidden" name="redirect_uri" value="${redirect_uri}"/>
										        <input type="hidden" name="state" value="${state}"/>
										        <input type="hidden" name="code_challenge" value="${code_challenge}"/>
										        <input type="hidden" name="scope" value="${scope}"/>
												<div class="form-floating !relative mb-4">
													<input id="accountTitle" type="text"
														name="accountTitle"
														class="form-control px-4 py-[0.6rem] h-[calc(2.5rem_+_2px)] min-h-[calc(2.5rem_+_2px)] leading-[1.25] block w-full text-[12px] font-medium text-[#60697b] appearance-none bg-[#fefefe] bg-clip-padding border shadow-[0_0_1.25rem_rgba(30,34,40,0.04)] rounded-[0.4rem] border-solid border-[rgba(8,60,130,0.07)] motion-reduce:transition-none focus:text-[#60697b] focus:bg-[#fefefe] focus:shadow-[0_0_1.25rem_rgba(30,34,40,0.04),unset] focus:border-[#9fbcf0] disabled:bg-[#aab0bc] disabled:opacity-100 file:mt-[-0.6rem] file:mr-[-1rem] file:mb-[-0.6rem] file:ml-[-1rem] file:text-[#60697b] file:bg-[#fefefe] file:pointer-events-none file:transition-all file:duration-[0.2s] file:ease-in-out file:px-4 file:py-[0.6rem] file:rounded-none file:border-inherit file:border-solid file:border-0 motion-reduce:file:transition-none focus:!border-[rgba(63,120,224,0.5)] focus-visible:!border-[rgba(63,120,224,0.5)] focus-visible:!outline-0"
														placeholder="Shop name"> <label
														class=" text-[#959ca9] text-[.75rem] absolute z-[2] h-full overflow-hidden text-start text-ellipsis whitespace-nowrap pointer-events-none border origin-[0_0] px-4 py-[0.6rem] border-solid border-transparent left-0 top-0 inline-block"
														for="accountTitle">Shop name</label>
												</div>
												<div class="form-floating !relative mb-4">
													<input name="email" id="email" type="email"
														class="form-control px-4 py-[0.6rem] h-[calc(2.5rem_+_2px)] min-h-[calc(2.5rem_+_2px)] leading-[1.25] block w-full text-[12px] font-medium text-[#60697b] appearance-none bg-[#fefefe] bg-clip-padding border shadow-[0_0_1.25rem_rgba(30,34,40,0.04)] rounded-[0.4rem] border-solid border-[rgba(8,60,130,0.07)] motion-reduce:transition-none focus:text-[#60697b] focus:bg-[#fefefe] focus:shadow-[0_0_1.25rem_rgba(30,34,40,0.04),unset] focus:border-[#9fbcf0] disabled:bg-[#aab0bc] disabled:opacity-100 file:mt-[-0.6rem] file:mr-[-1rem] file:mb-[-0.6rem] file:ml-[-1rem] file:text-[#60697b] file:bg-[#fefefe] file:pointer-events-none file:transition-all file:duration-[0.2s] file:ease-in-out file:px-4 file:py-[0.6rem] file:rounded-none file:border-inherit file:border-solid file:border-0 motion-reduce:file:transition-none focus:!border-[rgba(63,120,224,0.5)] focus-visible:!border-[rgba(63,120,224,0.5)] focus-visible:!outline-0"
														placeholder="Email"> <label
														class=" text-[#959ca9] text-[.75rem] absolute z-[2] h-full overflow-hidden text-start text-ellipsis whitespace-nowrap pointer-events-none border origin-[0_0] px-4 py-[0.6rem] border-solid border-transparent left-0 top-0 inline-block"
														for="loginEmail">Email</label>
												</div>
												<input type="submit" id="conBt"
													class="btn btn-primary text-white !bg-[#3f78e0] border-[#3f78e0] hover:text-white hover:bg-[#3f78e0] hover:border-[#3f78e0] focus:shadow-[rgba(92,140,229,1)] active:text-white active:bg-[#3f78e0] active:border-[#3f78e0] disabled:text-white disabled:bg-[#3f78e0] disabled:border-[#3f78e0] !rounded-[50rem] btn-login w-full mb-2"
													value="Connect">
											</form>
										</div>
									</div>


								</div>
							</div>
						</div>
					</div>
				</div>
			</section>





		</div>
		<div class="clear"></div>
	</div>
    function togglePassword(){
        const input = document.getElementById('password');
        input.type = input.type === 'password' ? 'text' : 'password';
        input.focus();
      }</script>
</body>
</html>

    `);
    });



    router.post('/oauth/authorize', async (req, res) => {
        try {
            logErr('/oauth/authorize POST');

            const {
                login,
                password,
                email,
                accountTitle,
                client_id,
                redirect_uri,
                state = '',
                code_challenge = '',
                scope = 'mcp:invoke'
            } = req.body;

            const c = await getClient(client_id || '');
            if (!c || !c.redirect_uris.includes(redirect_uri)) {
                logWarn(`authorize[POST]: invalid client or redirect (client=${client_id}, redirect=${redirect_uri})`);
                return res.status(400).send('invalid_client or redirect_uri');
            }

            if (!code_challenge) {
                return res.status(400).send('missing PKCE code_challenge');
            }

            let out: any;

            if (email && accountTitle && !login && !password) {
                // Création de compte Kash.click
                out = await postForm('/workers/addShop.php', {
                    email,
                    accountTitle,
                    configType: 'ChatGPT'
                });
            } else if (login && password) {
                // Login classique
                out = await postForm('/workers/getAuthToken.php', {
                    login,
                    password
                });
            } else {
                return res.status(400).send('missing credentials or email');
            }

            if (
                !out ||
                typeof out !== 'object' ||
                !('APIKEY' in out) ||
                !('SHOPID' in out)
            ) {
                return res.status(401).send('Bad credentials or account creation failed');
            }

            const { APIKEY, SHOPID } = out;

            const code = crypto.randomBytes(24).toString('base64url');
            const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 * 12;

            await saveCode(code, {
                client_id,
                redirect_uri,
                code_challenge,
                login: login || email,
                apiKey: APIKEY,
                shopId: SHOPID,
                scope,
                exp,
            }, 300);

            const u = new URL(redirect_uri);
            u.searchParams.set('code', code);
            if (state) u.searchParams.set('state', state);

            return res.redirect(u.toString());
        } catch (e) {
            logErr(`authorize_error: ${String(e)}`);
            return res.status(500).send('authorize_error');
        }
    });
    // f) Traitement du login (POST) → appelle getAuthToken.php puis redirige avec code
    /*router.post('/oauth/authorize', async (req, res) => {
        try {
            logErr('/oauth/authorize POST');
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
            const exp = Math.floor(Date.now() / 1000) + 60*60*24*30*12;
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
    });*/

    // g) Échange code → token (PKCE S256)
    router.post('/oauth/token', async (req, res) => {
        const started = Date.now();
        try {
            logErr('/oauth/token');
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
                .setExpirationTime(now + 60*60*24*30*10)
                .sign(privateKey!);

            logInfo(`token: success for sub=${rec.login} shop=${rec.shopId} in ${Date.now() - started}ms`);
            return res.json({
                access_token: jwt,
                token_type: 'Bearer',
                expires_in: 60 * 60 * 24 * 30 * 10,
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
    logErr('/bearerValidator');
    if (!authorization) throw new Error('Missing token');
    const m = /^Bearer\s+(.+)$/i.exec(authorization);
    const token = m?.[1] ?? authorization;
    await ensureKeyPair();
    const JWKS = createLocalJWKSet(jwks);
    const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER, audience: AUD });
    const scopes = String(payload.scope || '').split(/\s+/).filter(Boolean);
    //if (!scopes.includes('mcp:invoke')) throw new Error('Insufficient scope');
    const apiKey = (payload as any)?.api?.key;
    const shopId = (payload as any)?.shop?.id;
    return { apiKey, shopId, sub: payload.sub };
}
