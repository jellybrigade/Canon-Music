import { useEffect, useRef } from "react";
import { getDb } from "../db";
import { normalizeAlbum } from "../lib/tag-normalize";
import { useSetting } from "./useSetting";

const STALE_DAYS = 30;
const INTERVAL_MS = 2000;

export function useBackgroundNormalizer() {
  const [autoRefresh] = useSetting("tags.auto_refresh", "true");
  const runningRef = useRef(false);

  useEffect(() => {
    if (autoRefresh !== "true") return;
    if (runningRef.current) return;

    let cancelled = false;
    runningRef.current = true;

    async function run() {
      const db = await getDb();
      type Row = { id: string; artist: string | null; name: string };
      const stale = await db.select<Row[]>(
        `SELECT id, artist, name FROM albums
         WHERE computed_at IS NULL
            OR computed_at < unixepoch('now', '-' || ? || ' days')
         ORDER BY name`,
        [STALE_DAYS]
      );

      for (const album of stale) {
        if (cancelled) break;
        try {
          await normalizeAlbum(album.id, album.artist ?? "", album.name);
        } catch (e) {
          console.warn("Background normalizer failed for:", album.name, e);
        }
        if (!cancelled) await new Promise<void>((r) => setTimeout(r, INTERVAL_MS));
      }
      runningRef.current = false;
    }

    void run();
    return () => { cancelled = true; };
  }, [autoRefresh]);
}
