import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// 🧩 Correction ESM : reconstitue __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let cache = null;
function loadDict(lang) {
    const fallback = 'en';
    const baseDir = path.resolve(__dirname, '..', '..', 'locales');
    const tryFile = (l) => path.join(baseDir, l, 'common.json');
    let dict = {};
    try {
        dict = JSON.parse(fs.readFileSync(tryFile(lang), 'utf-8'));
    }
    catch {
        dict = JSON.parse(fs.readFileSync(tryFile(fallback), 'utf-8'));
        lang = fallback;
    }
    cache = { lang, dict };
    return dict;
}
export function getLang() {
    // LANG=fr_FR.UTF-8 or MCP_LANG=fr
    const env = (process.env.MCP_LANG || process.env.LANG || 'en').toLowerCase();
    const m = env.match(/^([a-z]{2})/);
    return m ? m[1] : 'en';
}
export function t(key, defaultValue) {
    const lang = getLang();
    if (!cache || cache.lang !== lang) {
        loadDict(lang);
    }
    const dict = cache.dict;
    const parts = key.split('.');
    let cur = dict;
    for (const p of parts) {
        if (cur && typeof cur === 'object' && p in cur)
            cur = cur[p];
        else
            return defaultValue ?? key;
    }
    if (typeof cur === 'string')
        return cur;
    return defaultValue ?? key;
}
export function ti(paths) {
    // try a list of keys, return first found
    for (const k of paths) {
        const v = t(k);
        if (v !== k)
            return v;
    }
    return paths[0];
}
