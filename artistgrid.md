# Artist Grid: full lifecycle (click → fetched → rendered → interactive)

Complete trace of everything that happens from clicking the Artists sidebar icon to a scrollable, clickable, populated grid of artist cards.

---

## 0. Before any click is possible: app boot, window reveal, server/credential resolution

**Window creation and reveal** (`src-tauri/tauri.conf.json` + `src/main.tsx`):
- Main window created with `"visible": false` in `tauri.conf.json`. Hidden until frontend signals first paint.
- `src/main.tsx`: renders React tree (`StrictMode` → `ErrorBoundary` → `QueryClientProvider` → `HashRouter` → `App`), then double-`requestAnimationFrame`s before calling `getCurrentWindow().show()`. Two rAFs (not one) so `show()` fires only after a real composited frame, reducing the window where the WebKitGTK freeze/thaw compositor race (`known-issues.md`) can land on a visible-but-still-settling frame. `.show()` on an already-visible window is a no-op.
- `src-tauri/src/lib.rs` has three additional fallback `w.show()` calls (~lines 1250/1323/1341/1361), including one wired through `tauri_plugin_single_instance::init` — if a second app instance launches, the existing window is shown/focused instead of a new process starting (see recent "single-instance guard" commit).
- **Router:** `HashRouter`, not `BrowserRouter` — routes live in the URL fragment (`#/artists`), which matters for Tauri's `asset://`/`tauri://` origin without a server-side router.
- `React.StrictMode` double-invokes effects in dev — `useArtists`' `useEffect`, `useLazyPortraitEnrich`'s `IntersectionObserver` setup/teardown, and the `ResizeObserver` setup in `ArtistGrid` all mount/unmount once extra in dev builds only.
- Global `contextmenu` suppression: `main.tsx` calls `e.preventDefault()` on any right-click outside `input, textarea, [contenteditable]`, which is why Canon's own `ContextMenu` component exists at all (native menu never shows).
- Global `unhandledrejection`/`error` listeners log to console so failures in async paths (e.g. a rejected enrichment fetch) don't vanish silently.
- `QueryClient` defaults: `staleTime: 60_000`, `refetchOnWindowFocus: false` — applies to every React Query hook touched later (`useArtistImageMap`, `useEnrichArtist`'s per-artist query, `useServerWithCredential`).

**Resolving `serverWithCred`** (`App.tsx:280`, feeding the `serverWithCred` gate at `App.tsx:915` mentioned in §1):
- `const { data: serverWithCred } = useServerWithCredential(server?.id)` — `src/hooks/useServer.ts:23-57`, a React Query hook (`queryKey: QK.serverCredential(serverId)`, `enabled: !!serverId`).
- `queryFn`: `db.select("SELECT * FROM servers WHERE id = ?")` (SQLite, §2's `getDb()` singleton) for the server row, then `keychain.get("canon.server.<id>", "credential")`.
- `keychain.get` (`src/keychain.ts`) is a thin wrapper calling `invoke("get_credential", { service, account })` — a second `#[tauri::command]` touched on this overall path (in addition to `set_cover_proxy_config` in §7), backed by the OS keychain via `tauri-plugin-keychain`, never disk.
- Credential JSON is parsed; a legacy shape (`token`+`salt`, no `type` field) is migrated in-memory to `{ type: "md5", token, salt }`. Missing or corrupt credentials throw (`"No credentials found..."` / `"Corrupt credentials..."`), which surfaces as `credError` in `App.tsx` and blocks `serverWithCred` from ever resolving — the `/artists` route's `Loading…` state (§1) stays up.
- Only once `serverWithCred` is truthy does the `<Route path="/artists">` element actually render `ArtistGrid` instead of the loading placeholder — so this whole resolution chain (SQLite read + keychain IPC round-trip) sits upstream of every artist card even though `useArtists()` itself doesn't depend on it.

---

## 1. Sidebar click → route change

**File:** `src/App.tsx`

- Sidebar nav items defined at `App.tsx:612-623` (`NAV_ITEMS`), including:
  ```tsx
  { id: "artists", label: "Artists", icon: <Users size={24} /> }
  ```
- Click handler at `App.tsx:1040-1053`:
  ```tsx
  onClick={() => { setCanonicalIdFilters([]); navigateTo(id); }}
  ```
  1. `setCanonicalIdFilters([])` clears active genre filter local state.
  2. `navigateTo("artists")` — from `useAppNavigation()` (`src/hooks/useAppNavigation.ts:49-58`). For a plain view id (no `select` arg): `navigate(VIEW_TO_PATH["artists"])` → `navigate("/artists")` via react-router. `VIEW_TO_PATH` map: `useAppNavigation.ts:9-21`.
- URL becomes `/artists`, matched by `<Route path="/artists" .../>` at `App.tsx:909`.
- Render gated on `serverWithCred` truthiness (`App.tsx:915`) — renders `<p className="empty-state">Loading…</p>` until server/credential resolved.
- `ArtistGrid` is a lazy-loaded chunk: `const ArtistGrid = lazy(() => import("./components/ArtistGrid"))` (`App.tsx:9`), inside `<Suspense fallback={null}>` (`App.tsx:1029`). First click in a session also triggers a JS chunk fetch.

---

## 2. Data fetching (artist list)

`useArtists()` is called unconditionally near the top of `App` (`App.tsx:295`), not gated behind the click — the artist list is already resident (or loading) as soon as the app mounts. Clicking the icon just swaps in the component that consumes it.

**`useArtists()`** — `src/hooks/useArtists.ts`:

- Plain `useState`/`useEffect`, reading directly from local SQLite (not React Query).
- Subscribes to `useArtistBrowseSessionStore((s) => s.refreshTick)` (`useArtists.ts:8`) — the full query re-runs every time `refreshTick` changes (post-sync, post-alias-merge, post-enrichment, see §7).
- `load()` (`useArtists.ts:15-38`), fired inside a `useEffect` keyed on `refreshTick`, runs:
  ```sql
  SELECT
    a.name,
    a.album_count,
    art.artwork_url,
    ai.lastfm_image_url,
    ai.wikidata_image_url,
    ai.navidrome_image_url
  FROM artists a
  LEFT JOIN artist_identity ai ON ai.artist_name = a.name
  LEFT JOIN (
    SELECT artist, server_id, artwork_url
    FROM albums
    WHERE artwork_url IS NOT NULL
    GROUP BY artist, server_id
  ) art ON art.artist = a.name AND art.server_id = a.server_id
  WHERE a.name NOT IN (SELECT alias_name FROM artist_aliases)
  ORDER BY a.name COLLATE NOCASE
  ```
  backed by index `idx_albums_artist_server_artwork` (schema v47). Returns every non-aliased artist row in one shot as `ArtistRow[]` — no LIMIT/pagination.
- Result assigned via `setData`/`setIsLoading(false)` inside the effect once the promise resolves.

**Where the `artists` table itself comes from (sync time, upstream of any click):** `src/lib/sync.ts:191-199`:
```ts
await db.execute("DELETE FROM artists WHERE server_id = ?", [server.id]);
await db.execute(
  `INSERT INTO artists (id, server_id, server_type, name, album_count, created_at)
   SELECT lower(hex(randomblob(8))), ?, ?, artist, COUNT(DISTINCT id), datetime('now')
   FROM albums WHERE server_id = ? AND artist IS NOT NULL AND artist != ''
   GROUP BY artist`,
  [server.id, server.type, server.id]
);
```
Artists are derived from `GROUP BY artist` over the local `albums` mirror, rebuilt every library sync.

**SQLite connection underneath** — `src/db/index.ts`:
- `getDb()` (lines 4-14): module-level singleton `Promise<Database>`. First call triggers `Database.load("sqlite:canon.db")` (the `@tauri-apps/plugin-sql` connection) chained with `runMigrations(database)`; every later call anywhere in the app returns the same resolved promise/handle.
- One PRAGMA is set: `PRAGMA journal_mode=WAL` (line 21), run on every app start.
- Migration runner (lines 16-60): ensures `schema_migrations(version INTEGER PRIMARY KEY)` exists, reads the max applied version, and for each migration in `src/db/migrations.ts` whose version is higher, splits its `.sql` string on `;`, trims/filters empty statements, and runs each individually via `database.execute(statement)`, recording the new version afterward.

---

## 3. Images — resolving each card's picture

For every rendered artist card (`ArtistGridCard`, `ArtistGrid.tsx:179-213`):

**URL resolution** (`ArtistGrid.tsx:117-125`, per visible artist):
```ts
const portraitUrl = resolvePortraitUrl(artist);                 // lastfm.ts:146-158
const cachedImageUrl = artistImageMap.get(artist.name) ?? null; // in-memory Map from SQLite artist_covers
const fallbackUrl = artist.artwork_url
  ? getCoverArtUrl(server.url, server.username, credential, artist.artwork_url, 300)
  : null;
const imgUrl = portraitUrl && !failedPortraits.has(artist.name)
  ? (cachedImageUrl ?? getArtistImageUrl(portraitUrl))
  : fallbackUrl;
```
`resolvePortraitUrl` (`src/lib/lastfm.ts:146-158`) prefers `wikidata_image_url` → `navidrome_image_url` → non-placeholder `lastfm_image_url`, else `null` (falls back to the album-cover proxy).

**`artist_covers` table and `useArtistImageMap`:**
- Schema (`src/db/migrations.ts:578-586`, migration v44):
  ```sql
  CREATE TABLE IF NOT EXISTS artist_covers (
    artist_name TEXT PRIMARY KEY,
    data_url TEXT NOT NULL,
    cached_at INTEGER NOT NULL
  );
  ```
  `data_url` is a base64 `data:` URI produced by `FileReader.readAsDataURL` on the fetched image `Blob` (`useArtistImageCache.ts:16-23`).
- Populated by `fetchAndStoreArtistImage` (`useArtistImageCache.ts:41-69`): fetches through `cover://.../artist-image/<encoded>` (retrying up to 4 times on HTTP 429 with exponential backoff), converts to a data URL, `INSERT OR REPLACE`s it. Only invoked via a manual "cache all artist images" action in Settings (`useCacheAllArtistImages`), processing missing rows in batches of 2 with a 500ms pause between batches, after waiting (up to 5s, polling every 200ms) for the cover proxy to be ready.
- `useArtistImageMap()` (`useArtistImageCache.ts:156-169`): a React Query hook, `staleTime`/`gcTime: Infinity`, doing one bulk `SELECT artist_name, data_url FROM artist_covers` for the whole table, wrapped in `useMemo(() => new Map(rows.map(...)), [rows])`. `ArtistGrid` calls this once and looks up per card — one query for the whole grid, not per artist.

**URL scheme routing** (`src/lib/navidrome.ts`):
- `getCoverArtUrl(...)` → `cover://localhost/cover/<id>?size=300` once `_coverServerReady` (set by `initCoverServer()`, itself gated on `set_cover_proxy_config` — see §8 — having been called first).
- `getArtistImageUrl(sourceUrl)` → `cover://localhost/artist-image/<encodeURIComponent(sourceUrl)>`.
- Both fall back to raw HTTP URLs if the proxy isn't ready yet.

**Rust side (`src-tauri/src/lib.rs`)** — serving `cover://`:
- `CoverState` (lines 124-131) holds two separate `HashMap<String,(Vec<u8>, String)>` behind their own `std::sync::Mutex`es (one for covers, one for artist portraits), a shared `proxy_config`, a `tokio::sync::Semaphore` (`request_sem`, 16 permits), and a shared blocking `reqwest::Client` (30s timeout).
- Registration (lines 1256-1269):
  ```rust
  .register_asynchronous_uri_scheme_protocol("cover", |ctx, request, responder| {
      let state = ctx.app_handle().state::<CoverState>().inner().clone();
      tauri::async_runtime::spawn(async move {
          let permit = state.request_sem.clone().acquire_owned().await;
          let response = tauri::async_runtime::spawn_blocking(move || {
              let _permit = permit;
              handle_cover_request(&state, &request)
          }).await.unwrap_or_else(|_| cover_error_response(500));
          responder.respond(response);
      });
  })
  ```
  Each request spawns an async task that awaits a semaphore permit, then runs the actual work in `spawn_blocking`, holding the permit for that duration.
- `handle_cover_request` (lines 252-368), for both the cover path and the artist-image path, in order:
  1. Lock the in-memory `HashMap`, check for a cached entry by key (`"{id}:{size}"` for covers, the raw source URL for portraits). Lock released immediately after the lookup.
  2. On miss, read the on-disk tier (`disk_cache_read`) under `<app-data>/cover-cache/<sanitized-key>` plus a `.ct` sidecar file for content-type (defaults to `image/jpeg` if missing). On hit, re-inserts into the in-memory map (clearing the whole map first if it's at `MAX_COVER_CACHE_ENTRIES` = 500).
  3. On both misses, fetches from upstream via the shared blocking HTTP client — direct `GET` for artist-image, `GET {base_url}/rest/getCoverArt?...&id=&size=` for covers — writes the result to disk (`disk_cache_write`) and into the in-memory map (same 500-entry clear-on-overflow check), then returns the bytes.
  4. Response always carries `Access-Control-Allow-Origin: *`; successful responses add `Cache-Control: public, max-age=604800`.
- Disk-tier eviction: `evict_disk_cache_if_needed` (lines 175-193) caps the on-disk cache at 2000 entries, deleting oldest-mtime files first; the sweep runs from `disk_cache_write` every 32nd disk write (`WRITE_COUNT % 32`, a process-lifetime `AtomicU64` shared across both cover and portrait writes).

**Lazy portrait-triggered enrichment** — `useLazyPortraitEnrich` (`ArtistGrid.tsx:18-32`): each mounted card gets its own `IntersectionObserver` (`rootMargin: "300px"`, observing relative to the browser viewport), created once on mount and disconnected on unmount or once the card has intersected (`useEnrichArtist(artistName, { enabled: inView })` then takes over — see §6).

---

## 4. Rendering the grid

**File:** `src/components/ArtistGrid.tsx`

- **Column/row geometry:** computed in JS, not CSS grid across the whole list. `containerRef`'s width is read via a `ResizeObserver` set up in a `useLayoutEffect` with an empty dependency array (lines 57-66): reads `el.offsetWidth` synchronously once, then `obs.observe(el)` for all further width changes, each calling `setContainerWidth`. `cols`, `cardWidth`, `rowHeight` are derived from `containerWidth` and `CARD_MIN = 190px` (line 37) plus `PADDING`/`COL_GAP`/`ROW_GAP` constants.
- **Virtualization:** `@tanstack/react-virtual`'s `useVirtualizer` (lines 76-81), row-based: `count: rowCount` (`rowCount = Math.ceil(artists.length / cols)`, line 74), `estimateSize: () => rowHeight`, `overscan: 3`. Only visible + 3 overscan rows are mapped to DOM via `virtualizer.getVirtualItems()` (line 100).
- A second `useLayoutEffect` (lines 83-90) tracks `prevLayoutKey = "${cols}-${rowHeight}"` in a ref and calls `virtualizer.measure()` only when that key changes (i.e. only on genuine layout changes, not every render).
- Each virtual row is positioned with inline `style` — `position: "absolute"`, `top: ${PADDING + virtualRow.start}px` (lines 107-108) — and internally lays out its cards via `gridTemplateColumns: repeat(${cols}, 1fr)` for just that row.
- `useScrollMemory("artists", containerRef)` (`src/hooks/useScrollMemory.ts`) persists/restores scroll offset in a module-level `Map<string, number>` keyed by view name, so the scroll position survives navigating away and back.
- If `artists.length === 0`: renders `<p className="empty-state">No artists found. Sync first.</p>` (lines 92-94) instead of the virtualizer.

**`ArtistGridCard`** (lines 179-213) renders, per artist:
```tsx
{imgUrl ? (
  <img
    className="album-art"
    src={imgUrl}
    alt={artist.name}
    decoding="async"
    loading="lazy"
    onError={() => { if (hasPortrait) onPortraitError(); }}
  />
) : (
  <div className="album-art album-art--placeholder" />
)}
```
- `loading="lazy"` and `decoding="async"` — native browser lazy-load/off-main-thread decode, layered on top of the fact that virtualization already keeps non-visible cards' `<img>` tags out of the DOM entirely.
- No `srcset`/`sizes` — single fixed source. The requested pixel size is fixed upstream: `getCoverArtUrl(..., 300)` (album-art fallback path) hardcodes `size=300`; portrait URLs carry no size parameter (native resolution of whatever the source is).
- Sizing/cropping via CSS (`AlbumGrid.css:92-105`): `position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;`, filling the `aspect-ratio: 1/1` `.album-card` container.
- `onError`, only when the failing image was a portrait attempt: `setFailedPortraits((prev) => new Set(prev).add(artist.name))` (line 135) — a `useState<Set<string>>` in the parent. On next render, `imgUrl`'s computation checks `!failedPortraits.has(artist.name)` and falls back to the album-art URL (or the placeholder `<div>` if there's no album art either) for the rest of that component instance's life.
- Click/keyboard/context-menu handlers wire up selection, `ContextMenu`, `StartRadioSubmenu`, `ArtistIdentifyDialog`. Concretely (`ArtistGrid.tsx:49-50`): `contextMenu` and `identifyArtist` are plain `useState` in the parent `ArtistGrid`, not per-card — right-clicking a card sets `contextMenu = { x, y, artist }` (coordinates from the click event), which conditionally renders one shared `<ContextMenu>` positioned at those coordinates; picking "Identify" from it sets `identifyArtist`, mounting `<ArtistIdentifyDialog>`; picking a radio mode routes through `<StartRadioSubmenu>` into the `onStartRadio` prop passed down from `App.tsx`. Only one context menu/dialog instance exists across the whole grid at a time, reused for whichever artist was last interacted with. Left-click-opened variants of these are subject to the WebKitGTK self-closing-menu gotcha (`known-issues.md`) — already mitigated via the deferred `mousedown`-capture outside-close listener in `ContextMenu.tsx`.
- `--motion-fast` (used by the hover transitions in `AlbumGrid.css`) is defined once in `src/styles/tokens.css:39` as `120ms ease-out` — every card's hover/overlay transition times back to this single token.

**Styling** — `ArtistGrid.tsx` reuses `src/components/AlbumGrid.css` classes (`album-card`, `album-art`, `album-overlay`, `album-name`, `album-artist`, `empty-state`):
- `.album-card` transitions `transform` and `box-shadow` over `--motion-fast`; on hover, `transform: translateY(-2px)` plus a larger `box-shadow`.
- `.album-overlay` transitions `opacity` from `var(--opacity-90)` to `1` on card hover.
- `.album-art` has a static (non-animated) `transform: translateZ(0); backface-visibility: hidden;` — promotes the image onto its own compositor layer.
- No `filter`/`backdrop-filter` anywhere in this stylesheet. `text-shadow` (not `box-shadow`) is used on the name/artist labels for legibility over the image.

---

## 5. State plumbing — Zustand tick + React Query layers

**`useArtistBrowseSessionStore`** (`src/store/artistBrowseSessionStore.ts`) — shape:
```ts
interface ArtistBrowseSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
}
```
- `refreshTick` is read only by `useArtists.ts` (as its refetch trigger).
- `bumpRefresh()` is called by: `useEnrichArtist.ts` (after a lazy background enrichment completes, and after a manual refresh completes), `useLibrarySync.ts` (after a full sync), `useArtistAliases.ts` (after an alias merge/split).
- Debounce (lines 19-29):
  ```ts
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  bumpRefresh: () => {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      set((s) => ({ refreshTick: s.refreshTick + 1 }));
    }, 400);
  },
  ```
  Module-level timer (not store state) — the first `bumpRefresh()` in a quiet period schedules a 400ms timeout; every call within that window is a no-op; when the timer fires, it nulls itself and increments `refreshTick` by exactly 1, regardless of how many bumps arrived.

**React-Query-backed pieces in this view:** `useArtistImageMap` (bulk `artist_covers` read, §3) and `useEnrichArtist`'s per-artist `artistEnrichment` query (`staleTime: Infinity`) both go through `@tanstack/react-query`. The primary artist list (`useArtists`) does not — it's the raw SQLite-mirror-plus-Zustand-tick pattern described in §2.

---

## 6. Enrichment triggered per visible card

`useEnrichArtist(artistName, { enabled: inView, serverWithCredential })` (`src/hooks/useEnrichArtist.ts`) only does work once `enabled` flips true (i.e. once `useLazyPortraitEnrich`'s IntersectionObserver fires for that card, §3).

**Concurrency gate**, module-level, shared across every card/hook instance in the app:
```ts
const inFlight = new Map<string, Promise<void>>();
const MAX_CONCURRENT_ENRICH = 3;
const MAX_QUEUED_ENRICH = 24;
let activeEnrichCount = 0;
const enrichQueue: Array<() => void> = [];
```
`acquireEnrichSlot()` grants immediately if `activeEnrichCount < 3`; otherwise queues (FIFO, capped at 24) or returns `null` if the queue is full. `releaseEnrichSlot()` decrements the count and immediately promotes the next queued waiter. `inFlight` deduplicates simultaneous enrichment attempts for the same artist name (e.g. two visible cards for the same artist).

**`enrichArtist()` call graph** for one artist (`useEnrichArtist.ts:183-286`):
1. **MBID resolution** (only if not already known): `searchArtists(artistName)` (MusicBrainz). Multiple candidates → `disambiguateArtistByLocalAlbums` reads local albums/aliases via `db.select` (no network), pre-filters by name similarity, probes the top 3 candidates in parallel via `fetchArtistReleaseGroupTitles`, and scores them against local album titles.
2. **Parallel fetch:** `fetchArtistInfo(lastfmName)` (Last.fm) together with `fetchWikidataImageByMbid(resolvedMbid)` (Wikidata, only if an MBID exists and no Wikidata image is cached yet).
3. **Fanart.tv fallback** (sequential, only if no Wikidata image and an MBID exists, and a Fanart API key is configured): `fetchFanartTvImageByMbid`.
4. **Bio/portrait fallback** (only if Last.fm returned no bio): `fetchTheAudioDbArtist` and a Wikipedia lookup (MBID-keyed first, falling back to name-based) run concurrently with each other.
5. **Navidrome scrape fallback** (only if still no image and a server/credential is available): `findNativeArtistId` (local `db.select`), then `getArtistImageFromServer` (direct `fetch` to the Navidrome `getArtistInfo2` endpoint), then `probeImageLoads(url)` — loads the URL into a throwaway `Image()` element to confirm it actually resolves before trusting it.
6. **Write:** one `db.execute` `INSERT ... ON CONFLICT(artist_name) DO UPDATE` into `artist_identity`, writing bio/listeners/playcount/`similar_json`/`top_tags_json` and the three image-url columns. `wikidata_image_url`/`navidrome_image_url`/`enriched_at` use `COALESCE(excluded.x, artist_identity.x)` (a null result doesn't erase a previously stored value); other fields are overwritten unconditionally.

On success, the hook invalidates the relevant React Query keys and calls `bumpRefresh()` on the Zustand store (§5), which is what eventually re-runs `useArtists()`'s SQL and lets a newly-resolved image URL show up in the grid.

---

## 7. Tauri IPC touched along this path

Only one actual `#[tauri::command]` is invoked anywhere in this render/data path:

- **`set_cover_proxy_config(state, base_url, auth_params)`** (`lib.rs:218-225`) — called via `updateCoverProxyConfig()` (`src/lib/navidrome.ts:16-26`) from an `App.tsx` effect whenever `serverWithCred` changes (`App.tsx:401-415`), always before `initCoverServer()` flips the local "proxy ready" flag that gates `cover://` URL generation.

Everything else that looks like a network call in this path is a direct browser `fetch()` (Last.fm, MusicBrainz, Wikidata, Fanart.tv, TheAudioDB, Wikipedia, the Navidrome `getArtistInfo2` scrape) or a request to the custom `cover://` URI scheme (handled by `register_asynchronous_uri_scheme_protocol`, resolved through normal `<img src>`/resource loading rather than `invoke()`).

---

## End state

Once `useArtists()` resolves, `ArtistGrid` mounts with the full `ArtistRow[]` array, computes column count from measured container width, virtualizes rows via `react-virtual`, and renders only the visible + overscan window of `ArtistGridCard`s. Each card resolves its image URL (portrait cache → live portrait fetch → album-art fallback → placeholder), lazily triggers background enrichment once scrolled near view, and is fully interactive (click, keyboard nav, context menu, hover states) as soon as its DOM node exists — which for the first screenful is essentially immediately after `artists` data resolves, and for the rest of the list happens progressively as the user scrolls and the virtualizer mounts new rows.
