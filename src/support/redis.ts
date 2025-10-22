// src/support/redis.ts
import { Redis } from 'ioredis';

const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
});

redis.on('connect', () => process.stderr.write('[redis] connect\n'));
redis.on('ready', () => process.stderr.write('[redis] ready\n'));
redis.on('error', (e: unknown) => {
    const msg = e && typeof e === 'object' && 'message' in (e as any) ? (e as any).message : String(e);
    process.stderr.write(`[redis][error] ${msg}\n`);
});
