type ReadPlan = { path: string; query?: URLSearchParams; list?: 'paged' | 'single'; text?: boolean };

const referenceReads: Readonly<Record<string, string>> = {
    getClients: '/customers',
    getDepartments: '/departments',
    getDepartmentGroups: '/department-groups',
    getDeclinaisons: '/product-variants',
    getDiscounts: '/discounts',
    getVATs: '/vat-rates',
    getUsers: '/users',
    getPaymentModes: '/payment-methods',
    getCashbox: '/cash-registers',
    getTables: '/tables',
    getDeliveryZones: '/delivery-zones',
    getRelayDeposit: '/pickup-points',
};

const mailboxReads: Readonly<Record<string, string>> = {
    getMailbox: '/mailbox',
    getMailboxMessages: '/mailbox/messages',
    getMailboxMessage: '/mailbox/message',
    getMailboxReplies: '/mailbox/replies',
    downloadMailboxAttachment: '/mailbox/attachment',
    getMailboxFolders: '/mailbox/folders',
};

export function partnerReadPlan(workerPath: string, parameters: URLSearchParams, oauth = false): ReadPlan | undefined {
    const worker = /^\/workers\/([A-Za-z]+)\.php$/.exec(workerPath)?.[1];
    if (!worker) return;
    // Explicit legacy exports retain their original headers, ordering and encodings.
    if ((parameters.get('format') ?? 'json') !== 'json') return;
    if (Object.hasOwn(referenceReads, worker)) return { path: referenceReads[worker], list: 'paged' };
    if (worker === 'getLivraisons') return { path: '/delivery-methods', list: 'single' };
    if (worker === 'getPending') return { path: '/orders/pending', list: 'single' };
    if (worker === 'getShopInfos') return { path: '/shop-settings' };
    if (worker === 'getSales' && parameters.get('formatExport') === 'Std') {
        const query = new URLSearchParams({ format: 'Std' });
        for (const key of ['d', 'm', 'y']) {
            const value = parameters.get(key);
            if (value !== null) query.set(key, value);
        }
        return { path: '/reports/sales', query, text: true };
    }
    if (oauth && Object.hasOwn(mailboxReads, worker)) {
        const query = new URLSearchParams(parameters);
        for (const key of ['key', 'shopID', 'shop_id', 'idboutique']) query.delete(key);
        return { path: mailboxReads[worker], query };
    }
}

export class KashReadError extends Error {
    constructor(readonly status: number) {
        super('Kash could not complete the read.');
    }
}

type ReadResponse = Pick<Response, 'ok' | 'status' | 'text'> & {
    headers: { get(name: string): string | null };
};

export async function callPartnerRead(
    base: string,
    shopId: string,
    plan: ReadPlan,
    fetchPage: (url: URL) => Promise<ReadResponse>,
): Promise<unknown> {
    const url = new URL('/api/partner/v1' + plan.path, base);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new KashReadError(400);
    url.search = plan.query?.toString() ?? '';
    url.searchParams.set('shop_id', shopId);
    if (plan.list === 'paged') url.searchParams.set('limit', '200');

    const rows: Record<string, string>[] = [];
    const seenCursors = new Set<string>();
    while (true) {
        const response = await fetchPage(url);
        if (!response.ok) throw new KashReadError(response.status);
        const text = await response.text();
        const contentType = response.headers.get('content-type')?.toLowerCase();
        if (plan.text && contentType?.startsWith('text/html')) return text;
        const payload = JSON.parse(text);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.error || payload.success === false) {
            throw new KashReadError(502);
        }
        if (!plan.list) return payload;
        if (!Array.isArray(payload.data)) throw new KashReadError(502);
        for (const row of payload.data) {
            if (!row || typeof row !== 'object' || Array.isArray(row)) throw new KashReadError(502);
            rows.push(Object.fromEntries(Object.entries(row).map(([key, value]) =>
                [key, value === true ? '1' : value === false || value == null ? '' : String(value).replace(/[\r\n]/g, '')])));
        }
        if (plan.list === 'single') return rows;
        const next = payload.pagination?.next_cursor;
        if (next === null) return rows;
        if (typeof next !== 'string' || !next || seenCursors.has(next)) throw new KashReadError(502);
        seenCursors.add(next);
        url.searchParams.set('cursor', next);
    }
}
