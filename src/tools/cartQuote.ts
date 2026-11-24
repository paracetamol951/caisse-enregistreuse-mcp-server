import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getSessionAuth } from '../context.js';
import type { KashOAuthGrant } from '../support/kashOAuthTools.js';

export const cartQuoteToolName = 'calculate_cart';
export const cartQuoteScope = 'catalog.read';

const context = z.enum(['on_premises', 'takeaway', 'delivery']);
const reference = z.number().int().min(1).max(2147483647);
const quantity = z.number().min(0.001).max(10000).multipleOf(0.001);
const variantIds = z.array(reference).max(5)
    .refine((ids) => new Set(ids).size === ids.length, 'Variant IDs must be unique.');
const inputSchema = z.object({
    lines: z.array(z.object({
        item_id: reference.describe('Kash catalog item (PLU) ID.'),
        quantity,
        variant_ids: variantIds.optional().describe('Selected variant choice IDs.'),
    }).strict()).min(1).max(100).refine((lines) => {
        const groups = lines.map(({ item_id, variant_ids: ids = [] }) => [
            item_id,
            ...[...ids].sort((left, right) => left - right),
        ].join(':'));
        return new Set(groups).size === lines.length;
    }, 'Combine quantities for identical catalog items and variant choices.'),
    context: context.optional().describe('Defaults to on_premises. Kash can reject contexts it cannot quote.'),
}).strict();
export { inputSchema as cartQuoteInputSchema };

const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const amounts = { net: decimal, vat: decimal, gross: decimal };
const adjustments = { discount: decimal, supplement: decimal };
const outputSchema = z.object({
    currency: z.string(),
    context,
    pricing_scale: z.number().int().min(0).max(4),
    lines: z.array(z.object({
        item_id: reference,
        name: z.string(),
        quantity,
        variants: z.array(z.object({ id: reference, name: z.string(), unit_supplement: decimal }).strict()),
        unit_price: decimal,
        vat_rate: decimal,
        ...amounts,
        ...adjustments,
    }).strict()),
    totals: z.object({ ...amounts, ...adjustments, fees: decimal }).strict(),
    taxes: z.array(z.object({ rate: decimal, ...amounts }).strict()),
}).strict();

type CartInput = z.infer<typeof inputSchema>;

function cartError(text: string, challenge?: string): CallToolResult {
    return {
        isError: true,
        content: [{ type: 'text', text }],
        ...(challenge ? { _meta: { 'mcp/www_authenticate': [challenge] } } : {}),
    };
}

function registerCartTool(
    server: McpServer,
    calculate: (input: CartInput) => Promise<CallToolResult>,
    oauth = false,
): void {
    const tool = server.registerTool(cartQuoteToolName, {
        title: 'Calculate Kash cart',
        description: 'Get an itemized quote and VAT totals from the connected Kash shop before checkout. Does not create a sale or reserve stock.',
        inputSchema: inputSchema.shape,
        outputSchema: outputSchema.shape,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        ...(oauth ? { _meta: { securitySchemes: [{ type: 'oauth2', scopes: [cartQuoteScope] }] } } : {}),
    }, calculate);
    // The pinned SDK wraps raw shapes in an object that strips unknown keys.
    tool.inputSchema = inputSchema;
}

async function requestCartQuote(
    base: string,
    shopId: string,
    input: CartInput,
    headers: Record<string, string>,
    onUnauthorized?: () => CallToolResult,
): Promise<CallToolResult> {
    try {
        const url = new URL('/api/partner/v1/cart-quotes', base);
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
            return cartError('The Kash cart API requires HTTPS.');
        }
        url.searchParams.set('shop_id', shopId);
        const response = await fetch(url, {
            method: 'POST',
            headers: { ...headers, Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
        });
        switch (response.status) {
            case 401: return onUnauthorized?.() ?? cartError('The Kash partner credential was rejected.');
            case 403: return cartError('The Kash connection cannot quote carts for this shop.');
            case 400: return cartError('Kash rejected the cart arguments.');
            case 404: return cartError('Kash could not find a cart reference in the connected shop.');
            case 422: return cartError('Kash cannot quote this cart with the selected items or context.');
        }
        if (!response.ok) return cartError('The Kash cart quote is temporarily unavailable.');

        const data = outputSchema.parse(await response.json());
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    } catch {
        return cartError('The Kash cart quote is temporarily unavailable.');
    }
}

export function registerOAuthCartQuoteTool(
    server: McpServer,
    options: {
        grant?: KashOAuthGrant;
        issuer: string;
        serviceToken: string;
        challenge(scopes: string[], error?: string): string;
    },
): void {
    const { grant, issuer, serviceToken, challenge } = options;
    registerCartTool(server, async (input) => {
        const scopes = [cartQuoteScope];
        const reconnect = () => cartError('Reconnect your Kash account to quote carts.', challenge(scopes, 'invalid_token'));
        if (!grant) return reconnect();
        if (!grant.scopes.has(cartQuoteScope)) {
            return cartError('Authorize access to the Kash catalog.', challenge(scopes, 'insufficient_scope'));
        }
        if (!grant.shopId) return reconnect();

        return requestCartQuote(issuer, grant.shopId, input, {
            Authorization: 'Bearer ' + serviceToken,
            'X-Kash-Mcp-Token-Ref': grant.tokenRef,
        }, reconnect);
    }, true);
}

export function registerStdioCartQuoteTool(server: McpServer): boolean {
    const key = process.env.KASH_PARTNER_API_KEY;
    if (!key || !/^kash_[a-f0-9]{64}$/.test(key)) return false;

    registerCartTool(server, async (input) => {
        const shopId = getSessionAuth()?.SHOPID ?? process.env.SHOPID ?? process.env.MCP_SHOPID;
        if (!shopId || !/^[1-9][0-9]{0,18}$/.test(shopId)) {
            return cartError('Configure a Kash shop ID to quote carts.');
        }
        return requestCartQuote(process.env.API_BASE || 'https://kash.click', shopId, input, {
            Authorization: 'Bearer ' + key,
        });
    });
    return true;
}
