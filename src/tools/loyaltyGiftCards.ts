import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
    definePartnerTool, partnerPagination as pagination, partnerPaging as paging,
    registerOAuthPartnerTools, registerStdioPartnerTools, type PartnerOAuthOptions,
} from '../support/partnerDomainTools.js';
import { cartQuoteInputSchema } from './cartQuote.js';

const customerScope = 'customers.read';
const salesScope = 'sales.read';
type LoyaltyGiftScope = typeof customerScope | typeof salesScope | 'catalog.read';
const serviceUnavailable = 'The Kash loyalty or gift card service is temporarily unavailable.';
const clientId = z.number().int().positive().safe().describe('Kash customer ID.');
const giftCode = z.string().regex(/^[1-9][0-9]{0,18}$/)
    .refine((code) => code.length < 19 || code <= '9223372036854775807', 'Invalid card code.')
    .describe('Sensitive gift card code. Supply it as a string and leave it out of messages and URLs.');
const amount = z.string().regex(/^(?=.*[1-9])[0-9]{1,12}(?:\.[0-9]{1,6})?$/)
    .describe('Positive amount in the card currency, as a decimal string.');
const monetaryValue = z.string().regex(/^-?[0-9]+(?:\.[0-9]+)?$/);

const giftCheck = z.object({
    state: z.enum(['active', 'unpaid', 'used', 'refunded', 'expired', 'unknown']),
    currency: z.string(),
    use_mode: z.enum(['single', 'multiple']),
    balance: monetaryValue.nullable(),
    usable_balance: monetaryValue.nullable(),
    issued_at: z.string().nullable(),
    expires_at: z.string().nullable(),
    validity_seconds: z.number(),
    check: z.object({
        amount: monetaryValue,
        covered: z.boolean().nullable(),
        applicable_amount: monetaryValue.nullable(),
        single_use_consumes_balance: z.boolean(),
    }).optional(),
});
const giftMovement = z.object({
    payment_id: z.string(),
    order_id: z.string(),
    kind: z.enum(['payment', 'refund_payment', 'unknown']),
    recorded_at: z.string().nullable(),
    applied_amount: monetaryValue.nullable(),
    tendered_amount: monetaryValue.nullable(),
});

const loyaltyDetails = z.record(z.unknown());
const loyaltyCards = z.array(loyaltyDetails);
const loyaltyProgram = z.object({
    currency: z.string(),
    points: loyaltyDetails,
    stamp_cards: z.object({ enabled: z.boolean(), templates: loyaltyCards }),
});
const loyaltyAccount = z.object({
    customer_id: clientId,
    currency: z.string(),
    points: loyaltyDetails,
    stamp_cards: loyaltyCards,
});
const loyaltyMovement = z.object({
    order_id: z.number().int().safe(),
    recorded_at: z.string().nullable(),
    is_return: z.boolean(),
    source_order_id: z.number().int().safe().nullable(),
    recorded_points: z.number(),
    points_on_reward_lines: z.number().nullable(),
});
const loyaltyEstimate = loyaltyAccount.extend({
    customer_id: clientId.nullable(),
    cart: loyaltyDetails,
});

const tools = [
    definePartnerTool('loyalty_get_program', 'Read Kash loyalty program',
        'Read the loyalty rules and rewards for the connected Kash shop.', [customerScope],
        {}, { data: loyaltyProgram }, () => ({ path: '/loyalty/program' })),
    definePartnerTool('loyalty_get_account', 'Read Kash loyalty account',
        'Read the customer’s Kash loyalty balance and available rewards.', [customerScope],
        { customer_id: clientId }, { data: loyaltyAccount }, ({ customer_id }) => ({ path: '/loyalty/customers/' + customer_id })),
    definePartnerTool('loyalty_list_movements', 'List Kash loyalty movements',
        'Read known loyalty movements for a customer. Use pagination.next_cursor for the next page.', [customerScope],
        { customer_id: clientId, ...paging }, { data: z.array(loyaltyMovement), pagination, meta: loyaltyDetails.optional() },
        ({ customer_id, ...page }) => ({ path: '/loyalty/customers/' + customer_id + '/movements', page })),
    definePartnerTool('loyalty_quote', 'Estimate Kash loyalty for a cart',
        'Simulate points earned and applicable rewards for a cart and optional customer.',
        [customerScope, 'catalog.read'], { customer_id: clientId.optional(), cart: cartQuoteInputSchema }, { data: loyaltyEstimate },
        (body) => ({ path: '/loyalty/quotes', body })),
    definePartnerTool('gift_card_check', 'Check Kash gift card',
        'Check a gift card’s validity, currency, available balance and optional purchase amount. Keep its code private.', [salesScope],
        { code: giftCode, amount: amount.optional() }, { data: giftCheck }, (body) => ({ path: '/gift-cards/check', body })),
    definePartnerTool('gift_card_list_movements', 'List Kash gift card movements',
        'Read recorded gift card payments and refund payments. Use pagination.next_cursor for the next page. Keep the card code private.', [salesScope],
        { code: giftCode, ...paging }, {
            data: z.array(giftMovement), pagination, meta: z.object({ coverage: z.literal('recorded_payments'), currency: z.string() }),
        }, ({ code, ...page }) => ({ path: '/gift-cards/movements', body: { code }, page })),
];

export function loyaltyGiftCardToolScopes(name: string): LoyaltyGiftScope[] {
    return [...(tools.find((tool) => tool.name === name)?.scopes ?? [])];
}

export function registerOAuthLoyaltyGiftCardTools(server: McpServer, options: PartnerOAuthOptions): void {
    registerOAuthPartnerTools(server, tools, options, serviceUnavailable);
}

export function registerStdioLoyaltyGiftCardTools(server: McpServer): string[] {
    return registerStdioPartnerTools(server, tools, serviceUnavailable);
}
