import { store } from './store.js';

const SESSION_TTL = 30 * 24 * 3600; // 30 jours
const key = (id: string) => `session:auth:${id}`;

export type StoredAuth = {
    ok: boolean;
    SHOPID?: string;
    APIKEY?: string;
    scopes?: string[];
};

export async function saveSessionAuth(sessionId: string, auth: StoredAuth): Promise<void> {
    await store.set(key(sessionId), JSON.stringify(auth), 'EX', SESSION_TTL);
}

export async function loadSessionAuth(sessionId: string): Promise<StoredAuth | null> {
    const raw = await store.get(key(sessionId));
    if (!raw) return null;
    try {
        return JSON.parse(raw as string) as StoredAuth;
    } catch {
        return null;
    }
}

export async function deleteSessionAuth(sessionId: string): Promise<void> {
    await store.del(key(sessionId));
}