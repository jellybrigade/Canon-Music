import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { getCoverArtUrl } from "../lib/navidrome";
import { QK } from "../lib/query-keys";
import type { ServerWithCredential } from "./useServer";

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 100;

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function fetchAndStoreCover(
  albumId: string,
  artworkUrl: string,
  swc: ServerWithCredential,
): Promise<boolean> {
  let url = "";
  try {
    url = getCoverArtUrl(swc.server.url, swc.server.username, swc.credential, artworkUrl, 300);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Cover cache: ${res.status} ${res.statusText} fetching album ${albumId} from ${url}`);
      return false;
    }
    const blob = await res.blob();
    const dataUrl = await blobToDataUrl(blob);
    const db = await getDb();
    await db.execute(
      `INSERT OR REPLACE INTO album_covers (album_id, data_url, cached_at) VALUES (?, ?, ?)`,
      [albumId, dataUrl, Date.now()],
    );
    return true;
  } catch (err) {
    // Network/parse/DB failure for this one album; retry on next session.
    console.error(`Cover cache: failed to cache album ${albumId} from ${url}`, err);
    return false;
  }
}

async function getMissingCoverRows(): Promise<{ id: string; artwork_url: string }[]> {
  const db = await getDb();
  return db.select<{ id: string; artwork_url: string }[]>(`
    SELECT a.id, a.artwork_url
    FROM albums a
    LEFT JOIN album_covers ac ON ac.album_id = a.id
    WHERE a.artwork_url IS NOT NULL AND ac.album_id IS NULL
  `);
}

/** Count of albums with artwork not yet cached. Used to show an estimate before a manual cache-all run. */
export async function getMissingCoverCount(): Promise<number> {
  return (await getMissingCoverRows()).length;
}

async function populateMissingCovers(
  swc: ServerWithCredential,
  signal: AbortSignal,
  onDone: (failed: number) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const rows = await getMissingCoverRows();
  onProgress?.(0, rows.length);
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    if (signal.aborted) return;
    const batch = rows.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((r) => fetchAndStoreCover(r.id, r.artwork_url, swc)));
    failed += results.filter((ok) => !ok).length;
    onProgress?.(Math.min(i + BATCH_SIZE, rows.length), rows.length);
    if (i + BATCH_SIZE < rows.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  onDone(failed);
}

/** Runs a background pass after sync to cache missing album covers in SQLite. */
export function useCoverCachePopulator(swc: ServerWithCredential | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!swc) return;
    const controller = new AbortController();
    void populateMissingCovers(swc, controller.signal, (failed) => {
      if (failed > 0) console.error(`Cover cache: ${failed} album(s) failed to cache in background pass`);
      void queryClient.invalidateQueries({ queryKey: QK.albumCovers() });
      void queryClient.invalidateQueries({ queryKey: QK.albumCoversMissingCount() });
    });
    return () => controller.abort();
  // Re-run when the server changes (e.g. user switches servers).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swc?.server.id]);
}

/** Manual "cache all covers now" trigger for Settings, with progress state. */
export function useCacheAllCovers(swc: ServerWithCredential | undefined) {
  const queryClient = useQueryClient();
  const [progress, setProgressState] = useState<{ done: number; total: number } | null>(null);
  const [lastFailedCount, setLastFailedCount] = useState<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = useCallback(async () => {
    if (!swc || controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLastFailedCount(null);
    await populateMissingCovers(
      swc,
      controller.signal,
      (failed) => {
        setLastFailedCount(failed);
        void queryClient.invalidateQueries({ queryKey: QK.albumCovers() });
        void queryClient.invalidateQueries({ queryKey: QK.albumCoversMissingCount() });
      },
      (done, total) => setProgressState({ done, total }),
    );
    controllerRef.current = null;
    setProgressState(null);
  }, [swc, queryClient]);

  return { run, progress, lastFailedCount };
}

interface CoverRow {
  album_id: string;
  data_url: string;
}

// Browsers don't share a decoded-image cache across data: URIs the way they do for
// blob:/http: URLs, so every <img> that points at the same data: URI (e.g. the same
// album card re-mounting via the AlbumGrid virtualizer on each route switch) pays a
// full image decode again. Converting once to a blob: URL and reusing that same URL
// string lets the browser's normal image cache skip the redundant decode on remount.
// Bounded so a long-running session (repeated re-syncs replacing data_url content)
// can't accumulate blob URLs forever; oldest entries are revoked on eviction.
const OBJECT_URL_CACHE_LIMIT = 2000;
const objectUrlCache = new Map<string, string>();

function dataUrlToObjectUrl(dataUrl: string): string {
  const cached = objectUrlCache.get(dataUrl);
  if (cached) {
    // Refresh recency: delete + re-set moves the entry to the end of Map's iteration order.
    objectUrlCache.delete(dataUrl);
    objectUrlCache.set(dataUrl, cached);
    return cached;
  }
  const commaIdx = dataUrl.indexOf(",");
  const mime = /data:([^;]+);base64/.exec(dataUrl.slice(0, commaIdx))?.[1] ?? "image/jpeg";
  const binary = atob(dataUrl.slice(commaIdx + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  objectUrlCache.set(dataUrl, url);
  if (objectUrlCache.size > OBJECT_URL_CACHE_LIMIT) {
    const oldestKey = objectUrlCache.keys().next().value;
    if (oldestKey !== undefined) {
      const oldestUrl = objectUrlCache.get(oldestKey)!;
      URL.revokeObjectURL(oldestUrl);
      objectUrlCache.delete(oldestKey);
    }
  }
  return url;
}

/** Returns a Map<albumId, objectUrl> loaded from the SQLite cover cache. */
export function useAlbumCoverMap(): Map<string, string> {
  const { data } = useQuery({
    queryKey: QK.albumCovers(),
    queryFn: async () => {
      const db = await getDb();
      return db.select<CoverRow[]>(`SELECT album_id, data_url FROM album_covers`);
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const rows = data ?? [];
  return useMemo(() => new Map(rows.map((r) => [r.album_id, dataUrlToObjectUrl(r.data_url)])), [rows]);
}
