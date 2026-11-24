import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodTypeAny } from 'zod';
import { get, postSaleForm, saleWriteError } from '../support/http.js';
import { t } from '../i18n/index.js';
import { resolveAuth, type Ctx } from '../context.js';

type InferFromShape<S extends Record<string, ZodTypeAny>> = z.infer<z.ZodObject<S>>;

// ============================================================
// SHARED SHAPES
// ============================================================

const SalesItemShape = {
    type: z.enum(['catalog', 'dept', 'free']).default('catalog').describe("Item type: 'catalog' for a PLU product, 'dept' for a department item, 'free' for a free-text line"),
    productId: z.string().optional().describe("PLU product ID (required for type 'catalog')"),
    quantity: z.union([z.number(), z.string()]).optional().describe('Item quantity (default 1)'),
    titleOverride: z.string().optional().describe('Override the product title on the receipt'),
    priceOverride: z.union([z.number(), z.string()]).optional().describe('Override the unit price'),
    declinaisons: z.array(z.string()).optional().describe('Array of variation choice IDs applied to this item'),
    departmentId: z.union([z.string(), z.number()]).optional().describe("Department ID (required for type 'dept')"),
    price: z.union([z.number(), z.string()]).optional().describe("Unit price (required for type 'free' or 'dept')"),
    title: z.string().optional().describe("Item label (required for type 'free')"),
} satisfies Record<string, ZodTypeAny>;

const saleItemId = z.union([z.string(), z.number().int().safe()]).transform(String).pipe(z.string().regex(/^[1-9][0-9]{0,18}$/));
const saleItemDecimal = z.union([z.string(), z.number()]).transform((value) => String(value).replace(',', '.'))
    .pipe(z.string().regex(/^-?[0-9]{1,10}(?:\.[0-9]{1,8})?$/));
const saleItemLabel = z.string().trim().min(1).max(1000).regex(/^[^_\u0000]+$/);

export const oauthSalesItem = z.union([
    z.object({
        type: z.literal('catalog').default('catalog'),
        productId: saleItemId.describe('Kash product ID'),
        quantity: saleItemDecimal.optional().describe('Quantity, defaults to one'),
        titleOverride: saleItemLabel.optional().describe('Custom receipt label, without underscores'),
        priceOverride: saleItemDecimal.optional().describe('Custom unit price'),
        declinaisons: z.array(saleItemId).max(5).optional().describe('IDs of the selected variation choices'),
    }),
    z.object({
        type: z.literal('dept'),
        departmentId: saleItemId.describe('Kash department ID'),
        price: saleItemDecimal.describe('Unit price'),
        title: saleItemLabel.describe('Receipt label, without underscores'),
    }),
    z.object({
        type: z.literal('free'),
        price: saleItemDecimal.describe('Unit price'),
        title: saleItemLabel.describe('Receipt label, without underscores'),
    }),
]);

const ClientShape = {
    firstname: z.string().optional().describe('Customer first name'),
    lastname: z.string().optional().describe('Customer last name'),
    email: z.string().email().optional().describe('Customer email address'),
    phone: z.string().optional().describe('Customer phone number'),
    address: z.string().optional().describe('Customer street address'),
    zip: z.string().optional().describe('Customer postal/ZIP code'),
    city: z.string().optional().describe('Customer city'),
    country: z.string().optional().describe('Customer country'),
} satisfies Record<string, ZodTypeAny>;

export function saleAddsInlineClient(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const { idClient, client } = value as { idClient?: unknown; client?: Record<string, unknown> };
    return idClient === undefined && !!client && typeof client === 'object'
        && Object.keys(ClientShape).some((key) => typeof client[key] === 'string' && client[key] !== '');
}

export const saleIdempotencyKey = z.string().regex(/^[A-Za-z0-9._~-]{16,128}$/)
    .describe('Unique ID for this operation, such as a UUID. After a timeout, retry with the same key and arguments. Use a new key for each distinct operation.');

const paymentAmount = z.union([z.number().nonnegative(), z.string()]).transform(String)
    .pipe(z.string().regex(/^[0-9]{1,10}(?:\.[0-9]{1,8})?$/)).optional()
    .describe('Amount collected, including for a partial payment (for example 12.50). With a positive payment method, supply an amount greater than zero or omit it to use the worker default.');

const salePaymentMode = z.union([
    z.number().int().safe().min(-2),
    z.string().regex(/^(?:-2|-1|0|[1-9][0-9]{0,18})$/),
]);

export const oauthSaleCreatePayment = z.union([
    z.number().int().safe().nonnegative(),
    z.string().regex(/^(?:0|[1-9][0-9]{0,18})$/),
]).optional().describe('Kash payment method ID. Omit or use 0 to save an unpaid quote.');

const SalesCreateShape = {
    idempotencyKey: saleIdempotencyKey,
    payment: salePaymentMode.optional()
        .describe('Omit or use 0 or -2 for an unpaid quote, -1 for an unpaid invoice, or a positive Kash payment method ID to record payment.'),
    paymentAmount,
    deliveryMethod: z.union([
        z.number().int().min(0).max(6),
        z.enum(['0', '1', '2', '3', '4', '5', '6'])
    ]).transform((v) => Number(v)).optional().describe('Delivery method: 0=takeaway, 1=delivery, 2=on-site, 3=drive, 4=relay, 5=table service, 6=room service'),
    idtable: z.union([z.number().int(), z.string()]).optional().describe('Table ID for table-service orders'),
    idcaisse: z.union([z.number().int(), z.string()]).optional().describe('Cash register ID'),
    numcouverts: z.union([z.number().int(), z.string()]).optional().describe('Number of covers/guests'),
    publicComment: z.string().optional().describe('Comment visible on the receipt'),
    privateComment: z.string().optional().describe('Internal staff-only comment'),
    pagerNum: z.union([z.number().int(), z.string()]).optional().describe('Pager/buzzer number for the customer'),
    idUser: z.union([z.number().int(), z.string()]).optional().describe('Staff member ID to assign the sale to'),
    idClient: z.union([z.number().int(), z.string()]).optional().describe('Existing customer ID (alternative to inline client object)'),
    client: z.object(ClientShape).partial().optional().describe('Inline customer details (used when no existing idClient)'),
    items: z.array(z.object(SalesItemShape)).min(1).describe('List of sale items (at least one required)'),
} satisfies Record<string, ZodTypeAny>;

const OrderEditShape = {
    idempotencyKey: saleIdempotencyKey,
    orderID: z.number().int().describe('ID of the order to modify'),
    payment: salePaymentMode.describe('-2 for a pending quote, -1 for an unpaid invoice, 0 for no collection, or a positive Kash payment method ID to record payment.'),
    paymentAmount,
    idUser: z.union([z.number().int(), z.string()]).optional().describe('Staff member ID'),
    idClient: z.union([z.number().int(), z.string()]).optional().describe('Customer ID'),
    client: z.object(ClientShape).partial().optional().describe('Inline customer details'),
    idtable: z.union([z.number().int(), z.string()]).optional().describe('Table ID'),
    idcaisse: z.union([z.number().int(), z.string()]).optional().describe('Cash register ID'),
    numcouverts: z.union([z.number().int(), z.string()]).optional().describe('Number of covers/guests'),
    publicComment: z.string().optional().describe('Comment visible on the receipt'),
    privateComment: z.string().optional().describe('Internal staff-only comment'),
    pagerNum: z.union([z.number().int(), z.string()]).optional().describe('Pager/buzzer number'),
    deliveryMethod: z.union([
        z.number().int().min(0).max(6),
        z.enum(['0', '1', '2', '3', '4', '5', '6'])
    ]).transform((v) => Number(v)).optional().describe('Delivery method: 0=takeaway, 1=delivery, 2=on-site, 3=drive, 4=relay, 5=table service, 6=room service'),
    items: z.array(z.object(SalesItemShape)).optional().describe('Items to add (only for unvalidated orders or new orders)'),
} satisfies Record<string, ZodTypeAny>;

const GetReportShape = {
    d: z.number().int().min(1).max(31).optional().describe('Day of month (1–31); omit for full-month report'),
    m: z.number().int().min(1).max(12).optional().describe('Month (1–12); omit for full-year report'),
    y: z.number().int().min(2010).optional().describe('Year (e.g. 2024); omit for current year'),
} satisfies Record<string, ZodTypeAny>;

type SalesCreateArgs = InferFromShape<typeof SalesCreateShape>;
type OrderEditArgs = InferFromShape<typeof OrderEditShape>;
type GetReportArgs = InferFromShape<typeof GetReportShape>;

function submitSale(path: string, body: Record<string, unknown>, input: SalesCreateArgs | OrderEditArgs) {
    if (Number(input.payment) > 0 && input.paymentAmount !== undefined && Number(input.paymentAmount) === 0) {
        return saleWriteError('validation_failed', {}, 'A positive payment method requires an amount greater than zero when paymentAmount is supplied.');
    }
    return postSaleForm(path, body, input.idempotencyKey);
}

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
            out.push(['Free', it.priceOverride ?? it.price ?? '', it.titleOverride ?? it.title ?? ''].join('_'));
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
            title: t('tools.report.get.title'),
            description: t('tools.report.get.description'),
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
        'order_create',
        {
            title: t('tools.order.create.title'),
            description: t('tools.order.create.description'),
            inputSchema: SalesCreateShape,
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
        },
        async (input: SalesCreateArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const body: Record<string, unknown> = { idboutique: shopId, key: apiKey };

            if (input.payment !== undefined) body.payment = input.payment;
            if (input.paymentAmount !== undefined) body.paymentAmount = input.paymentAmount;
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

            return submitSale('/workers/webapp.php', body, input);
        }
    );

    // -- ORDER EDIT --
    server.registerTool(
        'order_edit',
        {
            title: t('tools.order.edit.title'),
            description: t('tools.order.edit.description'),
            inputSchema: OrderEditShape,
            annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
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

            return submitSale('/workers/editOrder.php', body, input);
        }
    );
}
