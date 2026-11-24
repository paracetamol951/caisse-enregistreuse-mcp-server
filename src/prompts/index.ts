import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer | any) {

    server.registerPrompt(
        'authenticate',
        {
            title: 'Authenticate with a Kash shop',
            description: 'Step-by-step guide to log in to a Kash shop via email OTP and initialise the session.',
            argsSchema: {
                email: z.string().email().describe('Email address linked to the Kash account'),
            },
        },
        ({ email }: { email: string }) => ({
            messages: [{
                role: 'user',
                content: {
                    type: 'text',
                    text: `Please authenticate me with my Kash account using the email "${email}".

Follow these steps:
1. Call auth_request_otp with email="${email}" and keep the returned challengeId. Include the accountID if I provided it.
2. Ask me to enter the OTP code I received by email.
3. Call auth_login_with_otp with the email, challengeId and code. Include the accountID if known.
4. Confirm whether the session opened. If Kash requires an account selection, ask me for the account ID and request a new code for it.`,
                },
            }],
        })
    );

    server.registerPrompt(
        'record-sale',
        {
            title: 'Record a new sale',
            description: 'Guided workflow to create a complete sale: find products, identify the client, choose payment method, and submit.',
            argsSchema: {
                items_description: z.string().describe('Natural-language description of what was sold (e.g. "2 coffees and 1 croissant")'),
                payment_method: z.string().optional().describe('Payment method name or ID (e.g. "cash", "card"). Leave empty to create an unpaid quote.'),
            },
        },
        ({ items_description, payment_method }: { items_description: string; payment_method?: string }) => ({
            messages: [{
                role: 'user',
                content: {
                    type: 'text',
                    text: `Please record a new sale for: "${items_description}"${payment_method ? ` � payment: ${payment_method}` : ' (unpaid quote)'}.

Steps:
1. Call data_list_products to find matching products by name.
2. Call data_list_departments if no exact product match � use a department item instead.
3. ${payment_method ? `Call data_list_payments_modes to find the ID for "${payment_method}".` : 'Leave payment unset to save as an unpaid quote.'}
4. Build the items array with the correct type ('catalog', 'dept', or 'free') and IDs.
5. Save a client-generated idempotencyKey (for example a UUID) and the full arguments before calling order_create. For a confirmed partial payment, include the positive amount collected as paymentAmount.
6. After a timeout or unknown result, retry with the same key and arguments. If the result is unresolved, check the order and its payments before starting another operation.
7. On success, confirm the sale and show the returned order ID. For a later payment, use order_edit on this ID with a distinct key.`,
                },
            }],
        })
    );

    server.registerPrompt(
        'daily-report',
        {
            title: 'Get daily sales report',
            description: 'Retrieve and summarise the sales report for a given date or today.',
            argsSchema: {
                date: z.string().optional().describe('Date in YYYY-MM-DD format. Leave empty for yesterday\'s report.'),
            },
        },
        ({ date }: { date?: string }) => {
            let dateInstruction = 'Omit all date parameters to get yesterday\'s report.';
            if (date) {
                const [y, m, d] = date.split('-');
                dateInstruction = `Use y=${y}, m=${Number(m)}, d=${Number(d)}.`;
            }
            return {
                messages: [{
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `Please fetch the sales report${date ? ` for ${date}` : ' for yesterday'}.

Steps:
1. Call report_get with ${dateInstruction}
2. Parse and summarise the HTML result: total revenue, number of orders, top departments, VAT breakdown, and payment methods.
3. Present the summary in a clear, readable format.`,
                    },
                }],
            };
        }
    );

    server.registerPrompt(
        'add-product',
        {
            title: 'Add a new product to the catalog',
            description: 'Guided workflow to create a product: choose department, VAT rate, price and optional variations.',
            argsSchema: {
                product_name: z.string().describe('Name of the product to add'),
                price: z.string().optional().describe('Selling price (e.g. "4.50")'),
            },
        },
        ({ product_name, price }: { product_name: string; price?: string }) => ({
            messages: [{
                role: 'user',
                content: {
                    type: 'text',
                    text: `Please add a new product called "${product_name}"${price ? ` priced at ${price}` : ''} to the catalog.

Steps:
1. Call data_list_departments to list available departments � ask me which one to assign this product to.
2. Call data_list_vats to list VAT rates � ask me which one applies (or use the department default).
3. Optionally call data_list_variations if this product has variants (size, colour, etc.).
4. Call plu_add with title="${product_name}"${price ? `, price=${price}` : ''}, the chosen deptID, vatID, and any variationIDs.
5. Confirm the product was created and show its new ID.`,
                },
            }],
        })
    );
}
