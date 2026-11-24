import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodTypeAny } from 'zod';
import { postForm } from '../support/http.js';
import { getLang, t } from '../i18n/index.js';
import { setSessionAuth, clearSessionAuth, resolveAuth, type Ctx } from '../context.js';

type InferFromShape<S extends Record<string, ZodTypeAny>> = z.infer<z.ZodObject<S>>;
function appendData(body: Record<string, unknown>, fields: Record<string, unknown>) {
    for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined && v !== null) body[`data[${k}]`] = v;
    }
}
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
    challengeId: z.string().regex(/^[a-fA-F0-9]{32}$/).optional()
        .describe('Challenge ID returned by auth_request_otp. Required by the current Kash email API.'),
    accountID: z.union([z.number().int().positive().safe(), z.string().regex(/^[1-9][0-9]{0,18}$/)]).optional()
        .describe('Kash account ID to select when the email is linked to several accounts'),
} satisfies Record<string, ZodTypeAny>;

const LogoutShape = {} satisfies Record<string, ZodTypeAny>;

const GetShopInfosShape = {} satisfies Record<string, ZodTypeAny>;

const EditAccountShape = {
    shopName: z.string().optional().describe('Store name'),
    companyRegistrationNum: z.string().optional().describe('Company registration number (RCS/SIRET)'),
    taxRegistrationNum: z.string().optional().describe('VAT / tax registration number'),
    adressline1: z.string().optional().describe('Address line 1'),
    postCode: z.string().optional().describe('Postal/ZIP code'),
    city: z.string().optional().describe('City'),
    country: z.string().optional().describe('Country'),
    lat: z.string().optional().describe('GPS latitude'),
    lng: z.string().optional().describe('GPS longitude'),
    phone: z.string().optional().describe('Contact phone number'),
    urlwebsite: z.string().optional().describe('URL of the shop website'),
    defaultAccountingChapter: z.string().optional().describe('Default accounting chapter'),
    pdffooter: z.string().optional().describe('Footer text for PDF invoices'),
    receiptHeader: z.string().optional().describe('Header text printed on receipts'),
    receiptFooter: z.string().optional().describe('Footer text printed on receipts'),
    defaultVatID: z.union([z.number().int(), z.string()]).optional().describe('Default VAT rate identifier'),
    currency: z.string().optional().describe('Currency code (e.g. EUR, USD)'),
    language: z.string().optional().describe('Language code (e.g. fr, en)'),
    pricesAreProvidedTaxIncluded: z.number().int().min(0).max(1).optional().describe('0 = prices incl. VAT; 1 = prices excl. VAT'),
    paypalAddress: z.string().optional().describe('PayPal email address for collecting payments'),
    deliv_tablePlan: z.number().int().optional().describe('Enable table/seats management'),
    deliv_takeAway: z.number().int().optional().describe('Enable takeaway orders'),
    deliv_drivethru: z.number().int().optional().describe('Enable drive-thru orders'),
    deliv_deliver: z.number().int().optional().describe('Enable home delivery management'),
    deliv_bar: z.number().int().optional().describe('Enable counter/bar sales'),
    deliv_relayDeposit: z.number().int().optional().describe('Enable delivery to a relay point'),
    deliv_default: z.number().int().optional().describe('Default delivery method ID'),
    receipt_showVat: z.number().int().optional().describe('Display VAT breakdown on tickets'),
    receipt_showShopName: z.number().int().optional().describe('Display shop name on tickets'),
    receipt_showCashbox: z.number().int().optional().describe("Display cashier's name on receipts"),
    receipt_showSeller: z.number().int().optional().describe("Display seller's name on tickets"),
    receipt_showClient: z.number().int().optional().describe("Display customer's name on tickets"),
    receipt_showAddress: z.number().int().optional().describe("Display store's contact details on tickets"),
    receipt_showCompanyRegistrationNum: z.number().int().optional().describe("Display store's company number on receipts"),
    receipt_showClientSurname: z.number().int().optional().describe("Display customer's first name on tickets"),
    receipt_showClientAddress: z.number().int().optional().describe("Display customer's address on tickets"),
    receipt_showClientPhone: z.number().int().optional().describe("Display customer's phone number on tickets"),
    receipt_showGlobalVat: z.number().int().optional().describe('Display global VAT total on tickets'),
    receipt_showComment: z.number().int().optional().describe('Show order comment on tickets'),
    receipt_showPricesBeforeTaxes: z.number().int().optional().describe('Display prices excl. VAT on tickets'),
    orderRequires_deliveryChoice: z.number().int().optional().describe('Delivery method required for each order'),
    orderRequires_name: z.number().int().optional().describe("Customer last name required for each order"),
    orderRequires_surname: z.number().int().optional().describe("Customer first name required for each order"),
    orderRequires_address: z.number().int().optional().describe("Customer address required for each order"),
    orderRequires_email: z.number().int().optional().describe('Customer email required for each order'),
    orderRequires_phone: z.number().int().optional().describe('Customer phone required for each order'),
    orderRequires_date: z.number().int().optional().describe('Date selection required for each order'),
    orderRequires_CompanyRegistrationNum: z.number().int().optional().describe("Customer company number required for each order"),
    orderRequires_comment: z.number().int().optional().describe('Comment required for each order'),
    enable_stock: z.number().int().optional().describe('Activate inventory/stock management'),
    enable_barcodes: z.number().int().optional().describe('Enable barcode scanning'),
    enable_departments: z.number().int().optional().describe('Activate department/shelf management'),
    enable_departmentsGroups: z.number().int().optional().describe('Enable department group management'),
    enable_credits: z.number().int().optional().describe('Enable customer credit management'),
    enable_descriptionsForItems: z.number().int().optional().describe('Enable descriptions for catalog items'),
    enable_variations: z.number().int().optional().describe('Enable product variation management'),
    enable_delivShop: z.number().int().optional().describe('Activate deliveries via Deliv.shop'),
    enable_relayDeposit: z.number().int().optional().describe('Enable pickup/relay point management'),
    enable_descriptionForVariations: z.number().int().optional().describe('Enable descriptions for variation choices'),
    enable_dateOfConsumption: z.number().int().optional().describe('Enable expiration date management'),
    enable_coupons: z.number().int().optional().describe('Enable coupon management'),
    enable_weightForItems: z.number().int().optional().describe('Enable item weight management'),
    enable_whiteLabel: z.number().int().optional().describe('Enable white labeling (cannot be disabled once enabled)'),
    whiteLabelAdminUserID: z.union([z.number().int(), z.string()]).optional().describe('White label administrator user ID'),
    isWebShopEnabled: z.number().int().optional().describe('Activate the online webshop'),
    webShopURL: z.string().optional().describe('Webshop URL'),
    webShopLang: z.string().optional().describe('Webshop language'),
    webShopCol1: z.string().optional().describe('Webshop background color 1 (hex)'),
    webShopCol2: z.string().optional().describe('Webshop background color 2 (hex)'),
    webShopCol3: z.string().optional().describe('Webshop background color 3 (hex)'),
    webShopColT1: z.string().optional().describe('Webshop text color 1 (hex)'),
    webShopColT2: z.string().optional().describe('Webshop text color 2 (hex)'),
    webShopColT3: z.string().optional().describe('Webshop text color 3 (hex)'),
    prestaShopApiKey: z.string().optional().describe('Prestashop API key'),
    prestaShopURL: z.string().optional().describe('Prestashop store URL'),
    enableYavin: z.number().int().optional().describe('Enable Yavin payment terminal'),
    yavinSecret: z.string().optional().describe('Yavin secret code'),
    yavinSerial: z.string().optional().describe('Yavin terminal serial number'),
    enableVivaWallet: z.number().int().optional().describe('Enable Viva.com payment collection'),
    vivaWalletMerchant: z.string().optional().describe('Viva.com Merchant ID'),
    vivaAccoundID: z.string().optional().describe('Viva.com account ID'),
} satisfies Record<string, ZodTypeAny>;


type ListAccountsArgs = InferFromShape<typeof ListAccountsShape>;
type CreateAccountArgs = InferFromShape<typeof CreateAccountShape>;
type RequestOtpArgs = InferFromShape<typeof RequestOtpShape>;
type LoginWithOtpArgs = InferFromShape<typeof LoginWithOtpShape>;
type EditAccountArgs = InferFromShape<typeof EditAccountShape>;

const otpErrors: ReadonlyMap<string, string> = new Map([
    ['invalid_request', 'Invalid request data.'],
    ['invalid_email', 'Provide a valid email address.'],
    ['email_confirmation_required', 'Email confirmation is required. Request a new code.'],
    ['invalid_credential', 'Email confirmation is invalid or expired. Request a new code.'],
    ['invalid_otp', 'The confirmation code is invalid or expired. Request a new code.'],
    ['otp_expired', 'The confirmation code is invalid or expired. Request a new code.'],
    ['invalid_email_proof', 'Email confirmation is invalid or expired. Request a new code.'],
    ['account_selection_required', 'Select an account to continue.'],
    ['too_many_accounts', 'Too many accounts are associated with this email. Use an account identifier.'],
    ['rate_limited', 'Too many requests. Please try again later.'],
    ['auth_busy', 'Another authentication request is running. Please try again.'],
    ['account_unavailable', 'This account is unavailable.'],
    ['api_admin_required', 'Only an administrator may obtain API credentials. Ask an administrator for a dedicated key.'],
    ['webservices_disabled', 'Webservices are disabled for this account.'],
    ['identity_interactive_required', 'Sign in to Kash.click and use a dedicated API key.'],
    ['mfa_interactive_required', 'Sign in to Kash.click with your second factor and use a dedicated API key.'],
    ['shop_closed', 'This establishment is closed.'],
    ['service_unavailable', 'The service is temporarily unavailable. Please try again later.'],
]);

function sessionToolResult(data: unknown, source: 'account_create' | 'auth_login_with_otp') {
    const response = data && typeof data === 'object' ? data as Record<string, unknown> : {};
    const { APIKEY, SHOPID, success, code } = response;
    const creating = source === 'account_create';
    // Only publish a shop identifier and messages defined here. Even an upstream
    // error message or a nested field can contain credentials.
    const validShopId = typeof SHOPID === 'string'
        ? /^[1-9]\d*$/.test(SHOPID)
        : typeof SHOPID === 'number' && Number.isSafeInteger(SHOPID) && SHOPID > 0;
    if (success === true && validShopId && typeof APIKEY === 'string' && APIKEY.trim()) {
        setSessionAuth({ ok: true, APIKEY, SHOPID: String(SHOPID), scopes: ['*'] });
        process.stderr.write(`[caisse][${source}] Session initialisée pour SHOPID=${SHOPID}\n`);
        const result = {
            success: true,
            SHOPID,
            result: creating ? 'Account created and session initialized.' : 'Signed in successfully.',
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], structuredContent: result };
    }

    let errorCode = creating ? 'account_creation_failed' : 'login_failed';
    let message = creating
        ? 'Could not confirm account creation. Check whether the account exists before retrying.'
        : 'Could not complete sign-in. Check the email address and confirmation code.';
    if (success === true) {
        errorCode = 'session_unavailable';
        message = creating
            ? 'The account was created, but the session could not be initialized. Sign in to recover access.'
            : 'Kash confirmed sign-in, but the session could not be initialized. Request a new code.';
    } else if (creating && data === 'This email is already registered, connect with your existing account') {
        errorCode = 'account_already_exists';
        message = 'This email is already registered. Sign in with your existing account.';
    } else if (creating && code === 'service_unavailable') {
        errorCode = code;
        message = 'The shop may already exist. Recover access before retrying creation.';
    } else if (!creating && typeof code === 'string') {
        const knownError = otpErrors.get(code);
        if (knownError) {
            errorCode = code;
            message = knownError;
        }
    }

    const result = { success: false, code: errorCode, result: message };
    return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], structuredContent: result };
}

// ============================================================
// REGISTER
// ============================================================

export function registerAuthTools(server: McpServer | any) {

    // -- LIST ACCOUNTS --
    server.registerTool(
        'account_list',
        {
            title: t('tools.account.list.title'),
            description: t('tools.account.list.description'),
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
            title: t('tools.account.create.title'),
            description: getLang() === 'fr'
                ? "Crée un compte Kash avec une adresse email et un nom de boutique. En cas de succès, renvoie l'identifiant de la boutique et ouvre la session. Demandez à l'utilisateur de valider son adresse via le lien reçu par email."
                : 'Create a Kash account with an email address and a shop name. On success, return the shop ID and open the session. Ask the user to verify their email via the link they receive.',
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
            return sessionToolResult(data, 'account_create');
        }
    );

    // -- REQUEST OTP --
    server.registerTool(
        'auth_request_otp',
        {
            title: t('tools.auth.request.otp.title'),
            description: t('tools.auth.request.otp.description'),
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
            title: t('tools.auth.login.with_otp.title'),
            description: getLang() === 'fr'
                ? "Appelez d'abord auth_request_otp, puis transmettez le challengeId obtenu et le code reçu par email. En cas de succès, renvoie l'identifiant de la boutique et ouvre la session."
                : 'Call auth_request_otp first, then pass its challengeId and the code received by email. On success, return the shop ID and open the session.',
            inputSchema: LoginWithOtpShape,
            annotations: { destructiveHint: false, idempotentHint: false },
        },
        async (input: LoginWithOtpArgs) => {
            const data = await postForm('/workers/getAuthTokenWithOTP.php', {
                email: input.email,
                otp: input.otp,
                challengeId: input.challengeId,
                accountID: input.accountID,
            });
            return sessionToolResult(data, 'auth_login_with_otp');
        }
    );

    // -- EDIT ACCOUNT --
    server.registerTool(
        'account_edit',
        {
            title: t('tools.account.edit.title'),
            description: t('tools.account.edit.description'),
            inputSchema: EditAccountShape,
            annotations: { destructiveHint: false, idempotentHint: false },
        },
        async (input: EditAccountArgs, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const body: Record<string, unknown> = { shopID: shopId, key: apiKey };
            appendData(body, input as Record<string, unknown>);
            const data = await postForm('/workers/editShop.php', body);
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
                structuredContent: data,
            };
        }
    );

    // -- SHOW SHOP INFOS --
    server.registerTool(
        'account_show_infos',
        {
            title: t('tools.account.show_infos.title'),
            description: t('tools.account.show_infos.description'),
            inputSchema: GetShopInfosShape,
            annotations: { readOnlyHint: true },
        },
        async (_input: unknown, ctx: Ctx) => {
            const { shopId, apiKey } = resolveAuth(undefined, ctx);
            const data = await postForm('/workers/getShopInfos.php', {
                shopID: shopId,
                key: apiKey,
            });
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
            title: t('tools.auth.logout.title'),
            description: t('tools.auth.logout.description'),
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
