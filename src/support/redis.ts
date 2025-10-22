import * as IORedis from 'ioredis';

const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// IORedis is a module object; construct via its default export
export const redis = new (IORedis as unknown as { new(u: string, o?: any): any })(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
});

redis.on('connect', () => process.stderr.write('[redis] connect\n'));
redis.on('ready', () => process.stderr.write('[redis] ready\n'));
redis.on('error', (e: unknown) => {
    const msg = e && typeof e === 'object' && 'message' in e ? (e as any).message : String(e);
    process.stderr.write(`[redis][error] ${msg}\n`);
});
