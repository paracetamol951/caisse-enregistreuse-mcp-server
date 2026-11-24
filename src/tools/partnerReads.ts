import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getSessionAuth } from '../context.js';
import type { KashOAuthGrant } from '../support/kashOAuthTools.js';

export const salesSummaryToolName = 'sales_summary';
export const invoiceDocumentsToolName = 'list_invoice_documents';
export const invoiceDocumentsScope = 'invoices.read';
export const accountingTransmissionsScope = 'accounting_transmissions.read';
export const salesSummaryScope = 'reports.read';

const shopIdPattern = /^[1-9][0-9]{0,18}$/;
const id = z.union([z.string().regex(shopIdPattern), z.number().int().positive().safe()]);
const registerId = z.union([z.string().regex(/^(?:0|-?[1-9][0-9]{0,18})$/), z.number().int().safe()]);
const businessDate = z.string().date();
const decimal = z.string().regex(/^-?[0-9]+\.[0-9]{2,}$/);
const salesInput = z.object({
    from: businessDate.describe('First business date, inclusive (YYYY-MM-DD).'),
    to: businessDate.describe('Last business date, inclusive (YYYY-MM-DD).'),
    cash_register_id: registerId.optional().describe('Filter on a Kash cash register ID.'),
}).strict();
const invoiceInput = z.object({
    invoice_id: id.describe('Kash invoice ID in the selected shop.'),
}).strict();
const salesMeasures = {
    gross_sales_amount: decimal,
    refund_amount: decimal,
    net_sales_amount: decimal,
    sale_count: z.number().int().nonnegative(),
    refund_count: z.number().int().nonnegative(),
};
const salesOutput = z.object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    timezone: z.string(),
    period: z.object({ from: businessDate, to: businessDate, start_at: z.string(), end_at_exclusive: z.string() }),
    business_day: z.object({ opening_time: z.string(), date_field: z.literal('datevaleur') }),
    totals: z.object(salesMeasures),
    by_business_day: z.array(z.object({ date: businessDate, ...salesMeasures })),
    by_cash_register: z.array(z.object({ cash_register_id: registerId, ...salesMeasures })),
    by_payment_method: z.array(z.object({
        payment_method_id: registerId,
        payment_type_id: registerId,
        payment_count: z.number().int().nonnegative(),
        applied_amount: decimal,
    })),
});

const invoiceIdentity = {
    id: z.number().int().positive().safe(),
    reference: z.string(),
    issued_at: z.string().nullable(),
};
const documents = z.array(z.object({
    id: z.literal('pdf'),
    type: z.enum(['invoice', 'credit_note']),
    format: z.enum(['pdf', 'factur_x']),
    content_type: z.literal('application/pdf'),
    availability: z.enum(['available', 'unavailable']),
    download_path: z.string().regex(/^\/api\/partner\/v1\/invoices\/[1-9][0-9]*\/documents\/pdf\?shop_id=[1-9][0-9]*$/).nullable(),
}));
const status = z.enum(['sent', 'pending', 'failed', 'uncertain', 'excluded', 'unknown', 'unavailable']);
const transmission = z.object({
    pennylane: z.object({
        status,
        records: z.array(z.object({ status, reference: z.string().nullable(), updated_at: z.string().nullable() })),
    }),
}).nullable();
const invoiceOutput = z.object({
    invoice: z.object(invoiceIdentity),
    documents,
    credit_notes: z.array(z.object({ ...invoiceIdentity, documents, transmission })),
    transmission,
});

type PartnerRequest = {
    path: string;
    query?: Record<string, string>;
    output: z.AnyZodObject;
};
type ReadScope = typeof salesSummaryScope | typeof invoiceDocumentsScope;
type RunRead = (request: PartnerRequest, scope: ReadScope) => Promise<CallToolResult>;

function readError(code: string, text: string, challenge?: string): CallToolResult {
    return {
        isError: true,
        content: [{ type: 'text', text }],
        structuredContent: { error: { code, message: text } },
        ...(challenge ? { _meta: { 'mcp/www_authenticate': [challenge] } } : {}),
    };
}

async function requestRead(
    base: string,
    shopId: string,
    request: PartnerRequest,
    headers: Record<string, string>,
    onUnauthorized: () => CallToolResult,
): Promise<CallToolResult> {
    const unavailable = () => readError('unavailable', 'Kash data is temporarily unavailable.');
    try {
        const url = new URL('/api/partner/v1' + request.path, base);
        const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (url.username || url.password || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) {
            return readError('invalid_configuration', 'The Kash partner API requires HTTPS.');
        }
        url.search = new URLSearchParams({ ...request.query, shop_id: shopId }).toString();
        const response = await fetch(url, {
            method: 'GET',
            headers: { ...headers, Accept: 'application/json' },
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
        });
        switch (response.status) {
            case 401: return onUnauthorized();
            case 403: return readError('forbidden', 'This Kash connection cannot read the requested data for the selected shop.');
            case 404: return readError('not_found', 'Kash could not find the requested resource in the selected shop.');
            case 400:
            case 422: return readError('invalid_arguments', 'Kash rejected the arguments. Check the dates and references.');
        }
        if (!response.ok) return unavailable();
        const data = request.output.parse(await response.json());
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    } catch {
        return unavailable();
    }
}

function registerPartnerReadTools(server: McpServer, run: RunRead, oauth: boolean): void {
    const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
    const security = (scope: ReadScope) => oauth ? { _meta: { securitySchemes: [{ type: 'oauth2', scopes: [scope] }] } } : {};
    const sales = server.registerTool(salesSummaryToolName, {
        title: 'Read Kash sales summary',
        description: 'Get shop sales totals and breakdowns for an inclusive range of Kash business dates. Monetary amounts are decimal strings in the reported currency.',
        inputSchema: salesInput.shape,
        outputSchema: salesOutput.shape,
        annotations,
        ...security(salesSummaryScope),
    }, ({ from, to, cash_register_id }) => run({
        path: '/reports/sales-summary',
        query: { from, to, ...(cash_register_id === undefined ? {} : { cash_register_id: String(cash_register_id) }) },
        output: salesOutput,
    }, salesSummaryScope));
    sales.inputSchema = salesInput;

    const invoice = server.registerTool(invoiceDocumentsToolName, {
        title: 'List Kash invoice documents',
        description: 'List available invoice documents and linked credit notes in the connected shop. Accounting transmission details require additional permission. This read does not send documents.',
        inputSchema: invoiceInput.shape,
        outputSchema: invoiceOutput.shape,
        annotations,
        ...security(invoiceDocumentsScope),
    }, ({ invoice_id }) => run({ path: `/invoices/${invoice_id}/documents`, output: invoiceOutput }, invoiceDocumentsScope));
    invoice.inputSchema = invoiceInput;
}

export function registerOAuthPartnerReadTools(
    server: McpServer,
    { grant, issuer, serviceToken, challenge }: {
        grant?: KashOAuthGrant;
        issuer: string;
        serviceToken: string;
        challenge(scopes: string[], error?: string): string;
    },
): void {
    registerPartnerReadTools(server, (request, scope) => {
        const reconnect = () => readError('invalid_token', 'Reconnect your Kash account to read this data.', challenge([scope], 'invalid_token'));
        if (!grant?.shopId) return Promise.resolve(reconnect());
        if (!grant.scopes.has(scope)) {
            return Promise.resolve(readError('insufficient_scope', 'Authorize this Kash read permission.', challenge([scope], 'insufficient_scope')));
        }
        return requestRead(issuer, grant.shopId, request, {
            Authorization: 'Bearer ' + serviceToken,
            'X-Kash-Mcp-Token-Ref': grant.tokenRef,
        }, reconnect);
    }, true);
}

export function registerStdioPartnerReadTools(server: McpServer): boolean {
    const key = process.env.KASH_PARTNER_API_KEY;
    if (!key || !/^kash_[a-f0-9]{64}$/.test(key)) return false;
    registerPartnerReadTools(server, (request) => {
        const shopId = getSessionAuth()?.SHOPID ?? process.env.SHOPID ?? process.env.MCP_SHOPID;
        if (!shopId || !shopIdPattern.test(shopId)) {
            return Promise.resolve(readError('missing_shop', 'Configure a Kash shop ID to read this data.'));
        }
        return requestRead(process.env.API_BASE || 'https://kash.click', shopId, request, {
            Authorization: 'Bearer ' + key,
        }, () => readError('invalid_token', 'The Kash partner credential was rejected.'));
    }, false);
    return true;
}
