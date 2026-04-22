import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodTypeAny } from 'zod';
import { postForm } from '../support/http.js';
import { t } from '../i18n/index.js';
import { resolveAuth, type Ctx } from '../context.js';

type InferFromShape<S extends Record<string, ZodTypeAny>> = z.infer<z.ZodObject<S>>;

const AddVatShape = {
    title: z.string().describe("Name/label for the VAT rate (e.g. 'Standard 20%')"),
    rate: z.union([z.number(), z.string()]).describe('VAT percentage rate (e.g. 20 for 20%)'),
    accountingChapter: z.string().optional().describe('Accounting chapter code for this VAT rate'),
    legal: z.string().optional().describe('Legal reference or note for this VAT rate'),
} satisfies Record<string, ZodTypeAny>;

const EditVatShape = {
    id: z.union([z.number().int(), z.string()]).describe('ID of the VAT rate to modify'),
    title: z.string().optional().describe("Name/label for the VAT rate (e.g. 'Standard 20%')"),
    rate: z.union([z.number(), z.string()]).optional().describe('VAT percentage rate (e.g. 20 for 20%)'),
    accountingChapter: z.string().optional().describe('Accounting chapter code for this VAT rate'),
    legal: z.string().optional().describe('Legal reference or note for this VAT rate'),
} satisfies Record<string, ZodTypeAny>;

const DelVatShape = {
    id: z.union([z.number().int(), z.string()]).describe('ID of the VAT rate to delete'),
} satisfies Record<string, ZodTypeAny>;

type AddVatArgs = InferFromShape<typeof AddVatShape>;
type EditVatArgs = InferFromShape<typeof EditVatShape>;
type DelVatArgs = InferFromShape<typeof DelVatShape>;

export function registerVatTools(server: McpServer | any) {

    server.registerTool(
        'vat_add',
        {
            title: t('tools.vat.add.title'),
            description: t('tools.vat.add.description'),
            inputSchema: AddVatShape,
            annotations: { destructiveHint: false, idempotentHint: false },
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
            title: t('tools.vat.edit.title'),
            description: t('tools.vat.edit.description'),
            inputSchema: EditVatShape,
            annotations: { destructiveHint: false, idempotentHint: true },
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
            title: t('tools.vat.delete.title'),
            description: t('tools.vat.delete.description'),
            inputSchema: DelVatShape,
            annotations: { destructiveHint: true, idempotentHint: true },
        },
        async (input: DelVatArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const data = await postForm('/workers/delVat.php', { shopID: shopId, key: apiKey, id: input.id });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
        }
    );
}