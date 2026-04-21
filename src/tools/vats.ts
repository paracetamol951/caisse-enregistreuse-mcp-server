import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodTypeAny } from 'zod';
import { postForm } from '../support/http.js';
import { t } from '../i18n/index.js';
import { resolveAuth, type Ctx } from '../context.js';

type InferFromShape<S extends Record<string, ZodTypeAny>> = z.infer<z.ZodObject<S>>;

const AddVatShape = {
    title: z.string(),
    rate: z.union([z.number(), z.string()]),
    accountingChapter: z.string().optional(),
    legal: z.string().optional(),
} satisfies Record<string, ZodTypeAny>;

const EditVatShape = {
    id: z.union([z.number().int(), z.string()]),
    title: z.string().optional(),
    rate: z.union([z.number(), z.string()]).optional(),
    accountingChapter: z.string().optional(),
    legal: z.string().optional(),
} satisfies Record<string, ZodTypeAny>;

const DelVatShape = {
    id: z.union([z.number().int(), z.string()]),
} satisfies Record<string, ZodTypeAny>;

type AddVatArgs = InferFromShape<typeof AddVatShape>;
type EditVatArgs = InferFromShape<typeof EditVatShape>;
type DelVatArgs = InferFromShape<typeof DelVatShape>;

export function registerVatTools(server: McpServer | any) {

    server.registerTool(
        'vat_add',
        {
            title: t('tools.vat_add.title'),
            description: t('tools.vat_add.description'),
            inputSchema: AddVatShape,
        },
        async (input: AddVatArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const body: Record<string, unknown> = {
                shopID: shopId, key: apiKey,
                'data[title]': input.title,
                'data[rate]': input.rate,
            };
            if (input.accountingChapter !== undefined) body['data[accountingChapter]'] = input.accountingChapter;
            if (input.legal !== undefined) body['data[legal]'] = input.legal;
            const data = await postForm('/workers/addVat.php', body);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
        }
    );

    server.registerTool(
        'vat_edit',
        {
            title: t('tools.vat_edit.title'),
            description: t('tools.vat_edit.description'),
            inputSchema: EditVatShape,
        },
        async (input: EditVatArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const body: Record<string, unknown> = { shopID: shopId, key: apiKey, id: input.id };
            if (input.title !== undefined) body['data[title]'] = input.title;
            if (input.rate !== undefined) body['data[rate]'] = input.rate;
            if (input.accountingChapter !== undefined) body['data[accountingChapter]'] = input.accountingChapter;
            if (input.legal !== undefined) body['data[legal]'] = input.legal;
            const data = await postForm('/workers/editVat.php', body);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
        }
    );

    server.registerTool(
        'vat_delete',
        {
            title: t('tools.vat_delete.title'),
            description: t('tools.vat_delete.description'),
            inputSchema: DelVatShape,
        },
        async (input: DelVatArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const data = await postForm('/workers/delVat.php', { shopID: shopId, key: apiKey, id: input.id });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
        }
    );
}