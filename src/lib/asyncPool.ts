/**
 * Fixed-size worker pool for long background passes (artist-image warm-up,
 * background normalizer).
 *
 * Why a pool instead of the `for (batch of chunks) { await Promise.all(batch); await sleep() }`
 * shape these passes used to have: a chunk loop is a barrier. Every item in a chunk
 * waits for the slowest one before the next chunk starts, so per-item wall clock is
 * `max(chunk) + delay` rather than `avg(item)`. With N workers pulling from a shared
 * cursor, a slow item only occupies its own worker.
 *
 * Pacing is NOT this helper's job. Both callers are network-bound and already have a
 * real throttle in front of the network (`makeRateLimiter` for Last.fm, a per-host
 * token bucket for portraits), so the pool only decides how many items may be
 * in flight, never how fast requests leave.
 */
export interface PoolOptions {
  concurrency: number;
  signal?: AbortSignal;
  /** Called after each item settles, with the running completed count. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Runs `worker` over every item with at most `concurrency` in flight.
 * A worker that throws is treated as a completed item, so one bad item cannot
 * abort the pass; the worker is responsible for logging its own failure.
 * Resolves once every item has settled, or early once `signal` aborts.
 */
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
