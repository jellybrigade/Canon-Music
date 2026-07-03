import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { getArtistImageUrl, isCoverServerReady } from "../lib/navidrome";
import { resolvePortraitUrl } from "../lib/lastfm";
import { QK } from "../lib/query-keys";

// Wikimedia Commons rate-limits anonymous fetches aggressively; a batch of 5 concurrent
// requests reliably trips 429s. Keep concurrency low and retry 429s with backoff instead
// of counting a transient rate-limit as a permanent failure.
const BATCH_SIZE = 2;
const BATCH_DELAY_MS = 500;
const MAX_RETRIES_429 = 4;
const RETRY_BASE_DELAY_MS = 1000;

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const PROXY_WAIT_TIMEOUT_MS = 5000;
const PROXY_WAIT_POLL_MS = 200;

// Artist portraits are external (Wikidata/Last.fm) hosts that don't send CORS headers, so they must
// go through the Rust loopback proxy. The proxy's port is assigned asynchronously on app start, so a
// cache-all run kicked off right away (e.g. a fast "missing count" query resolving before the proxy's
// invoke() round-trip finishes) would otherwise fetch the raw external URL and fail on every image.
async function waitForCoverServer(signal: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + PROXY_WAIT_TIMEOUT_MS;
  while (!isCoverServerReady()) {
    if (signal.aborted || Date.now() >= deadline) return isCoverServerReady();
    await new Promise((r) => setTimeout(r, PROXY_WAIT_POLL_MS));
  }
  return true;
}

async function fetchAndStoreArtistImage(artistName: string, portraitUrl: string): Promise<boolean> {
  let url = "";
  try {
    url = getArtistImageUrl(portraitUrl);
    let res: Response | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES_429; attempt++) {
      res = await fetch(url);
      if (res.status !== 429) break;
      if (attempt === MAX_RETRIES_429) break;
      await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * 2 ** attempt));
    }
    if (!res!.ok) {
      console.error(`Artist image cache: ${res!.status} ${res!.statusText} fetching ${artistName} from ${url}`);
      return false;
    }
    const blob = await res!.blob();
    const dataUrl = await blobToDataUrl(blob);
    const db = await getDb();
    await db.execute(
      `INSERT OR REPLACE INTO artist_covers (artist_name, data_url, cached_at) VALUES (?, ?, ?)`,
      [artistName, dataUrl, Date.now()],
    );
    return true;
  } catch (err) {
    // Network/parse/DB failure for this one artist; retry on next session.
    console.error(`Artist image cache: failed to cache ${artistName} from ${url}`, err);
    return false;
  }
}

async function getMissingArtistImageRows(): Promise<{ name: string; portrait_url: string }[]> {
  const db = await getDb();
  const rows = await db.select<{ name: string; lastfm_image_url: string | null; wikidata_image_url: string | null }[]>(`
    SELECT ai.artist_name AS name, ai.lastfm_image_url, ai.wikidata_image_url
    FROM artist_identity ai
    LEFT JOIN artist_covers ac ON ac.artist_name = ai.artist_name
    WHERE ac.artist_name IS NULL
  `);
  return rows
    .map((r) => ({ name: r.name, portrait_url: resolvePortraitUrl(r) }))
    .filter((r): r is { name: string; portrait_url: string } => r.portrait_url !== null);
}

/** Count of artists with a resolvable portrait not yet cached. Used to show an estimate before a manual cache-all run. */
export async function getMissingArtistImageCount(): Promise<number> {
  return (await getMissingArtistImageRows()).length;
}

async function populateMissingArtistImages(
  signal: AbortSignal,
  onDone: (failed: number) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const rows = await getMissingArtistImageRows();
  onProgress?.(0, rows.length);

  const ready = await waitForCoverServer(signal);
  if (signal.aborted) return;
  if (!ready) {
    console.error("Artist image cache: cover proxy never became ready; aborting run");
    onDone(rows.length);
    return;
  }

  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    if (signal.aborted) return;
    const batch = rows.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((r) => fetchAndStoreArtistImage(r.name, r.portrait_url)));
    failed += results.filter((ok) => !ok).length;
    onProgress?.(Math.min(i + BATCH_SIZE, rows.length), rows.length);
    if (i + BATCH_SIZE < rows.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  onDone(failed);
}

/** Manual "cache all artist images now" trigger for Settings, with progress state. */
export function useCacheAllArtistImages() {
  const queryClient = useQueryClient();
  const [progress, setProgressState] = useState<{ done: number; total: number } | null>(null);
  const [lastFailedCount, setLastFailedCount] = useState<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = useCallback(async () => {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLastFailedCount(null);
    await populateMissingArtistImages(
      controller.signal,
      (failed) => {
        setLastFailedCount(failed);
        void queryClient.invalidateQueries({ queryKey: QK.artistCovers() });
        void queryClient.invalidateQueries({ queryKey: QK.artistCoversMissingCount() });
      },
      (done, total) => setProgressState({ done, total }),
    );
    controllerRef.current = null;
    setProgressState(null);
  }, [queryClient]);

  return { run, progress, lastFailedCount };
}

interface ArtistCoverRow {
  artist_name: string;
  data_url: string;
}

/** Returns a Map<artistName, dataUrl> loaded from the SQLite artist image cache. */
export function useArtistImageMap(): Map<string, string> {
  const { data } = useQuery({
    queryKey: QK.artistCovers(),
    queryFn: async () => {
      const db = await getDb();
      return db.select<ArtistCoverRow[]>(`SELECT artist_name, data_url FROM artist_covers`);
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const rows = data ?? [];
  return useMemo(() => new Map(rows.map((r) => [r.artist_name, r.data_url])), [rows]);
}

/** Resolves the URL to render for an artist portrait: prefer the locally
 * cached data URL, falling back to the loopback-routed source URL. Returns
 * null when there's no source portrait URL at all. */
export function resolveArtistImageUrl(
  imageMap: Map<string, string>,
  artistName: string,
  rawPortraitUrl: string | null
): string | null {
  if (!rawPortraitUrl) return null;
  return imageMap.get(artistName) ?? getArtistImageUrl(rawPortraitUrl);
}
