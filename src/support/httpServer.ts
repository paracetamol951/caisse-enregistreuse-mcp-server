import express, { type Application, type Request, type Response } from 'express';
import { createRequire } from 'node:module';

// Charge le manifeste JSON sans import assertion (compatible ESM)
const require = createRequire(import.meta.url);
const manifest = require('../../static/.well-known/mcp/manifest.json');

export default function httpServer(_server: unknown): Application {
  const app = express();

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.get('/.well-known/mcp/manifest.json', (_req: Request, res: Response) => {
    res.json(manifest);
  });

  return app;
}
