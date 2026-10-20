# Canon Architecture

Agent reference. Update in the same commit as any change that adds, moves, deletes or repurposes a file, table, command or invariant. Commands and workflow rules live in `AGENTS.md`.

## 1. Stack and process model

- Tauri 2 app. Webview: React + TypeScript (Vite), React Router, Zustand (playback + session caches), React Query (per-entity queries), `tauri-plugin-sql` (sqlx pool) for most SQLite reads/writes and all migrations.
- Rust owns: audio (`rodio` + `symphonia`, HTTP streaming, gapless, waveform), OS keychain, `cover://` + cover disk cache, UPnP/SSDP + SOAP, tray, net probe.
- Rust also owns rusqlite library reads (`src-tauri/src/library_read/`) and multi-statement write transactions (`src-tauri/src/library_write/`).
- One DB file: `canon.db` in the app config dir (`~/.config/dev.canon.app/canon.db` on Linux). TS migrates it; rusqlite opens the same file after `getDb()` resolved.
- External HTTP from TS: Navidrome (OpenSubsonic), Last.fm, MusicBrainz, LRClib, lyrics.ovh, fanart.tv, TheAudioDB/Wikipedia/Wikidata, iTunes, Bandsintown, remote notice JSON.
- Canon never writes music files. Enrichment and tag decisions are SQLite-only.

## 2. Directory map

| Path | Holds |
|---|---|
| `src/main.tsx` | Entry: logger init, QueryClient, router, fire-and-forget `carryGenreTree` after `getDb()`. |
| `src/App.tsx` | MainApp: owns every app-level hook, state and playback handler; builds `AppViewProps` for `AppShell`. |
| `src/app/` | `AppShell.tsx` (sidebar + persistent overlays), `AppRoutes.tsx` (route table, `AppViewProps`), `DetailRoutes.tsx` (lazy album/artist/playlist routes keyed by URL param), `DatabaseErrorScreen.tsx`. |
| `src/pages/` | Route targets no feature owns: Home, Library, AlbumDetail, ArtistDetail, ArtistGrid, GenreView, YearsView, TrackTableView, plus `album/`, `artist/`, `home/` subparts. |
| `src/features/<name>/` | Feature-owned code, `components/ hooks/ lib/ store/` (flat for small features): `tags`, `radio`, `search`, `sync`, `enrichment`, `playlists`, `playback`, `pins`, `settings`, `setup`. |
| `src/components/` | Shared presentation: `AlbumGrid`, `AlbumGenreEditor`, `FilterSidebar`, `CommandPalette`, `ArtBackdrop`, `FeedbackModal`, banners. |
| `src/ui/` | Primitives: `ContextMenu`, `ErrorBoundary` (root; recovery moves to Home, then offers a reload), `Skeleton`, `CanonIcon`, `useClickOutside`, `useModalChrome`, `useOverlayDismiss`. |
| `src/hooks/` | Stateful shared hooks: library reads (`useAlbums`, `useArtists`, `useTracks`, `useAllTracks`, `useGenres`, `useLoved`), `useServer`, `useSetting`, caches, navigation. |
| `src/store/` | `*SessionStore.ts`: refresh tick + row cache per mirrored domain; `libraryFilters.ts`, `albumTracksNotice.ts`. |
| `src/lib/` | Pure helpers: `ids.ts`, `sql.ts` (`escapeLike`), `queryKeys.ts` (`QK`), `routes.ts`, `shuffle.ts`, `asyncPool.ts`, `rateLimiter.ts`, `boundedCache.ts`, `logger.ts`, `keychain.ts`, `transportHealth.ts`, `credentialRejections.ts`, `updater.ts`, `replayGainRow.ts`, `numberSetting.ts` (`parseNumberOr`, `parseIntegerOr`, `parseStalenessDays`), `trackCells.ts` (`formatDuration`, zero-safe `durationCell`/`bitrateCell`), `plural.ts` (every counted noun in UI text). |
| `src/clients/` | HTTP clients, one per service. Navidrome split: `navidrome.ts`, `navidromeUrls.ts` (auth params, cover/stream URLs), `navidromeTransport.ts` (`apiPost`), `navidromePlaylists.ts`. `dlna.ts` = UPnP SOAP. Every request goes through `boundedFetch.ts`: `boundedFetch` (webview) or `boundedNativeFetch` (`tauri-plugin-http`, for a User-Agent or CORS-blocked hosts); 12 s on headers (`UPLOAD_TIMEOUT_MS` for uploads), 12 s per body chunk, returns a buffered `Response`. `unboundedFetchGuard.test.ts` rejects a bare, `window.` or `globalThis.` `fetch(` and any other `plugin-http` import. |
| `src/db/` | `index.ts` (`getDb()`), `migrations.ts`, `trackIdTables.ts`, `genreIdTables.ts`. |
| `src/types/` | `library.ts` row types, `server.ts` (`Server`). |
| `src/styles/` | `tokens.css`, `base.css`. |
| `src/test/` | Harness: `setup.ts`, `sqlite.ts` (in-memory SQLite), `perf.ts` (waste probes), `renderCatching.tsx` (records errors a boundary caught), `mocks/`. |
| `src/assets/canon-tree.json` | Generated genre DAG (see Genre tree); excluded from Biome so regeneration diffs stay small. |
| `scripts/` | `parse-rym.mjs`, `data/` (RYM txt, `custom-nodes.json`, `tree-renames.json`), `run-local-checks.sh` (Biome/`cargo fmt`/`clippy --fix` rewrite pass, then checks), `git-hooks/`. Root `biome.jsonc` + `.editorconfig`: 120-col format and lint for TS/CSS/JSON. |
| `.github/` | `workflows/release.yml` (build + publish on push to main), `workflows/checks.yml` (`run-local-checks.sh --ci`, npm audit, cargo-deny on every push/PR), `dependabot.yml` (npm/cargo weekly, actions monthly, into `development`). `src-tauri/deny.toml`: license allowlist, advisories, git/registry sources. |
| Root toolchain pins | `package.json` `packageManager` (pnpm), `.node-version`, `rust-toolchain.toml`; CI reads the same files. `prepare` script points `core.hooksPath` at `scripts/git-hooks`. |

Rust (`src-tauri/src/`):

| Module | Holds |
|---|---|
| `lib.rs` | `run()`: plugins, managed state, `cover://` scheme, tray, window events, `generate_handler!` list, `take_crash_report`. Window created hidden, shown in `on_page_load`. |
| `audio/` | `mod.rs` output open (fixed 100ms buffer, device config fallback, fatal stream error sets `output_lost`), `open_decoder` (seekable + byte length, shared by playback and waveform), `AudioState` (player, `play_id` race guard, `PosTracker`, prefetch cache, fade generation, gapless flags, `output_lost`); `playback.rs` play/enqueue/prefetch, reports a lost output as a non-retryable `audio-error`; `control.rs` transport + position; `waveform.rs`. |
| `streaming.rs` | `StreamingBuffer` (RAM) and `FileBackedStreamingBuffer` (spills to `stream-spill/` when length > 64 MiB or unknown); spill dir cleared at startup. |
| `stream_classify.rs` | `classify_stream_response`: sniffs the first 8 KiB so a Subsonic error envelope on HTTP 200 never reaches the decoder. |
| `cover.rs` | `cover://` handler: memory cache (500), disk cache (2000, `cover-cache/`), request semaphore (16), `set_cover_proxy_config`. |
| `keychain.rs` | `set_credential`/`get_credential`/`delete_credential`; `SECRET_STORE_UNAVAILABLE` marker = retriable failure. |
| `upnp.rs` | `discover_upnp_renderers` (SSDP M-SEARCH), `upnp_soap`. |
| `net_probe.rs` | `probe_server`: reqwest reachability check to tell webview proxy (PAC) hangs from real outages. |
| `tray.rs` | Tray menu, `tray_update`, `tray_set_visible`, `tray_set_close_to_tray`; emits `tray-action`. |
| `library_read/` | `LibraryReadStore` (lazy rusqlite conn, READ_WRITE for WAL, no CREATE). `get_albums`, `get_artists`, `get_tracks`, `get_all_tracks`, `get_genres`, `get_recent_genres`, `get_loved`, `get_playlists`, `get_unmapped_tag_count`. |
| `library_write/` | `LibraryWriteStore`. Transactions: `playlist_remove_track`, `delete_user_tree_node`, `carry_genre_renames`, `repair_dangling_genre_id`, `remap_track_ids`. |

## 3. Data flow

- Sync: `useLibrarySync` -> `syncLibrary` (`src/features/sync/sync.ts`): album list + scan status -> album upsert + prune -> per-album track pass -> id remap -> FTS rebuild -> artists -> loved -> playlists.
- Track pass reads only changed albums (song count differs) unless the watermark moved, a resync forced it, or the track-id probe failed. `scanForIssues` + `rebuildTagVocabCache` run only if albums/tracks changed.
- After sync, `useLibrarySync` bumps only the session stores whose domain changed (`changed.*`), staggered 300/600 ms, and busts the genre tree cache. Its only React Query invalidation is the pins (`QK.pinsAll`), when albums, tracks or artists changed.
- `runSync(server, { onSettled })` reports `{ status, albumsChanged, error }` once to the caller that started the run, after its album refresh is requested. Home's Newly Added "Check for new albums" button (`src/pages/home/useNewAlbumsCheck.ts`) uses it for its own spinner and failure note, and scrolls back to the start only when an album not shown at click lands at the front before the run's own read (or the next sync) ends the watch.
- Reads: browse lists go `invoke("get_*")` -> rusqlite -> row cache on a `*SessionStore` keyed by its tick. Detail/feature queries (tags, identity, enrichment, search, playlists mutations) use React Query or direct `getDb()` over `tauri-plugin-sql`.
- Playback: component -> `usePlayerStore` action with a `streamUrlFor` callback -> `PlaybackTarget` (`LocalTarget` = `audio_*` commands, `DlnaTarget` = SOAP).
- Rust events back to `playerEngine.ts`: `track-ended`, `track-advanced`, `gapless-cancelled`, `audio-format`, `audio-error`.
- Credentials: Wizard/ServerTab -> `keychain.set` -> OS keychain; `useServerWithCredential` reads them; never stored elsewhere.
- Tag normalization: file tags + Last.fm + MusicBrainz -> `normalizeAlbum` -> `albums.normalized_tags_json`, `album_genres`, `album_unresolved_genres` (display and filtering only).

## 4. Invariants

- Mirrored ids are `"{serverId}:{nativeId}"`; strip with `stripServerPrefix` (`src/lib/ids.ts`), never by slicing.
- Every read of a mirrored table is scoped by `server_id`; `src/lib/serverScoping.test.ts` sweeps artist-filtered SQL.
- Every LIKE binds through `escapeLike` (`src/lib/sql.ts`) with `ESCAPE '\\'`.
- Every read that becomes a playable track selects `REPLAY_GAIN_COLUMNS` and builds `replayGain` via `replayGainFromRow` (`src/lib/replayGainRow.ts`).
- Every numeric parse with a fallback goes through `parseNumberOr` (`src/lib/numberSetting.ts`), so a stored `0` stays `0` (whole-string `Number`, `parseIntegerOr` truncates; staleness floors at 1 day); `src/lib/numericFallbackGuard.test.ts` bans `Number(x) || fallback`.
- Equal grid columns are `repeat(n, minmax(0, 1fr))`, never bare `1fr`, which grows to fit content (a long one-line name widened its card); `src/lib/equalColumnsGuard.test.ts` sweeps CSS and inline styles.
- Tables keyed by track id are listed once in `TRACK_ID_TABLES` (`src/db/trackIdTables.ts`) with prune/purge/remap policy; Rust mirror `REMAPPED_TRACK_ID_TABLES` is pinned by test.
- Every stored genre-tree id is listed in `GENRE_ID_HOLDERS` (`src/db/genreIdTables.ts`); `genreIdTables.test.ts` sweeps migrations and pins the Rust `GENRE_ID_COLUMNS` copy.
- A multi-statement write whose intermediate state is invalid goes in `library_write/` (the sqlx pool gives no connection affinity, so TS `BEGIN` does not hold). Migration blocks are the one exception.
- rusqlite readers await `getDb()` first so migrations have run; a missing DB file errors instead of being created.
- React Query `queryFn`s never return a `Set` (structural sharing treats all Sets as equal); return arrays, convert in the hook.
- `streamUrlFor` is a callback so the player store never holds credentials. Queue position access goes through `resolveTrack` (`queueOrder.ts`).
- `queue_state` and `radio_seed` settings hold server-prefixed ids and are validated against surviving servers on load.
- Session-store hooks return `isLoading` = "no rows for this key yet", not "fetch in flight"; tick bumps refetch behind the old rows. They also return `error`: a failed read is never rendered as an empty list or an endless loading line.
- Sync prune refuses an empty or partial fetch; a failed stage (loved, playlists) leaves stored data untouched and is reported in `skippedStages`.
- MusicBrainz calls go through `boundedNativeFetch` (User-Agent) at 1 req/1.1 s; capability scoped to musicbrainz.org.
- A DB with a schema version above `LATEST_SCHEMA_VERSION` throws `SchemaTooNewError` (fatal screen, no retry).

## 5. Feature notes

| Area | Key files | Gotchas |
|---|---|---|
| Sync | `sync.ts`, `syncWatermark.ts`, `syncTracks.ts`, `syncPrune.ts`, `trackRemap.ts` | Watermark (`servers.last_scan_at/server_version/song_count`) moves only after a complete pass; `albums.tracks_read_scan` lets an interrupted pass resume. |
| Sync | same | Rewritten track ids are paired by `file_path` (`planTrackIdRemap`) and carried by `remap_track_ids` instead of pruned. Auto-sync interval + retry ladder 30s/2m/5m in `useLibrarySync.ts`. |
| Browse reads | `useAlbums.ts`, `useArtists.ts`, `useAllTracks.ts`, `albumBrowseSessionStore.ts` | `useAlbums` reads via `invoke("get_albums")` + session store, not React Query. Artist store bump is 400 ms debounced (enrichment bursts). |
| Playback | `player.ts`, `playerEngine.ts`, `playbackTarget.ts` | One store built from factories; shared mutable state in `playerRuntime.ts`. Position poll every 200 ms; at 80% elapsed, gapless -> `audio_enqueue_next`, else `audio_prefetch`. |
| Playback (Rust) | `playback.rs`, `streaming.rs` | Gapless transition is recorded by the audio thread (zero-length callback source sets `gapless_started`), not inferred by the watcher. `play_id` guards stale threads. |
| Playback | `useTrackIdRepair.ts` | Subsonic code 70 on the current stream triggers a track-id repair instead of a skip. |
| Player bar | `PlayerBar.tsx`, `PlayerMoreControls.tsx` | Sides and center share flex `1 / 2 / 1`, so the transport and waveform stay on the window midline at every width. At or below 900px timer, cast, now playing and volume move into the more menu, whose button carries an accent dot while a timer or cast is active; the menu closes on any resize. Both volume controls are `VolumeControl.tsx`. The waveform (`WaveformBars.tsx`) measures its width and merges the 200 stored peaks down to one bar per fixed pitch (`fitWaveformPeaks`), so bar size holds at every width. Window floor 720 x 560 (`tauri.conf.json`). |
| Now Playing | `NowPlayingView.tsx` | Breakpoints are container queries on the view (window less sidebar and player bar), not viewport media queries, which WebKitGTK re-evaluated only on the next style change. At or below 850px wide and over 910px tall the hero sits over the tab panel. Shorter, the two never stack, and at 670px tall or less the art sits beside the controls: collapsed shows the hero over three tab buttons, a button expands that tab under a small cover strip that keeps play/pause and any playback error; the cover, X, Escape (unless typing, a modal is open or a context menu takes it) or any window resize collapses, since only CSS knows whether a resize left the narrow layout. |
| Bottom notices | `BottomNotices.tsx` | One fixed stack of 24px rows above the player bar (or the window bottom with no track): at most one info row (album tracks failure, metadata progress, metadata pending, in that order) plus the playback error row nearest the player. It writes the row count to `--bottom-notice-rows`; `base.css` multiplies it by `--notice-bar-height` into the shell's bottom reserve. |
| Cast / DLNA | `dlna.ts`, `upnp.rs`, `playbackTarget.ts` | `scanRenderers`/`setCastDevice` in `player.ts`; `cast.device` + `cast.max_bitrate` settings restore a `DlnaTarget` on load. SSDP lives in Rust because JS has no UDP multicast. |
| Scrobbling | `useScrobble.ts`, `useScrobbleFlush.ts` | Queue at `scrobble.threshold_percent` (50) or `scrobble.min_seconds` (240); now-playing sent separately. |
| Scrobbling | same | Flush every 60 s + on `online`, scoped to current server; code 70 drops the row, other errors stop the batch; success writes `scrobble_history` and bumps local play counts. |
| Queue sync | `useQueueSync.ts` | `savePlayQueue` debounced 10 s + on visibilitychange; restore only when nothing is playing. |
| Lyrics | `useLyrics.ts` | Order: SQLite `lyrics` cache -> OpenSubsonic `getLyricsBySongId` (if advertised) -> LRClib -> lyrics.ovh. A miss is cached only when every source answered; a failed one leaves `source = 'cleared'`. |
| Tag normalization | `tagNormalize.ts`, `useNormalizeAlbum.ts`, `useBackgroundNormalizer.ts` | Runs on: album open when stale (`computed_at` NULL or > 30 days), background pass (asks above 300), identify, genre editor, TagDrawer, Settings refresh-all, track enrichment. |
| Tag normalization | `tagNormalize.ts` | Match order in `resolveGenreTags`: `album_user_genres` first, then manual mapping (`__ignored__` drops, `__accepted__` falls through), then `findCanonicalSync`; `album_genre_exclusions` always win. |
| Tag normalization | same | Confidence file 1.0 > Last.fm 0.8 > MB 0.7 > folksonomy 0.6. Per-track genres promote at >= 50% of tracks. `CAPS` genres 6, descriptors 6, scenes 4. Year-like genres skipped (`tags.skip_year_genres`). |
| Tag normalization | same | Artist-tag fallback only when no file, Last.fm album or MB tags exist. A mapping decision applies to every album carrying that raw value. |
| Tags view | `TagsView.tsx` | Tabs: Review (unresolved tags with `album_count > 0`, plus `DanglingGenresPanel`), Decided, Tree, Title Cleanup. |
| Tags decided | `useTagMappings.ts`, `TagDecidedTab.tsx` | Sentinels `__accepted__`/`__ignored__` are redefined in `useTagMappings.ts`, `TagsViewHelpers.tsx`, `useGenreDisplay.ts` and `genre_carry.rs`; never written to `track_tags.canonical_id`. |
| Tags decided | same | `locked=1` blocks save and delete. Save/lock match exact `raw_value`; delete (undo) matches `norm_value`, clearing every variant. `mapping_source` is selected but never read. |
| Tag issues | `tagIssues.ts` | `scanForIssues` writes `tag_issues` when a sync changed data; nothing reads the table and no UI dismisses rows. |
| Genre tree | `canonicalize.ts`, `useUserTree.ts`, `genreTreeCarry.ts` | Canon tree + `user_tree_nodes` are resolved together at read time, never merged on disk. User-node delete goes through `delete_user_tree_node`. |
| Genre tree | `scripts/parse-rym.mjs`, `tree-renames.json` | Renames are data: parser stamps `renames` + hash `version`; at startup `carryGenreTree` runs `carry_genre_renames` once per new version. Dangling ids surface in Review. |
| Enrichment / MB | `albumIdentify.ts`, `fuzzyMatch.ts`, `useAutoIdentifyAlbum.ts` | `AUTO_CONFIRM_THRESHOLD` 0.90 and `MIN_SCORE_GAP` 0.10; `mb.auto_identify` default true. Zero hits or a weak top score retries with trailing brackets stripped. Auto and the Identify dialog share `pickClearWinner` (a tie goes to the higher release type, album over its same-titled single), differing only in thresholds. Album open waits for tracks and the artist's known MBID before looking up; a failed automatic lookup is retried after `AUTO_IDENTIFY_RETRY_SECONDS` (7 days), a user-confirmed row never. |
| Enrichment / MB | `artistAutoSelect.ts`, `useEnrichArtist.ts`, `IdentifyDialog.tsx` | Artist auto-select: top MusicBrainz score >= `mb.artist_auto_select_score` (default 95) and no rival within 5; background enrichment saves it, Identify only pre-selects. Otherwise local album overlap decides. In-library artists (artist page, owned similar cards) with no MBID re-run the search once per session even when enrichment is fresh (`identifyIfUnidentified`); a failed search frees the attempt. |
| Enrichment / MB | `useAlbumIdentity.ts` | `useConfirmedArtistMbid` infers artist MBIDs only from `artist_identity` or manual album matches (`auto_matched = 0`). Enrichment staleness = `tags.staleness_days` (30). |
| Search | `SearchView.tsx`, `useSearch.ts`, `searchScore.ts` | `/search?q=` route (`searchPath`); typing replaces history, `searchFor` pushes from outside search and replaces inside it. FTS5 prefix tokens, `"` stripped. bm25 CTE must stay `MATERIALIZED` (pool 2000), then JS re-ranking in `searchScore.ts` (text in `()`/`[]` scores a tenth, below any plain match; an album's or track's artist counts 0.6), 200 rows per section. `pickTopResult` reuses the same scorers across kinds, ties to artist then album. |
| Radio | `radio.ts`, `genreSeed.ts`, `useRadio.ts`, `useStartRadio.ts` | Curated weights come from `scaleWeights(similarityScale)` (tag 0.60..0.20, track CF 0.25..0.45, artist CF 0.15..0.35); same-genre passes empty CF maps. Pick window scales per mode. Genre-radio seeds come from `loadGenreSeedTracks`, scoped to the active server. Every UI radio start goes through `useStartRadio` (replace/add setting). |
| Radio | same | Refill below 10 queued tracks. Same Era = seed decade window (no year -> random). Same Album falls back to curated when exhausted. Artist/album repeats decay, not capped. Last.fm signals cached in `radio_signal_cache`. |
| Playlists | `PlaylistList.tsx` | Card names wrap to at most two lines, so virtualized rows are measured (`measureElement`) and keyed by column count, never reset with `measure()`; the estimate is first paint only. |
| Playlists | `usePlaylists.ts`, `usePlaylistTracks.ts`, `playlists.rs` | Removal is by position index on server and locally (`playlist_remove_track` closes the gap in a transaction); concurrent edits from other clients can remove the wrong track. |
| Playlists | same | `INSERT OR IGNORE` only guards the `(playlist_id, position)` key, so the same track can be added twice; `track_count` is incremented regardless. |
| Smart playlists | `smartPlaylist.ts` | Genre exclude = `NOT IN` over direct `album_genres`, so untagged albums pass. Text filters use `LIKE ... ESCAPE`; limit clamped 1..500. |
| Command palette | `CommandPalette.tsx`, `usePaletteActions.tsx`, `commandMatch.ts` | Ctrl+K. A query lists matching commands above the music: "Go to" entries plus actions (play/pause, next, radio from the current track, 30 minute sleep timer, shuffle library, resync library), ranked label start, then word start, then anywhere (`rankCommands`), 4 a section. Below them a "Top result" row (`pickTopResult`, lifted out of its own section), then Artists, Albums, Tracks at 4 each, then "See all results" (`searchFor`, opens /search at the query). Rows are two-line (name, tertiary detail) with artist portraits (`resolveArtistImageUrl`) or cover art, typed words bolded by `matchRanges`; skeleton rows while the first search runs, and "No results" only when the rows are gone, not when the kept previous rows don't rescore. The empty palette lists "Recent" (`useRecents`, the last 5 albums, artists or tracks opened or played from Ctrl+K, recorded through `onOpened`, kind named in the detail) between the pins and Go to, as linear rows. The input is a `combobox` pointing via `aria-activedescendant` at `role="option"` rows (pins and Go to tiles too) inside one `listbox`. Actions appear only when they would do something (no track, no next, radio already on, no server) and call the shared entry points: radio through `useStartRadio`, resync through `resyncLibrary` (Settings uses it too), shuffle library = random radio seeded from one random track. Commands show even when the library search fails. Enter (or click) opens, Shift+Enter (or Shift+click) plays, everywhere incl. pins: album = `usePlayAlbum`, artist = curated radio via `handleStartRadioFromArtist`, track = `handlePlayTrack`; track Enter opens its album at `?track=` (`albumPath(id, trackId)`, `openAlbumAtTrack` replaces when that album is already open), which `AlbumTrackList` marks and scrolls to once. Nav/actions ignore Shift. Until the debounce catches up with the field, keys go to the field and Enter opens /search for the typed text, since the rows still answer the previous text. Footer hints come from `HINTS` per focused kind. `usePaletteActions` runs in a wrapper inside `AppShell` so the player state it reads re-renders the palette, not the views. |
| Pins | `features/pins/` | Pin/unpin via `PinMenuItem` ("Pin"/"Unpin") in album and artist context menus (songs can't be pinned; v55 dropped `pinned_tracks`). `SidebarPins` shows the 3 newest album/artist pins under the nav, albums above artists with a rule between (thumb only when collapsed, thumb plus name when expanded; right-click unpins); the rest live in Ctrl+K, whose empty query shows a `PinShelf` above "Go to": a scrolling row (Home's `CarouselTrack`, arrows cancel mousedown so the field keeps focus) of round artist tiles over one of square album tiles, each newest first (`pinsNewestFirst`); past 24 in a row its 24th onward folds behind a count tile that unfolds that row in place; left/right move along a row, up/down step between rows (keeping the column) and into the 3-column Go to grid, which arrows the same way (`arrowTarget` over a per-item row key; `NAV_GRID_COLUMNS` feeds the CSS `--cp-nav-columns`); search result lists stay linear and leave left/right to the field. A shelf tile unpins from its right-click menu or with Delete (footer hint "del unpin"), focus moving to its row neighbour; while that menu is open the palette ignores keys, and a right mousedown never opens a tile. Context menus sit on `--z-menu`, above `--z-modal`, so they show over the palette. Both read names and art through `usePinArt`. The sidebar reserves one pin row at the 560px floor by letting nav buttons shrink to 28px only while a pin shows (`:has(> .sidebar-pins)`), and the pin list scrolls on its own. `AppShell` reads pins once for the palette; the query never goes stale (writes and sync invalidate it). |
| Loved | `useLoved.ts`, `syncLoved.ts` | Local write first, star/unstar fire-and-forget; sync replaces local state from `getStarred2`. Album shows loved if starred or any track loved. |
| Overlays / modals | `useModalChrome.ts`, `useSearchShortcuts.ts`, `useDismissOnNavigate.ts`, `useAppNavigation.ts` | Modals register in an ordered module registry; only the topmost acts on Escape, and `useAnyModalOpen` feeds `overlayAbove` so /search stands down. Focus restores to the opener only if still connected. The command palette is non-URL state: `useAppNavigation` dismisses it on nav intent, `useDismissOnNavigate` on route-driven navigation (pathname only). |
| Covers | `cover.rs`, `navidromeUrls.ts`, `useCoverCache.ts` | `getCoverArtUrl` returns `cover://` once proxy config is set; `album_covers`/`artist_covers` are data-URL art caches filled by a background pass (batches of 5). `useAlbumCoverMap` loads only the keyset eagerly; each data_url is fetched on first `.get()` (sync, LRU 2000). |
| Settings / logs | `useSetting.ts`, `logger.ts`, `settingsBackup.ts` | `useSetting` returns `loaded`; gate expensive work on it. Logger ring buffer (500) flushes to `app_logs` every 3 s when dirty. |
| Transport | `navidromeTransport.ts`, `transportHealth.ts`, `credentialRejections.ts`, `net_probe.rs` | `apiPost`: `boundedFetch` timeout, 3 attempts, alt URL per attempt, single shot for non-idempotent writes, per-server breaker (ping exempt). Every envelope goes through `checkEnvelope`, which throws `SubsonicError` carrying `code` and records 40/44 per server (cleared by the next ok envelope or a saved credential); the Settings server card reads it via `useCredentialRejected`. Login pings skip the record; their copy for 40/44 lives in `features/setup/loginFailureMessage.ts`. |

## 6. Genre tree

- `src/assets/canon-tree.json`: 3349 nodes (2869 genres, 467 moods, 13 categories): 3343 from RYM plus 6 from `scripts/data/custom-nodes.json`; 95 nodes sit in two sections. `/update-rym-tree` updates these counts.
- Sections: genres, descriptors, scenes-and-movements. Top-level `version` + `renames`. Generated by `scripts/parse-rym.mjs` from `scripts/data/rym-hierarchy.txt`; never hand-edited.
- DAG: a node may have several parents. `getAncestorIds` expands all parents for `album_genres` ancestor rows. User nodes live in `user_tree_nodes` and are resolved beside the canon tree, never merged into it.

## 7. SQLite schema (v56)

Version = highest entry in `src/db/migrations.ts` (`LATEST_SCHEMA_VERSION`). Ids of mirrored rows carry the server prefix.

| Table | Purpose: key columns |
|---|---|
| `servers` | Navidrome servers: id, url, alt_url, display_name, username, watermark (last_scan_at, server_version, song_count). |
| `settings` | Key/value app settings (`key` PK). |
| `albums` | Mirror: id, server_id, name, artist, year, artwork_url, play_count, played_at, release_type, accent_color, normalized_tags_json, computed_at, tracks_read_scan. |
| `tracks` | Mirror: id, server_id, album_id, title, artist, file_path, play_count, played_at, replay_gain_*, bit_rate, suffix, tags_enriched_at. |
| `artists` | Mirror, rebuilt per sync: id, server_id, name, album_count. |
| `tracks_fts` | FTS5 over id, title, artist, album, genre; rebuilt per dirty album. |
| `loved_tracks` / `loved_albums` | Starred ids + loved_at. |
| `pinned_albums` / `pinned_artists` | Pins (sidebar, Ctrl+K): album_id PK, or PK (server_id, artist_name) since artist ids are regenerated per rebuild; server_id, pinned_at (ms). An artist counts as in the library if it is an album or a track artist (`artistInLibrarySql`, `src/lib/libraryArtists.ts`), as search lists both. Pruned with the item (albums in `pruneAlbums`, artists after the artists rebuild), purged with the server; first a pin on an album relisted under a new id (same server, name and artist) moves to it, and one on an album artist whose name only changed case follows the new spelling. |
| `recent_albums` / `recent_artists` / `recent_tracks` | Ctrl+K recents (v56): same keys as pins plus `recent_tracks` (track_id PK, on the track-id registry so it is pruned, purged and carried by `remap_track_ids`); server_id, opened_at (ms). `recordRecent` upserts then trims each table to `RECENTS_LIMIT` (5) per server; `readRecents` merges the three newest first. Pruned and purged like pins. |
| `playlists` | id, server_id, name, comment, track_count, cover_art_url, custom_cover_data, is_smart, rules_json. |
| `playlist_tracks` | playlist_id, track_id, position; PK (playlist_id, position). |
| `playlist_resume` | playlist_id PK, last_track_id, track_position. |
| `scrobble_queue` | Pending scrobbles: track_id, title, artist, album, timestamp. |
| `scrobble_history` | Sent scrobbles: track_id, timestamp; UNIQUE pair. |
| `lyrics` | Cache: track_id PK, plain, synced, source, offset_ms. |
| `waveform_cache` | track_id PK, peaks_json. |
| `track_tags` | Raw tags per track: kind (genre/mood), raw_value, canonical_id (NULL = off-tree), source; UNIQUE(track_id, kind, raw_value, source). |
| `tag_mappings` | Raw value -> tree id or sentinel: PK (raw_value, kind), norm_value, source, match_type, locked. |
| `tag_vocab_cache` | Distinct tag vocabulary: PK (norm_value, kind), raw_value, album_count, sources; rebuilt after sync. |
| `tag_issues` | track_id, issue_type, details, dismissed_at; UNIQUE(track_id, issue_type). Written, never read. |
| `album_genres` | Resolved genres: PK (album_id, canonical_id), relation direct/ancestor, name; `raw:<key>` ids for unmatched; `section` column inert. |
| `album_unresolved_genres` | Tags that failed resolution: PK (album_id, raw_value, kind), source. |
| `album_user_genres` | User-added album genres: PK (album_id, canonical_id), name. |
| `album_genre_exclusions` | Per-album hidden genres: PK (album_id, canonical_id). |
| `user_tree_nodes` | User tree nodes: id, name, type, canonical_key, parent_ids (JSON). |
| `user_tree_changelog` | Audit of user node create/update/delete with before/after JSON. |
| `album_identity` | MB/Last.fm identity per album: MB ids, lastfm names, combined_genres_json, combined_tags_json, auto_matched, confirmed_at, album_bio. |
| `artist_identity` | Per artist name: mb_artist_id (auto-resolved ids kept, `confirmed_at` NULL), bio, similar_json (Last.fm getSimilar with `match` >= `SIMILAR_ARTIST_MIN_MATCH` 0.3, no count cap; getInfo's five if getSimilar is empty), top_tags_json, image URLs, enriched_at (left NULL while a portrait source failed and none was found). |
| `artist_aliases` | alias_name PK -> canonical_name (artist merge). |
| `album_covers` / `artist_covers` | Data-URL art caches keyed by album_id / artist_name. |
| `radio_signal_cache` | Last.fm similarity cache: cache_key PK, value, fetched_at. |
| `app_logs` | Persisted log ring: ts, level, message. |
| `schema_migrations` | Applied version high-water mark. |
| `pending_edits` / `edit_history` | Inert leftovers of a removed tag-write path; nothing writes or reads them (`inert` in `TRACK_ID_TABLES`). |

`servers.sidecar_*` columns are likewise inert. `genre_mappings` was dropped.

## 8. Migrations

- Add a new numbered entry at the end of `migrations` in `src/db/migrations.ts`; never edit a shipped one. Each block runs inside `BEGIN`/`COMMIT`; duplicate-column errors are swallowed.
- New `canonical_id`/track-id columns must join `GENRE_ID_HOLDERS` / `TRACK_ID_TABLES` (tests fail otherwise), plus the Rust copies.
- Update section 7 and the version in `AGENTS.md` Status in the same commit.
