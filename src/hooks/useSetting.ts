import { useCallback, useEffect, useState } from "react";
import { getDb } from "../db";

const settingCache = new Map<string, string>();
const settingListeners = new Map<string, Set<(v: string) => void>>();
// What the database holds, as far as this session knows; a failed write falls back to it.
const storedValues = new Map<string, string>();
// Per key, so two quick changes can't reach the database's connection pool in the wrong order.
const pendingWrites = new Map<string, Promise<void>>();

function publish(key: string, value: string) {
  settingCache.set(key, value);
  settingListeners.get(key)?.forEach((fn) => {
    fn(value);
  });
}

// Queued behind the key's earlier writes; also the way in for bulk writes such as a settings import,
// which an older change still on its way would otherwise overwrite.
export function storeSetting(key: string, value: string): Promise<void> {
  const write = (pendingWrites.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const db = await getDb();
      await db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value]);
      storedValues.set(key, value);
    });
  pendingWrites.set(key, write);
  return write;
}

export function useBoolSetting(key: string, defaultValue: boolean): [boolean, (v: boolean) => Promise<void>, boolean] {
  const [raw, setRaw, loaded] = useSetting(key, defaultValue ? "true" : "false");
  const set = useCallback((v: boolean) => setRaw(v ? "true" : "false"), [setRaw]);
  return [raw === "true", set, loaded];
}

// The third element reports whether the stored value has been read back yet; until then
// `value` is only the caller's default. Callers keying expensive work on the value should wait for it.
export function useSetting(key: string, defaultValue: string): [string, (v: string) => Promise<void>, boolean] {
  const [value, setValue] = useState(() => settingCache.get(key) ?? defaultValue);
  const [loaded, setLoaded] = useState(() => settingCache.has(key));

  useEffect(() => {
    if (!settingListeners.has(key)) settingListeners.set(key, new Set());
    const listeners = settingListeners.get(key)!;
    listeners.add(setValue);

    if (settingCache.has(key)) {
      setLoaded(true);
      return () => {
        listeners.delete(setValue);
      };
    }

    setLoaded(false);
    let cancelled = false;
    getDb()
      .then((db) => db.select<{ value: string }[]>("SELECT value FROM settings WHERE key = ?", [key]))
      .then((rows) => {
        if (cancelled) return;
        const read = rows[0]?.value ?? defaultValue;
        if (!storedValues.has(key)) storedValues.set(key, read);
        // A change made while this read was out is newer than what it returned.
        const resolved = settingCache.get(key) ?? read;
        settingCache.set(key, resolved);
        setValue(resolved);
        setLoaded(true);
      })
      // A failed read leaves the default in place, so report it as settled rather
      // than blocking every consumer gated on `loaded` for the rest of the session.
      .catch((e) => {
        console.error("Failed to load setting:", key, e);
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
      listeners.delete(setValue);
    };
  }, [key]);

  // The screen changes at once: awaiting the write first left toggles dead for seconds while a
  // new queue kept the database busy.
  const update = useCallback(
    (newValue: string) => {
      publish(key, newValue);
      const write = storeSetting(key, newValue);
      return write.catch((e: unknown) => {
        console.error("Failed to save setting:", key, e);
        if (pendingWrites.get(key) === write) publish(key, storedValues.get(key) ?? defaultValue);
        throw e;
      });
    },
    [key, defaultValue],
  );

  return [value, update, loaded];
}

// Re-reads every setting from the DB and pushes fresh values to subscribed
// useSetting/useBoolSetting hooks, bypassing their in-memory cache. Needed
// after a bulk write (e.g. settings import) that doesn't go through `update`.
export async function refreshAllSettings(): Promise<void> {
  await Promise.allSettled(pendingWrites.values());
  const db = await getDb();
  const rows = await db.select<{ key: string; value: string }[]>("SELECT key, value FROM settings");
  for (const { key, value } of rows) {
    storedValues.set(key, value);
    publish(key, value);
  }
}

// Test-only: the cache is module state, so a suite that swaps in a fresh database per case
// would otherwise read the previous case's values.
export function __resetSettingCache(): void {
  settingCache.clear();
  storedValues.clear();
  pendingWrites.clear();
}
