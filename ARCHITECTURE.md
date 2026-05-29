# Canon — Architecture

Living document. Update in the same commit as any change that adds, moves, deletes, or substantially repurposes a file. See CLAUDE.md "Keep ARCHITECTURE.md current".

---

## Repo Layout

```
Canon/
├── src-tauri/                 Rust: audio + keychain only (no business logic)
│   ├── src/lib.rs             Tauri command handlers, AudioState, PosTracker
│   ├── src/main.rs            6-line stub → lib::run()
│   ├── Cargo.toml             rodio 0.19, symphonia, reqwest, tauri-plugin-sql, tauri-plugin-http, keyring
│   └── tauri.conf.json        App config, bundle, plugin allowlist
├── src/                       React + TypeScript frontend
│   ├── App.tsx                Root: routing, sidebar nav, sync trigger, search bar, keymap
│   ├── App.css                Design tokens (color vars, z-index, typography), global element resets, animations, sidebar (215 LOC)
│   ├── main.tsx               React entry, QueryClientProvider; imports tokens.css, base.css, library.css
│   ├── keychain.ts            Thin invoke wrapper for set/get/delete_credential Tauri commands
│   ├── db/
│   │   ├── index.ts           getDb() promise-cached singleton
│   │   └── migrations.ts      All schema versions (v1–v11), runs on every getDb() call
│   ├── lib/
│   │   ├── cx.ts              cx(...classes) helper for joining conditional class names
│   │   ├── ids.ts             stripServerPrefix(id, serverId) — strips "{serverId}:" prefix
│   │   ├── canonicalize.ts    Canon tree loader, canonicalKey(), findCanonical(), findCanonicalSync(), getAncestorIds() (BFS all DAG parents); exports TreeNode (with section field)
│   │   ├── tag-buckets.ts     bucketize(tagIds) — splits mapped tag IDs into { genres, descriptors, scenes } using node.section
│   │   ├── artColor.ts        Canvas-based accent extraction: extractAccent(imageUrl) → hsl string | null; CORS-safe fallback
│   │   ├── lastfm.ts          Last.fm API: fetchAlbumTags(), classifyTag(), fetchSimilarArtists(), fetchArtistTopTracks(); uses makeRateLimiter()
│   │   ├── musicbrainz.ts     MusicBrainz API (via tauri-plugin-http for UA header): searchReleaseGroups(), lookupReleaseGroup(), lookupRelease(), searchArtists(), lookupArtist(), combineGenres(); 1 req/sec
│   │   ├── rate-limiter.ts    makeRateLimiter(intervalMs) factory — shared between lastfm.ts and musicbrainz.ts
│   │   ├── lrclib.ts          LRClib lyrics fetch: fetchLyrics(), parseLrc(); public API, no auth
│   │   ├── navidrome.ts       OpenSubsonic API client; scrobbleTrack()
│   │   ├── radio.ts           Radio scoring engine: buildAncestorWeights(), getRadioCandidates()
│   │   ├── sidecar.ts         checkSidecarHealth() + probeSidecar(host) + writeTags() HTTP client wrappers
│   │   ├── sync.ts            syncLibrary(): albums+tracks+FTS+starred+playlists+artists+tag_issues; incremental skip
│   │   └── tagIssues.ts       scanForIssues(serverId): detects 5 issue types, INSERT OR IGNORE preserves dismissed
│   ├── hooks/
│   │   ├── useAlbumIdentity.ts  useAlbumIdentity(albumId) + useIdentifyAlbum() on-demand MB lookup + useSaveAlbumIdentity() mutation
│   │   ├── useArtistIdentity.ts useArtistIdentity(artistName) + useIdentifyArtist() + useSaveArtistIdentity()
│   │   ├── useAlbums.ts       Albums from SQLite; sort + genre filter
│   │   ├── useArtists.ts      Artists from artists table (populated by sync)
│   │   ├── useGenres.ts       useGenres() + useAlbumsByGenre(genre)
│   │   ├── useGlobalShortcuts.ts  Global keydown handler: Space/arrows/L (love); Space=play-pause
│   │   ├── useLoved.ts        loved_tracks + loved_albums; optimistic toggle + star API
│   │   ├── useLyrics.ts       useLyrics(track): SQLite cache → LRClib fetch; returns {plain, synced, loading}
│   │   ├── useMediaSession.ts navigator.mediaSession wiring: metadata + 6 action handlers; MPRIS on Linux
│   │   ├── useRadio.ts        Radio lookahead: when radioActive and queue < 10 tracks, fetches + enqueues next pick
│   │   ├── useScrobble.ts     Writes to scrobble_queue at 50% / 240s
│   │   ├── useScrobbleFlush.ts  Flushes scrobble_queue to Navidrome scrobble.view; 60s interval + online event
│   │   ├── useSearch.ts       FTS5 search; 200ms debounce; prefix-match tokens; LIMIT 50/group
│   │   ├── useServer.ts       useServers() + useServerWithCredential(); ServerWithCredential type
│   │   ├── useSetting.ts      Generic key-value SQLite settings hook
│   │   ├── useTagIssues.ts    useTagIssues(): React Query over tag_issues; dismissIssue + dismissAll mutations
│   │   ├── useTagMappings.ts  tag_mappings CRUD; saveMapping also stages pending_edits for genre; useVocabulary(); useVocabAlbums(); useAddUserTreeNode()
│   │   ├── useTagPull.ts      useTagPull(): pullForAlbum + canonizeAlbum; applyInboxItem stages pending_edits; useAcceptInboxItem()
│   │   ├── useTrackEndedListener.ts  Tauri track-ended event → playerStore.next()
│   │   ├── useTrackTags.ts    track_tags read/write; useOffTreeAlbumIds(); useTagStats(); useStaleAlbums()
│   │   └── useTracks.ts       Tracks for a given album_id from SQLite
│   ├── store/
│   │   ├── player.ts          Zustand: queue, shuffle, repeat, volume, elapsed, isNowPlayingOpen, actions
│   │   └── tags.ts            Zustand: inboxItems (in-memory per session); addInboxItem, removeInboxItem, updateTagRow
│   ├── components/
│   │   ├── setup/
│   │   │   ├── Wizard.tsx     4-step onboarding wizard (replaces AddServerModal); server connect + optional sidecar + auto-detect
│   │   │   └── Wizard.css     Wizard layout, step dots, form + action styles
│   │   ├── AlbumDetail.tsx    Hero (blurred bg + 240px art), three-column tag band (useNormalizeAlbum), tracklist, right-click → Show tags / Start radio / playlist; Identify button → AlbumIdentifyDialog
│   │   ├── AlbumGrid.tsx      Album card grid; hover heart; off-tree badge (AlertTriangle icon)
│   │   ├── ArtistDetail.tsx   Blurred banner (local art or Last.fm image), album grid, top tracks; Identify button → ArtistIdentifyDialog
│   │   ├── IdentifyDialog.tsx AlbumIdentifyDialog + ArtistIdentifyDialog — MB lookup, ambiguous candidate picker, confirmed facts display, Confirm saves to album_identity/artist_identity
│   │   ├── TagDrawer.tsx      Sliding right drawer: normalized tag source/confidence per bucket; Override → pending_edits (track-scoped only)
│   │   ├── ArtistGrid.tsx     Artist cards with album count
│   │   ├── NowPlayingView.tsx     Full-page now-playing view: fluid two-panel, accent color from art, top tracks (Last.fm ranked), lyrics
│   │   ├── PlayerBar.tsx      Fixed bottom bar: controls, progress, volume, thumb→overlay
│   │   ├── PlaylistDetail.tsx  Playlist tracklist + play controls + remove-track context menu
│   │   ├── PlaylistList.tsx   Playlist list + inline create form
│   │   ├── QueuePanel.tsx     Right drawer: HTML5 drag-to-reorder, right-click context menu
│   │   ├── SearchResults.tsx  Grouped Albums / Tracks / Artists with "Show all" toggles (up to 50)
│   │   └── SettingsView.tsx   Settings: Last.fm API key, staleness threshold, pull mode default, sidecar
│   ├── styles/
│   │   ├── tokens.css         New design tokens: --radius-sm/md/lg, --motion-fast/med/slow, --shadow-1/2
│   │   ├── base.css           Global resets: box-sizing, html/body/root, scrollbars
│   │   └── library.css        Library view shell CSS (imported by App.tsx); sort bar, genre filter, search bar
│   ├── types/
│   │   └── server.ts          Server interface (+sidecar_url/secret_key/path_prefix fields)
│   └── assets/
│       └── canon-tree.json    3203-node genre DAG (2766 genres + 424 moods + 13 categories). Each node has section field. Generated by scripts/parse-rym.mjs.
├── sidecar/                   T1: Python + mutagen tag-write service (FastAPI, Docker-ready)
│   ├── canon_sidecar/main.py  GET /health + POST /write (dry_run, backup, path escape guard)
│   ├── pyproject.toml         Dependencies: fastapi, uvicorn, mutagen
│   ├── Dockerfile             python:3.12-slim; CANON_SIDECAR_SECRET + CANON_SIDECAR_MUSIC_ROOT
│   ├── README.md              Run locally + Docker; API docs; path remap; security
│   └── tests/test_write.py    pytest: dry-run, backup, bad auth, path escape, 404
├── scripts/
│   ├── data/
│   │   └── rym-hierarchy.txt  RateYourMusic genre/descriptor/scene hierarchy (source for canon-tree.json)
│   └── parse-rym.mjs          Regenerates canon-tree.json from rym-hierarchy.txt. Run: node scripts/parse-rym.mjs
├── plan.md                    Product spec and v1/v2 feature split
├── HANDOFF.md                 Progress, design decisions, known bugs, missing-before-v1
├── ARCHITECTURE.md            This file
└── CLAUDE.md                  Coding principles, architecture rules, commands
```

---

## Data Flow

```
Navidrome (OpenSubsonic)
        │
        ▼ navidrome.ts
        │  ping, getAlbumList2, getAlbum, getStarred2,
        │  star/unstar, getCoverArtUrl, getStreamUrl
        │
        ▼ sync.ts → syncLibrary(server)
        │  upserts albums + tracks into SQLite
        │  rebuilds tracks_fts (FTS5)
        │  syncs loved state from getStarred2
        │
        ▼ SQLite (canon.db)
        │  tables: albums, tracks, artists, servers, settings,
        │          loved_tracks, loved_albums, tracks_fts,
        │          pending_edits, edit_history,
        │          scrobble_queue, scrobble_history
        │
        ▼ React Query hooks (useAlbums, useTracks, useLoved, useSearch …)
        │  cache layer; queryKey determines cache identity
        │
        ▼ Components (AlbumGrid, AlbumDetail, SearchResults …)
           render; user interactions call playerStore actions or hook mutations

Playback path:
  Component calls playerStore.play(track, streamUrlFor)
        │
        ▼ player.ts (Zustand)
           invoke("audio_play", { url }) → Rust audio_play
           polls invoke("audio_get_pos") every 200ms
           prefetches next track at 80% elapsed via invoke("audio_prefetch")
           listens for track-ended Tauri event → next()

Tag normalization pipeline (display-only):
  useNormalizeAlbum / useBackgroundNormalizer → tag-normalize.ts → normalizeAlbum()
    → track_tags JOIN tracks (file tags) + fetchAlbumTags (Last.fm)
    → dedup by canonicalKey → findCanonicalSync → bucketize by section
    → cap (genres≤6, descriptors≤6, scenes≤4) → albums.normalized_tags_json + computed_at
    → getAncestorIds (BFS all DAG parents) → album_genres (direct leaves + full ancestor expansion)
    → album_unresolved_genres (tags that failed canon resolution)

Tag inbox pipeline (legacy, file-write path):
  Last.fm pull → lastfm.ts → raw tags → canonicalize.ts → InboxItem (in-memory)
               → user reviews InboxCard → Accept → track_tags + tag_mappings (SQLite)
               → stageGenrePendingEdits: pending_edits row per track ("; "-joined canonical genres)
               → albums.tags_refreshed_at updated
  Vocabulary rename → tag_mappings row → back-fills canonical_id → stageGenreEditsForRawValue → pending_edits
  User tree addition → user_tree_nodes (SQLite) → bustCanonTreeCache()
  Off-tree detection: track_tags WHERE canonical_id IS NULL → badge on AlbumGrid cards

Tag file-write path (via sidecar):
  Accept inbox / save mapping → pending_edits (SQLite) → diff review → POST /write → sidecar (Docker)
           → on success → edit_history → pending_edits row deleted

Scrobble path:
  useScrobble → scrobble_queue (SQLite)
  useScrobbleFlush (mounted in App) → 60s interval + online event → scrobble.view API
              → success: INSERT scrobble_history + DELETE from queue; failure: stop batch

Radio path:
  useRadio (mounted in App) → monitors radioActive + queue depth
  when queue.length - queueIndex < 10: getRadioCandidates(seed, excludeIds, similarArtists)
    → SQL CTE scores tracks by DAG ancestor weights (0.6 * tree + 0.4 * lastfm boost)
    → random pick from top-5 of top-50 pool → addToQueue

Lyrics path:
  useLyrics(track) → SQLite lyrics cache → miss: fetchLyrics (LRClib API)
                   → cache result → parseLrc → NowPlayingOverlay synced/plain display

Credentials:
  setup/Wizard → invoke("set_credential") → OS keychain
  useServer → invoke("get_credential") → decoded NavidromeCredential
  Never in SQLite, localStorage, or Zustand
```

---

## File-by-File Reference

### Rust (`src-tauri/src/`)

| File | Purpose |
|---|---|
| `lib.rs` | All Tauri commands. `AudioState`: `rodio::Sink`, `play_id: AtomicU64` (race guard), `PosTracker` (wall-clock elapsed), `prefetch_cache: HashMap<url, bytes>`. Commands: `audio_play`, `audio_pause`, `audio_resume`, `audio_stop`, `audio_seek`, `audio_volume`, `audio_get_pos`, `audio_prefetch`, `set_credential`, `get_credential`, `delete_credential`. Emits `track-ended` event when sink empties. |
| `main.rs` | Stub: `lib::run()`. |

### Database (`src/db/`)

| File | Purpose |
|---|---|
| `index.ts` | `getDb()` — promise-cached singleton. Safe to call concurrently. Runs all migrations on first call. |
| `migrations.ts` | Schema v1–v17. Tables: `tracks` (+`file_path` v8), `albums` (+`navidrome_created` v6, +`normalized_tags_json`/`computed_at` v11), `artists`, `servers` (+sidecar columns v8), `settings`, `pending_edits`, `edit_history`, `scrobble_queue`, `scrobble_history`, `loved_tracks`, `loved_albums`, `tracks_fts` (FTS5, v5), `playlists`, `playlist_tracks` (v7), `genre_mappings`, `tag_issues` (v8), `lyrics` (v10), `track_tags`+`tag_mappings`+`user_tree_nodes`+`tag_inbox` (v9), `tag_mappings` +`source`/`match_type` (v13), +`locked` (v14), `album_identity`+`artist_identity` (v15), `album_identity` +`auto_matched`/`match_score`/`looked_up_at` (v16), `album_genres`+`album_unresolved_genres` (v17). |

### API clients & sync (`src/lib/`)

| File | Purpose |
|---|---|
| `ids.ts` | `stripServerPrefix(id, serverId)` — removes `"{serverId}:"` prefix from composite IDs. Throws if prefix is missing (catches colon-in-ID bugs). Use instead of `id.slice(server.id.length + 1)`. |
| `artColor.ts` | `extractAccent(imageUrl)` — loads cover art via hidden `crossOrigin="anonymous"` image, downscales to 32×32 canvas, finds the most saturated vibrant pixel, returns `hsl(…)` string or `null` on CORS/error. Used by NowPlayingView to drive per-track `--accent`. |
| `lastfm.ts` | Last.fm API. `fetchAlbumTags(artist, album)`, `fetchArtistImage(artist)`, `classifyTag(raw)`, `fetchSimilarArtists(artist)`, `fetchArtistTopTracks(artist)` (global popularity ranking for "Top tracks" section). Rate-limited to 4 req/s via `makeRateLimiter()`. API key from `settings['lastfm.api_key']`. |
| `musicbrainz.ts` | MusicBrainz API client. Uses `@tauri-apps/plugin-http` (not browser fetch) to set required `User-Agent` header per MB policy. Rate-limited to 1 req/sec via `makeRateLimiter(1100)`. No API key required. Functions: `searchReleaseGroups(artist, album)`, `lookupReleaseGroup(rgMbid)` (inc genres+releases+artist-credits), `lookupRelease(releaseMbid)` (inc genres+labels), `searchArtists(name)`, `lookupArtist(artistMbid)` (inc genres), `combineGenres(rgGenres, releaseGenres)` (deduped union by vote count). Genre note: combined genres = union(RG genres, matched-release genres); full per-pressing union not fetched (rate-limit cost). `MbReleaseGroupCandidate` includes `score` (MB Lucene relevance, 0–100) for tiebreaking. |
| `fuzzy-match.ts` | Dependency-free fuzzy matching for MB candidate scoring. `normalizeForMatch(s)`: lowercase, strip diacritics, drop edition noise (deluxe/remaster/etc.), drop leading articles, collapse whitespace. `similarity(a, b)`: normalized Levenshtein (0–1). `scoreReleaseGroup(candidate, artist, album)`: 0.6×title + 0.4×artist similarity. `rankCandidates(cands, artist, album)`: desc by score. |
| `rate-limiter.ts` | `makeRateLimiter(intervalMs)` — factory returning a `rateLimit()` async function. Shared by `lastfm.ts` and `musicbrainz.ts`. |
| `lrclib.ts` | LRClib public API. `fetchLyrics({artist, album, title, durationSec})` → `LrclibResult | null` (404 = no lyrics). `parseLrc(lrc)` → `LrcLine[]` sorted by timeSec. |
| `navidrome.ts` | OpenSubsonic client. MD5 token + salt auth (`c=canon`, `v=1.16.1`). `NavidromeAlbum.songCount?: number` for incremental sync. `scrobbleTrack(url, username, cred, nativeId, timestampMs)`. Functions: `authenticate`, `fetchAllAlbums`, `fetchAlbumTracks`, `fetchStarred2`, `fetchPlaylists`, `fetchPlaylistTracks`, `createNavidromePlaylist`, `deleteNavidromePlaylist`, `addTrackToNavidromePlaylist`, `removeTrackFromNavidromePlaylist`, `starTrack/Album`, `unstarTrack/Album`, `getStreamUrl`, `getCoverArtUrl`. |
| `radio.ts` | Radio engine. `buildAncestorWeights(nodeId, byId, maxDepth=4)` → BFS weight map (weight = 1/2^depth). `getRadioCandidates({ seedTrackId, mode, excludeIds, similarArtists })` → dispatcher routing across 8 `RadioMode` values: `curated` (tree + Last.fm boost), `same-genre` (tree only), `similar-artists` (Last.fm match), `same-artist`, `same-album` (ordered), `era` (decade from `year`), `loved` (join `loved_tracks`), `random`. Mood weight 0.4; curated falls back to random 20 if no seed tags. |
| `album-identify.ts` | `autoIdentifyAlbum({ artist, album })` — plain async fn (no React hooks): MB search → fuzzy rank → confidence decision tree (thresholds 0.80 / gap 0.10) → optional RG + release lookup → `combinedGenres`. Used by `useAutoIdentifyAlbum` and bulk sync in `SettingsView`. Exports `AutoDecision` + `AutoIdentifyResult` types. |
| `sidecar.ts` | HTTP client for the Python sidecar. `checkSidecarHealth(url, secret)` → `SidecarHealth`. `writeTags(url, secret, {filePath, tags, dryRun}, pathPrefixFrom, pathPrefixTo)` → `WriteDryRunResult | void`. Path remap applied before send. |
| `sync.ts` | `syncLibrary(server)` → `{ failedAlbums, failedPlaylists, skippedAlbums }`. Incremental skip: compares `navidrome_created` + `songCount` before fetching tracks. Per-album error catch (continues loop). Rebuilds `artists` table after album loop. Calls `scanForIssues(server.id)` at end. |
| `tag-normalize.ts` | Normalization pipeline. `normalizeAlbum(albumId, artist, album, identity?)`: pull file tags (track_tags JOIN tracks) + Last.fm tags (using `identity.lastfmArtistName/lastfmAlbumName` overrides when present) + MB combined genres (injected as additional lastfm-source entries) → merge/dedup → map via `findCanonicalSync` → `bucketize` by section → cap (6/6/4) → persist `normalized_tags_json` + `computed_at` on `albums`. Also writes `album_genres` (direct leaves + full DAG ancestor expansion via `getAncestorIds`) and `album_unresolved_genres` (tags that failed canon resolution). Also exports `readNormalizedTags(albumId)` and `isStale(tags)`. |
| `tagIssues.ts` | `scanForIssues(serverId)`. Deletes non-dismissed issues for server, then INSERTs for: `missing_genre`, `missing_artist`, `suspicious_genre` (http/long), `inconsistent_album_artist`, `duplicate_album`. `INSERT OR IGNORE` preserves dismissed rows across rescans. |

### Hooks (`src/hooks/`)

| File | Purpose |
|---|---|
| `useAlbums.ts` | Albums from SQLite. `sort: AlbumSort` (artist/alphabetical/year/recently_added). `canonicalIds: string[]` — when non-empty, JOINs `album_genres` and filters by canonical_id (covers leaf + ancestors + `raw:` synthetic ids for unmatched tags). QueryKey includes both params. |
| `useArtists.ts` | Artists from `artists` table (rebuilt by `syncLibrary` after every sync). |
| `useGenres.ts` | `useGenres()` — distinct direct (leaf) canon genres with album counts from `album_genres` (excludes `raw:` ids). |
| `useGlobalShortcuts.ts` | Global `keydown` listener (document). Keys: Space (play/pause), ←/→ (seek ±5s), Shift+←/→ (prev/next), ↑/↓ (volume ±5%), L (love). Suppressed when target is HTMLInputElement / textarea / contenteditable. |
| `useLoved.ts` | `loved_tracks` + `loved_albums` from SQLite as `string[]` (converted to Set in hook body). Toggle: optimistic SQLite write → invalidate → fire-and-forget star/unstar API. |
| `useLyrics.ts` | `useLyrics(track)` — React Query (`staleTime: Infinity`). Reads `lyrics` cache from SQLite first; on miss, calls `fetchLyrics` (LRClib), caches result. Returns `{ plain, synced, loading }`. |
| `useMediaSession.ts` | `useMediaSession()` — sets `navigator.mediaSession.metadata` on track change; sets `playbackState`; wires 6 action handlers (play/pause/prev/next/seekbackward/seekforward) to store. Mounted once in App. |
| `useRadio.ts` | `useRadio()` — monitors `radioActive`, `radioMode`, and queue depth; when `queue.length - queueIndex < LOOKAHEAD_THRESHOLD (10)`, fetches candidates from `getRadioCandidates` (passing current mode), excludes recently played (1h window from `scrobble_history`), picks randomly from top-5 of top-50 (except `same-album`: picks first in order). Skips Last.fm fetch for modes that don't use it. Mounted once in App. |
| `useScrobble.ts` | Threshold: 50% elapsed OR 240s. Guards via `scrobbedRef` (resets on `playStartedAt` change). Writes to `scrobble_queue`. |
| `useScrobbleFlush.ts` | `useScrobbleFlush(serverWithCred)` — on mount + 60s interval + `online` event: reads `scrobble_queue`, calls `scrobbleTrack` per row, moves succeeded rows to `scrobble_history`, stops batch on first failure. Mounted once in App. |
| `useSearch.ts` | FTS5 across `tracks_fts`. Debounced 200ms. Tokenizes into `"token"*` prefix expressions. Returns `{ albums, tracks, artists }`. LIMIT 50/group. |
| `useServer.ts` | `useServers()` — all servers from SQLite. `useServerWithCredential()` — joins server row with keychain credential. Exports `ServerWithCredential` type. |
| `useSetting.ts` | `useSetting(key, default)` — loads from `settings` table on mount. Returns `[value, updateFn]`. |
| `useTagIssues.ts` | `useTagIssues()` — React Query over `tag_issues` (non-dismissed). Orphaned (TagIssuesView deleted in Phase 1); removal deferred to Phase 9. |
| `useTagMappings.ts` | `useTagMappings()` — `tag_mappings` CRUD. `saveMapping` also calls `stageGenreEditsForRawValue` to stage `pending_edits` for affected genre tracks. `useVocabulary()`, `useVocabAlbums(rawValue, kind)`, `useAddUserTreeNode()`, `useUnresolvedGenres()` — unmatched Last.fm/MB tags from `album_unresolved_genres` not yet covered by a mapping. |
| `useTagPull.ts` | `useTagPull()` — `pullForAlbum` + `canonizeAlbum`. `applyInboxItem` writes `track_tags` + `tag_mappings`, then calls `stageGenrePendingEdits` for genre kind. `useAcceptInboxItem()`. |
| `useBackgroundNormalizer.ts` | `useBackgroundNormalizer()` — mounted in App. On launch, queries albums with stale `computed_at` (>30 days or NULL), processes them sequentially at 1/2s. Writes `pullProgress` to `useTagsStore` so `PlayerBar` can show a persistent progress indicator. Cancelled when component unmounts or `tags.auto_refresh` is off. |
| `useNormalizeAlbum.ts` | `useNormalizeAlbum(albumId, artist, album)` — React Query over `normalized_tags_json`. If data is missing or stale, reads `album_identity` row and passes identity overrides (lastfm strings + MB combined genres) to `normalizeAlbum()`. Returns `{ data: NormalizedTags | null, isLoading }`. |
| `useAlbumIdentity.ts` | `useAlbumIdentity(albumId)` — reads `album_identity` row or null. `useIdentifyAlbum({albumId, artist, album, overrideMbRgId?, overrideMbReleaseId?, enabled})` — on-demand MB lookup: search or direct MBID → `lookupReleaseGroup` + `lookupRelease` → `combineGenres`; returns `AlbumLookupResult` with status (found/ambiguous/not_found/error) + facts. `useSaveAlbumIdentity()` — mutation writing to `album_identity` (supports `autoMatched`/`matchScore` fields). `useRecordFailedLookup()` — writes a minimal "attempted, not matched" row via INSERT OR IGNORE so the gate won't retry on reopen. |
| `useAutoIdentifyAlbum.ts` | Mount-time auto-lookup. Thin React Query wrapper over `autoIdentifyAlbum` from `../lib/album-identify`. Fires when `mb.auto_identify` setting is on AND no identity row exists yet. Returns `AutoIdentifyResult`; `AlbumDetail` owns persistence. `staleTime: Infinity` + existence gate ensures each album is looked up at most once. Re-exports `AutoDecision` and `AutoIdentifyResult` types. |
| `useArtistIdentity.ts` | `useArtistIdentity(artistName)` — reads `artist_identity` row or null. `useIdentifyArtist({artistName, overrideMbArtistId?, enabled})` — on-demand MB artist lookup. `useSaveArtistIdentity()` mutation. |
| `useTrackEndedListener.ts` | Listens for Tauri `track-ended` event → calls `playerStore.next()`. |
| `useTrackTags.ts` | `useTrackTagsForAlbum(albumId)` — tags for album. `useOffTreeAlbumIds()`. `useTrackTagMutations()`. `useTagStats()`. `useStaleAlbums(days)`. |
| `useTracks.ts` | Tracks for a given `albumId` from SQLite. `enabled` when albumId non-null. |

### Store (`src/store/`)

| File | Purpose |
|---|---|
| `player.ts` | Zustand playback store. Exports `RadioMode` union (8 modes). `CurrentTrack` has optional `album` + `albumId` fields. State: `queue`, `queueIndex`, `shuffleOrder`, `isShuffled`, `repeat`, `volume`, `elapsed`, `currentTrack`, `streamUrlFor`, `isQueueOpen`, `playStartedAt`, `radioActive`, `radioSeed`, `radioMode` (default `'curated'`). Shuffle re-seeds on repeat-all loop wrap. Actions: `play`, `playQueue`, `pause`, `resume`, `next`, `prev`, `seek`, `setVolume`, `toggleShuffle`, `toggleRepeat`, `toggleQueue`, `addToQueue`, `playNext`, `removeFromQueue`, `moveQueueItem`, `loadSettings`, `setStreamUrlFor`, `setRadioActive`, `startRadio(seed, mode?)`, `setRadioMode`. Radio state (`radioActive`, `radioSeed`, `radioMode`) persisted to `settings`. Queue state persisted to `settings['queue_state']` on every mutation. |
| `tags.ts` | Zustand tag-pipeline store. `inboxItems: InboxItem[]` — in-memory per session (lost on close; user can re-pull). Actions: `addInboxItem`, `removeInboxItem`, `updateTagRow`, `clearInbox`. Inbox items carry per-tag `kept` + `overrideCanonicalId` state. |

### Components (`src/components/`)

| File | Purpose |
|---|---|
| `setup/Wizard.tsx` | 4-step onboarding wizard (shown when no servers configured). Step 1: welcome. Step 2: server URL/credentials + inline test. Step 3: optional sidecar (auto-detect via `probeSidecar`, manual, or skip). Step 4: done → calls `onSuccess(server)`. Writes to `servers` table + OS keychain. |
| `AlbumDetail.tsx` | Hero with full-bleed blurred cover bg + 240px thumbnail. Three-column tag band from `useNormalizeAlbum` (genres/descriptors/scenes chips). Tracklist with play, queue, radio, playlist, and Show tags actions. Right-click chip → album-level TagDrawer; right-click track → track-scoped TagDrawer. **Identify button** → `AlbumIdentifyDialog`. When `mb.auto_identify` is on, runs `useAutoIdentifyAlbum` on mount; auto-saves high-confidence matches silently via `useSaveAlbumIdentity`; records failed attempts via `useRecordFailedLookup`. Confirmed identity shows label/country/year facts (no badge — match is expected). Unconfirmed albums show an "Unidentified" badge (HelpCircle) when auto-identify is on, clicking which opens the dialog. |
| `TagDrawer.tsx` | Right-side overlay drawer. Shows normalized tag buckets (source badge + confidence %). If `trackId` provided: also shows raw file tags and Override button (queues `pending_edits` for genre field). Escape / click-outside closes. |
| `AlbumGrid.tsx` | Album card grid. Lazy-loaded cover art. Hover heart. Off-tree badge (AlertTriangle, from `useOffTreeAlbumIds`). Click → onSelect. |
| `ArtistDetail.tsx` | Blurred banner (local artwork_url → fallback Last.fm `artist.getInfo` image, using `artist_identity.lastfm_artist_name` override if confirmed), album card grid, top tracks list. **Identify button** → `ArtistIdentifyDialog`. |
| `IdentifyDialog.tsx` | Two portal-based dialogs sharing the same CSS. `AlbumIdentifyDialog`: editable Last.fm strings + MB Release Group/Release/Artist MBID fields; on-demand `useIdentifyAlbum` lookup; ambiguous → candidate picker; found → facts grid (title/artist/year/label/country/catalog#/genres/MBID). `ArtistIdentifyDialog`: artist MBID + Last.fm name; `useIdentifyArtist` lookup. Both call respective `useSave*Identity` on Confirm. |
| `ArtistGrid.tsx` | Artist cards with album count. |
| `NowPlayingView.tsx` | Full-page now-playing view (not an overlay). Fluid two-panel layout: left (art + controls), right (Up Next / About / Lyrics tabs). Per-track accent color via `extractAccent`. Top tracks ranked by Last.fm global popularity with local fallback. Responsive breakpoints at 900/1100/1500px. |
| `PlayerBar.tsx` | Fixed bottom bar. Shuffle / prev / play-pause / next / repeat / queue toggle. Elapsed timer + clickable progress bar. Volume slider. Album art thumbnail → `toggleNowPlaying()`. Also renders `RadioChip` (when radio active) and a persistent `.normalizing-bar` above the player when `useTagsStore.pullProgress` is non-null. |
| `RadioChip.tsx` | Renders only when `radioActive`. Shows current mode ("Radio: Curated ●"). Click opens a dropdown to switch `RadioMode` live (`setRadioMode`) or stop radio. |
| `StartRadioSubmenu.tsx` | Reusable `ContextMenuSubmenu` listing all 8 `RadioMode` options. Used in `AlbumDetail`, `AlbumGrid`, and `ArtistGrid` context menus. Calls `onSelect(mode)` on pick. |
| `PlaylistDetail.tsx` | Playlist tracklist + play controls + delete + remove-track context menu. Populates `CurrentTrack.album/albumId`. |
| `PlaylistList.tsx` | Playlist list + inline create form. |
| `QueuePanel.tsx` | Fixed right drawer (z-index 50). Current queue in playback order. HTML5 drag-to-reorder (`draggable`, onDragStart/Over/Drop/End; drop-target highlight). Right-click context menu. |
| `SearchResults.tsx` | Three groups: Albums / Tracks / Artists. Up to 50 per group (LIMIT 50 at source); "Show all N" toggle reveals up to 50. |
| `SettingsView.tsx` | Settings: Server panel (show/edit/remove server + sidecar config), Last.fm API key, **MusicBrainz** (auto-identify toggle + **"Sync all MB genres"** button), Tags (staleness/pull mode), Tag automation (auto-refresh toggle, **Refresh now**, **"Sync all Last.fm tags"** identity-aware bulk normalize, last-refreshed timestamp), Diagnostics. All bulk ops share the `pullProgress` state; disabled when any is running. |
| `TagsView.tsx` | Tag vocabulary view (sidebar "Tags" item). **"Needs Review" section at top** — shows unmatched Last.fm/MB genres from `album_unresolved_genres` with album count and source; reuses `CanonCombobox` + Accept/Ignore for mapping. Vocabulary table below: all raw track tags, unmapped by default (toggle to show all). Sidebar badge shows unmapped count. |

### Other (`src/`)

| File | Purpose |
|---|---|
| `App.tsx` | Root component. Views: library/artists/playlists/tags/settings. Sidebar nav (5 items, Tags badge = unmapped count). Sync trigger + query invalidation. useMediaSession + useRadio + useBackgroundNormalizer + useScrobbleFlush + useGlobalShortcuts mounted here. Genre filter dropdown (uses canonical_id from `useGenres`) + canonical tag filter chip in library header. All genre filtering unified in `canonicalIdFilters: string[]`; AlbumDetail chip clicks set it via `onTagFilter(canonicalId: string)`. |
| `keychain.ts` | Thin wrapper: `keychain.set/get/delete` → Tauri `set_credential/get_credential/delete_credential` commands. Key formats: `canon.server.{id}` (Navidrome cred), `canon.sidecar.{id}` (sidecar secret). |
| `types/server.ts` | `Server` interface: `id, type, url, display_name, username, created_at, sidecar_url, sidecar_secret_key, sidecar_path_prefix_from, sidecar_path_prefix_to`. |

---

## Key Invariants

- **Rust holds no business logic.** Adding computation to `lib.rs` requires explicit justification. Rust exists for: audio playback (`rodio`/`symphonia`), OS keychain access, and future file I/O.
- **All tag writes go through `pending_edits` → diff → confirm → sidecar.** No direct mutation path. Do not add one.
- **Album/track IDs in SQLite are `"{serverId}:{nativeId}"`** — strip with `stripServerPrefix(id, serverId)` from `src/lib/ids.ts`. Throws if prefix is missing (runtime guard against silent slicing bugs). Never use `.slice(server.id.length + 1)` directly.
- **Credentials in OS keychain only.** Never in SQLite, localStorage, Zustand, or env vars.
- **React Query never holds `Set`.** Return `string[]` from queryFn; convert to Set in hook body. Reason: RQ `structuralSharing` treats any two Sets as equal after first render.
- **`getDb()` is promise-cached.** Safe to call concurrently; migrations run exactly once.
- **`streamUrlFor` is a callback in Zustand**, not a URL string — so the store never holds credentials.
- **`resolveTrack(queue, shuffleOrder, isShuffled, position)`** — every queue position access must go through this pure function.
- **Confirmed `album_identity` overrides auto-lookup.** When an `album_identity` row with `confirmed_at` exists, `useNormalizeAlbum` passes its `lastfm_artist_name`/`lastfm_album_name` strings and `combined_genres_json` to `normalizeAlbum()`, so Last.fm fetch and genre injection use the corrected identity. `ArtistDetail` uses `artist_identity.lastfm_artist_name` for Last.fm fetches when confirmed.
- **MusicBrainz fetches use `tauri-plugin-http`, not browser fetch.** Required to set the `User-Agent` header mandated by MB's usage policy. Scoped capability limits MB fetches to `musicbrainz.org` and `*.musicbrainz.org` only.

---

## SQLite Schema (v17)

| Table | Purpose |
|---|---|
| `albums` | id, server_id, server_type, name, artist, album_artist, year, artwork_url, navidrome_created, tags_refreshed_at, **normalized_tags_json** (v11), **computed_at** (v11, unix timestamp), created_at |
| `tracks` | id, server_id, server_type, title, artist, album_artist, album_id, genre, track_number, disc_number, year, duration, last_modified, file_path, created_at |
| `track_tags` | id, track_id, kind (genre\|mood), raw_value, canonical_id (NULL = off-tree), source (server\|lastfm\|manual), created_at — UNIQUE(track_id, kind, raw_value, source) |
| `tag_mappings` | raw_value, kind, canonical_id, source, match_type, locked, created_at — PRIMARY KEY (raw_value, kind). `locked=1` prevents auto-map overwrite and save/delete mutations. |
| `tag_issues` | id, track_id, issue_type, details, detected_at, **dismissed_at** (v10, NULL = active) |
| `user_tree_nodes` | id, name, type, canonical_key, parent_ids (JSON array) |
| `artists` | id, server_id, server_type, name, **album_count** (v10), created_at — rebuilt on every sync |
| `lyrics` | track_id (PK), plain, synced, source, fetched_at — cache for LRClib results |
| `servers` | id, type, url, display_name, username, sidecar_url, sidecar_secret_key, sidecar_path_prefix_from, sidecar_path_prefix_to, created_at |
| `settings` | key TEXT PRIMARY KEY, value TEXT — volume, repeat, library_sort, queue_state, **lastfm.api_key, tags.staleness_days, tags.pull_mode_default, tags.auto_refresh, mb.auto_identify** |
| `loved_tracks` | track_id TEXT PRIMARY KEY, loved_at TEXT |
| `loved_albums` | album_id TEXT PRIMARY KEY, loved_at TEXT |
| `tracks_fts` | FTS5: id UNINDEXED, title, artist, album, genre — bulk-rebuilt after each sync |
| `playlists` | id, server_id, name, comment, track_count, created_at |
| `playlist_tracks` | playlist_id, track_id, position PRIMARY KEY (playlist_id, position) |
| `tag_issues` | id, track_id, issue_type, details, detected_at UNIQUE(track_id, issue_type) — for T6 |
| `pending_edits` | id, track_id, field, old_value, new_value, source (manual/lastfm/genre_unifier), error, created_at — **file-write edits only; tag pipeline uses track_tags** |
| `edit_history` | id, track_id, field, old_value, new_value, source, written_at |
| `scrobble_queue` | id, track_id, title, artist, album, timestamp, created_at |
| `scrobble_history` | id, track_id, timestamp UNIQUE(track_id, timestamp) |
| `album_identity` | album_id (PK), mb_release_group_id, mb_release_id, mb_artist_id, lastfm_artist_name, lastfm_album_name, lastfm_match_confirmed, combined_genres_json (JSON MbGenre[]), label, country, catalog_number, barcode, release_date, confirmed_at, **auto_matched** (v16, 1=auto/0=user), **match_score** (v16, 0–100 fuzzy score), **looked_up_at** (v16, unix secs of auto-attempt) — keyed by stable album_id `"{serverId}:{nativeId}"`. `confirmed_at NULL` = looked up but not matched. Row missing = never attempted. |
| `artist_identity` | artist_name (PK), mb_artist_id, lastfm_artist_name, confirmed_at — keyed by name (artist ids are random blobs regenerated on each sync) |
| `album_genres` | album_id + canonical_id (PK), relation (direct\|ancestor), section (genres\|descriptors\|scenes-and-movements\|null), name — rebuilt by `normalizeAlbum`; canonical_id may be `raw:<key>` for unmatched tags; indexed on canonical_id for filter JOINs |
| `album_unresolved_genres` | album_id + raw_value + kind (PK), source (file\|lastfm\|mb) — tags that failed canon resolution; drives "Needs Review" queue in TagsView |

DB path: `~/.config/dev.canon.app/canon.db`

## Sidecar Protocol

Secret stored in keychain: `service = "canon.sidecar.{server.id}"`, `account = "secret"`.  
`sidecar_secret_key` column in `servers` stores the keychain service key, not the secret itself.

```
POST /write            { file_path, tags }  Authorization: Bearer <secret>
POST /write?dry_run=true  → { resolved_path, diff[] }  (no file write)
GET /health            → { status: "ok", version }
```

Path remap applied in `src/lib/sidecar.ts` (client-side) before the request is sent.  
Sidecar enforces `CANON_SIDECAR_MUSIC_ROOT` boundary; symlinks escaping root are rejected.
