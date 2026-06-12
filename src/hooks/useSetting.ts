import { useCallback, useEffect, useState } from "react";
import { getDb } from "../db";

export function useBoolSetting(key: string, defaultValue: boolean): [boolean, (v: boolean) => Promise<void>] {
  const [raw, setRaw] = useSetting(key, defaultValue ? "true" : "false");
  const set = useCallback((v: boolean) => setRaw(v ? "true" : "false"), [setRaw]);
  return [raw === "true", set];
}

export function useSetting(key: string, defaultValue: string): [string, (v: string) => Promise<void>] {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    getDb()
      .then((db) =>
        db.select<{ value: string }[]>(
          "SELECT value FROM settings WHERE key = ?",
          [key]
        )
      )
      .then((rows) => {
        if (rows[0]) setValue(rows[0].value);
      })
      .catch((e) => console.error("Failed to load setting:", key, e));
  }, [key]);

  const update = useCallback(
    async (newValue: string) => {
      setValue(newValue);
      const db = await getDb();
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        [key, newValue]
      );
    },
    [key]
  );

  return [value, update];
}
