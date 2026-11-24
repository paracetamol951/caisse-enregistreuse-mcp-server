import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
    definePartnerTool, partnerIdempotencyKey, partnerPagination, partnerPaging,
    registerOAuthPartnerTools, registerStdioPartnerTools, type PartnerOAuthOptions,
} from '../support/partnerDomainTools.js';
import { cartQuoteInputSchema } from './cartQuote.js';

type DiscountVoucherScope = 'catalog.read' | 'catalog.write' | 'customers.read' | 'customers.write';
const idString = z.string().regex(/^[1-9][0-9]{0,18}$/)
    .refine((value) => value.length < 19 || value <= '9223372036854775807', 'Invalid Kash reference.');
const reference = z.union([z.number().int().positive().safe(), idString]);
const customerId = reference.describe('Kash customer ID.');
const reductionId = reference.refine((value) => Number(value) <= 2147483647, 'Invalid catalog reduction reference.');
const visibleBmp = /^[^\p{C}\u{10000}-\u{10FFFF}]+$/u;
const couponCode = z.string().max(200).regex(visibleBmp)
    .refine((code) => {
        const length = code.replace(/^ +| +$/g, '').length;
        return length >= 1 && length <= 50 && Buffer.byteLength(code, 'utf8') <= 200;
    }, 'Invalid coupon code length.')
    .describe('Sensitive coupon code. Keep it out of messages and URLs.');
const newCouponCode = couponCode.refine((code) => /^ *[A-Za-z0-9_-]{1,50} *$/.test(code), 'Invalid characters for a new coupon code.')
    .describe('New sensitive promo code, 1–50 letters, digits, underscores or hyphens. Keep it out of messages and URLs.');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Calendar date in YYYY-MM-DD format.');
const couponDay = day.refine((value) => value >= '1970-01-01' && value <= '2037-12-31', 'Date is outside the supported coupon range.');
const couponMinimum = z.string().regex(/^[0-9]{1,5}(?:[.,][0-9]{1,5})?$/);
const couponCount = z.number().int().min(0).max(999999999);
const money = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const voucherDecimal = z.string().regex(/^[0-9]{1,9}(?:\.[0-9]{1,6})?$/);
const voucherKind = z.enum(['fixed', 'percent']);
const confirmation = {
    confirm: z.literal(true).describe('Set to true when the user explicitly requests this issuance.'),
    idempotency_key: partnerIdempotencyKey,
};

const couponCheck = z.object({
    coupon_id: idString,
    status: z.enum(['eligible', 'ineligible', 'context_required']),
    reason: z.enum([
        'coupons_disabled', 'webshop_coupons_disabled', 'reduction_unavailable', 'not_started', 'expired',
        'usage_limit', 'customer_required', 'customer_restricted', 'unsupported_customer_group_rule', 'customer_group_restricted',
        'cashbox_required', 'cashbox_restricted', 'cart_required', 'already_used_by_customer', 'minimum_order_amount',
        'required_item', 'required_department', 'minimum_item_count', 'delivery_restricted', 'invalid_discount_total',
    ]).nullable(),
    currency: z.string(),
    reduction: z.object({ rate: z.number(), amount: money, fixed_price: money.nullable() }).nullable(),
    cart: z.object({ gross: money, estimated_discount: money.nullable(), estimated_gross: money.nullable() }).nullable(),
});

const personalVoucher = z.object({
    id: idString,
    customer_id: idString,
    kind: voucherKind,
    value: money,
    label: z.string(),
    minimum: money,
    expires_on: z.string().nullable(),
    issued_at: z.string(),
    status: z.enum(['available', 'reserved', 'used', 'cancelled', 'expired']),
    order_id: idString.nullable(),
    applied_amount: money.nullable(),
    used_at: z.string().nullable(),
    cancelled_at: z.string().nullable(),
});
const voucherQuote = z.object({
    customer_id: idString,
    currency: z.string(),
    mode: z.enum(['manual', 'automatic']),
    subtotal: money,
    eligible_subtotal: money,
    discount: money,
    total: money,
    selected_voucher_id: idString.nullable(),
    options: z.array(z.object({ voucher_id: idString, amount: money, eligible: z.boolean(), limited: z.boolean() })),
});

const tools = [
    definePartnerTool('coupon_check', 'Check Kash promo code',
        'Check a promo code and optionally estimate the reduction for a cart. Provide customer and cashbox context when applicable.',
        ['catalog.read', 'customers.read'], {
            code: couponCode,
            cart: cartQuoteInputSchema.optional(),
            customer_id: customerId.optional(),
            cashbox_id: z.union([reference, z.literal(-9), z.literal('-9')]).optional()
                .describe('Kash cashbox ID or -9 for the web shop.'),
        }, { data: couponCheck }, (body) => ({ path: '/coupons/check', body })),
    definePartnerTool('coupon_issue', 'Issue Kash promo code',
        'Create a promo code linked to an existing catalog reduction. Requires explicit confirmation and an active shop administrator or manager. Reuse the same key and arguments for a retry.',
        ['catalog.write'], {
            ...confirmation,
            code: newCouponCode,
            name: z.string().min(1).max(80).regex(visibleBmp),
            reduction_id: reductionId.describe('Existing Kash catalog reduction ID.'),
            minimum_order_amount: couponMinimum.optional(),
            max_uses: couponCount.optional(),
            minimum_item_count: couponCount.optional(),
            valid_from: couponDay.optional(),
            valid_until: couponDay.optional(),
            one_use_per_customer: z.boolean().optional(),
        }, { data: z.object({ coupon_id: idString }) },
        ({ idempotency_key, ...body }) => ({ path: '/coupons', body, idempotencyKey: idempotency_key }), { mutation: true }),
    definePartnerTool('personal_voucher_list', 'List Kash personal vouchers',
        'Read a customer’s personal vouchers and their current state. Use pagination.next_cursor for the next page.', ['customers.read'],
        { customer_id: customerId, ...partnerPaging }, { data: z.array(personalVoucher), pagination: partnerPagination },
        ({ customer_id, ...page }) => ({ path: '/personal-vouchers/customers/' + customer_id, page })),
    definePartnerTool('personal_voucher_quote', 'Estimate Kash personal vouchers',
        'Simulate the eligible personal vouchers and their discount for a customer’s cart.', ['customers.read', 'catalog.read'],
        { customer_id: customerId, cart: cartQuoteInputSchema, voucher_id: reference.optional() }, { data: voucherQuote },
        (body) => ({ path: '/personal-vouchers/quotes', body })),
    definePartnerTool('personal_voucher_issue', 'Issue Kash personal voucher',
        'Issue a personal voucher for one customer. Requires explicit confirmation and an active shop administrator or manager. Reuse the same key and arguments for a retry.',
        ['customers.write'], {
            ...confirmation,
            customer_id: customerId,
            kind: voucherKind,
            value: voucherDecimal.refine((value) => Number(value) > 0, 'Voucher value must be positive.')
                .describe('Positive decimal amount. For a percentage, use at most two decimal places and a maximum of 100.'),
            label: z.string().trim().min(1).refine((label) => Array.from(label).length <= 60, 'Voucher label must have at most 60 characters.'),
            expires_on: day.nullable().optional(),
            minimum: voucherDecimal.optional(),
        }, { data: personalVoucher }, ({ customer_id, idempotency_key, ...body }) => ({
            path: '/personal-vouchers/customers/' + customer_id, body, idempotencyKey: idempotency_key,
        }), { mutation: true }),
];

export function discountVoucherToolScopes(name: string): DiscountVoucherScope[] {
    return [...(tools.find((tool) => tool.name === name)?.scopes ?? [])];
}

export function registerOAuthDiscountVoucherTools(server: McpServer, options: PartnerOAuthOptions): void {
    registerOAuthPartnerTools(server, tools, options);
}

export function registerStdioDiscountVoucherTools(server: McpServer): string[] {
    return registerStdioPartnerTools(server, tools);
}
