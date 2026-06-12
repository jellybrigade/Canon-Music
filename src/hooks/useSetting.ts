import { useCallback, useEffect, useState } from "react";
import { getDb } from "../db";

const settingCache = new Map<string, string>();
const settingListeners = new Map<string, Set<(v: string) => void>>();

export function useBoolSetting(key: string, defaultValue: boolean): [boolean, (v: boolean) => Promise<void>] {
  const [raw, setRaw] = useSetting(key, defaultValue ? "true" : "false");
  const set = useCallback((v: boolean) => setRaw(v ? "true" : "false"), [setRaw]);
  return [raw === "true", set];
}

export function useSetting(key: string, defaultValue: string): [string, (v: string) => Promise<void>] {
  const [value, setValue] = useState(() => settingCache.get(key) ?? defaultValue);

  useEffect(() => {
    if (!settingListeners.has(key)) settingListeners.set(key, new Set());
    const listeners = settingListeners.get(key)!;
    listeners.add(setValue);

    if (settingCache.has(key)) {
      return () => { listeners.delete(setValue); };
    }

    let cancelled = false;
    getDb()
      .then((db) =>
        db.select<{ value: string }[]>(
          "SELECT value FROM settings WHERE key = ?",
          [key]
        )
      )
      .then((rows) => {
        if (!cancelled && rows[0]) {
          settingCache.set(key, rows[0].value);
          setValue(rows[0].value);
        }
      })
      .catch((e) => console.error("Failed to load setting:", key, e));

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

  return [value, update];
}
