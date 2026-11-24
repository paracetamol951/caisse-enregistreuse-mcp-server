import { fetch, type RequestInit } from 'undici';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getKashOAuthWorker } from './kashOAuthWorker.js';
import { callPartnerRead, partnerReadPlan } from './partnerReadTransport.js';

export const BASE = process.env.API_BASE || 'https://kash.click';
// en tête du fichier
export type Formish = Record<
    string,
    | string
    | number
    | boolean
    | null
    | undefined
    | Array<string | number | boolean>
>;
function serializeForForm(
    key: string,
    value: unknown,
    usp: URLSearchParams
) {
    const push = (k: string, v: unknown) => {
        if (v === undefined || v === null || v === '') return;
        if (
            typeof v === 'string' ||
            typeof v === 'number' ||
            typeof v === 'boolean'
        ) {
            usp.append(k, String(v));
        } else if (v instanceof Date) {
            usp.append(k, v.toISOString());
        } else if (Array.isArray(v)) {
            // Si tableau: on ajoute une entrée par élément
            for (const item of v) push(k, item);
        } else {
            // objets/unknown => JSON
            usp.append(k, JSON.stringify(v));
        }
    };

    push(key, value);
}
export function qs(params: Record<string, unknown>) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '') continue;
        if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
        else sp.append(k, String(v));
    }
    return sp.toString();
}


export async function get(path: string, params: Record<string, unknown>) {
    const search = qs(params);
    const oauth = getKashOAuthWorker();
    const parameters = new URLSearchParams(search);
    if (oauth) return oauth.call('GET', path, parameters);
    const partner = managedRead(path, parameters);
    if (partner) return partner;

    const url = `${BASE}${path}?${search}`;
    const res = await fetch(url);
    return asJsonOrText(res as unknown as Response);
}
// remplace la signature de asJsonOrText et sa déclaration
function managedRead(path: string, params: URLSearchParams): Promise<unknown> | undefined {
    const key = params.get('key') ?? '';
    if (!/^kash_[a-f0-9]{64}$/.test(key)) return;
    const shopId = params.get('shopID') ?? params.get('idboutique');
    if (!shopId) return;
    const plan = partnerReadPlan(path, params);
    if (!plan) return;
    return callPartnerRead(BASE, shopId, plan, (url) => fetch(url, {
        headers: { Authorization: 'Bearer ' + key, Accept: 'application/json, text/html' },
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
    }));
}

export async function asJsonOrText(res: Pick<Response, 'arrayBuffer'>): Promise<unknown> {
    const buf = await res.arrayBuffer();
    const txt = new TextDecoder().decode(buf);
    try { return JSON.parse(txt); } catch { return txt; }
}

function formParameters(body: Record<string, unknown>): URLSearchParams {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
        serializeForForm(k, v, sp);
    }
    return sp;
}

export async function postForm(
    path: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {}
): Promise<unknown> {
    const sp = formParameters(body);

    const oauth = getKashOAuthWorker();
    if (oauth) return oauth.call('POST', path, sp);
    if (path === '/workers/getShopInfos.php') {
        const partner = managedRead(path, sp);
        if (partner) return partner;
    }

    try {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(`${BASE}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', ...headers },
            body: sp.toString(),
            signal: controller.signal,
        } as RequestInit).finally(() => clearTimeout(to));
        return asJsonOrText(res as unknown as Response);
    } catch {
        return { error: 'Request failed' };
    }
}


const saleErrorMessages = {
    idempotency_conflict: 'This key was already used with different sale parameters. Check the previous operation before submitting a new one.',
    idempotency_unresolved: 'The sale may still be running or may need review. Check the order and its payments before submitting any new operation. Retry only with the same key and arguments.',
    idempotency_unavailable: 'The sale journal was unavailable. Kash did not start this attempt. Retry with the same key and arguments.',
    idempotency_key_required: 'A valid idempotency key is required to submit the sale.',
    idempotency_key_invalid: 'The sale idempotency key is invalid.',
    idempotency_files_unsupported: 'Kash cannot submit this sale with both a file and an idempotency key.',
    validation_failed: 'Kash rejected the sale. Check the arguments and the selected resources.',
    network_outcome_unknown: 'The sale result could not be received. Retry with the same key and arguments. Check the order and its payments before submitting any new operation.',
    unexpected_response: 'Kash returned an unexpected sale response. Check the order and its payments. Retry only with the same key and arguments.',
};

type SaleErrorCode = keyof typeof saleErrorMessages;

export function saleWriteError(
    code: SaleErrorCode,
    details: { orderID?: number | string; replayed?: boolean } = {},
    message = saleErrorMessages[code],
): CallToolResult {
    return { isError: true, content: [{ type: 'text', text: message }], structuredContent: { code, ...details } };
}

export async function saleWorkerResponse(
    response: Pick<Response, 'ok' | 'status' | 'arrayBuffer'> & { headers: Pick<Headers, 'get'> },
): Promise<CallToolResult> {
    let data: unknown;
    try {
        data = await asJsonOrText(response);
    } catch {
        return saleWriteError('network_outcome_unknown');
    }
    const replayed = response.headers.get('Idempotency-Replayed') === 'true';
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return saleWriteError('unexpected_response', { replayed });
    }

    const payload = data as Record<string, unknown>;
    const { orderID, code } = payload;
    const validOrderId = (typeof orderID === 'number' && Number.isSafeInteger(orderID) && orderID > 0)
        || (typeof orderID === 'string' && /^[1-9][0-9]{0,18}$/.test(orderID));
    const details = { ...(validOrderId ? { orderID } : {}), replayed };
    const { status } = response;
    if (status === 409 && (code === 'idempotency_conflict' || code === 'idempotency_unresolved')) {
        return saleWriteError(code, details);
    }
    if (status === 503 && code === 'idempotency_unavailable') return saleWriteError(code, details);
    if (status === 400) {
        if (code === 'idempotency_key_invalid' || code === 'idempotency_files_unsupported') {
            return saleWriteError(code, details);
        }
        if (payload.error === 'idempotency_key_required') return saleWriteError('idempotency_key_required', details);
        if (payload.error === 'invalid_request' || payload.error === 'invalid_reference') {
            return saleWriteError('validation_failed', details);
        }
    }
    if ((response.ok || status === 400 || status === 422) && payload.success === false && typeof payload.result === 'string') {
        return saleWriteError('validation_failed', details);
    }
    if (!response.ok || !validOrderId || payload.error || payload.success === false || payload.result !== 'ok') {
        return saleWriteError('unexpected_response', details);
    }

    const sale: Record<string, unknown> = { ...details, result: 'ok' };
    if (payload.success === true) sale.success = true;
    for (const field of ['receiptLink', 'invoice', 'quote', 'paymentLink', 'stripePaymentLink']) {
        if (typeof payload[field] === 'string') sale[field] = payload[field];
    }
    return { content: [{ type: 'text', text: JSON.stringify(sale, null, 2) }], structuredContent: sale };
}

export async function postSaleForm(path: string, body: Record<string, unknown>, requestKey: string): Promise<CallToolResult> {
    const parameters = formParameters(body);
    const oauth = getKashOAuthWorker();
    // The OAuth adapter attaches the tool key under the active grant.
    if (oauth) return await oauth.call('POST', path, parameters) as CallToolResult;

    const response = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Idempotency-Key': requestKey,
        },
        body: parameters,
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
    }).catch(() => null);
    return response ? saleWorkerResponse(response) : saleWriteError('network_outcome_unknown');
}

// aligne postJsonRaw sur unknown aussi
export async function postJsonRaw(
    path: string,
    body: unknown,
    headers: Record<string, string> = {}
): Promise<unknown> {
    if (getKashOAuthWorker()) throw new Error('Unsupported Kash OAuth worker request');
    try {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(`${BASE}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
            signal: controller.signal
        } as RequestInit).finally(() => clearTimeout(to));
        return asJsonOrText(res as unknown as Response);
    } catch {
        return { error: 'Request failed' };
    }
}
