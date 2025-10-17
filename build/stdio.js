// src/stdio.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
// ⬇️ IMPORTANT : garde bien les suffixes ".js" car le build ESM référencera build/*.js
import { registerAuthTools } from './tools/auth.js';
import { registerSalesTools } from './tools/sales.js';
import { registerDataTools } from './tools/data.js';
const SESSION = {};
export function setSessionAuth(a) { SESSION.auth = a; }
export function getSessionAuth() { return SESSION.auth; }
export function clearSessionAuth() { delete SESSION.auth; }
/** Vérifie qu'un objet est un ZodRawShape (Record<string, ZodTypeAny>) */
function isZodRawShape(x) {
    if (!x || typeof x !== 'object' || Array.isArray(x))
        return false;
    for (const v of Object.values(x)) {
        if (!v || typeof v !== 'object' || !v._def)
            return false;
    }
    return true;
}
/** Normalise en ZodRawShape ; log si correction appliquée */
function ensureZodRawShape(maybeShape, kind, toolName) {
    if (isZodRawShape(maybeShape))
        return maybeShape;
    process.stderr.write(`[caisse][patch] ${kind} absent/non-ZodRawShape → {} pour ${toolName}\n`);
    return {};
}
async function main() {
    // --- Logs de contexte ---
    try {
        // @ts-ignore
        const __dir = typeof __dirname !== 'undefined' ? __dirname : '(no __dirname)';
        process.stderr.write(`[caisse][path] __dirname=${__dir}\n`);
        process.stderr.write(`[caisse][env] API_BASE=${process.env.API_BASE ?? ''} USE_V2=${process.env.USE_V2 ?? ''}\n`);
    }
    catch { }
    // --- Création du serveur MCP ---
    const server = new McpServer({
        name: 'caisse-enregistreuse-api',
        version: '1.0.0',
    });
    // Wrap de registerTool
    function enforceAuthOnTools(server, whitelist = []) {
        const original = server.registerTool.bind(server);
        server.registerTool = (name, meta, handler) => {
            const guarded = async (args, ctx = {}) => {
                // Réinjecter l’auth de la session dans ce ctx “éphémère”
                const current = getSessionAuth();
                if (current)
                    ctx.auth = current;
                // Autoriser les tools publics
                if (whitelist.includes(name)) {
                    return handler(args, ctx);
                }
                // Protéger les autres
                if (!ctx.auth?.ok) {
                    const err = new Error('Login required (call auth_get_token first)');
                    err.code = -32001;
                    throw err;
                }
                // (Optionnel) Scopes fins par tool
                if (meta?.requiredScopes?.length) {
                    const have = new Set(ctx.auth.scopes || []);
                    const need = meta.requiredScopes;
                    const ok = need.every(s => have.has(s) || have.has('*'));
                    if (!ok) {
                        const err = new Error('Forbidden: missing scope');
                        err.code = -32003;
                        throw err;
                    }
                }
                return handler(args, ctx);
            };
            return original(name, meta, guarded);
        };
    }
    // Activer le guard avec une whitelist minimale
    enforceAuthOnTools(server, [
        //'health.ping',      // public
        'auth_get_token', // public si tu veux que la 1ère étape reste ouverte
        // si tu veux AU CONTRAIRE fermer auth_get_token, enlève-le de la whitelist
    ]);
    // --- Wrapper registerTool : forcera inputSchema/outputSchema en ZodRawShape ---
    const registeredToolNames = [];
    const _registerTool = server.registerTool.bind(server);
    server.registerTool = function (name, meta = {}, handler) {
        meta.inputSchema = ensureZodRawShape(meta.inputSchema, 'inputSchema', name);
        // Si un outputSchema est fourni mais pas conforme, on le normalise.
        if (meta.outputSchema !== undefined) {
            meta.outputSchema = ensureZodRawShape(meta.outputSchema, 'outputSchema', name);
        }
        registeredToolNames.push(name);
        return _registerTool(name, meta, handler);
    };
    // --- Enregistrement des outils métier ---
    try {
        registerAuthTools(server);
        registerSalesTools(server);
        registerDataTools(server);
        process.stderr.write(`[caisse][info] Tools enregistrés (après registerX): ${JSON.stringify(registeredToolNames)}\n`);
    }
    catch (e) {
        process.stderr.write(`[caisse][error] Echec registerXTools: ${e?.stack || e}\n`);
    }
    // --- Tool "ping" minimal (inputSchema sous forme de shape, pas z.object) ---
    server.registerTool('ping', {
        title: 'Ping',
        description: 'Health check du serveur MCP',
        inputSchema: { msg: z.string().optional() }, // ✅ ZodRawShape
    }, async ({ msg }) => ({
        content: [{ type: 'text', text: `pong${msg ? ': ' + msg : ''}` }],
        structuredContent: { ok: true, echo: msg ?? null },
    }));
    process.stderr.write(`[caisse][info] Tools finaux: ${JSON.stringify(registeredToolNames)}\n`);
    // --- Démarrage en STDIO ---
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(`[caisse][info] Server started and connected successfully (stdio)\n`);
}
// --- Garde-fous globaux ---
process.on('unhandledRejection', (err) => {
    process.stderr.write(`[caisse][fatal] UnhandledRejection: ${err?.stack || err}\n`);
});
process.on('uncaughtException', (err) => {
    process.stderr.write(`[caisse][fatal] UncaughtException: ${err?.stack || err}\n`);
});
main().catch((e) => {
    process.stderr.write(`[caisse][fatal] main() failed: ${e?.stack || e}\n`);
    process.exit(1);
});
