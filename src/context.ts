// src/context.ts
export type AuthState = { ok: boolean; SHOPID?: string; APIKEY?: string; scopes?: string[] };

const SESSION: { auth?: AuthState } = {};

export function setSessionAuth(a: AuthState) { SESSION.auth = a; }
export function getSessionAuth(): AuthState | undefined { return SESSION.auth; }
export function clearSessionAuth() { delete SESSION.auth; }

export type Ctx = { auth?: AuthState };
