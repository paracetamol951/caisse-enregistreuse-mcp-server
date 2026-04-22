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
    title: z.string().optional().describe('Product display name'),
    shortTitle: z.string().optional().describe('Short label shown on receipt or keyboard'),
    description: z.string().optional().describe('Full product description'),
    buyingPrice: z.union([z.number(), z.string()]).optional().describe('Cost/buying price (for margin calculation)'),
    price: z.union([z.number(), z.string()]).optional().describe('Selling price'),
    calories: z.union([z.number(), z.string()]).optional().describe('Calorie count'),
    weight: z.union([z.number(), z.string()]).optional().describe('Product weight'),
    unitID: z.union([z.number(), z.string()]).optional().describe('Unit of measure ID (e.g. kg, litre)'),
    variationID0: z.union([z.number(), z.string()]).optional().describe('Variation type ID for slot 0'),
    variationID1: z.union([z.number(), z.string()]).optional().describe('Variation type ID for slot 1'),
    variationID2: z.union([z.number(), z.string()]).optional().describe('Variation type ID for slot 2'),
    variationID3: z.union([z.number(), z.string()]).optional().describe('Variation type ID for slot 3'),
    variationID4: z.union([z.number(), z.string()]).optional().describe('Variation type ID for slot 4'),
    deptID: z.union([z.number(), z.string()]).optional().describe('Parent department ID'),
    supplierID: z.union([z.number(), z.string()]).optional().describe('Supplier ID'),
    vatID: z.union([z.number(), z.string()]).optional().describe('VAT rate ID for takeaway/standard sales'),
    eatinvatID: z.union([z.number(), z.string()]).optional().describe('VAT rate ID for eat-in sales'),
    discountID: z.union([z.number(), z.string()]).optional().describe('Default discount ID applied to this product'),
    barcode: z.string().optional().describe('Product barcode (EAN, QR, etc.)'),
    stock: z.union([z.number(), z.string()]).optional().describe('Current stock quantity'),
    stockAlert: z.union([z.number(), z.string()]).optional().describe('Low-stock alert threshold'),
    consumptionDate: z.string().optional().describe('Expiry/consumption date'),
    shopHide: z.union([z.number(), z.string()]).optional().describe('1 to hide from online shop, 0 to show'),
    keyboardHide: z.union([z.number(), z.string()]).optional().describe('1 to hide from POS keyboard, 0 to show'),
    needPrepa: z.union([z.number(), z.string()]).optional().describe('1 if product requires kitchen preparation'),
    prepaLength: z.union([z.number(), z.string()]).optional().describe('Estimated preparation time in minutes'),
    position: z.union([z.number(), z.string()]).optional().describe('Display position/order on keyboard'),
    activityCode: z.string().optional().describe('Accounting activity code'),
    internalID: z.string().optional().describe('Internal reference or SKU'),
} satisfies Record<string, ZodTypeAny>;

const EditPluShape = {
    id: z.union([z.number().int(), z.string()]).describe('ID of the product to modify'),
    ...PluDataShape,
} satisfies Record<string, ZodTypeAny>;

const DelPluShape = {
    id: z.union([z.number().int(), z.string()]).describe('ID of the product to delete'),
} satisfies Record<string, ZodTypeAny>;

const DeptDataShape = {
    title: z.string().optional().describe('Department/category display name'),
    shortTitle: z.string().optional().describe('Short label for receipt or keyboard'),
    stock: z.union([z.number(), z.string()]).optional().describe('Stock quantity override at department level'),
    vatID: z.union([z.number(), z.string()]).optional().describe('Default VAT rate ID for this department'),
    eatinvatID: z.union([z.number(), z.string()]).optional().describe('Eat-in VAT rate ID'),
    discountID: z.union([z.number(), z.string()]).optional().describe('Default discount ID'),
    price: z.union([z.number(), z.string()]).optional().describe('Default price for free-price items'),
    keyboardHide: z.union([z.number(), z.string()]).optional().describe('1 to hide from POS keyboard'),
    shopHide: z.union([z.number(), z.string()]).optional().describe('1 to hide from online shop'),
    position: z.union([z.number(), z.string()]).optional().describe('Display order on keyboard'),
    deptGroupID: z.union([z.number(), z.string()]).optional().describe('Department group this department belongs to'),
    unitID: z.union([z.number(), z.string()]).optional().describe('Unit of measure ID'),
    needPrepa: z.union([z.number(), z.string()]).optional().describe('1 if items require kitchen preparation'),
    variationID0: z.union([z.number(), z.string()]).optional().describe('Variation type ID for slot 0'),
    variationID1: z.union([z.number(), z.string()]).optional().describe('Variation type ID for slot 1'),
    variationID2: z.union([z.number(), z.string()]).optional().describe('Variation type ID for slot 2'),
    variationID3: z.union([z.number(), z.string()]).optional().describe('Variation type ID for slot 3'),
    variationID4: z.union([z.number(), z.string()]).optional().describe('Variation type ID for slot 4'),
    activityCode: z.string().optional().describe('Accounting activity code'),
} satisfies Record<string, ZodTypeAny>;

const EditDeptShape = {
    id: z.union([z.number().int(), z.string()]).describe('ID of the department to modify'),
    ...DeptDataShape,
} satisfies Record<string, ZodTypeAny>;

const DelDeptShape = {
    id: z.union([z.number().int(), z.string()]).describe('ID of the department to delete'),
} satisfies Record<string, ZodTypeAny>;

type AddPluArgs = InferFromShape<typeof PluDataShape>;
type EditPluArgs = InferFromShape<typeof EditPluShape>;
type DelPluArgs = InferFromShape<typeof DelPluShape>;


type AddDeptArgs = InferFromShape<typeof DeptDataShape>;
type EditDeptArgs = InferFromShape<typeof EditDeptShape>;
type DelDeptArgs = InferFromShape<typeof DelDeptShape>;

// ============================================================
// REGISTER
// ============================================================

export function registerCatalogTools(server: McpServer | any) {

    // ---- ARTICLES ----

    server.registerTool(
        'plu.add',
        {
            title: t('tools.plu.add.title'),
            description: t('tools.plu.add.description'),
            inputSchema: PluDataShape, 
            annotations: { destructiveHint: false, idempotentHint: false },
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
        'plu.edit',
        {
            title: t('tools.plu.edit.title'),
            description: t('tools.plu.edit.description'),
            inputSchema: EditPluShape,
            annotations: { destructiveHint: false, idempotentHint: true },
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
        'plu.delete',
        {
            title: t('tools.plu.delete.title'),
            description: t('tools.plu.delete.description'),
            inputSchema: DelPluShape,
            annotations: { destructiveHint: true, idempotentHint: true },
        },
        async (input: DelPluArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const data = await postForm('/workers/delPlu.php', { shopID: shopId, key: apiKey, id: input.id });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
        }
    );

    // ---- DEPARTMENTS ----

    server.registerTool(
        'dept.add',
        {
            title: t('tools.dept.add.title'),
            description: t('tools.dept.add.description'),
            inputSchema: DeptDataShape,
            annotations: { destructiveHint: false, idempotentHint: false },
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
        'dept.edit',
        {
            title: t('tools.dept.edit.title'),
            description: t('tools.dept.edit.description'),
            inputSchema: EditDeptShape,
            annotations: { destructiveHint: false, idempotentHint: true },
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
        'dept.delete',
        {
            title: t('tools.dept.delete.title'),
            description: t('tools.dept.delete.description'),
            inputSchema: DelDeptShape,
            annotations: { destructiveHint: true, idempotentHint: true },
        },
        async (input: DelDeptArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const data = await postForm('/workers/delDept.php', { shopID: shopId, key: apiKey, id: input.id });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
        }
    );
}