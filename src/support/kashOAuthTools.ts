import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { registerAuthTools } from '../tools/auth.js';
import { registerCatalogTools } from '../tools/catalog.js';
import { registerCatalogExtrasTools } from '../tools/catalog_extras.js';
import { registerClientTools } from '../tools/clients.js';
import { registerDataTools, registerDeliveryMethodsTool } from '../tools/data.js';
import { registerPaymentModeTools } from '../tools/payment_modes.js';
import { oauthSaleCreatePayment, oauthSalesItem, registerSalesTools, saleAddsInlineClient, saleIdempotencyKey } from '../tools/sales.js';
import { registerVatTools } from '../tools/vats.js';
import { cartQuoteScope, cartQuoteToolName } from '../tools/cartQuote.js';
import { discountVoucherToolScopes } from '../tools/discountVouchers.js';
import { loyaltyGiftCardToolScopes } from '../tools/loyaltyGiftCards.js';
import { accountingTransmissionsScope, invoiceDocumentsScope, invoiceDocumentsToolName, salesSummaryScope, salesSummaryToolName } from '../tools/partnerReads.js';
import { mailboxScopes, mailboxTools, registerKashMailboxTools } from './kashOAuthMailboxTools.js';
import { withKashOAuthWorker, type WorkerMethod } from './kashOAuthWorker.js';
import { callPartnerRead, KashReadError, partnerReadPlan } from './partnerReadTransport.js';
import { saleWorkerResponse, saleWriteError } from './http.js';

export const kashOAuthScopes = [
    'catalog.read', 'catalog.write', 'customers.read', 'customers.write',
    'sales.read', 'sales.write', 'reports.read', 'settings.read', 'settings.write',
    invoiceDocumentsScope, accountingTransmissionsScope,
    ...mailboxScopes,
] as const;

type Scope = typeof kashOAuthScopes[number];
type Policy = {
    scope: Scope;
    method: WorkerMethod;
    worker: string;
    idempotency?: boolean;
};

const read = (scope: Scope, worker: string, method: WorkerMethod = 'GET'): Policy => ({ scope, method, worker });
const write = (scope: Scope, worker: string, idempotency = false): Policy => ({ scope, method: 'POST', worker, idempotency });

const toolPolicies: Record<string, Policy> = {
    data_list_departments: read('catalog.read', 'getDepartments'),
    data_list_department_groups: read('catalog.read', 'getDepartmentGroups'),
    data_list_variations: read('catalog.read', 'getDeclinaisons'),
    data_list_discounts: read('catalog.read', 'getDiscounts'),
    data_list_vats: read('catalog.read', 'getVATs'),
    plu_add: write('catalog.write', 'addPlu', true),
    plu_edit: write('catalog.write', 'editPlu', true),
    plu_delete: write('catalog.write', 'delPlu'),
    dept_add: write('catalog.write', 'addDept'),
    dept_edit: write('catalog.write', 'editDept'),
    dept_delete: write('catalog.write', 'delDept'),
    dept_group_add: write('catalog.write', 'addGrpDept'),
    dept_group_edit: write('catalog.write', 'editGrpDept'),
    dept_group_delete: write('catalog.write', 'delGrpDept'),
    variation_add: write('catalog.write', 'addVariation'),
    variation_edit: write('catalog.write', 'editVariation'),
    variation_delete: write('catalog.write', 'delVariation'),
    variation_choice_add: write('catalog.write', 'addVariationItem'),
    variation_choice_edit: write('catalog.write', 'editVariationItem'),
    variation_choice_delete: write('catalog.write', 'delVariationItem'),
    vat_add: write('catalog.write', 'addVat'),
    vat_edit: write('catalog.write', 'editVat'),
    vat_delete: write('catalog.write', 'delVat'),
    data_list_clients: read('customers.read', 'getClients'),
    client_add: write('customers.write', 'addClient', true),
    client_edit: write('customers.write', 'editClient', true),
    client_delete: write('customers.write', 'delClient'),
    data_list_orders: read('sales.read', 'getOrders'),
    order_detail: read('sales.read', 'getOrder'),
    data_list_pending_orders: read('sales.read', 'getPending'),
    order_create: write('sales.write', 'webapp', true),
    order_edit: write('sales.write', 'editOrder', true),
    report_get: read('reports.read', 'getSales'),
    account_show_infos: read('settings.read', 'getShopInfos', 'POST'),
    data_list_users: read('settings.read', 'getUsers'),
    data_list_payments_modes: read('settings.read', 'getPaymentModes'),
    data_list_cashboxes: read('settings.read', 'getCashbox'),
    data_list_tables: read('settings.read', 'getTables'),
    data_list_delivery_men: read('settings.read', 'getLivreurs'),
    data_list_delivery_methods: read('settings.read', 'getLivraisons'),
    data_list_delivery_zones: read('settings.read', 'getDeliveryZones'),
    data_list_relay_points: read('settings.read', 'getRelayDeposit'),
    account_edit: write('settings.write', 'editShop'),
    payment_mode_add: write('settings.write', 'addPaymentMethod'),
    payment_mode_delete: write('settings.write', 'delPaymentMethod'),
    ...mailboxTools,
};

const restrictedShopFields = [
    'paypalAddress', 'enable_whiteLabel', 'whiteLabelAdminUserID', 'webShopURL',
    'prestaShopApiKey', 'prestaShopURL', 'enableYavin', 'yavinSecret', 'yavinSerial',
    'enableVivaWallet', 'vivaWalletMerchant', 'vivaAccoundID',
];
export const kashProductScope = 'catalog.read';

export function kashOAuthToolScopes(name: string, args?: unknown): Scope[] {
    if (name === 'data_list_products') return [kashProductScope];
    if (name === cartQuoteToolName) return [cartQuoteScope];
    const discountVoucherScopes = discountVoucherToolScopes(name);
    if (discountVoucherScopes.length) return discountVoucherScopes;
    const loyaltyGiftScopes = loyaltyGiftCardToolScopes(name);
    if (loyaltyGiftScopes.length) return loyaltyGiftScopes;
    if (name === salesSummaryToolName) return [salesSummaryScope];
    if (name === invoiceDocumentsToolName) return [invoiceDocumentsScope];
    if (!Object.hasOwn(toolPolicies, name)) return [];
    const { scope } = toolPolicies[name];
    return scope === 'sales.write' && saleAddsInlineClient(args) ? [scope, 'customers.write'] : [scope];
}

export type KashOAuthGrant = {
    scopes: ReadonlySet<string>;
    shopId?: string;
    tokenRef: string;
};

type OAuthToolOptions = {
    grant?: KashOAuthGrant;
    issuer: string;
    serviceToken: string;
    challenge(scopes: string[], error?: string): string;
};

type ToolConfig = {
    title?: string;
    description?: string;
    inputSchema?: z.ZodRawShape;
    annotations?: ToolAnnotations;
};

async function workerResponse(response: Response, textOutput: boolean, emptyListOnNull: boolean): Promise<unknown> {
    if (!response.ok) throw new KashReadError(response.status);
    const text = await response.text();
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
        if (textOutput && (contentType.includes('text/html') || contentType.includes('text/csv'))) return text;
    }
    // The legacy order worker returns JSON null for an empty date range.
    if (emptyListOnNull && data === null) return [];
    const json = data && typeof data === 'object' ? data as Record<string, unknown> : undefined;
    if (!json || json.success === false || json.error) throw new KashReadError(422);
    return data;
}

function toolError(text: string, authentication?: string): CallToolResult {
    return {
        isError: true,
        content: [{ type: 'text', text }],
        ...(authentication ? { _meta: { 'mcp/www_authenticate': [authentication] } } : {}),
    };
}

export function registerKashOAuthWorkerTools(server: McpServer, options: OAuthToolOptions): void {
    const { grant, issuer, serviceToken, challenge } = options;
    const adapter = {
        registerTool(
            name: string,
            config: ToolConfig,
            handler: (args: Record<string, unknown>, ctx: Ctx) => Promise<CallToolResult>,
        ) {
            if (!Object.hasOwn(toolPolicies, name)) return;
            const policy = toolPolicies[name];
            const path = '/workers/' + policy.worker + '.php';
            const readOnly = policy.scope.endsWith('.read');
            const saleWrite = policy.scope === 'sales.write';
            const schema = { ...config.inputSchema };
            if (name === 'account_edit') {
                for (const field of restrictedShopFields) delete schema[field];
            }
            if (saleWrite) {
                delete schema.idUser;
                const items = z.array(oauthSalesItem).max(150);
                schema.items = (name === 'order_create' ? items.min(1) : items.optional())
                    .describe(schema.items.description ?? 'Order lines.');
                if (name === 'order_create') schema.payment = oauthSaleCreatePayment;
                schema.client = schema.client.describe('New customer details, used when idClient is omitted. Requires customers.write in addition to sales.write.');
            }
            if (policy.idempotency && !saleWrite) schema.idempotencyKey = saleIdempotencyKey;

            server.registerTool(name, {
                ...config,
                inputSchema: schema,
                annotations: {
                    idempotentHint: readOnly,
                    ...config.annotations,
                    readOnlyHint: readOnly,
                    destructiveHint: !readOnly && (config.annotations?.destructiveHint === true
                        || name.endsWith('_edit') || name === 'order_create'),
                    ...(policy.idempotency ? { idempotentHint: true } : {}),
                    openWorldHint: false,
                },
                _meta: { securitySchemes: [{ type: 'oauth2', scopes: [policy.scope] }] },
            }, async (args) => {
                const required = kashOAuthToolScopes(name, args);
                if (!grant) return toolError('Reconnect your Kash account to use this tool.', challenge(required, 'invalid_token'));
                if (required.some((scope) => !grant.scopes.has(scope))) {
                    return toolError('Authorize access to this Kash tool.', challenge(required, 'insufficient_scope'));
                }
                if (!grant.shopId) return toolError('Reconnect your Kash account to use this tool.', challenge(required, 'invalid_token'));
                const { idempotencyKey: requestKey, ...input } = args;
                const shopId = grant.shopId;
                try {
                    return await withKashOAuthWorker({
                        shopId,
                        async call(method, workerPath, parameters) {
                            if (method !== policy.method || workerPath !== path) throw new Error('Unexpected Kash OAuth worker');
                            const partner = readOnly && partnerReadPlan(path, parameters, true);
                            if (partner) {
                                return callPartnerRead(issuer, shopId, partner, (url) => fetch(url, {
                                    method: 'GET',
                                    headers: {
                                        Authorization: 'Bearer ' + serviceToken,
                                        'X-Kash-Mcp-Token-Ref': grant.tokenRef,
                                        Accept: 'application/json, text/html',
                                    },
                                    signal: AbortSignal.timeout(15000),
                                    redirect: 'error',
                                }));
                            }
                            const url = new URL(path, issuer);
                            parameters.delete('key');
                            parameters.set('shopID', shopId);
                            if (parameters.has('idboutique')) parameters.set('idboutique', shopId);
                            if (method === 'GET') url.search = parameters.toString();
                            const request = fetch(url, {
                                method,
                                headers: {
                                    Authorization: 'Bearer ' + serviceToken,
                                    'X-Kash-Mcp-Token-Ref': grant.tokenRef,
                                    Accept: 'application/json, text/html, text/csv',
                                    ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
                                    ...(policy.idempotency && typeof requestKey === 'string' ? { 'Idempotency-Key': requestKey } : {}),
                                },
                                ...(method === 'POST' ? { body: parameters } : {}),
                                signal: AbortSignal.timeout(15000),
                                redirect: 'error',
                            });
                            const response = saleWrite ? await request.catch(() => null) : await request;
                            if (!response) return saleWriteError('network_outcome_unknown');
                            if (saleWrite && response.status !== 401 && response.status !== 403) {
                                return saleWorkerResponse(response);
                            }
                            const textOutput = name === 'report_get' || input.format === 'csv' || input.format === 'html';
                            return workerResponse(response, textOutput, name === 'data_list_orders');
                        },
                    }, () => handler(saleWrite ? args : input, {}));
                } catch (error) {
                    if (error instanceof KashReadError) {
                        if (error.status === 401) {
                            return toolError('Reconnect your Kash account to use this tool.', challenge(required, 'invalid_token'));
                        }
                        if (error.status === 403) return toolError('Kash denied access to this action or resource.');
                        if (error.status === 409) {
                            return toolError('Kash reported a conflict. Check the result before trying the action again.');
                        }
                        if (error.status < 500) return toolError('Kash rejected the action. Check the arguments and the selected resource.');
                    }
                    return toolError('Kash could not complete the request. Check its status before retrying a write.');
                }
            });
        },
    };

    registerAuthTools(adapter);
    registerCatalogTools(adapter);
    registerCatalogExtrasTools(adapter);
    registerClientTools(adapter);
    registerDataTools(adapter);
    registerDeliveryMethodsTool(adapter);
    registerPaymentModeTools(adapter);
    registerSalesTools(adapter);
    registerVatTools(adapter);
    registerKashMailboxTools(adapter.registerTool, issuer);
}
