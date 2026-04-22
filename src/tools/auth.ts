import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodTypeAny } from 'zod';
import { postForm } from '../support/http.js';
import { t } from '../i18n/index.js';
import { setSessionAuth, clearSessionAuth } from '../context.js';

type InferFromShape<S extends Record<string, ZodTypeAny>> = z.infer<z.ZodObject<S>>;

// ============================================================
// CONFIG TYPES (pour account_create)
// ============================================================

const CONFIG_TYPES = [
    'Bar', 'Ticket-Office', 'Butchery-Delicatessen', 'Bakery', 'Brewery',
    'Tobacconist', 'Cafe', 'Camping', 'Liquor-Shop', 'CBD', 'Coffee-shop',
    'Coiffeur', 'Shops', 'Street-trade', 'Grocery-store', 'Florist',
    'Food-truck', 'Cheese-shop', 'Beauty-institute', 'Library', 'Clothing-store',
    'Market', 'Pharmacy', 'Pizzeria', 'Fish-shop', 'For-association',
    'Dry-cleaning', 'Restaurant', 'Fast-food', 'Supermarket', 'Perfumery',
    'Services', 'Ecommerce', 'ChatGPT', 'Claude', 'Prestashop',
    'VivaWallet', 'SumUp', 'GoCardless', 'Sunmi', 'Yavin', 'Pennylane',
] as const;

// ============================================================
// SHAPES
// ============================================================

const ListAccountsShape = {
    email: z.string().email().describe('Email address to look up linked Kash accounts'),
    accountTitle: z.string().optional().describe('Filter results by account title'),
} satisfies Record<string, ZodTypeAny>;

const CreateAccountShape = {
    email: z.string().email().describe('Email address for the new Kash account'),
    accountTitle: z.string().describe('Display name for the new account'),
    configType: z.enum(CONFIG_TYPES).optional().describe('Pre-loaded dataset type (e.g. Restaurant, Bar, Bakery)'),
    companyRegistrationNum: z.string().optional().describe('Company registration number (SIRET, etc.)'),
    taxRegistrationNum: z.string().optional().describe('VAT / tax registration number'),
    adressline1: z.string().optional().describe('Street address line 1'),
    postCode: z.string().optional().describe('Postal/ZIP code'),
    city: z.string().optional().describe('City name'),
    country: z.string().optional().describe('Country code or name'),
    phone: z.string().optional().describe('Contact phone number'),
    currency: z.string().optional().describe('Currency code (e.g. EUR, USD)'),
    language: z.string().optional().describe('Language code (e.g. fr, en)'),
} satisfies Record<string, ZodTypeAny>;

const RequestOtpShape = {
    email: z.string().email().describe('Email address to send the OTP to'),
    accountID: z.union([z.number().int(), z.string()]).optional().describe('Target account ID if the email has multiple accounts'),
} satisfies Record<string, ZodTypeAny>;

const LoginWithOtpShape = {
    email: z.string().email().describe('Email address used to request the OTP'),
    otp: z.string().describe('One-time password received by email'),
} satisfies Record<string, ZodTypeAny>;

const LogoutShape = {} satisfies Record<string, ZodTypeAny>;

type ListAccountsArgs = InferFromShape<typeof ListAccountsShape>;
type CreateAccountArgs = InferFromShape<typeof CreateAccountShape>;
type RequestOtpArgs = InferFromShape<typeof RequestOtpShape>;
type LoginWithOtpArgs = InferFromShape<typeof LoginWithOtpShape>;

// ============================================================
// HELPER : initialise la session si la réponse contient APIKEY+SHOPID
// ============================================================

function tryInitSession(data: unknown, source: string): void {
    if (data && typeof data === 'object' && (data as any).success === true) {
        const { APIKEY, SHOPID } = data as any;
        if (APIKEY && SHOPID) {
            setSessionAuth({ ok: true, APIKEY, SHOPID, scopes: ['*'] });
            process.stderr.write(`[caisse][${source}] Session initialisée pour SHOPID=${SHOPID}\n`);
        }
    }
}

// ============================================================
// REGISTER
// ============================================================

export function registerAuthTools(server: McpServer | any) {

    // -- LIST ACCOUNTS --
    server.registerTool(
        'account_list',
        {
            title: t('tools.account_list.title'),
            description: t('tools.account_list.description'),
            inputSchema: ListAccountsShape,
            annotations: { readOnlyHint: true },
        },
        async (input: ListAccountsArgs) => {
            const body: Record<string, unknown> = { email: input.email };
            if (input.accountTitle) body.accountTitle = input.accountTitle;
            const data = await postForm('/workers/listShops.php', body);
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
                structuredContent: data,
            };
        }
    );

    // -- CREATE ACCOUNT --
    server.registerTool(
        'account_create',
        {
            title: t('tools.account_create.title'),
            description: t('tools.account_create.description'),
            inputSchema: CreateAccountShape,
            annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
        },
        async (input: CreateAccountArgs) => {
            const body: Record<string, unknown> = {
                email: input.email,
                accountTitle: input.accountTitle,
            };
            if (input.configType) body.configType = input.configType;
            if (input.companyRegistrationNum) body['data[companyRegistrationNum]'] = input.companyRegistrationNum;
            if (input.taxRegistrationNum) body['data[taxRegistrationNum]'] = input.taxRegistrationNum;
            if (input.adressline1) body['data[adressline1]'] = input.adressline1;
            if (input.postCode) body['data[postCode]'] = input.postCode;
            if (input.city) body['data[city]'] = input.city;
            if (input.country) body['data[country]'] = input.country;
            if (input.phone) body['data[phone]'] = input.phone;
            if (input.currency) body['data[currency]'] = input.currency;
            if (input.language) body['data[language]'] = input.language;

            const data = await postForm('/workers/addShop.php', body);
            tryInitSession(data, 'account_create');
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
                structuredContent: data,
            };
        }
    );

    // -- REQUEST OTP --
    server.registerTool(
        'auth_request_otp',
        {
            title: t('tools.auth_request_otp.title'),
            description: t('tools.auth_request_otp.description'),
            inputSchema: RequestOtpShape,
            annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
        },
        async (input: RequestOtpArgs) => {
            const body: Record<string, unknown> = { email: input.email };
            if (input.accountID !== undefined) body.accountID = input.accountID;
            const data = await postForm('/workers/getOTPForAccount.php', body);
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
                structuredContent: data,
            };
        }
    );

    // -- LOGIN WITH OTP --
    server.registerTool(
        'auth_login_with_otp',
        {
            title: t('tools.auth_login_with_otp.title'),
            description: t('tools.auth_login_with_otp.description'),
            inputSchema: LoginWithOtpShape,
            annotations: { destructiveHint: false, idempotentHint: false },
        },
        async (input: LoginWithOtpArgs) => {
            const data = await postForm('/workers/getAuthTokenWithOTP.php', {
                email: input.email,
                otp: input.otp,
            });
            tryInitSession(data, 'auth_login_with_otp');
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
                structuredContent: data,
            };
        }
    );

    // -- LOGOUT --
    server.registerTool(
        'auth_logout',
        {
            title: t('tools.auth_logout.title'),
            description: t('tools.auth_logout.description'),
            inputSchema: LogoutShape,
            annotations: { destructiveHint: false, idempotentHint: true },
        },
        async () => {
            clearSessionAuth();
            process.stderr.write('[caisse][auth] Session effacée.\n');
            return {
                content: [{ type: 'text', text: JSON.stringify({ success: true, result: 'Session cleared' }) }],
                structuredContent: { success: true, result: 'Session cleared' },
            };
        }
    );
}