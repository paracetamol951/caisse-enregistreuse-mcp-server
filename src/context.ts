// src/context.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { saveSessionAuth, deleteSessionAuth } from './support/session-store.js';

export type AuthState = {
    ok: boolean;
    SHOPID?: string;
    APIKEY?: string;
    scopes?: string[];
};

export type Ctx = {
    auth?: AuthState;
};

type RequestSession = {
    sessionId: string;
    auth?: AuthState;
};

const asyncLocalStore = new AsyncLocalStorage<RequestSession>();

const GLOBAL_SESSION: { auth?: AuthState } = {};

export function runWithSession<T>(sessionId: string, fn: () => T): T {
    return asyncLocalStore.run({ sessionId }, fn);
}

export function getCurrentSession(): RequestSession | undefined {
    return asyncLocalStore.getStore();
}

export function updateSessionId(newSessionId: string): void {
    const session = asyncLocalStore.getStore();
    if (session && session.sessionId !== newSessionId) {
        session.sessionId = newSessionId;
        if (session.auth) {
            saveSessionAuth(newSessionId, session.auth).catch(() => { });
        }
    }
}

export function setSessionAuth(a: AuthState): void {
    const session = asyncLocalStore.getStore();
    if (session) {
        session.auth = a;
        saveSessionAuth(session.sessionId, a).catch(() => { });
    } else {
        GLOBAL_SESSION.auth = a;
    }
}

export function getSessionAuth(): AuthState | undefined {
    return asyncLocalStore.getStore()?.auth ?? GLOBAL_SESSION.auth;
}

export function clearSessionAuth(): void {
    const session = asyncLocalStore.getStore();
    if (session) {
        delete session.auth;
        deleteSessionAuth(session.sessionId).catch(() => { });
    } else {
        delete GLOBAL_SESSION.auth;
    }
}

export function resolveAuth(
    _input?: unknown,
    ctx?: Ctx
): { shopId: string; apiKey: string } {
    const sessionAuth = ctx?.auth ?? getSessionAuth();
    process.stderr.write('resolveAuth' + sessionAuth + '\n');

    const shopId =
        sessionAuth?.SHOPID ??
        process.env.SHOPID ??
        process.env.MCP_SHOPID ??
        '';

    const apiKey =
        sessionAuth?.APIKEY ??
        process.env.APIKEY ??
        process.env.MCP_APIKEY ??
        '';

    if (!shopId || !apiKey) {
        throw new Error(
            'Identifiants manquants : SHOPID et/ou APIKEY introuvables (session/env). ' +
            'Connectez-vous via auth.login, définissez SHOPID/APIKEY en variables d\'environnement, ' +
            'ou configurez les headers Authorization (Bearer) + X-Shop-Id côté client.'
        );
    }

    return { shopId, apiKey };
}