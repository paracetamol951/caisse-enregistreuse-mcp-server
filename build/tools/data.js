import { z } from 'zod';
import { get } from '../support/http.js';
/** Entrées communes à toutes les listes */
const CommonShape = {
    shopId: z.string(),
    apiKey: z.string(),
    format: z.enum(['json', 'csv', 'html']).default('json'),
};
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
        //return { content, structuredContent: isText ? undefined : data };
    });
}
export function registerDataTools(server) {
    //  Garde les mêmes endpoints que ton backend PHP
    // Noms de tools avec UNDERSCORE (comme vus dans tes logs)
    registerSimple(server, 'data_list_articles', '/workers/getPlus.php', 'Lister les articles', 'Articles');
    registerSimple(server, 'data_list_departments', '/workers/getDepartments.php', 'Lister les rayons', 'Rayons');
    registerSimple(server, 'data_list_department_groups', '/workers/getDepartmentsGroups.php', 'Lister les groupes de rayons', 'Groupes de rayons');
    registerSimple(server, 'data_list_clients', '/workers/getClients.php', 'Lister les clients', 'Clients');
    registerSimple(server, 'data_list_declinaisons', '/workers/getDeclinaisons.php', 'Lister les déclinaisons', 'Déclinaisons d’articles');
    registerSimple(server, 'data_list_deliveries', '/workers/getLivreurs.php', 'Lister les méthodes de livraison', 'Livraisons');
    registerSimple(server, 'data_list_payments', '/workers/getPaymentModes.php', 'Lister les modes de paiement', 'Paiements');
    registerSimple(server, 'data_list_cashboxes', '/workers/getCashbox.php', 'Lister les caisses', 'Caisses');
    registerSimple(server, 'data_list_delivery_zones', '/workers/getDeliveryZones.php', 'Lister les zones de livraison', 'Zones de livraison');
    registerSimple(server, 'data_list_relay_points', '/workers/getRelayDeposit.php', 'Lister les points relais', 'Points relais');
    registerSimple(server, 'data_list_discounts', '/workers/getDiscounts.php', 'Lister les réductions', 'Réductions');
    registerSimple(server, 'data_list_users', '/workers/getUsers.php', 'Lister les utilisateurs', 'Utilisateurs');
}
