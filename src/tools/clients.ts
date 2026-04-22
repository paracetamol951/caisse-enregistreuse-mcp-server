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
    title: z.string().optional().describe('Honorific or title (e.g. Mr, Mrs, Company)'),
    surname: z.string().optional().describe('Customer surname / last name'),
    name: z.string().optional().describe('Customer first name'),
    position: z.union([z.number(), z.string()]).optional().describe('Sort order / priority within the customer list'),
    email: z.string().email().optional().describe('Customer email address'),
    phone: z.string().optional().describe('Primary phone number'),
    phone2: z.string().optional().describe('Secondary phone number'),
    addressline1: z.string().optional().describe('Street address line 1'),
    addressline2: z.string().optional().describe('Street address line 2'),
    adressComment: z.string().optional().describe('Delivery instructions or address comment'),
    postcode: z.string().optional().describe('Postal/ZIP code'),
    city: z.string().optional().describe('City'),
    country: z.string().optional().describe('Country'),
    identificationID: z.string().optional().describe('National ID or passport number'),
    lat: z.union([z.number(), z.string()]).optional().describe('GPS latitude of the customer address'),
    lng: z.union([z.number(), z.string()]).optional().describe('GPS longitude of the customer address'),
    commentPrivate: z.string().optional().describe('Internal staff-only note'),
    commentPublic: z.string().optional().describe('Note visible to the customer'),
    registrationNumber: z.string().optional().describe('Company registration number (SIRET, etc.)'),
    VATnum: z.string().optional().describe('VAT registration number'),
    barcode: z.string().optional().describe('Customer loyalty card barcode'),
    blacklist: z.union([z.number(), z.string()]).optional().describe('1 to blacklist this customer'),
    clientGroupID: z.union([z.number(), z.string()]).optional().describe('ID of the customer group/segment'),
    birthDate: z.union([z.number(), z.string()]).optional().describe('Date of birth (YYYY-MM-DD or timestamp)'),
    activityCode: z.string().optional().describe('Accounting activity code'),
} satisfies Record<string, ZodTypeAny>;

const AddClientShape = {
    ...ClientDataShape,
} satisfies Record<string, ZodTypeAny>;

const EditClientShape = {
    id: z.union([z.number().int(), z.string()]).describe('ID of the customer to modify'),
    ...ClientDataShape,
} satisfies Record<string, ZodTypeAny>;

const DelClientShape = {
    id: z.union([z.number().int(), z.string()]).describe('ID of the customer to delete'),
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
            title: t('tools.client.add.title'),
            description: t('tools.client.add.description'),
            inputSchema: AddClientShape,
            annotations: { destructiveHint: false, idempotentHint: false },
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
            title: t('tools.client.edit.title'),
            description: t('tools.client.edit.description'),
            inputSchema: EditClientShape,
            annotations: { destructiveHint: false, idempotentHint: true },
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
            title: t('tools.client.delete.title'),
            description: t('tools.client.delete.description'),
            inputSchema: DelClientShape,
            annotations: { destructiveHint: true, idempotentHint: true },
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