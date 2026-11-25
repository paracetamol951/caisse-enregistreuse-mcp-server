import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getSessionAuth } from '../context.js';
import type { KashOAuthGrant } from './kashOAuthTools.js';

export const partnerCursor = z.string().regex(/^[A-Za-z0-9_-]{1,1500}\.[A-Za-z0-9_-]{43}$/);
export const partnerPaging = {
    limit: z.number().int().min(1).max(200).optional(),
    cursor: partnerCursor.optional().describe('Copy the next_cursor from the previous page.'),
};
export const partnerPagination = z.object({ next_cursor: partnerCursor.nullable() });
export const partnerIdempotencyKey = z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/)
    .describe('Unique request key for this operation, such as a UUID. Reuse the same key and arguments when retrying.');

type PartnerRequest = {
    path: string;
    body?: Record<string, unknown>;
    page?: { limit?: number; cursor?: string };
    idempotencyKey?: string;
};
type ErrorResult = CallToolResult & { isError: true };
type Connection = { base: string; shopId: string; headers: Record<string, string>; onUnauthorized?: () => ErrorResult; isError?: never };
export type PartnerOAuthOptions = {
    grant?: KashOAuthGrant;
    issuer: string;
    serviceToken: string;
    challenge(scopes: string[], error?: string): string;
};
type PartnerTool = {
    name: string;
    scopes: readonly string[];
    register(server: McpServer, resolve: () => Connection | ErrorResult, oauth: boolean, unavailable: string): void;
};
const serviceUnavailable = 'The Kash partner service is temporarily unavailable.';

function toolError(message: string, challenge?: string): ErrorResult {
    return {
        isError: true,
        content: [{ type: 'text', text: message }],
        ...(challenge ? { _meta: { 'mcp/www_authenticate': [challenge] } } : {}),
    };
}

const errorMessages: Record<number, string> = {
    400: 'Kash rejected the request arguments.',
    403: 'The Kash connection has insufficient permissions for this tool or shop.',
    404: 'Kash could not find the requested resource in the connected shop.',
    409: 'The requested Kash resource is unavailable in its current state.',
    422: 'Kash cannot evaluate the request with these references or settings.',
    429: 'Kash is receiving too many requests. Retry later.',
};

async function callPartner(
    connection: Connection,
    request: PartnerRequest,
    output: z.ZodTypeAny,
    unavailable: string,
): Promise<CallToolResult> {
    try {
        const url = new URL('/api/partner/v1' + request.path, connection.base);
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
            return toolError('The Kash partner API requires HTTPS.');
        }
        url.searchParams.set('shop_id', connection.shopId);
        if (request.page?.limit !== undefined) url.searchParams.set('limit', String(request.page.limit));
        if (request.page?.cursor !== undefined) url.searchParams.set('cursor', request.page.cursor);
        const headers = {
            ...connection.headers, Accept: 'application/json',
            ...(request.body ? { 'Content-Type': 'application/json' } : {}),
            ...(request.idempotencyKey ? { 'Idempotency-Key': request.idempotencyKey } : {}),
        };
        const response = await fetch(url, {
            method: request.body ? 'POST' : 'GET',
            headers,
            body: request.body ? JSON.stringify(request.body) : undefined,
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
        });
        if (response.status === 401) {
            return connection.onUnauthorized?.() ?? toolError('The Kash partner credential was rejected.');
        }
        if (!response.ok) {
            if (response.status === 409 && request.idempotencyKey) {
                return toolError('Kash found a conflicting operation or resource state. Retry the original request with the same key and arguments.');
            }
            if (response.status === 403 || response.status === 422) {
                const code = (await response.json().catch(() => null))?.error?.code;
                if (response.status === 403 && code === 'personal_vouchers_disabled') {
                    return toolError('Personal vouchers are disabled for this shop.');
                }
                if (response.status === 422 && code === 'coupons_disabled') {
                    return toolError('Coupon management is disabled for this shop.');
                }
            }
            return toolError(errorMessages[response.status] ?? unavailable);
        }

        const data: Record<string, unknown> = output.parse(await response.json());
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    } catch {
        return toolError(unavailable);
    }
}

export function definePartnerTool<S extends string, I extends z.ZodRawShape, O extends z.ZodRawShape>(
    name: string,
    title: string,
    description: string,
    scopes: readonly S[],
    input: I,
    output: O,
    request: (input: z.infer<z.ZodObject<I>>) => PartnerRequest,
    { mutation = false } = {},
) {
    const inputSchema = z.object(input);
    const outputSchema = z.object(output);
    return {
        name,
        scopes,
        register(server: McpServer, resolve: () => Connection | ErrorResult, oauth: boolean, unavailable: string) {
            const tool = server.registerTool(name, {
                title,
                description,
                inputSchema: input as z.ZodRawShape,
                outputSchema: output,
                annotations: { readOnlyHint: !mutation, destructiveHint: mutation, idempotentHint: true, openWorldHint: false },
                ...(oauth ? { _meta: { securitySchemes: [{ type: 'oauth2', scopes: [...scopes] }] } } : {}),
            }, async (args) => {
                const connection = resolve();
                if (connection.isError) return connection;
                return callPartner(connection, request(args as z.infer<typeof inputSchema>), outputSchema, unavailable);
            });
            tool.inputSchema = inputSchema;
        },
    };
}

export function registerOAuthPartnerTools(
    server: McpServer,
    tools: readonly PartnerTool[],
    options: PartnerOAuthOptions,
    unavailable = serviceUnavailable,
): void {
    const { grant, issuer, serviceToken, challenge } = options;
    for (const tool of tools) {
        const scopes = [...tool.scopes];
        const reconnect = () => toolError('Reconnect your Kash account to use this tool.', challenge(scopes, 'invalid_token'));
        tool.register(server, () => {
            if (!grant?.shopId) return reconnect();
            if (scopes.some((scope) => !grant.scopes.has(scope))) {
                return toolError('Authorize access to this Kash tool.', challenge(scopes, 'insufficient_scope'));
            }
            return {
                base: issuer,
                shopId: grant.shopId,
                headers: { Authorization: 'Bearer ' + serviceToken, 'X-Kash-Mcp-Token-Ref': grant.tokenRef },
                onUnauthorized: reconnect,
            };
        }, true, unavailable);
    }
}

export function registerStdioPartnerTools(server: McpServer, tools: readonly PartnerTool[], unavailable = serviceUnavailable): string[] {
    const key = process.env.KASH_PARTNER_API_KEY;
    if (!key || !/^kash_[a-f0-9]{64}$/.test(key)) return [];

    const base = process.env.API_BASE || 'https://kash.click';
    for (const tool of tools) {
        tool.register(server, () => {
            const shopId = getSessionAuth()?.SHOPID ?? process.env.SHOPID ?? process.env.MCP_SHOPID;
            if (!shopId || !/^[1-9][0-9]{0,18}$/.test(shopId)) {
                return toolError('Configure a Kash shop ID to use this tool.');
            }
            return { base, shopId, headers: { Authorization: 'Bearer ' + key } };
        }, false, unavailable);
    }
    return tools.map((tool) => tool.name);
}
