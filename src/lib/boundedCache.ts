// Shared oldest-entry eviction for size-capped in-memory Maps (Map iteration
// order is insertion order, so `.keys().next()` is the oldest key). Insertion
// order, not LRU: re-writing a key updates its value and leaves its age alone.
export function cappedSet<K, V>(cache: Map<K, V>, key: K, value: V, maxEntries: number): void {
  // An overwrite adds no entry, so evicting for it would drop a live one for nothing.
  if (!cache.has(key) && cache.size >= maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, value);
}
