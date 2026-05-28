import { useEffect, useRef } from "react";
import { getDb } from "../db";
import { normalizeAlbum } from "../lib/tag-normalize";
import { useSetting } from "./useSetting";
import { useTagsStore } from "../store/tags";

const INTERVAL_MS = 2000;

export function useBackgroundNormalizer() {
  const [autoRefresh] = useSetting("tags.auto_refresh", "true");
  const [stalenessDays] = useSetting("tags.staleness_days", "30");
  const runningRef = useRef(false);

  useEffect(() => {
    if (autoRefresh !== "true") return;
    if (runningRef.current) return;

    const staleDays = Number(stalenessDays) || 30;
    let cancelled = false;
    runningRef.current = true;

    async function run() {
      const { setPullProgress } = useTagsStore.getState();
      const db = await getDb();
      type Row = { id: string; artist: string | null; name: string };
      const stale = await db.select<Row[]>(
        `SELECT id, artist, name FROM albums
         WHERE computed_at IS NULL
            OR computed_at < unixepoch('now', '-' || ? || ' days')
         ORDER BY name`,
        [staleDays]
      );

      if (stale.length === 0) {
        runningRef.current = false;
        return;
      }

      setPullProgress({ done: 0, total: stale.length });
      for (let i = 0; i < stale.length; i++) {
        if (cancelled) break;
        const album = stale[i]!;
        try {
          await normalizeAlbum(album.id, album.artist ?? "", album.name);
        } catch (e) {
          console.warn("Background normalizer failed for:", album.name, e);
        }
        if (!cancelled) {
          setPullProgress({ done: i + 1, total: stale.length });
          await new Promise<void>((r) => setTimeout(r, INTERVAL_MS));
        }
      }
      setPullProgress(null);
      runningRef.current = false;
    }

    void run();
    return () => { cancelled = true; };
  }, [autoRefresh, stalenessDays]);
}
