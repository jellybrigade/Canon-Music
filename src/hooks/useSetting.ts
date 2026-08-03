import { useCallback, useEffect, useState } from "react";
import { getDb } from "../db";

const settingCache = new Map<string, string>();
const settingListeners = new Map<string, Set<(v: string) => void>>();

export function useBoolSetting(key: string, defaultValue: boolean): [boolean, (v: boolean) => Promise<void>, boolean] {
  const [raw, setRaw, loaded] = useSetting(key, defaultValue ? "true" : "false");
  const set = useCallback((v: boolean) => setRaw(v ? "true" : "false"), [setRaw]);
  return [raw === "true", set, loaded];
}

// The third element reports whether the stored value has been read back from the
// settings table yet. Until it is true, `value` is only the caller's default, which
// is not necessarily what the user chose. Callers that kick off expensive work keyed
// on the value (useAlbums re-queries the whole library when `sort` changes) should
// wait for it, otherwise they run once against the default and again against the
// real value, and the user watches the result change under them.
export function useSetting(key: string, defaultValue: string): [string, (v: string) => Promise<void>, boolean] {
  const [value, setValue] = useState(() => settingCache.get(key) ?? defaultValue);
  const [loaded, setLoaded] = useState(() => settingCache.has(key));

  useEffect(() => {
    if (!settingListeners.has(key)) settingListeners.set(key, new Set());
    const listeners = settingListeners.get(key)!;
    listeners.add(setValue);

    if (settingCache.has(key)) {
      setLoaded(true);
      return () => { listeners.delete(setValue); };
    }

    setLoaded(false);
    let cancelled = false;
    getDb()
      .then((db) =>
        db.select<{ value: string }[]>(
          "SELECT value FROM settings WHERE key = ?",
          [key]
        )
      )
      .then((rows) => {
        if (cancelled) return;
        const resolved = rows[0]?.value ?? defaultValue;
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

  const update = useCallback(
    async (newValue: string) => {
      const db = await getDb();
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        [key, newValue]
      );
      settingCache.set(key, newValue);
      settingListeners.get(key)?.forEach((fn) => fn(newValue));
    },
    [key]
  );

  return [value, update, loaded];
}

// Re-reads every setting from the DB and pushes fresh values to subscribed
// useSetting/useBoolSetting hooks, bypassing their in-memory cache. Needed
// after a bulk write (e.g. settings import) that doesn't go through `update`.
export async function refreshAllSettings(): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM settings"
  );
  for (const { key, value } of rows) {
    settingCache.set(key, value);
    settingListeners.get(key)?.forEach((fn) => fn(value));
  }
}
