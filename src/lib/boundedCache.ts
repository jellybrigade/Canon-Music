// Shared oldest-entry eviction for size-capped in-memory Maps (Map iteration
// order is insertion order, so `.keys().next()` is the oldest key).
export function cappedSet<K, V>(cache: Map<K, V>, key: K, value: V, maxEntries: number): void {
  if (cache.size >= maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, value);
}
