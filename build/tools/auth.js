import { z } from 'zod';
import { postForm } from '../support/http.js';
import { getSessionAuth, setSessionAuth } from '../stdio.js';
import { t } from '../i18n/index.js';
// ✅ Le SDK attend un "shape", pas z.object(...)
const AuthInput = {
    login: z.string(),
    password: z.string(),
};
export function registerAuthTools(server) {
    server.registerTool('auth_get_token', {
        title: t('tools.auth_get_token.title'),
        description: t('tools.auth_get_token.description'),
        inputSchema: AuthInput, // ✅ shape
    }, async ({ login, password }, ctx) => {
        const data = await postForm('/workers/getAuthToken.php', { login, password });
        if (typeof data !== 'string' && 'APIKEY' in data && 'SHOPID' in data) {
            /*ctx.auth = {
                ok: true,
                SHOPID: data.SHOPID as string,
                APIKEY: data.APIKEY as string,
                scopes: ['*'], // ou ['sales:read','sales:write'] si tu veux affiner
            };*/
            setSessionAuth({
                ok: true,
                SHOPID: data.SHOPID,
                APIKEY: data.APIKEY,
                scopes: ['*'], // ou ['sales:read','sales:write']
            });
            // (facultatif) refléter dans le ctx courant aussi
            ctx.auth = getSessionAuth();
        }
        else {
            console.error('Erreur API:', data);
        }
        const strData = typeof data === 'string'
            ? data
            : JSON.stringify(data, null, 2);
        /*ctx.auth = {
            ok: true,
            data: strData,
            scopes: ['*'], // ou ['sales:read','sales:write'] si tu veux affiner
        };*/ // Marque la session process comme authentifiée (clé du fix)
        process.stderr.write(`[caisse][info] set contxt: ${strData}\n`);
        return {
            content: [
                {
                    type: 'text',
                    text: strData,
                },
            ],
            structuredContent: data, // on garde pour usage programmatique
        };
        //return { content: [{ type: 'json', json: data }], structuredContent: data };
    });
}
