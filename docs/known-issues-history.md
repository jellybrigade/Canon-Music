# Known Issues: History

Backstory for `docs/known-issues/<area>.md` entries: the incident, the numbers, what the first
fix missed. The area files keep lesson, fix and grep; this file is read on demand and is not
auto-loaded. Entries appear here verbatim as they stood when trimmed (2026-09-23).

## Platform (Linux / WebKitGTK / audio) - `known-issues/platform.md`

- **Two HTTP stacks means two proxy configurations, and only the webview honours PAC.** Canon reaches the API through the webview (libsoup, so the desktop's `GProxyResolver`) and covers through Rust reqwest (env proxy only, no PAC). A desktop left on `/system/proxy/mode` = `auto` with no working PAC/WPAD made every `fetch` hang on a 25s D-Bus call to `org.gtk.GLib.PACRunner`, so Canon's 12s abort fired first, three attempts per call, and the library was unusable - while cover art loaded fine, `curl` answered in 100ms and Chrome (own WPAD, own fallback) was untroubled. It reads as "Canon is broken" and logs as a bare `timed out after 12000ms`. Fix: `net_probe.rs::probe_server` reaches the server over the stack that is *not* stalling, so the message names the machine's HTTP configuration instead of the server; `transportHealth.ts` stops the ladder after two lost to timeouts. User-side cure is `dconf write /system/proxy/mode "'none'"`. Ask of any transport failure: which of Canon's two HTTP clients saw it, and would the other agree?
  ```
  dconf read /system/proxy/mode   # 'auto' with no reachable PAC stalls every webview fetch
  grep -rn "timed out after\|Load failed" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A diagnosis collected and used only for the message text is not a decision.** After two
  timed-out ladders the breaker called `probe_server`, got `reachable: true, status: 200` in
  94ms, wrote that into the notice, and opened anyway: every sync request for the next 15s was
  refused against a server that had just answered, and the notice told the user to check a
  desktop proxy setting that was fine. The probe was the one piece of evidence that the stall
  was one lost connection rather than a stalled transport, and nothing branched on it. Fix: the
  first 2xx probe in a streak excuses the stall and closes the breaker again, with a message
  that says the server is up; a further timeout with nothing through since opens it as before,
  since a webview that keeps timing out while Rust keeps getting through is exactly the PAC
  stall above, and vetoing every time would bring back 37s per request. Ask of any check whose
  result only reaches a string: would the code do anything different if it said the opposite?
  ```
  grep -rn "probe_server\|ServerProbe" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **WebKit's `err.stack` carries no message line, so logging the stack alone loses the error.** `logger.ts` stored `v.stack ?? v.message`, which on V8 opens with `Error: <message>` and on WebKitGTK - every shipped Canon build - is frames only. All 500 rows of `app_logs` read `Cn@tauri://localhost/assets/index-DO98X4Wg.js:430:23778` and nothing else, so a real user report of failing syncs could not be diagnosed from the logs at all, only from the surrounding message the call site happened to pass. Fix: `formatLogValue` puts `name: message` in front unless the stack already starts with it. Any place a browser API's output is stored rather than shown owes the question: is this the same string on the engine we actually ship?
  ```
  grep -rn "\.stack" src --include='*.ts*' | grep -v '\.test\.'
  ```

## Async / lifecycle - `known-issues/async.md`

- **Module-scoped promise memo assigned only on the success side stays poisoned.** `manualMappings.ts` cleared `inFlight` inside the resolved branch, so one rejected read handed the same rejection to every later caller and manual genre mappings silently stopped applying for the life of the process - reading as a mapping bug, not a db one. Fix: `try`/`catch` around the whole body, clearing under the same generation check the success path uses, then rethrow. `src/db/index.ts`'s `dbPromise` is the deliberate exception: a failed migration must not silently retry, and it surfaces on `DatabaseErrorScreen`.
  ```
  grep -rn "^let .*: Promise<\|^let .*Promise<.*> | null" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A result from the previous key is still visible to the commit that switches the key.** `useTracks` reset its rows with `setData(undefined)` inside the effect, so the render carrying the new album id, and every effect in that commit, still saw the old album's rows with `isLoading: false`. The album page's missing-tracks repair read an empty list from the previous album as the new album's and fetched tracks already mirrored. Its own fetch outcome had the same shape: one `fetching`/`error` pair shared by every album, so album A's late failure painted on album B. Fix: store the key beside the result and derive `current = result.key === key ? result : null` during render (`useTracks`, `usePlaylistTracks`, `useMissingTracksRepair`). A reset written in an effect is always one commit late.
  ```
  grep -rn "prev\w*IdRef.current !== " src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A one-shot report of live state is wrong from the moment the state moves.** `useScrobble`
  told Navidrome which track was playing (`scrobble.view?submission=false`) off `playStartedAt`
  alone, which the store stamps only for a new track or a gapless advance. Pause and resume never
  move it, so a pause outlasting Navidrome's now-playing expiry left the server - and the Discord
  rich-presence plugin that reads it - saying nothing was playing for the rest of the track, with
  no way back until the next track started. The same trigger fired in the other direction: queue
  restore writes `currentTrack` with the player stopped, so Canon announced a track nobody had
  started every launch. Fix: gate on `isPlaying` and name it in the deps, so every start, resume
  and track change re-asserts and a pause simply lets the entry expire on its own. Ask of any
  state pushed into another process: what re-asserts it after the far side forgets, and can it be
  pushed while locally false?
  ```
  grep -rn "playStartedAt" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **An endpoint's idempotency can live in a parameter, not in its name.** `NON_IDEMPOTENT_ENDPOINTS`
  keyed the retry ladder on the bare endpoint name, but `scrobble` carries two opposite writes:
  `submission=true` appends a play and must never be repeated, `submission=false` only sets which
  track is on and is as safe to repeat as a `star`. The safe one inherited the unsafe one's single
  shot, so one lost request - a breaker cooldown, one resolver stall - meant no now-playing for
  that whole track, silently, since the caller discards the rejection. Fix: `isRetriableEndpoint`
  takes the params and reads the submission. `updatePlaylist` is the same shape and is deliberately
  left one-shot: a rename is a set-to-this-value write, but it shares the endpoint with the
  membership edits and its failure reaches the user instead of being swallowed. Ask of any endpoint
  on a policy list: does every caller of it do the same kind of write?
  ```
  grep -n "NON_IDEMPOTENT_ENDPOINTS" -A 6 src/clients/navidromeTransport.ts
  grep -hnE "callSubsonicVoid\(|apiPost\(" src/clients/navidrome.ts src/clients/navidromePlaylists.ts src/clients/navidromeTransport.ts | grep -oE '"[a-zA-Z]+(\.view)?"' | sort | uniq -c | sort -rn | head
  ```

## Test / harness - `known-issues/testing.md`

- **A timeout ceiling set against an idle machine is measured against a busy one.** vitest's 5s
  default failed `migrations.test.ts > reaches the same schema from every intermediate version` at
  5164ms inside `scripts/run-local-checks.sh`, which runs the whole suite beside `cargo test` and
  clippy; alone the same test takes 0.8-2.4s and passes. Not a race and not a slow test to delete:
  it replays every migration block from every rung, so its cost is quadratic in the block count and
  grows with each migration added. The protection already existed but only covered the family its
  author had in front of them - `allowSlowAppMounts()` raises `testTimeout` to 30s for the 8 `App`
  suites, leaving every other suite on the default, and the two heaviest non-App tests (3.9s and
  2.1s idle) were one scheduling accident from the ceiling. Fix: `testTimeout: 15000` in
  `vitest.config.ts`, one writer, rather than an annotation per slow test that the next slow test
  has to remember to add. Testing Library's `findBy*` window stays short, since that is the one
  that must fail fast. Reproduce a load-dependent failure before believing a fix: saturate every
  core (`for i in $(seq 1 $(nproc)); do timeout 400 sh -c 'while :; do :; done' & done`) and run
  the whole suite, not the one file.
  ```
  grep -n "testTimeout" vitest.config.ts src/test/appMount.ts
  pnpm test:run --reporter=verbose 2>&1 | grep -oE "[0-9]{4,}ms$" | sort -rn | head
  ```
- **A real sleep inside a real debounce window is a race, not a wait.** Two search tests armed
  the 200ms `?q` debounce, slept `DEBOUNCE_MS / 2` to sit "mid-window", then unmounted or
  navigated and asserted no `?q` was written. Under `scripts/run-local-checks.sh`, which runs
  the suite beside `cargo test` and clippy, the half-window sleep overran the whole window, the
  write landed *before* the unmount, and `expected '/search?q=abba' to be '/search'` failed on a
  correct component - a flake that reads as a product bug. Sleeping *past* a window is safe
  (overrunning changes nothing); sleeping *inside* one is not, and no margin fixes it, because
  the ceiling is set by whatever else the machine is doing. Fix: fake timers for the in-window
  case, so real time cannot advance the debounce at all. In an `App`-mount suite, fake timers
  also stall `waitFor`'s polling (30s timeout, a background normalizer waiting on real time), so
  the navigation assertion there is a direct `expect` inside `act` rather than a `waitFor` - and
  `vi.useRealTimers()` belongs in `afterEach`, since switching back mid-test drops the pending
  fake timer the assertion depends on.
  ```
  grep -rn "setTimeout(r\|setTimeout(resolve" src --include='*.test.ts*' | grep -iE "/ ?2|debounce|window"
  ```

## Data / state - `known-issues/data.md`

- **A bare column under `GROUP BY`, and a `LIMIT` cut on a non-unique key, both pick arbitrarily.** `query_artists` took `artwork_url` bare from its per-artist group, so a tile's portrait changed after unrelated writes; `query_recent_genres`' fallback ordered by `album_count` alone, so the 18th/19th genre swapped between refreshes. Fix: `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY navidrome_created DESC, year DESC, id)` and a `name COLLATE NOCASE` tiebreaker. Ask of any aggregate: which row is this, and would two runs agree? **Found again in the branch beside it:** the first fix landed only on the fallback, which runs for a user with no scrobble history, while the branch that actually runs ordered by `MAX(last_played)` alone - and one played album contributes several genres, all tied on it, so ties were the normal case rather than an edge. Fix a tiebreak on every branch of the query, not the one the test reached, and prefer `MIN(name)` over a bare `name` even where the name looks functionally dependent on the group key (a genre rename re-normalizes albums incrementally, so two names share one `canonical_id` until the last album is reprocessed).
  ```
  grep -rn "GROUP BY" src-tauri/src --include='*.rs' | grep -v "COUNT(\|MIN(\|MAX(\|SUM("
  grep -rn "LIMIT" src-tauri/src src --include='*.rs' --include='*.ts*' | grep -v '\.test\.' | grep -v "ORDER BY"
  ```
- **Cap check that runs before the write evicts for a write that adds nothing.** `cappedSet` compared `size >= maxEntries` without asking whether the key was already held, so the cover and artist caches dropped a live entry on every plain overwrite and ran permanently at one entry under their own workload. Fix: `!cache.has(key) &&` in front of the check. Insertion order, not LRU, is the documented semantics. **Found 3x:** `artColor.ts` and `artBlur.ts` hand-rolled the same pre-write check, reachable because neither dedups in-flight work, so two components mounting on one cover URL both miss and both write. Now enforced repo-wide by `src/lib/cappedCacheGuard.test.ts`. The comparison tells the two spellings apart: a cap checked *before* the write is `>= MAX` and needs the `has` guard, one checked *after* a delete-then-set write is `> MAX` and is already safe.
  ```
  grep -rn "\.size >= \|\.size > " src --include='*.ts*' | grep -v '\.test\.'
  ```
- **`!` on an optional id ships the string "undefined" to the server, and caches it.** `HomeView`'s For-You tile was the one unguarded `!` of 30 `getCoverArtUrl` call sites: `encodeURIComponent(undefined)` requested a cover named `"undefined"`, cached forever under `"undefined:300"`, once per artless album. Enforced repo-wide by `src/lib/coverArtGuard.test.ts`, which sweeps the call sites rather than trusting the next one written. **A sweep owes its own reach a test:** the first version matched `!` only at the end of the argument (missing it inside a ternary or before `??`) and split arguments on bracket depth alone, so one comma inside a string, template or comment shifted every later argument and the cover id stopped being `args[3]` - blind in exactly the call nobody looked at.
  ```
  grep -rn "getCoverArtUrl(" src --include='*.tsx' | grep '!'
  ```
- **A counter fed by every request of one burst counts one event many times.** The transport breaker treated each of N requests stalling together as separate evidence: the first opened it, and every other in-flight ladder then re-opened it, walking the 15s/60s/300s cooldown to its top in one burst and spending one `probe_server` per request. Shared module state has to ask whether the thing it is counting already happened; here the breaker being open *is* that answer, so a re-open inside its own cooldown is ignored. Ask of any counter behind a slow operation: how many callers are inside it right now?
  ```
  grep -rnE "^(let|const) \w+ = (0|new Map|new Set)" src/lib src/clients src/hooks src/ui src/features --include='*.ts*' | grep -v '\.test\.'
  ```
- **A refusal from a circuit breaker is not evidence about the record it was raised on.**
  Two real stalls opened the transport breaker, and the album pass counted the next five
  requests it refused in zero milliseconds as album failures, hit its consecutive-failure
  limit and quit. Every partial sync said "failed to fetch tracks for 5 albums" whatever the
  library held: the 5 was `CONSECUTIVE_FAILURE_LIMIT`, not anything the server did. The
  playlist stage did the same to `failedPlaylists`. Fix: `apiPost` throws
  `TransportStalledError` for a refusal, the album pass stops on the first one without
  counting it, and the playlist stage still skips its write but counts no playlist. Ask of
  any per-record failure counter behind a shared gate: did this record fail, or was it never
  tried?
  ```
  grep -rn "Failures++\|failed\w*++" src/lib src/clients src/hooks src/ui src/features --include='*.ts*' | grep -v '\.test\.'
  grep -rn "transportStallNotice\|TransportStalledError" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A skip fast-path is only as good as a probe of the thing it skips.** `syncLibrary`'s `skipTracks` was keyed on `navidrome_created` + `songCount`, both album columns. Navidrome 0.64 rewrote ~87% of track ids and left every album row byte-identical, so the track pass was skipped for all 1512 albums and the mirror could never heal, on any number of syncs. Fix: three mirrored track ids drawn at random go through `songExists` before the album loop, and one Subsonic 70 disables the skip for the whole run. Only a 70 counts - a transport failure or a rejected credential says nothing about the id, and reading it as a miss turns every offline moment into a full pass. Ask of any skip gate: what evidence do I have about the rows I am *not* reading?
  ```
  grep -rn "skip\|unchanged" src/features/sync/sync.ts src/features/sync/syncWatermark.ts | grep -v '^\s*//'
  ```
- **A server-assigned id is a cache, not an identity.** Navidrome 0.64 re-encoded ~87% of its track ids without touching a file, so to Canon's prune every one of those tracks looked deleted and re-added: loved state, lyrics, waveforms, queued scrobbles and resume positions all died with the row, and no number of syncs brought them back. Fix: `planTrackIdRemap` (`src/features/sync/trackRemap.ts`) pairs a mirrored row whose id the server stopped using with the fetched track holding the same `file_path`, and `remap_track_ids` (`library_write/track_remap.rs`) carries every track-keyed row onto the new id in one transaction, before the upsert writes the new row and before the prune runs. Exact match on the path, since it is the server's own bytes; any ambiguity (no path, a path claimed twice on either side, a destination id the mirror already holds) means no evidence and the row goes to the prune. Store the natural key beside the assigned one, or the next id migration is a data loss.
  ```
  grep -rn "file_path" src/features/sync/syncTracks.ts src/features/sync/trackRemap.ts
  ```
- **Watermark upstream identity, not only per-row timestamps.** Per-row mtimes cannot see a migration that rewrote the rows' keys, because the rows they sit on did not move. `servers.server_version` / `last_scan_at` / `song_count` (v49) come from `getScanStatus` at the top of every sync and any of the three moving forces a full track pass. Two halves that are easy to get wrong: `getScanStatus` is admin-only on some deployments, so a failure is "no evidence" and falls through to the probe rather than counting as "unchanged"; and the new watermark is stored only after a pass that completed, since storing it after an early break tells the next sync those albums were read and erases the evidence that they were not.
  ```
  grep -rn "getScanStatus\|last_scan_at\|server_version" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Progress recorded only when a pass completes means a pass that keeps failing never completes.**
  The watermark is stored only after a clean track pass, which is right on its own: storing it
  after an early break would claim albums were read that were not. But a flaky transport broke
  every pass part way, the watermark never moved, and every auto-sync started another full
  ~1500-request pass that met the same flake - two correct rules making a livelock where
  nothing accumulated. Fix: `albums.tracks_read_scan` (v51) stamps each album with the server
  identity it was read under, written after the loop on the early break too, and a pass forced
  by a moved identity skips albums already stamped with the current one. Not for an explicit
  resync (a request to read everything) and not for a failed id probe under an unchanged
  identity (evidence against the very albums carrying the stamp). Ask of any all-or-nothing
  marker in front of long work: what does a run that gets 90% of the way leave the next run?
  ```
  grep -rn "Incomplete &&\|!.*Incomplete\b" src/lib src/clients src/hooks src/ui src/features --include='*.ts*' | grep -v '\.test\.'
  grep -rn "tracks_read_scan" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A 2xx body is not the type you asked for.** Subsonic rides its errors on HTTP 200 with `content-type: application/json`, so `audio_play`'s status check passed and `{"error":{"code":70}}` went into `Decoder::new`, which reported "This file could not be decoded" - blaming the file for a track id Navidrome 0.64 had rewritten. Every mirrored track in the library was unplayable and the message named the wrong cause. Fix: `stream_classify.rs::classify_stream_response` reads the head of the body first and names the real error; the prefetch cache and the gapless path run it too, or a poisoned cache entry walks straight past the live path's guard. Conservative by design: only a parsed envelope, an empty body or plainly-textual bytes are refused, since the decoder knows more containers than the classifier does. Any consumer of a binary body (stream, cover art, waveform source) owes the same check.
  **Found again in the guard written for it:** the cover proxy substitutes `image/jpeg` when the
  response carries no `Content-Type`, purely to have something to store beside the bytes, and then
  handed that substitute to `is_image_response` - which trusts any `image/` prefix before it looks
  at a byte. A header-less error body therefore walked into the memory *and* disk caches under
  `{id}:{size}`, the permanent breakage the guard exists to stop. A stand-in value must never be
  the evidence a check runs on: the guard now takes `Option<&str>` (absent means magic bytes or
  nothing) and refuses an `image/` claim over a body carrying `subsonic-response`.
  **Found 3x:** `classify_stream_response` returned on an audio content-type before looking at
  the body, so an empty 200 or an error envelope labelled `audio/mpeg` reached the decoder and
  the prefetch cache. A header is a claim; check the body before trusting it, on every path.
  ```
  grep -rn "Decoder::new\|::load_from_memory\|image::load" src-tauri/src | grep -v '#\[cfg(test)\]'
  grep -rn "unwrap_or(\"image/\|unwrap_or(\"audio/\|unwrap_or(\"application/" src-tauri/src
  ```
- **A stand-in for a missing measurement must not be the value that binds the limit.** ReplayGain
  peak is optional in the tags, and `computeReplayGainLinear` substituted `1.0` for an absent one
  before clamping `linear` to `1.0 / peak` - so "no peak" meant a full-scale peak, the cap bound at
  unity gain, and every positive pre-amp or fallback gain was silently thrown away. Measured on the
  real mirror: 16,521 of 17,678 tracks carry no ReplayGain at all, so this was the normal path, not
  an edge - the pre-amp slider did nothing for 93% of the library while reading as applied. Fix: an
  absent or non-positive peak means there is nothing to clip against, so no cap is applied at all
  (`nokkvi/data/src/audio/normalization.rs:88` is the same shape). The same pass made the gain
  fallback symmetric: album mode already fell through to track gain, track mode dropped straight
  past an available album gain to the constant. Ask of any default filling in for absent evidence:
  is it neutral, or is it the extreme that decides the outcome?
  ```
  grep -rnE "Math\.(min|max)\([^)]*\?\?" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A rename escapes the prune, so every mirror keyed by the old id is orphaned forever.**
  `remap_track_ids` rewrites `tracks.id` instead of deleting the row, which is the whole point -
  but `tracks_fts` was left out of the carry on the grounds that the sync rebuilds it, and the
  rebuild deletes `WHERE id IN (SELECT id FROM tracks WHERE album_id IN (...))`, i.e. by the *new*
  ids. Nothing could reach the old id again: not the rebuild, not `pruneAlbums`, not
  `purgeServerData`, all of which subselect `tracks`. On a Navidrome 0.64 migration that is ~15k
  dead rows in a 17.6k-track library, and they are not merely stale - `useSearch` ranks and caps
  its pool at 2000 rows *before* joining `tracks`, so orphans take slots from real matches and a
  broad query returns a fraction of them. Fix: one writer, `rebuildTracksFts(db, albumIds,
  staleTrackIds)`, deleting by explicit old id as well as by album, called by the sync, the
  play-time repair and `syncAlbumTracks` alike. Ask of any id rewrite: which tables did I decide
  not to carry, and what deletes their old row now that the prune cannot see it?
  ```
  grep -rn "SET id = \|SET track_id = " src src-tauri/src | grep -v '\.test\.'
  ```
- **A flag meaning "the user asked for this" must not be spelled as state a fallback can flatten.**
  Settings' **Resync library** cleared the sync watermark and started a sync, inferring intent from
  the cleared columns - but `watermarkMoved` returns false outright when `getScanStatus` is
  unreadable, which it is on any deployment restricting it to admins. The only remaining gate was
  the 3-id probe, which passes whenever the sampled ids happen to resolve: exactly the state a user
  reaches for the button in. The button reported success and ran the same skipped sync. Fix:
  `syncLibrary(..., { forceTrackPass: true })`, an explicit parameter; the watermark clear stays,
  but only so an interrupted resync is repeated by the next sync. A request is a parameter, not a
  reading of the world.
  ```
  grep -rn "clearSyncWatermark\|forceTrackPass" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Per-statement conflict handling decides per statement, not per record.** The id remap ran
  `UPDATE OR IGNORE` over nine tables and let each decide the collision for itself, but `OR IGNORE`
  only declines where a uniqueness constraint exists: `scrobble_queue` (plain `track_id`) and
  `playlist_resume` (keyed by `playlist_id`) have none, so when the destination id already held a
  row, the user's queued scrobbles and resume position moved onto a track that kept its own id
  while `tracks` correctly refused. The test that named the case asserted on `tracks` alone and
  passed throughout. Fix: one `SELECT EXISTS` on the destination per track, before any table is
  touched. A record-level decision belongs above the statements, not inside each of them.
  ```
  grep -rn "OR IGNORE\|ON CONFLICT DO NOTHING" src-tauri/src src --include='*.rs' --include='*.ts' | grep -v '\.test\.'
  ```
- **Global state holding server-scoped ids outlives the server that issued them.** Removing a
  server purges every `server_id`-owned table, but `queue_state` and `radio_seed` are single
  global `settings` rows whose values are full track objects carrying `{serverId}:{nativeId}`
  ids. Deleting the server and re-adding it through the wizard mints a fresh UUID, so
  `loadSettings` restored a queue and a current track belonging to a server that no longer
  existed, and the first consumer to reach for a stream URL threw `id "<old>:..." missing
  expected server prefix "<new>:"` in the user's face on a freshly set-up install - with
  nothing playable and no way back. The purge could not fix it: the row is not scoped to one
  server, so on a two-server library blanket-deleting it would throw away the other server's
  queue. The reader is the only place that can decide, so `loadSettings` reads
  `SELECT id FROM servers` once (only when one of those two rows is non-empty) and drops the
  whole snapshot unless every id in it, `currentTrack` included - a partial restore leaves
  `queueIndex` and `shuffleOrder` pointing at the holes. A stranded seed also clears
  `radioActive`/`radioLabel`, decided after the loop because those are separate rows arriving
  in any order. Audited beside them: `display.album_suffix_excluded_ids` holds album ids too,
  but only ever `.includes()`-compares them, so a stranded id is inert. Ask of any global
  state: whose ids are in it, and what happens when that owner is deleted?
  ```
  grep -rn "INTO settings (key, value) VALUES ('" src --include='*.ts*' | grep -v '\.test\.' | grep -iE "queue|radio|ids|track|album"
  grep -rn "useSetting(\"" src --include='*.ts*' | grep -v '\.test\.' | grep -iE "ids|track|album|queue"
  grep -n "SELECT id FROM servers" src/features/playback/store/playerSettings.ts
  ```
- **Rows whose owner row is gone are unreachable, not stale, and nothing sweeps them.**
  After a server was removed and re-added through the wizard, the live library still held
  6672 `tracks` rows, all 257 `loved_tracks` and a queued scrobble under the old server id,
  while that server's `albums`, `artists` and `playlists` were gone - the exact inverse of
  `purgeServerData`'s statement order, so the purge did not run to completion. It cannot
  self-heal: every read is scoped by `server_id`, every prune subselects the server's own
  albums, and a server with no `servers` row never triggers a sync, so the rows are
  permanently invisible *and* permanently undeletable. Orphans are not merely wasted bytes -
  `useSearch` caps its pool before joining `tracks`, so they take slots from real matches.
  Fix: `purgeStrandedServers` (`src/features/sync/syncPrune.ts`), run once from `main.tsx` after the DB
  opens, diffs the `server_id`s in the mirrored tables against `servers` and purges each one
  left over. A delete path that has to finish is a delete path that needs a sweep behind it.
  ```
  grep -rn "purgeStrandedServers" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **An empty read and a broken button look the same to the user.** Every whole-album play
  path (`usePlayAlbum`, `useAddAlbumToQueue`, and two open-coded copies in `App.tsx`) read
  the album's tracks and did `if (tracks.length === 0) return;`. A sync that stopped at its
  consecutive-failure break leaves most albums with no track rows at all - 1248 of 1517 on
  the reported install - so clicking play did nothing, with no message, no error and no way
  to tell it from a dead control. The album page did say something, but what it said was to
  run a library sync, which is the thing that had already failed. Fix: one
  `loadAlbumTracks` (`src/lib/albumTracks.ts`) fetches the album on a miss, so opening or
  playing an album repairs it. **Found again in the fix:** the fetch could now reject, and
  every caller discarded the promise with `void`, so offline the click still did nothing.
  Play paths go through `loadAlbumTracksForPlay`, which reports both a failed fetch and a
  server-empty album on the bar above the player. Ask of any silent `return` on an empty
  list, and of any `void` on a promise that can reject: what did the user just click, and
  how do they find out nothing happened?
  ```
  grep -rn "length === 0) return" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A fixed edit distance is a bigger share of a short key, and file order is not a tiebreak.**
  Both `findCanonical` and `findCanonicalSync` (two hand-copied blocks) accepted a Levenshtein
  distance of 2 for any key of 5+ characters, so a tag reached a genre by losing a whole
  meaningful prefix: `J-Rock` resolved to `Rock` as a confident `fuzzy` match, and every tag on
  that shelf normalized into the wrong branch of the tree with nothing in TagsView Review to say
  so. The second half was the tiebreak: the winner among equally-distant nodes was whichever
  `nodesByKind` listed first, which is the order `canon-tree.json` happens to hold, so a
  re-scrape that reorders the file silently moves tags between genres. Fix: one shared
  `findFuzzy`, allowance `floor(min(key.length, candidate.length) / 5)` capped at 2, ties broken
  by node id. Known limit kept deliberately: same-length near-neighbours (`art rock`/`alt rock`)
  are one edit apart and still match, because length alone cannot tell them from
  `postrock`/`post rock`. Ask of any fuzzy threshold: what share of the shorter string may it
  destroy, and who decides a tie?
  ```
  grep -rn "levenshtein(\|similarity(" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A lookup miss skipped with `continue` deletes the user's own data without a word.**
  Deleting a custom genre cleared `tag_mappings` and `track_tags` but left `album_user_genres`
  naming the dead id, and `normalizeAlbum` skipped any user genre whose node it could not find:
  the genre vanished from every album it was on, with no `album_genres` row, no unresolved row,
  nothing in TagsView Review or Cleanup to find it by. A manual mapping pointing at a dead id did
  the same through an `if (node && ...)` with no `else`. Fix: the delete clears every table
  holding the node's `canonical_id` (the album genres, exclusions and derived `album_genres` too,
  since nothing re-normalizes after a delete), and `resolveGenreTags` sends a missing node to
  unmapped. Only the missing node reports: a duplicate or an excluded id stays silent, because
  that drop is the user's own decision. Ask of any `continue` after a lookup: was the value
  meant to be skipped, or did the thing it points at disappear?
  ```
  grep -rn "byId.get(" src --include='*.ts*' -A1 | grep -v '\.test\.' | grep "continue\|if (node &&"
  python3 -c "import re;s=open('src/db/migrations.ts').read();print(sorted({m.group(1) for m in re.finditer(r'CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([^;]*?)\);',s,re.S) if 'canonical_id' in m.group(2)}))"; grep -n "canonical_id = ?" src-tauri/src/library_write/user_tree.rs
  ```

## UI - `known-issues/ui.md`

- **Non-URL render state must be dismissed by navigation intent, not pathname change.** Overlays-as-state stayed painted when target route == current pathname. Fix: `useAppNavigation` runs `dismissOverlays` top of every nav call via ref. **Now the command palette alone.** Search was the other name on this list and left the class outright (2026-09-09): it is the `/search` route, so Back leaves it by doing nothing special and `goBack` does one thing instead of two. The lesson for the next candidate is that leaving beats a third dismissal mechanism. One exemption: `SearchView`'s `?q` write is a `replace` that never changes the pathname, so it can strand nothing - and it takes `leaveSearch` from props rather than calling `useNavigate` itself.
  ```
  grep -rn "useNavigate()\|useSearchParams()" src --include='*.ts*' | grep -v '\.test\.' | grep -v useAppNavigation
  ```
- **A grid cell that can render `null` hands its column to the next sibling.** The tag review row lays its cells straight into a subgrid through a `display: contents` wrapper, and `AlbumArtStrip` returns `null` with no drawable cover (no mirrored tracks for the album, or its query still loading). Every later cell shifted one track left: the count landed in the 200px art column and the actions in the 36px count column, hiding the "Map to genre" input. `TagSourceDots` did the same for a tag with no recorded source. Fix: the row owns a wrapper per column, so a child's `null` empties its cell instead of deleting it. Pinned by `TagReviewTab.test.tsx`. Ask of any fixed-column grid row: which of its direct children can render nothing?
  ```
  grep -rn "display: contents\|subgrid" src --include='*.css'
  ```
