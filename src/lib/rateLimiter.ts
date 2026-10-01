export function makeRateLimiter(intervalMs: number): () => Promise<void> {
  let lastRequestAt = 0;
  return async function rateLimit(): Promise<void> {
    const now = Date.now();
    const wait = intervalMs - (now - lastRequestAt);
    lastRequestAt = now + Math.max(0, wait);
    if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
  };
}
