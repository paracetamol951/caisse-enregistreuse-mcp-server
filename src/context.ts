// src/context.ts

/**
 * �tat d'authentification conserv� c�t� serveur (session en m�moire).
 */
export type AuthState = {
    ok: boolean;
    SHOPID?: string;
    APIKEY?: string;
    scopes?: string[];
};

/**
 * Stockage de session minimaliste (en m�moire de process).
 * Remplace si besoin par un store persistant selon ton runtime.
 */
const SESSION: { auth?: AuthState } = {};

/** D�finit l'�tat d'authentification pour la session courante. */
export function setSessionAuth(a: AuthState) {
    SESSION.auth = a;
}

/** R�cup�re l'�tat d'authentification de la session courante. */
export function getSessionAuth(): AuthState | undefined {
    return SESSION.auth;
}

/** Efface l'�tat d'authentification de la session courante. */
export function clearSessionAuth() {
    delete SESSION.auth;
}

/**
 * Contexte pass� aux handlers de tools.
 * (Laisse-le align� avec ce que ton serveur MCP injecte d�j�.)
 */
export type Ctx = {
    auth?: AuthState;
    // ... ajoute d'autres champs sp�cifiques � ton serveur si besoin
};

/**
 * R�solution unifi�e des identifiants :
 * 1) session (ctx.auth puis SESSION)
 * 2) variables d'environnement (SHOPID/APIKEY ou MCP_SHOPID/MCP_APIKEY)
 *
 * Les tools n'ont plus besoin de recevoir shopId/apiKey en param�tres.
 * L�ve une erreur explicite si les identifiants sont introuvables.
 */
export function resolveAuth(
    _input?: unknown,
    ctx?: Ctx
): { shopId: string; apiKey: string } {
    // Priorit� session: d'abord le ctx re�u par le handler (si ton serveur l'alimente),
    // puis le store global en m�moire.
    const sessionAuth = ctx?.auth ?? getSessionAuth();

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
            'Connectez-vous via auth.login, d�finissez SHOPID/APIKEY en variables d�environnement, ' +
            'ou configurez les headers Authorization (Bearer) + X-Shop-Id c�t� client.'
        );
    }

    return { shopId, apiKey };
}
