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
): Promise<void> {
  try {
    const url = getCoverArtUrl(swc.server.url, swc.server.username, swc.credential, artworkUrl, 300);
    const res = await fetch(url);
    if (!res.ok) return;
    const blob = await res.blob();
    const dataUrl = await blobToDataUrl(blob);
    const db = await getDb();
    await db.execute(
      `INSERT OR REPLACE INTO album_covers (album_id, data_url, cached_at) VALUES (?, ?, ?)`,
      [albumId, dataUrl, Date.now()],
    );
  } catch {
    // ignore individual failures; retry on next session
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
  onDone: () => void,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const rows = await getMissingCoverRows();
  onProgress?.(0, rows.length);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    if (signal.aborted) return;
    const batch = rows.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((r) => fetchAndStoreCover(r.id, r.artwork_url, swc)));
    onProgress?.(Math.min(i + BATCH_SIZE, rows.length), rows.length);
    if (i + BATCH_SIZE < rows.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  onDone();
}

/** Runs a background pass after sync to cache missing album covers in SQLite. */
export function useCoverCachePopulator(swc: ServerWithCredential | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!swc) return;
    const controller = new AbortController();
    void populateMissingCovers(swc, controller.signal, () => {
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
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = useCallback(async () => {
    if (!swc || controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    await populateMissingCovers(
      swc,
      controller.signal,
      () => {
        void queryClient.invalidateQueries({ queryKey: QK.albumCovers() });
        void queryClient.invalidateQueries({ queryKey: QK.albumCoversMissingCount() });
      },
      (done, total) => setProgressState({ done, total }),
    );
    controllerRef.current = null;
    setProgressState(null);
  }, [swc, queryClient]);

  return { run, progress };
}

interface CoverRow {
  album_id: string;
  data_url: string;
}

/** Returns a Map<albumId, dataUrl> loaded from the SQLite cover cache. */
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
  return useMemo(() => new Map(rows.map((r) => [r.album_id, r.data_url])), [rows]);
}
