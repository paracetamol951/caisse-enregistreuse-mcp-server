import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { KASH_SPEC } from './spec.js';
import { KASH_CATALOG_GUIDE } from './catalog-guide.js';
import { KASH_CLIENT_GUIDE } from './client-guide.js';

export function registerResources(server: McpServer | any) {
    server.resource(
        'kash-spec',
        'kash://spec',
        {
            mimeType: 'text/plain',
            description: 'Kash agent specification: payment values, delivery methods, VAT logic, order states, and agent behavior rules.',
        },
        async () => ({
            contents: [{
                uri: 'kash://spec',
                mimeType: 'text/plain',
                text: KASH_SPEC,
            }],
        })
    );

    server.resource(
        'kash-catalog-guide',
        'kash://catalog-guide',
        {
            mimeType: 'text/plain',
            description: 'Kash catalog guide: product fields, department hierarchy, variation system, stock management, visibility flags, and kitchen preparation.',
        },
        async () => ({
            contents: [{
                uri: 'kash://catalog-guide',
                mimeType: 'text/plain',
                text: KASH_CATALOG_GUIDE,
            }],
        })
    );

    server.resource(
        'kash-client-guide',
        'kash://client-guide',
        {
            mimeType: 'text/plain',
            description: 'Kash client/CRM guide: identity fields, address, business data, loyalty, blacklist, segmentation, and agent rules for customer management.',
        },
        async () => ({
            contents: [{
                uri: 'kash://client-guide',
                mimeType: 'text/plain',
                text: KASH_CLIENT_GUIDE,
            }],
        })
    );
}