/**
 * Fixed-size worker pool for long background passes. Unlike chunked `Promise.all`, a slow item
 * holds only its own worker. Caps concurrency only; callers own rate limiting.
 */
export interface PoolOptions {
  concurrency: number;
  signal?: AbortSignal;
  /** Called after each item settles, with the running completed count. */
  onProgress?: (done: number, total: number) => void;
}

/** Runs `worker` over items with at most `concurrency` in flight; a throw counts as settled, not aborted. */
export async function runPool<T>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<void>,
  { concurrency, signal, onProgress }: PoolOptions,
): Promise<void> {
  if (items.length === 0) {
    onProgress?.(0, 0);
    return;
  }

  onProgress?.(0, items.length);

  let cursor = 0;
  let done = 0;

  async function drain(): Promise<void> {
    while (true) {
      if (signal?.aborted) return;
      const index = cursor++;
      if (index >= items.length) return;
      try {
        await worker(items[index]!, index);
      } catch {
        // Worker logs its own failures; a single bad item must not kill the pass.
      }
      done++;
      onProgress?.(done, items.length);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, drain);
  await Promise.all(workers);
}
