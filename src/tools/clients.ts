import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodTypeAny } from 'zod';
import { postForm } from '../support/http.js';
import { t } from '../i18n/index.js';
import { resolveAuth, type Ctx } from '../context.js';

type InferFromShape<S extends Record<string, ZodTypeAny>> = z.infer<z.ZodObject<S>>;

function appendData(body: Record<string, unknown>, fields: Record<string, unknown>) {
    for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined && v !== null) body[`data[${k}]`] = v;
    }
}

// ============================================================
// SHAPES
// ============================================================

const ClientDataShape = {
    title: z.string().optional(),
    surname: z.string().optional(),
    name: z.string().optional(),
    position: z.union([z.number(), z.string()]).optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    phone2: z.string().optional(),
    addressline1: z.string().optional(),
    addressline2: z.string().optional(),
    adressComment: z.string().optional(),
    postcode: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
    identificationID: z.string().optional(),
    lat: z.union([z.number(), z.string()]).optional(),
    lng: z.union([z.number(), z.string()]).optional(),
    commentPrivate: z.string().optional(),
    commentPublic: z.string().optional(),
    registrationNumber: z.string().optional(),
    VATnum: z.string().optional(),
    barcode: z.string().optional(),
    blacklist: z.union([z.number(), z.string()]).optional(),
    clientGroupID: z.union([z.number(), z.string()]).optional(),
    birthDate: z.union([z.number(), z.string()]).optional(),
    activityCode: z.string().optional(),
} satisfies Record<string, ZodTypeAny>;

const AddClientShape = {
    ...ClientDataShape,
} satisfies Record<string, ZodTypeAny>;

const EditClientShape = {
    id: z.union([z.number().int(), z.string()]),
    ...ClientDataShape,
} satisfies Record<string, ZodTypeAny>;

const DelClientShape = {
    id: z.union([z.number().int(), z.string()]),
} satisfies Record<string, ZodTypeAny>;

type AddClientArgs = InferFromShape<typeof AddClientShape>;
type EditClientArgs = InferFromShape<typeof EditClientShape>;
type DelClientArgs = InferFromShape<typeof DelClientShape>;

// ============================================================
// REGISTER
// ============================================================

export function registerClientTools(server: McpServer | any) {

    // -- ADD CLIENT --
    server.registerTool(
        'client_add',
        {
            title: t('tools.client_add.title'),
            description: t('tools.client_add.description'),
            inputSchema: AddClientShape,
        },
        async (input: AddClientArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const body: Record<string, unknown> = { shopID: shopId, key: apiKey };
            appendData(body, input);
            const data = await postForm('/workers/addClient.php', body);
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
                structuredContent: data,
            };
        }
    );

    // -- EDIT CLIENT --
    server.registerTool(
        'client_edit',
        {
            title: t('tools.client_edit.title'),
            description: t('tools.client_edit.description'),
            inputSchema: EditClientShape,
        },
        async (input: EditClientArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const { id, ...rest } = input;
            const body: Record<string, unknown> = { shopID: shopId, key: apiKey, id };
            appendData(body, rest);
            const data = await postForm('/workers/editClient.php', body);
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
                structuredContent: data,
            };
        }
    );

    // -- DELETE CLIENT --
    server.registerTool(
        'client_delete',
        {
            title: t('tools.client_delete.title'),
            description: t('tools.client_delete.description'),
            inputSchema: DelClientShape,
        },
        async (input: DelClientArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const data = await postForm('/workers/delClient.php', {
                shopID: shopId, key: apiKey, id: input.id,
            });
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
                structuredContent: data,
            };
        }
    );
}