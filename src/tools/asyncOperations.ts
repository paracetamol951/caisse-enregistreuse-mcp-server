import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getSessionAuth } from '../context.js';
import type { KashOAuthGrant } from '../support/kashOAuthTools.js';

export const asyncOperationToolNames = {
    exportSales: 'export_sales_async',
    prepareImport: 'prepare_catalog_import',
    confirmImport: 'confirm_catalog_import',
    status: 'get_async_operation',
    result: 'get_async_operation_result',
} as const;

type OperationScope = 'reports.read' | 'catalog.read' | 'catalog.write';
const operationKind = z.enum(['export', 'import']);
const submissionKey = z.string().regex(/^[A-Za-z0-9._~-]{16,128}$/)
    .describe('Stable key for this submission, such as a UUID. Keep the same key and arguments when retrying.');
const operationId = z.string().regex(/^[a-f0-9]{32}$/).describe('ID returned when the operation was queued.');
const previewToken = z.string().regex(/^[a-f0-9]{64}$/).describe('Token from the analyzed preview returned by get_async_operation.');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MAX_IMPORT_BASE64 = 4 * Math.ceil(1048576 / 3);

const exportInput = z.object({
    from: day.describe('First local business date to include, YYYY-MM-DD.'),
    to: day.describe('First local business date to exclude, YYYY-MM-DD. Maximum range: 366 days.'),
    cashbox_id: z.number().int().positive().safe().optional().describe('Limit the export to one Kash cashbox.'),
    idempotencyKey: submissionKey,
}).strict();
const prepareInput = z.object({
    contentBase64: z.string().min(4).max(MAX_IMPORT_BASE64)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/)
        .describe('Original Kash catalog CSV bytes encoded as Base64, up to 1 MiB decoded.'),
    idempotencyKey: submissionKey,
}).strict();
const confirmInput = z.object({
    operationId,
    previewToken,
    apply: z.literal(true).describe('Set to true only when the user explicitly authorizes applying this exact preview.'),
}).strict();
const statusFields = {
    operationId,
    operationKind: operationKind.describe('Use export for a sales export and import for a catalog import.'),
};
const statusInput = z.object(statusFields).strict();
const resultInput = z.object({
    ...statusFields,
    after: z.number().int().nonnegative().safe().optional().describe('Import only. Reuse nextAfter from the previous result page.'),
    limit: z.number().int().min(1).max(200).optional().describe('Import only. Number of preview or result lines to fetch.'),
}).strict();
const envelope = z.object({ data: z.record(z.unknown()) });
const importResult = z.object({
    id: operationId,
    state: z.enum(['awaiting_confirmation', 'succeeded', 'partial', 'failed']),
    summary: z.unknown(),
    rows: z.array(z.record(z.unknown())).max(200),
    nextAfter: z.number().int().nonnegative().nullable(),
});
const exportFile = z.object({
    id: operationId,
    state: z.literal('succeeded'),
    filename: z.string().min(1).max(255),
    mediaType: z.string().min(1).max(255),
    contentBase64: z.string().max(4 * Math.ceil(4194304 / 3)),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

type OperationRequest = {
    path: string;
    scope: OperationScope;
    body?: Record<string, unknown>;
    idempotencyKey?: string;
    after?: number;
    limit?: number;
    result?: z.infer<typeof operationKind>;
};

type Send = (request: OperationRequest) => Promise<CallToolResult>;

export function asyncOperationScopes(name: string, args?: unknown): OperationScope[] {
    switch (name) {
        case asyncOperationToolNames.exportSales:
            return ['reports.read'];
        case asyncOperationToolNames.prepareImport:
            return ['catalog.read'];
        case asyncOperationToolNames.confirmImport:
            return ['catalog.write'];
        case asyncOperationToolNames.status:
        case asyncOperationToolNames.result: {
            const { operationKind: kind } = typeof args === 'object' && args !== null
                ? args as { operationKind?: unknown } : {};
            if (kind === 'export') return ['reports.read'];
            if (kind === 'import') return ['catalog.read'];
            return [];
        }
        default:
            return [];
    }
}

function errorResult(text: string, authChallenge?: string): CallToolResult {
    return {
        isError: true,
        content: [{ type: 'text', text }],
        ...(authChallenge ? { _meta: { 'mcp/www_authenticate': [authChallenge] } } : {}),
    };
}

function registerTools(server: McpServer, send: Send, oauth: boolean): void {
    function register<Shape extends z.ZodRawShape>(
        name: string,
        title: string,
        description: string,
        input: z.ZodObject<Shape, 'strict'>,
        handler: (args: z.infer<typeof input>) => Promise<CallToolResult>,
    ): void {
        const writesCatalog = name === asyncOperationToolNames.confirmImport;
        const scopes = asyncOperationScopes(name);
        const tool = server.registerTool(name, {
            title,
            description,
            inputSchema: input.shape as z.ZodRawShape,
            annotations: {
                readOnlyHint: !writesCatalog,
                destructiveHint: writesCatalog,
                idempotentHint: true,
                openWorldHint: false,
            },
            ...(oauth ? {
                _meta: { securitySchemes: (scopes.length ? [scopes] : [['reports.read'], ['catalog.read']])
                    .map((scope) => ({ type: 'oauth2', scopes: scope })) },
            } : {}),
        }, (args) => handler(args as z.infer<typeof input>));
        // Preserve strict argument validation when the SDK wraps the raw shape.
        tool.inputSchema = input;
    }

    register(asyncOperationToolNames.exportSales, 'Queue a Kash sales export',
        'Queue a CSV export of validated sales for the selected shop. Returns an operation ID for status and file retrieval.',
        exportInput, ({ idempotencyKey, ...parameters }) => send({
            path: '/exports',
            scope: 'reports.read',
            body: { type: 'sales', format: 'csv', parameters },
            idempotencyKey,
        }));

    register(asyncOperationToolNames.prepareImport, 'Preview a Kash catalog import',
        'Queue analysis of a catalog CSV. Fetch the operation and paginated preview, then ask the user before applying it.',
        prepareInput, ({ idempotencyKey, contentBase64 }) => send({
            path: '/imports',
            scope: 'catalog.read',
            body: { type: 'catalog', format: 'csv', contentBase64 },
            idempotencyKey,
        }));

    register(asyncOperationToolNames.confirmImport, 'Apply a Kash catalog import',
        'Queue application of a specific analyzed preview to the selected shop. Call only when the user explicitly approves its changes.',
        confirmInput, ({ operationId, previewToken }) => send({
            path: '/operations/' + operationId + '/confirm',
            scope: 'catalog.write',
            body: { previewToken },
        }));

    register(asyncOperationToolNames.status, 'Get a Kash operation status',
        'Read the status, summary, and any failure reason. Catalog previews awaiting confirmation also return a preview token.',
        statusInput, ({ operationId, operationKind }) => send({
            path: '/operations/' + operationId,
            scope: operationKind === 'export' ? 'reports.read' : 'catalog.read',
        }));

    register(asyncOperationToolNames.result, 'Get a Kash operation result',
        'Retrieve a completed sales CSV as an embedded MCP file, or read the catalog preview or outcome page and its line errors.',
        resultInput, ({ operationId, operationKind, after, limit }) => {
            if (operationKind === 'export' && (after !== undefined || limit !== undefined)) {
                return Promise.resolve(errorResult('Pagination applies to catalog import results.'));
            }
            return send({
                path: '/operations/' + operationId + '/result',
                scope: operationKind === 'export' ? 'reports.read' : 'catalog.read',
                result: operationKind,
                after,
                limit,
            });
        });
}

async function requestOperation(
    base: string,
    shopId: string,
    headers: Record<string, string>,
    request: OperationRequest,
    reconnect?: () => CallToolResult,
): Promise<CallToolResult> {
    try {
        const url = new URL('/api/partner/v1' + request.path, base);
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
            return errorResult('The Kash partner API requires HTTPS.');
        }
        url.searchParams.set('shop_id', shopId);
        if (request.after !== undefined) url.searchParams.set('after', String(request.after));
        if (request.limit !== undefined) url.searchParams.set('limit', String(request.limit));
        const response = await fetch(url, {
            method: request.body ? 'POST' : 'GET',
            headers: {
                ...headers,
                Accept: 'application/json',
                ...(request.body ? { 'Content-Type': 'application/json' } : {}),
                ...(request.idempotencyKey ? { 'Idempotency-Key': request.idempotencyKey } : {}),
            },
            body: request.body ? JSON.stringify(request.body) : undefined,
            signal: AbortSignal.timeout(15000),
            redirect: 'error',
        });
        if (!response.ok) {
            if (response.status === 401) return reconnect?.() ?? errorResult('The Kash partner credential was rejected.');
            if (response.status === 403) return errorResult('The Kash connection lacks permission for this operation.');
            if (response.status === 404) return errorResult('Kash could not find this operation in the selected shop.');
            if (response.status === 409) return errorResult('Kash reported a conflict. Check the operation status and retry with the same submission key only for the same request.');
            if (response.status === 410) return errorResult('The Kash operation or its result has expired.');
            if (response.status === 413) return errorResult('The file exceeds the size limit.');
            if (response.status === 429) return errorResult('Kash is receiving too many requests. Retry the same request later.');
            if (response.status < 500) return errorResult('Kash rejected the request. Check the inputs and operation status.');
            return errorResult('The Kash partner API is temporarily unavailable. Check the operation status before retrying.');
        }

        const reply = envelope.parse(await response.json()).data;
        if (request.result !== 'export') {
            const data = request.result === 'import' ? importResult.parse(reply) : reply;
            return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
        }

        const file = exportFile.parse(reply);
        const { contentBase64, ...metadata } = file;
        const uri = 'kash://partner/operations/' + file.id + '/result';
        return {
            content: [
                { type: 'text', text: JSON.stringify(metadata) },
                { type: 'resource', resource: { uri, mimeType: file.mediaType, blob: contentBase64 } },
            ],
            structuredContent: metadata,
        };
    } catch {
        return errorResult('The Kash partner API could not complete the request. Check its status or retry the same submission with the same key.');
    }
}

export function registerOAuthAsyncOperationTools(
    server: McpServer,
    options: {
        grant?: KashOAuthGrant;
        issuer: string;
        serviceToken: string;
        challenge(scopes: string[], error?: string): string;
    },
): void {
    const { grant, issuer, serviceToken, challenge } = options;
    registerTools(server, async (request) => {
        const scopes = [request.scope];
        const reconnect = () => errorResult('Reconnect your Kash account to use this tool.', challenge(scopes, 'invalid_token'));
        if (!grant?.shopId) return reconnect();
        if (!grant.scopes.has(request.scope)) {
            return errorResult('Authorize access to this Kash tool.', challenge(scopes, 'insufficient_scope'));
        }
        return requestOperation(issuer, grant.shopId, {
            Authorization: 'Bearer ' + serviceToken,
            'X-Kash-Mcp-Token-Ref': grant.tokenRef,
        }, request, reconnect);
    }, true);
}

export function registerStdioAsyncOperationTools(server: McpServer): string[] {
    const key = process.env.KASH_PARTNER_API_KEY;
    if (!key || !/^kash_[a-f0-9]{64}$/.test(key)) return [];

    registerTools(server, async (request) => {
        const shopId = getSessionAuth()?.SHOPID ?? process.env.SHOPID ?? process.env.MCP_SHOPID;
        if (!shopId || !/^[1-9][0-9]{0,18}$/.test(shopId)) {
            return errorResult('Configure a Kash shop ID to use partner operations.');
        }
        return requestOperation(process.env.API_BASE || 'https://kash.click', shopId, {
            Authorization: 'Bearer ' + key,
        }, request);
    }, false);
    return Object.values(asyncOperationToolNames);
}
