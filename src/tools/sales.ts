import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodTypeAny } from 'zod';
import { get, postForm, postJsonRaw } from '../support/http.js';
import { t } from '../i18n/index.js';
import { resolveAuth, type Ctx } from '../context.js';

type InferFromShape<S extends Record<string, ZodTypeAny>> = z.infer<z.ZodObject<S>>;

// ============================================================
// SHARED SHAPES
// ============================================================

/** Item de vente : soit du catalogue, soit un rayon, soit une ligne libre */
const SalesItemShape = {
    type: z.enum(['catalog', 'dept', 'free']).default('catalog'),
    productId: z.string().optional(),
    quantity: z.union([z.number(), z.string()]).optional(),
    titleOverride: z.string().optional(),
    priceOverride: z.union([z.number(), z.string()]).optional(),
    declinaisons: z.array(z.string()).optional(),
    departmentId: z.union([z.string(), z.number()]).optional(),
    price: z.union([z.number(), z.string()]).optional(),
    title: z.string().optional(),
} satisfies Record<string, ZodTypeAny>;

const ClientShape = {
    firstname: z.string().optional(),
    lastname: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    zip: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
} satisfies Record<string, ZodTypeAny>;

// ============================================================
// SALE CREATE SHAPE
// ============================================================

const SalesCreateShape = {
    payment: z.union([z.number(), z.string()]).transform((v) => Number(v)).optional(),
    deliveryMethod: z.union([
        z.number().int().min(0).max(6),
        z.enum(['0', '1', '2', '3', '4', '5', '6'])
    ]).transform((v) => Number(v)).optional(),
    idtable: z.union([z.number().int(), z.string()]).optional(),
    idcaisse: z.union([z.number().int(), z.string()]).optional(),
    numcouverts: z.union([z.number().int(), z.string()]).optional(),
    publicComment: z.string().optional(),
    privateComment: z.string().optional(),
    pagerNum: z.union([z.number().int(), z.string()]).optional(),
    idUser: z.union([z.number().int(), z.string()]).optional(),
    idClient: z.union([z.number().int(), z.string()]).optional(),
    client: z.object(ClientShape).partial().optional(),
    items: z.array(z.object(SalesItemShape)).min(1),
} satisfies Record<string, ZodTypeAny>;

// ============================================================
// ORDER EDIT SHAPE
// ============================================================

const OrderEditShape = {
    orderID: z.number().int(),
    // payment: -2 = not paid/not validated, -1 = not paid/validated,
    //          or a payment method ID to record an actual payment
    payment: z.union([
        z.literal(-2),
        z.literal(-1),
        z.number().int(),
        z.string(),
    ]).describe(
        '-2 = not paid, not validated | -1 = not paid, validated (invoice) | payment method ID = record a payment'
    ),
    paymentAmount: z.union([z.number(), z.string()]).optional(),
    idUser: z.union([z.number().int(), z.string()]).optional(),
    idClient: z.union([z.number().int(), z.string()]).optional(),
    client: z.object(ClientShape).partial().optional(),
    idtable: z.union([z.number().int(), z.string()]).optional(),
    idcaisse: z.union([z.number().int(), z.string()]).optional(),
    numcouverts: z.union([z.number().int(), z.string()]).optional(),
    publicComment: z.string().optional(),
    privateComment: z.string().optional(),
    pagerNum: z.union([z.number().int(), z.string()]).optional(),
    deliveryMethod: z.union([
        z.number().int().min(0).max(6),
        z.enum(['0', '1', '2', '3', '4', '5', '6'])
    ]).transform((v) => Number(v)).optional(),
    // items only usable on unvalidated orders
    items: z.array(z.object(SalesItemShape)).optional(),
} satisfies Record<string, ZodTypeAny>;

type SalesCreateArgs = InferFromShape<typeof SalesCreateShape>;
type OrderEditArgs = InferFromShape<typeof OrderEditShape>;


const GetReportShape = {
    d: z.number().int().min(1).max(31).optional(),
    m: z.number().int().min(1).max(12).optional(),
    y: z.number().int().min(2010).optional(),
} satisfies Record<string, ZodTypeAny>;

type GetReportArgs = InferFromShape<typeof GetReportShape>;

// ============================================================
// HELPER: encode items to legacy itemsList[] format
// ============================================================

function encodeItemsList(items: SalesCreateArgs['items']): string[] {
    const out: string[] = [];
    for (const it of items) {
        if (it.type === 'catalog') {
            const parts: (string | number)[] = [
                it.productId ?? '',
                it.quantity ?? 1,
                it.titleOverride ?? '',
                it.priceOverride ?? '',
            ];
            if (it.declinaisons?.length) parts.push(...it.declinaisons);
            out.push(parts.join('_'));
        } else if (it.type === 'free') {
            out.push(['Free', it.priceOverride ?? '', it.titleOverride ?? ''].join('_'));
        } else {
            out.push(`-${it.departmentId ?? ''}_${it.price ?? ''}_${it.title ?? ''}`);
        }
    }
    return out;
}

// ============================================================
// REGISTER
// ============================================================

export function registerSalesTools(server: McpServer | any) {

    server.registerTool(
        'report_get',
        {
            title: t('tools.report_get.title'),
            description: t('tools.report_get.description'),
            inputSchema: GetReportShape,
            annotations: { readOnlyHint: true },
        },
        async (input: GetReportArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);

            const params: Record<string, unknown> = {
                shopID: shopId,
                key: apiKey,
                formatExport: 'Std', // HTML report — only text-compatible format exposed
            };
            if (input.d !== undefined) params.d = input.d;
            if (input.m !== undefined) params.m = input.m;
            if (input.y !== undefined) params.y = input.y;

            const data = await get('/workers/getSales.php', params);
            const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
            return {
                content: [{ type: 'text', text }],
                structuredContent: typeof data === 'string' ? { report: data } : data,
            };
        }
    );
    // -- SALE CREATE --
    server.registerTool(
        'sale_create',
        {
            title: t('tools.sale_create.title'),
            description: t('tools.sale_create.description'),
            inputSchema: SalesCreateShape,
        },
        async (input: SalesCreateArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const body: Record<string, unknown> = { idboutique: shopId, key: apiKey };

            if (input.payment !== undefined) body.payment = input.payment;
            if (input.deliveryMethod !== undefined) body.deliveryMethod = String(input.deliveryMethod);
            if (input.idUser !== undefined) body.idUser = input.idUser;
            if (input.idtable !== undefined) body.idtable = input.idtable;
            if (input.idcaisse !== undefined) body.idcaisse = input.idcaisse;
            if (input.numcouverts !== undefined) body.numcouverts = input.numcouverts;
            if (input.publicComment !== undefined) body.publicComment = input.publicComment;
            if (input.privateComment !== undefined) body.privateComment = input.privateComment;
            if (input.pagerNum !== undefined) body.pagerNum = input.pagerNum;
            if (input.idClient !== undefined) {
                body.idClient = input.idClient;
            } else if (input.client) {
                for (const [k, v] of Object.entries(input.client)) {
                    if (v !== undefined && v !== null && v !== '') body[`client[${k}]`] = String(v);
                }
            }
            body['itemsList[]'] = encodeItemsList(input.items);

            const data = await postForm('/workers/webapp.php', body);
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
                structuredContent: data,
            };
        }
    );

    // -- ORDER EDIT --
    server.registerTool(
        'order_edit',
        {
            title: t('tools.order_edit.title'),
            description: t('tools.order_edit.description'),
            inputSchema: OrderEditShape,
        },
        async (input: OrderEditArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const body: Record<string, unknown> = {
                shopID: shopId,
                key: apiKey,
                orderID: input.orderID,
                payment: input.payment,
            };

            if (input.paymentAmount !== undefined) body.paymentAmount = input.paymentAmount;
            if (input.idUser !== undefined) body.idUser = input.idUser;
            if (input.idtable !== undefined) body.idtable = input.idtable;
            if (input.idcaisse !== undefined) body.idcaisse = input.idcaisse;
            if (input.numcouverts !== undefined) body.numcouverts = input.numcouverts;
            if (input.publicComment !== undefined) body.publicComment = input.publicComment;
            if (input.privateComment !== undefined) body.privateComment = input.privateComment;
            if (input.pagerNum !== undefined) body.pagerNum = input.pagerNum;
            if (input.deliveryMethod !== undefined) body.deliveryMethod = String(input.deliveryMethod);
            if (input.idClient !== undefined) {
                body.idClient = input.idClient;
            } else if (input.client) {
                for (const [k, v] of Object.entries(input.client)) {
                    if (v !== undefined && v !== null && v !== '') body[`client[${k}]`] = String(v);
                }
            }
            if (input.items?.length) {
                body['itemsList[]'] = encodeItemsList(input.items);
            }

            const data = await postForm('/workers/editOrder.php', body);
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
                structuredContent: data,
            };
        }
    );
}