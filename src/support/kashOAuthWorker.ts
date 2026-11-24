import { AsyncLocalStorage } from 'node:async_hooks';

export type WorkerMethod = 'GET' | 'POST';

type KashOAuthWorker = {
    shopId: string;
    call(method: WorkerMethod, path: string, parameters: URLSearchParams): Promise<unknown>;
};

const worker = new AsyncLocalStorage<KashOAuthWorker>();

export function getKashOAuthWorker(): KashOAuthWorker | undefined {
    return worker.getStore();
}

export function withKashOAuthWorker<T>(context: KashOAuthWorker, callback: () => T): T {
    return worker.run(context, callback);
}
