import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodTypeAny } from 'zod';
import { postForm } from '../support/http.js';
import { t } from '../i18n/index.js';
import { setSessionAuth } from '../context.js';

type InferFromShape<S extends Record<string, ZodTypeAny>> = z.infer<z.ZodObject<S>>;

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

const CreateAccountShape = {
    email: z.string().email(),
    accountTitle: z.string(),
    configType: z.enum(CONFIG_TYPES).optional(),
    // Informations légales / adresse
    companyRegistrationNum: z.string().optional(),
    taxRegistrationNum: z.string().optional(),
    adressline1: z.string().optional(),
    postCode: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
    phone: z.string().optional(),
    currency: z.string().optional(),
    language: z.string().optional(),
} satisfies Record<string, ZodTypeAny>;

type CreateAccountArgs = InferFromShape<typeof CreateAccountShape>;

export function registerAccountTools(server: McpServer | any) {

    server.registerTool(
        'account_create',
        {
            title: t('tools.account_create.title'),
            description: t('tools.account_create.description'),
            inputSchema: CreateAccountShape,
        },
        async (input: CreateAccountArgs) => {
            // Cet endpoint est PUBLIC : pas de resolveAuth() nécessaire
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

            // Si la création réussit, on initialise automatiquement la session
            // pour que les autres tools soient utilisables immédiatement
            if (data && typeof data === 'object' && (data as any).success === true) {
                const { APIKEY, SHOPID } = data as any;
                if (APIKEY && SHOPID) {
                    setSessionAuth({ ok: true, APIKEY, SHOPID, scopes: ['*'] });
                    process.stderr.write(`[caisse][account_create] Session auto-initialisée pour SHOPID=${SHOPID}\n`);
                }
            }

            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
                structuredContent: data,
            };
        }
    );
}