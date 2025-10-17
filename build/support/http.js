import { fetch } from 'undici';
export const BASE = process.env.API_BASE || 'https://caisse.enregistreuse.fr';
export function qs(params) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '')
            continue;
        if (Array.isArray(v))
            v.forEach((x) => sp.append(k, String(x)));
        else
            sp.append(k, String(v));
    }
    return sp.toString();
}
export async function asJsonOrText(res) {
    const buf = await res.arrayBuffer();
    const txt = new TextDecoder().decode(buf);
    process.stderr.write(`[caisse][patch] response ${txt} \n`);
    try {
        return JSON.parse(txt);
    }
    catch {
        return txt;
    }
}
export async function get(path, params) {
    process.stderr.write(`[caisse][patch] GET ${path} ${params} \n`);
    const url = `${BASE}${path}?${qs(params)}`;
    const res = await fetch(url);
    return asJsonOrText(res);
}
export async function postForm(path, params) {
    process.stderr.write(`[caisse][patch] postForm ${path} \n`);
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: qs(params)
    });
    return asJsonOrText(res);
}
export async function postJsonRaw(path, body, headers = {}) {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body)
    });
    return asJsonOrText(res);
}
