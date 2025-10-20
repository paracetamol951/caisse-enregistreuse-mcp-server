import { fetch, type RequestInit } from 'undici';

export const BASE = process.env.API_BASE || 'https://caisse.enregistreuse.fr';

export function qs(params: Record<string, unknown>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
    else sp.append(k, String(v));
  }
  return sp.toString();
}

export async function asJsonOrText(res: Response): Promise<String|Object> {
  const buf = await res.arrayBuffer();
    const txt = new TextDecoder().decode(buf);
    process.stderr.write(`[caisse][patch] response ${txt} \n`);
  try { return JSON.parse(txt); } catch { return txt; }
}

export async function get(path: string, params: Record<string, unknown>) {
    const url = `${BASE}${path}?${qs(params)}`;
    process.stderr.write(`[caisse][patch] GET ${url} ${path} ${params} \n`);
  const res = await fetch(url);
  return asJsonOrText(res as unknown as Response);
}

export async function postForm(path: string, params: Record<string, unknown>) {
    process.stderr.write(`[caisse][patch] postForm ${path} \n`);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: qs(params)
  } as RequestInit);
  return asJsonOrText(res as unknown as Response);
}

export async function postJsonRaw(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  } as RequestInit);
  return asJsonOrText(res as unknown as Response);
}
