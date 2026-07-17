import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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

// --- On-demand cover data_url loading ---------------------------------------------------
// APPROACH (chosen 2026-07-17): eager keyset + on-demand per-id base64 fetch.
// useAlbumCoverMap used to eagerly run `SELECT album_id, data_url FROM album_covers` over
// the WHOLE cache (staleTime/gcTime Infinity), pulling multi-MB of base64 resident into JS
// at startup with a cost that scaled with library size. Now only the keyset (album_id) is
// loaded eagerly (tiny); each row's data_url is pulled on demand the first time a caller
// actually .get()s that id, and cached so each id is fetched at most once. Resident base64
// now scales with the set of covers actually VIEWED in a session, not the whole library.
//
// This is a SQLite-flavored port of psysonic's warm-disk-peek pattern
// (reference-projects/psysonic/src/cover/*): a synchronous cache read for consumers
// (getDiskSrcForGrid), a dedup'd background fetch for misses (coverArtInFlight), a
// subscriber notification to re-render when a fetch lands (subscribeDiskSrcCache), and a
// bounded in-memory cache. Psysonic also warms a bounded first-N batch up front; we skip
// that eager warm because callers already fall back to a server URL for un-warmed ids
// (`coverMap.get(id) ?? getCoverArtUrl(...)`), so misses show real art immediately rather
// than a blank, and the on-demand pull swaps in the cached bytes on the next render.
//
// CRITICAL: .get() stays SYNCHRONOUS. Every caller invokes it inline in render and uses the
// result immediately (with a `?? fallback`). It returns the object-URL synchronously when
// warmed; otherwise it kicks off a one-time background load, returns undefined this render,
// and a version bump re-renders the consumer once the load lands.

const DATA_URL_CACHE_LIMIT = 2000;
// albumId -> data_url, populated on demand, bounded LRU (recency = Map insertion order).
const dataUrlByAlbum = new Map<string, string>();
const albumLoadsInFlight = new Set<string>();

// External store so ALL useAlbumCoverMap consumers re-render when any cover lands, not just
// the one component whose .get() happened to trigger the load.
let coverStoreVersion = 0;
const coverStoreListeners = new Set<() => void>();
function subscribeCoverStore(listener: () => void): () => void {
  coverStoreListeners.add(listener);
  return () => coverStoreListeners.delete(listener);
}
function getCoverStoreVersion(): number {
  return coverStoreVersion;
}
function bumpCoverStore(): void {
  coverStoreVersion++;
  coverStoreListeners.forEach((l) => l());
}

function rememberAlbumDataUrl(albumId: string, dataUrl: string): void {
  dataUrlByAlbum.delete(albumId);
  dataUrlByAlbum.set(albumId, dataUrl);
  if (dataUrlByAlbum.size > DATA_URL_CACHE_LIMIT) {
    const oldest = dataUrlByAlbum.keys().next().value;
    // Evicting the data_url string only frees the base64 here; the decoded object-URL is
    // keyed by data_url content in objectUrlCache and evicted independently. A later re-get
    // of this id just re-reads the (small, PK-indexed) row from SQLite.
    if (oldest !== undefined) dataUrlByAlbum.delete(oldest);
  }
}

async function loadAlbumDataUrl(albumId: string): Promise<void> {
  try {
    const db = await getDb();
    const rows = await db.select<CoverRow[]>(
      `SELECT album_id, data_url FROM album_covers WHERE album_id = ? LIMIT 1`,
      [albumId],
    );
    if (rows[0]) {
      rememberAlbumDataUrl(albumId, rows[0].data_url);
      bumpCoverStore();
    }
  } catch (err) {
    console.error(`Cover cache: failed to load data_url for album ${albumId}`, err);
  } finally {
    albumLoadsInFlight.delete(albumId);
  }
}

class OnDemandCoverMap {
  constructor(private readonly ids: Set<string>) {}

  get(albumId: string): string | undefined {
    const dataUrl = dataUrlByAlbum.get(albumId);
    if (dataUrl) {
      // Refresh recency in the bounded album->data_url cache, then reuse the object-URL layer.
      dataUrlByAlbum.delete(albumId);
      dataUrlByAlbum.set(albumId, dataUrl);
      return dataUrlToObjectUrl(dataUrl);
    }
    // Not warmed yet: kick off a one-time background load only if this id is actually cached.
    if (this.ids.has(albumId) && !albumLoadsInFlight.has(albumId)) {
      albumLoadsInFlight.add(albumId);
      void loadAlbumDataUrl(albumId);
    }
    return undefined;
  }
}

/** Returns a lazily-loading albumId -> objectUrl lookup backed by the SQLite cover cache.
 *  Only the keyset is loaded eagerly; each cover's base64 is pulled on first .get(). */
export function useAlbumCoverMap(): Pick<Map<string, string>, "get"> {
  // Re-render this consumer whenever any cover data_url lands in the shared store.
  useSyncExternalStore(subscribeCoverStore, getCoverStoreVersion);

  const { data } = useQuery({
    queryKey: QK.albumCovers(),
    queryFn: async () => {
      const db = await getDb();
      // This runs on initial load and on every invalidation (after a sync / cache-all pass).
      // Drop cached data_urls so any covers whose bytes changed on re-sync get re-pulled
      // fresh on demand instead of serving stale base64.
      dataUrlByAlbum.clear();
      albumLoadsInFlight.clear();
      const rows = await db.select<{ album_id: string }[]>(`SELECT album_id FROM album_covers`);
      return rows.map((r) => r.album_id);
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const ids = data;
  return useMemo(() => new OnDemandCoverMap(new Set(ids ?? [])), [ids]);
}
