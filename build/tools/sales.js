import { z } from 'zod';
import { postForm, postJsonRaw } from '../support/http.js';
const USE_V2 = String(process.env.USE_V2 || 'false').toLowerCase() === 'true';
/** Item de vente : soit du catalogue, soit une ligne libre */
const SalesItemShape = {
    type: z.enum(['catalog', 'free']).default('catalog'),
    // catalog
    productId: z.string().optional(),
    quantity: z.union([z.number(), z.string()]).optional(),
    titleOverride: z.string().optional(),
    priceOverride: z.union([z.number(), z.string()]).optional(),
    declinaisons: z.array(z.string()).optional(),
    // free (ligne manuelle)
    departmentId: z.union([z.string(), z.number()]).optional(),
    price: z.union([z.number(), z.string()]).optional(),
    title: z.string().optional(),
};
const ClientShape = {
    firstname: z.string().optional(),
    lastname: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    zip: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
};
/** ⚠️ ZodRawShape (pas z.object) — conforme à ton SDK MCP */
const SalesCreateShape = {
    shopId: z.string(),
    apiKey: z.string(),
    payment: z.union([z.number(), z.string()]).transform((v) => Number(v)),
    deliveryMethod: z.union([
        z.number().int().min(0).max(6),
        z.enum(['0', '1', '2', '3', '4', '5', '6'])
    ]).transform((v) => Number(v)),
    idUser: z.union([z.number().int(), z.string()]).optional(),
    idClient: z.union([z.number().int(), z.string()]).optional(),
    client: z.object(ClientShape).partial().optional(),
    items: z.array(z.object(SalesItemShape)).min(1),
};
/** Encode le tableau items en format legacy itemsList[] */
function encodeItemsList(items) {
    const out = [];
    for (const it of items) {
        if (it.type === 'catalog') {
            const parts = [
                it.productId ?? '',
                it.quantity ?? 1,
                it.titleOverride ?? '',
                it.priceOverride ?? '',
            ];
            if (it.declinaisons?.length)
                parts.push(...it.declinaisons);
            out.push(parts.join('_'));
        }
        else {
            // ligne libre : -<departmentId>_<price>_<title>
            out.push(`-${it.departmentId ?? ''}_${it.price ?? ''}_${it.title ?? ''}`);
        }
    }
    return out;
}
export function registerSalesTools(server) {
    // -- SALES CREATE --
    server.registerTool('sales_create', {
        title: 'Créer une vente',
        description: 'Crée une vente (v2 JSON si USE_V2=true, sinon legacy webapp.php)',
        inputSchema: SalesCreateShape, // ✅ ZodRawShape
    }, async (input) => {
        // ---------- Mode v2 JSON ----------
        if (USE_V2) {
            // On envoie tout l’objet tel quel ; le backend v2 est supposé accepter la structure JSON
            const data = await postJsonRaw('/workers/webapp_v2.php', input, {
                'X-Shop-Id': input.shopId,
                'X-Api-Key': input.apiKey,
            });
            // Affichage texte (compat Claude) + structuredContent pour usage programmatique
            return {
                content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
                structuredContent: data,
            };
        }
        // ---------- Mode legacy ----------
        const body = {
            idboutique: input.shopId,
            key: input.apiKey,
            payment: input.payment,
            deliveryMethod: String(input.deliveryMethod),
        };
        if (input.idUser !== undefined)
            body.idUser = input.idUser;
        if (input.idClient !== undefined)
            body.idClient = input.idClient;
        if (!input.idClient && input.client) {
            // Le legacy aime les clés client[...]
            for (const [k, v] of Object.entries(input.client)) {
                if (v !== undefined && v !== null && v !== '') {
                    body[`client[${k}]`] = String(v);
                }
            }
        }
        body['itemsList[]'] = encodeItemsList(input.items);
        const data = await postForm('/workers/webapp.php', body);
        return {
            content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            structuredContent: data,
        };
    });
}
