import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodTypeAny } from 'zod';
import { postForm } from '../support/http.js';
import { t } from '../i18n/index.js';
import { Ctx, getSessionAuth, setSessionAuth } from '../context.js';

// ✅ Le SDK attend un "shape", pas z.object(...)
const AuthInput = {
  login: z.string(),
  password: z.string(),
} satisfies Record<string, ZodTypeAny>;

type AuthArgs = z.infer<z.ZodObject<typeof AuthInput>>;
type AuthResponse = {
    APIKEY: string;
    SHOPID: string;
};
export function registerAuthTools(server: McpServer | any) {
  server.registerTool(
    'auth_get_token',
    {
      title: t('tools.auth_get_token.title'),
      description: t('tools.auth_get_token.description'),
      inputSchema: AuthInput, // ✅ shape
    },
    async ({ login, password }: { login: string; password: string }, ctx: Ctx) => {
        const data = await postForm('/workers/getAuthToken.php', { login, password });

        if (typeof data === 'object' && data && 'APIKEY' in data && 'SHOPID' in data) {
            /*ctx.auth = {
                ok: true,
                SHOPID: data.SHOPID as string,
                APIKEY: data.APIKEY as string,
                scopes: ['*'], // ou ['sales:read','sales:write'] si tu veux affiner
            };*/
            setSessionAuth({
                ok: true,
                SHOPID: data.SHOPID as string,
                APIKEY: data.APIKEY as string,
                scopes: ['*'], // ou ['sales:read','sales:write']
            });

            // (facultatif) refléter dans le ctx courant aussi
            ctx.auth = getSessionAuth();
        } else {
            console.error('Erreur API:', data);
        }
        const strData = typeof data === 'string'
            ? data
            : JSON.stringify(data, null, 2)
        /*ctx.auth = {
            ok: true,
            data: strData,
            scopes: ['*'], // ou ['sales:read','sales:write'] si tu veux affiner
        };*/    // Marque la session process comme authentifiée (clé du fix)
        


        //process.stderr.write(`[caisse][info] set contxt: ${strData}\n`);
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
    }
  );
}
