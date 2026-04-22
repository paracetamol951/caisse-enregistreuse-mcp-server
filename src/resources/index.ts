import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { KASH_SPEC } from './spec.js';

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
}