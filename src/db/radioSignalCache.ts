import { getDb } from ".";

const SIGNAL_CACHE_TTL_S = 7 * 24 * 3600;

export async function readSignalCache<T>(key: string): Promise<T | null> {
  try {
    const db = await getDb();
    const cutoff = Math.floor(Date.now() / 1000) - SIGNAL_CACHE_TTL_S;
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM radio_signal_cache WHERE cache_key = ? AND fetched_at > ?",
      [key, cutoff],
    );
    if (rows[0]) return JSON.parse(rows[0].value) as T;
  } catch {
    /* cache miss */
  }
  return null;
}

export async function writeSignalCache<T>(key: string, value: T): Promise<void> {
  try {
    const db = await getDb();
    await db.execute("INSERT OR REPLACE INTO radio_signal_cache (cache_key, value, fetched_at) VALUES (?, ?, ?)", [
      key,
      JSON.stringify(value),
      Math.floor(Date.now() / 1000),
    ]);
  } catch {
    /* non-critical */
  }
}
