import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodTypeAny } from 'zod';
import { postForm } from '../support/http.js';
import { t } from '../i18n/index.js';
import { resolveAuth, type Ctx } from '../context.js';

type InferFromShape<S extends Record<string, ZodTypeAny>> = z.infer<z.ZodObject<S>>;

const PaymentModeTypeEnum = z.enum([
    'Cash', 'Credit_Card', 'Check', 'Bank_Transfer', 'Meal_Voucher', 'Holiday_Voucher',
    'Cash_Refund', 'Credit_Card_Refund', 'Check_Refund', 'Bank_Transfer_Refund',
    'Meal_Voucher_Refund', 'Holiday_Voucher_Refund',
]);

const AddPaymentModeShape = {
    title: z.string().describe('Name of the payment method (e.g. "Cash #2")'),
    type: PaymentModeTypeEnum.optional().describe('Payment method type'),
    accountingChapter: z.string().optional().describe('Accounting chapter code'),
    fixedAmount: z.union([z.number(), z.string()]).optional().describe('Fixed amount (e.g. for a gift certificate)'),
    minimumAmount: z.union([z.number(), z.string()]).optional().describe('Minimum payment amount'),
    maximumAmount: z.union([z.number(), z.string()]).optional().describe('Maximum payment amount'),
    cashboxLock: z.union([z.number().int(), z.string()]).optional().describe('ID of the cashbox allowed to use this method (0 = all)'),
} satisfies Record<string, ZodTypeAny>;

const DelPaymentModeShape = {
    id: z.union([z.number().int(), z.string()]).describe('ID of the payment method to delete'),
} satisfies Record<string, ZodTypeAny>;

type AddPaymentModeArgs = InferFromShape<typeof AddPaymentModeShape>;
type DelPaymentModeArgs = InferFromShape<typeof DelPaymentModeShape>;

export function registerPaymentModeTools(server: McpServer | any) {

    server.registerTool(
        'payment_mode_add',
        {
            title: t('tools.payment_mode.add.title'),
            description: t('tools.payment_mode.add.description'),
            inputSchema: AddPaymentModeShape,
            annotations: { destructiveHint: false, idempotentHint: false },
        },
        async (input: AddPaymentModeArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const body: Record<string, unknown> = {
                shopID: shopId, key: apiKey,
                'data[title]': input.title,
            };
            if (input.type !== undefined) body['data[type]'] = input.type;
            if (input.accountingChapter !== undefined) body['data[accountingChapter]'] = input.accountingChapter;
            if (input.fixedAmount !== undefined) body['data[fixedAmount]'] = input.fixedAmount;
            if (input.minimumAmount !== undefined) body['data[minimumAmount]'] = input.minimumAmount;
            if (input.maximumAmount !== undefined) body['data[maximumAmount]'] = input.maximumAmount;
            if (input.cashboxLock !== undefined) body['data[cashboxLock]'] = input.cashboxLock;
            const data = await postForm('/workers/addPaymentMethod.php', body);
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
        }
    );

    server.registerTool(
        'payment_mode_delete',
        {
            title: t('tools.payment_mode.delete.title'),
            description: t('tools.payment_mode.delete.description'),
            inputSchema: DelPaymentModeShape,
            annotations: { destructiveHint: true, idempotentHint: true },
        },
        async (input: DelPaymentModeArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const data = await postForm('/workers/delPaymentMethod.php', { shopID: shopId, key: apiKey, id: input.id });
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
        }
    );
}