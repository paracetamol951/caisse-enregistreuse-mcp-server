import express, { type Application, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { t, getLang } from '../i18n/index.js';

function deepGet(obj: any, key: string) {
  return key.split('.').reduce((o,k)=> (o && typeof o==='object') ? o[k] : undefined, obj);
}

function render(obj: any, dict: any): any {
  if (typeof obj === 'string') {
    return obj.replace(/\{\{([^}]+)\}\}/g, (_,k) => {
      const v = deepGet(dict, k.trim());
      return v !== undefined ? String(v) : '';
    });
  } else if (Array.isArray(obj)) {
    return obj.map(x => render(x, dict));
  } else if (obj && typeof obj === 'object') {
    const out: any = {};
    for (const k of Object.keys(obj)) out[k] = render(obj[k], dict);
    return out;
  }
  return obj;
}

function loadDict(lang: string) {
  const base = path.resolve(__dirname, '..', '..');
  const p = path.join(base, 'locales', lang, 'common.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

export default function httpServer(_server: unknown): Application {
  const app = express();

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', lang: getLang() });
  });

  app.get(['/.well-known/mcp/manifest.json','/mcp/manifest'], (req: Request, res: Response) => {
    // resolve locale preference
    let lang = process.env.MCP_LANG || '';
    if (!lang && req.headers['accept-language']) {
      const m = String(req.headers['accept-language']).match(/^[a-z]{2}/i);
      if (m) lang = m[0];
    }
    lang = (lang || 'en').toLowerCase().slice(0,2);

    const base = path.resolve(__dirname, '..', '..');
    const tmpl = JSON.parse(fs.readFileSync(path.join(base, 'manifest.template.json'), 'utf-8'));
    const dict = loadDict(lang);
    const rendered = render(tmpl, dict);
    res.json(rendered);
  });

  return app;
}