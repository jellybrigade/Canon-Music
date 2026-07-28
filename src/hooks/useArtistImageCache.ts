import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { getArtistImageUrl, isCoverServerReady } from "../lib/navidrome";
import { resolvePortraitUrl } from "../lib/lastfm";
import { makeRateLimiter } from "../lib/rate-limiter";
import { runPool } from "../lib/async-pool";
import { QK } from "../lib/query-keys";

// Wikimedia Commons rate-limits anonymous fetches aggressively; a batch of 5 concurrent
// requests reliably trips 429s. Keep the request RATE low and retry 429s with backoff
// instead of counting a transient rate-limit as a permanent failure.
//
// Rate and concurrency are separated deliberately (rewritten 2026-07-28). This used to be
// `BATCH_SIZE = 2` + a 500ms sleep between batches, which conflated the two: the sleep
// paced requests, but the batch barrier also meant each pair of portraits cost
// `max(fetch_a, fetch_b) + 500ms`, so one slow host stalled a fast one. Now a per-host
// token bucket owns the rate (so a fetch from a host that is not Wikimedia is not slowed
// by Wikimedia's budget) and a worker pool owns concurrency.
const PORTRAIT_HOST_INTERVAL_MS = 250; // <= 4 req/s per host
const POOL_CONCURRENCY = 4;
const MAX_RETRIES_429 = 4;
const RETRY_BASE_DELAY_MS = 1000;

interface HostBudget {
  /** Token bucket: spaces this host's requests PORTRAIT_HOST_INTERVAL_MS apart. */
  limit: () => Promise<void>;
  /** Epoch ms until which every worker must hold off this host, set on a 429. */
  cooldownUntil: number;
}

const hostBudgets = new Map<string, HostBudget>();

function hostBudgetFor(sourceUrl: string): HostBudget {
  // Bucket on the ORIGINAL portrait host, not the cover:// proxy URL: the proxy is local
  // and unmetered, the upstream host is the thing with a rate limit.
  let host: string;
  try {
    host = new URL(sourceUrl).host;
  } catch {
    host = sourceUrl;
  }
  let budget = hostBudgets.get(host);
  if (!budget) {
    budget = { limit: makeRateLimiter(PORTRAIT_HOST_INTERVAL_MS), cooldownUntil: 0 };
    hostBudgets.set(host, budget);
  }
  return budget;
}

async function awaitHostBudget(budget: HostBudget): Promise<void> {
  const cooldown = budget.cooldownUntil - Date.now();
  if (cooldown > 0) await new Promise((r) => setTimeout(r, cooldown));
  await budget.limit();
}

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
    const budget = hostBudgetFor(portraitUrl);
    let res: Response | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES_429; attempt++) {
      await awaitHostBudget(budget);
      res = await fetch(url);
      if (res.status !== 429) break;
      if (attempt === MAX_RETRIES_429) break;
      // Back off the whole HOST, not just this request. With several workers in flight a
      // per-request sleep lets the others keep hammering a host that just said "slow down",
      // so each of them burns its own retry budget and the run ends with avoidable
      // permanent failures. Parking the host makes every worker wait it out together.
      budget.cooldownUntil = Math.max(budget.cooldownUntil, Date.now() + RETRY_BASE_DELAY_MS * 2 ** attempt);
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
  const rows = await db.select<{ name: string; lastfm_image_url: string | null; wikidata_image_url: string | null; navidrome_image_url: string | null }[]>(`
    SELECT ai.artist_name AS name, ai.lastfm_image_url, ai.wikidata_image_url, ai.navidrome_image_url
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

  await runPool(
    rows,
    async (row) => {
      const ok = await fetchAndStoreArtistImage(row.name, row.portrait_url);
      if (!ok) failed++;
    },
    {
      concurrency: POOL_CONCURRENCY,
      signal,
      onProgress: (done, total) => onProgress?.(done, total),
    },
  );
  if (signal.aborted) return;
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

// --- On-demand artist-image data_url loading -------------------------------------------
// APPROACH (chosen 2026-07-17): eager keyset + on-demand per-name base64 fetch. Mirrors the
// cover-cache rewrite in useCoverCache.ts (see the long comment there). useArtistImageMap
// used to eagerly `SELECT artist_name, data_url FROM artist_covers` over the WHOLE cache
// (staleTime/gcTime Infinity), pulling multi-MB of resident base64 into JS at startup with a
// cost that scaled with library size. Now only the keyset (artist_name) is loaded eagerly;
// each portrait's data_url is pulled on demand the first time a caller .get()s that name,
// cached so each name is fetched at most once, bounded LRU.
//
// Unlike covers, artist portraits have no object-URL layer: .get() returns the raw data URL
// string (callers feed it straight into <img src>), so the return contract is preserved
// exactly. .get() stays SYNCHRONOUS: warmed -> return the data URL; miss -> kick off a
// one-time background load, return undefined this render, and a version bump re-renders the
// consumer once it lands. Callers (`resolveArtistImageUrl`) already `?? getArtistImageUrl()`
// fall back to the loopback-routed source URL for un-warmed names, so a miss shows the live
// portrait immediately and swaps to cached bytes on the next render.

const ARTIST_DATA_URL_CACHE_LIMIT = 2000;
// artistName -> data_url, populated on demand, bounded LRU (recency = Map insertion order).
const dataUrlByArtist = new Map<string, string>();
const artistLoadsInFlight = new Set<string>();

// External store so ALL useArtistImageMap consumers re-render when any portrait lands.
let artistStoreVersion = 0;
const artistStoreListeners = new Set<() => void>();
function subscribeArtistStore(listener: () => void): () => void {
  artistStoreListeners.add(listener);
  return () => artistStoreListeners.delete(listener);
}
function getArtistStoreVersion(): number {
  return artistStoreVersion;
}
function bumpArtistStore(): void {
  artistStoreVersion++;
  artistStoreListeners.forEach((l) => l());
}

function rememberArtistDataUrl(name: string, dataUrl: string): void {
  dataUrlByArtist.delete(name);
  dataUrlByArtist.set(name, dataUrl);
  if (dataUrlByArtist.size > ARTIST_DATA_URL_CACHE_LIMIT) {
    const oldest = dataUrlByArtist.keys().next().value;
    if (oldest !== undefined) dataUrlByArtist.delete(oldest);
  }
}

async function loadArtistDataUrl(name: string): Promise<void> {
  try {
    const db = await getDb();
    const rows = await db.select<ArtistCoverRow[]>(
      `SELECT artist_name, data_url FROM artist_covers WHERE artist_name = ? LIMIT 1`,
      [name],
    );
    if (rows[0]) {
      rememberArtistDataUrl(name, rows[0].data_url);
      bumpArtistStore();
    }
  } catch (err) {
    console.error(`Artist image cache: failed to load data_url for ${name}`, err);
  } finally {
    artistLoadsInFlight.delete(name);
  }
}

class OnDemandArtistImageMap {
  constructor(private readonly names: Set<string>) {}

  get(name: string): string | undefined {
    const dataUrl = dataUrlByArtist.get(name);
    if (dataUrl) {
      dataUrlByArtist.delete(name);
      dataUrlByArtist.set(name, dataUrl);
      return dataUrl;
    }
    if (this.names.has(name) && !artistLoadsInFlight.has(name)) {
      artistLoadsInFlight.add(name);
      void loadArtistDataUrl(name);
    }
    return undefined;
  }
}

/** Returns a lazily-loading artistName -> dataUrl lookup backed by the SQLite artist image
 *  cache. Only the keyset is loaded eagerly; each portrait's base64 is pulled on first .get().
 *  Return shape is a `.get()`-only view; callers only ever call .get(). */
export function useArtistImageMap(): Pick<Map<string, string>, "get"> {
  // Re-render this consumer whenever any portrait data_url lands in the shared store.
  useSyncExternalStore(subscribeArtistStore, getArtistStoreVersion);

  const { data } = useQuery({
    queryKey: QK.artistCovers(),
    queryFn: async () => {
      const db = await getDb();
      // Runs on initial load + every invalidation (after a cache-all pass). Drop cached
      // data_urls so re-fetched portraits get re-pulled fresh on demand.
      dataUrlByArtist.clear();
      artistLoadsInFlight.clear();
      const rows = await db.select<{ artist_name: string }[]>(`SELECT artist_name FROM artist_covers`);
      return rows.map((r) => r.artist_name);
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const names = data;
  return useMemo(() => new OnDemandArtistImageMap(new Set(names ?? [])), [names]);
}

/** Resolves the URL to render for an artist portrait: prefer the locally
 * cached data URL, falling back to the loopback-routed source URL. Returns
 * null when there's no source portrait URL at all. */
export function resolveArtistImageUrl(
  imageMap: Pick<Map<string, string>, "get">,
  artistName: string,
  rawPortraitUrl: string | null
): string | null {
  if (!rawPortraitUrl) return null;
  return imageMap.get(artistName) ?? getArtistImageUrl(rawPortraitUrl);
}
