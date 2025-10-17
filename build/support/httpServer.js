import express from 'express';
import { createRequire } from 'node:module';
// Charge le manifeste JSON sans import assertion (compatible ESM)
const require = createRequire(import.meta.url);
const manifest = require('../../static/.well-known/mcp/manifest.json');
export default function httpServer(_server) {
    const app = express();
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok' });
    });
    app.get('/.well-known/mcp/manifest.json', (_req, res) => {
        res.json(manifest);
    });
    return app;
}
