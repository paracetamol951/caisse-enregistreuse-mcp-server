import { z } from 'zod';
import { get } from '../support/http.js';
import { t } from '../i18n/index.js';
/** Entrées communes à toutes les listes */
const CommonShape = {
    shopId: z.string(),
    apiKey: z.string(),
    format: z.enum(['json', 'csv', 'html']).default('json'),
};
const getOrderShape = {
    shopId: z.string(),
    apiKey: z.string(),
    order_id: z.number().int(),
};
const getOrdersShape = {
    shopId: z.string(),
    apiKey: z.string(),
    validatedOrders: z.boolean(),
    from_date_ISO8601: z.string().datetime(),
    to_date_ISO8601: z.string().datetime(),
    filterDeliveryMethod: z.union([
        z.number().int().min(0).max(6),
        z.enum(['0', '1', '2', '3', '4', '5', '6'])
    ]).transform((v) => Number(v)).optional(),
};
function structData(data) {
    return {
        content: [
            {
                type: 'text',
                text: typeof data === 'string'
                    ? data
                    : JSON.stringify(data, null, 2),
            },
        ],
        structuredContent: data, // on garde pour usage programmatique
    };
}
/** Fabrique un tool "liste" minimaliste */
function registerSimple(server, toolName, path, title, entityLabel) {
    server.registerTool(toolName, {
        title,
        description: `Liste des ${entityLabel}`,
        inputSchema: CommonShape, // ZodRawShape
    }, async ({ shopId, apiKey, format }) => {
        const data = await get(path, { idboutique: shopId, key: apiKey, format });
        const isText = typeof data === 'string' || format !== 'json';
        const content = isText
            ? [{ type: 'text', text: String(data) }]
            : [{ type: 'json', json: data }];
        return structData(data);
        //return { content, structuredContent: isText ? undefined : data };
    });
}
export function registerDataTools(server) {
    //  Garde les mêmes endpoints que ton backend PHP
    // Noms de tools avec UNDERSCORE (comme vus dans tes logs) t('tools.sales_create.title')
    registerSimple(server, 'data_list_articles', '/workers/getPlus.php', t('tools.data_list_articles.description'), t('tools.data_list_articles.title'));
    registerSimple(server, 'data_list_departments', '/workers/getDepartments.php', t('tools.data_list_departments.description'), t('tools.data_list_departments.title'));
    registerSimple(server, 'data_list_department_groups', '/workers/getDepartmentsGroups.php', t('tools.data_list_department_groups.description'), t('tools.data_list_department_groups.title'));
    registerSimple(server, 'data_list_clients', '/workers/getClients.php', t('tools.data_list_clients.description'), t('tools.data_list_clients.title'));
    registerSimple(server, 'data_list_declinaisons', '/workers/getDeclinaisons.php', t('tools.data_list_declinaisons.description'), t('tools.data_list_declinaisons.title'));
    registerSimple(server, 'data_list_deliveries', '/workers/getLivreurs.php', t('tools.data_list_deliveries.description'), t('tools.data_list_deliveries.title'));
    registerSimple(server, 'data_list_payments', '/workers/getPaymentModes.php', t('tools.data_list_payments.description'), t('tools.data_list_payments.title'));
    registerSimple(server, 'data_list_cashboxes', '/workers/getCashbox.php', t('tools.data_list_cashboxes.description'), t('tools.data_list_cashboxes.title'));
    registerSimple(server, 'data_list_delivery_zones', '/workers/getDeliveryZones.php', t('tools.data_list_delivery_zones.description'), t('tools.data_list_delivery_zones.title'));
    registerSimple(server, 'data_list_relay_points', '/workers/getRelayDeposit.php', t('tools.data_list_relay_points.description'), t('tools.data_list_relay_points.title'));
    registerSimple(server, 'data_list_discounts', '/workers/getDiscounts.php', t('tools.data_list_discounts.description'), t('tools.data_list_discounts.title'));
    registerSimple(server, 'data_list_users', '/workers/getUsers.php', t('tools.data_list_users.description'), t('tools.data_list_users.title'));
    registerSimple(server, 'data_list_tables', '/workers/getTables.php', t('tools.data_list_tables.description'), t('tools.data_list_tables.title'));
    //registerSimple(server, 'data_list_orders', '/workers/getPending.php', t('tools.data_list_orders.description'), t('tools.data_list_orders.title'),);
    server.registerTool('data_list_orders', {
        title: t('tools.data_list_orders.title'),
        description: t('tools.data_list_orders.description'),
        inputSchema: getOrdersShape, // ZodRawShape
    }, async ({ shopId, apiKey, validatedOrders, from_date_ISO8601, to_date_ISO8601, filterDeliveryMethod }) => {
        const data = await get('/workers/getOrders.php', { idboutique: shopId, key: apiKey, validatedOrders, from_date_ISO8601, to_date_ISO8601, filterDeliveryMethod });
        return structData(data);
        //return { content, structuredContent: isText ? undefined : data };
    });
    server.registerTool('order_detail', {
        title: t('tools.order_detail.title'),
        description: t('tools.order_detail.description'),
        inputSchema: getOrderShape, // ZodRawShape
    }, async ({ shopId, apiKey, order_id }) => {
        const data = await get('/workers/getOrder.php', { idboutique: shopId, key: apiKey, order_id });
        return structData(data);
        //return { content, structuredContent: isText ? undefined : data };
    });
    // je pourrais ajouter getReport : obtenir les rapports de vente et getOrders : liste des commandes
}
