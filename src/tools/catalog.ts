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
// ARTICLE (PLU)
// ============================================================

const PluDataShape = {
    title: z.string().optional(),
    shortTitle: z.string().optional(),
    description: z.string().optional(),
    buyingPrice: z.union([z.number(), z.string()]).optional(),
    price: z.union([z.number(), z.string()]).optional(),
    calories: z.union([z.number(), z.string()]).optional(),
    weight: z.union([z.number(), z.string()]).optional(),
    unitID: z.union([z.number(), z.string()]).optional(),
    variationID0: z.union([z.number(), z.string()]).optional(),
    variationID1: z.union([z.number(), z.string()]).optional(),
    variationID2: z.union([z.number(), z.string()]).optional(),
    variationID3: z.union([z.number(), z.string()]).optional(),
    variationID4: z.union([z.number(), z.string()]).optional(),
    deptID: z.union([z.number(), z.string()]).optional(),
    supplierID: z.union([z.number(), z.string()]).optional(),
    vatID: z.union([z.number(), z.string()]).optional(),
    eatinvatID: z.union([z.number(), z.string()]).optional(),
    discountID: z.union([z.number(), z.string()]).optional(),
    barcode: z.string().optional(),
    stock: z.union([z.number(), z.string()]).optional(),
    stockAlert: z.union([z.number(), z.string()]).optional(),
    consumptionDate: z.string().optional(),
    shopHide: z.union([z.number(), z.string()]).optional(),
    keyboardHide: z.union([z.number(), z.string()]).optional(),
    needPrepa: z.union([z.number(), z.string()]).optional(),
    prepaLength: z.union([z.number(), z.string()]).optional(),
    position: z.union([z.number(), z.string()]).optional(),
    activityCode: z.string().optional(),
    internalID: z.string().optional(),
} satisfies Record<string, ZodTypeAny>;


const EditPluShape = {
    id: z.union([z.number().int(), z.string()]),
    ...PluDataShape,
} satisfies Record<string, ZodTypeAny>;

const DelPluShape = {
    id: z.union([z.number().int(), z.string()]),
} satisfies Record<string, ZodTypeAny>;

type AddPluArgs = InferFromShape<typeof PluDataShape>;
type EditPluArgs = InferFromShape<typeof EditPluShape>;
type DelPluArgs = InferFromShape<typeof DelPluShape>;

// ============================================================
// DEPARTMENT
// ============================================================

const DeptDataShape = {
    title: z.string().optional(),
    shortTitle: z.string().optional(),
    stock: z.union([z.number(), z.string()]).optional(),
    vatID: z.union([z.number(), z.string()]).optional(),
    eatinvatID: z.union([z.number(), z.string()]).optional(),
    discountID: z.union([z.number(), z.string()]).optional(),
    price: z.union([z.number(), z.string()]).optional(),
    keyboardHide: z.union([z.number(), z.string()]).optional(),
    shopHide: z.union([z.number(), z.string()]).optional(),
    position: z.union([z.number(), z.string()]).optional(),
    deptGroupID: z.union([z.number(), z.string()]).optional(),
    unitID: z.union([z.number(), z.string()]).optional(),
    needPrepa: z.union([z.number(), z.string()]).optional(),
    variationID0: z.union([z.number(), z.string()]).optional(),
    variationID1: z.union([z.number(), z.string()]).optional(),
    variationID2: z.union([z.number(), z.string()]).optional(),
    variationID3: z.union([z.number(), z.string()]).optional(),
    variationID4: z.union([z.number(), z.string()]).optional(),
    activityCode: z.string().optional(),
} satisfies Record<string, ZodTypeAny>;

const EditDeptShape = {
    id: z.union([z.number().int(), z.string()]),
    ...DeptDataShape,
} satisfies Record<string, ZodTypeAny>;

const DelDeptShape = {
    id: z.union([z.number().int(), z.string()]),
} satisfies Record<string, ZodTypeAny>;

type AddDeptArgs = InferFromShape<typeof DeptDataShape>;
type EditDeptArgs = InferFromShape<typeof EditDeptShape>;
type DelDeptArgs = InferFromShape<typeof DelDeptShape>;

// ============================================================
// REGISTER
// ============================================================

export function registerCatalogTools(server: McpServer | any) {

    // ---- ARTICLES ----

    server.registerTool(
        'plu_add',
        {
            title: t('tools.plu_add.title'),
            description: t('tools.plu_add.description'),
            inputSchema: PluDataShape,
        },
        async (input: AddPluArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const { title, ...rest } = input;
            const body: Record<string, unknown> = { shopID: shopId, key: apiKey, 'data[title]': title };
            appendData(body, rest);
            const data = await postForm('/workers/addPlu.php', body);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
        }
    );

    server.registerTool(
        'plu_edit',
        {
            title: t('tools.plu_edit.title'),
            description: t('tools.plu_edit.description'),
            inputSchema: EditPluShape,
        },
        async (input: EditPluArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const { id, ...rest } = input;
            const body: Record<string, unknown> = { shopID: shopId, key: apiKey, id };
            appendData(body, rest);
            const data = await postForm('/workers/editPlu.php', body);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
        }
    );

    server.registerTool(
        'plu_delete',
        {
            title: t('tools.plu_delete.title'),
            description: t('tools.plu_delete.description'),
            inputSchema: DelPluShape,
        },
        async (input: DelPluArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const data = await postForm('/workers/delPlu.php', { shopID: shopId, key: apiKey, id: input.id });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
        }
    );

    // ---- DEPARTMENTS ----

    server.registerTool(
        'dept_add',
        {
            title: t('tools.dept_add.title'),
            description: t('tools.dept_add.description'),
            inputSchema: DeptDataShape,
        },
        async (input: AddDeptArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const { title, ...rest } = input;
            const body: Record<string, unknown> = { shopID: shopId, key: apiKey, 'data[title]': title };
            appendData(body, rest);
            const data = await postForm('/workers/addDept.php', body);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
        }
    );

    server.registerTool(
        'dept_edit',
        {
            title: t('tools.dept_edit.title'),
            description: t('tools.dept_edit.description'),
            inputSchema: EditDeptShape,
        },
        async (input: EditDeptArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const { id, ...rest } = input;
            const body: Record<string, unknown> = { shopID: shopId, key: apiKey, id };
            appendData(body, rest);
            const data = await postForm('/workers/editDept.php', body);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
        }
    );

    server.registerTool(
        'dept_delete',
        {
            title: t('tools.dept_delete.title'),
            description: t('tools.dept_delete.description'),
            inputSchema: DelDeptShape,
        },
        async (input: DelDeptArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const data = await postForm('/workers/delDept.php', { shopID: shopId, key: apiKey, id: input.id });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
        }
    );
}