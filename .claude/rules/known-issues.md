# Known Issues & Platform Gotchas

Bug classes that already shipped once. Headings are the lesson. Full forensics in git history.

## Platform (Linux / WebKitGTK / audio)

**Left-click popup self-closes.** Outside-click listener catches the tail of the opening click (WebKitGTK only; right-click fine). Fixed in `ContextMenu.tsx`: listener deferred `setTimeout(...,0)`, uses `mousedown` capture + containment, not `click`. New left-click popover "does nothing" → same class, check render fires but `querySelector` finds nothing.

**Freeze/thaw compositor crash.** Focus loss/regain can kill the WebProcess (`gdk_window_thaw_toplevel_updates`); `wry` doesn't survive it. Upstream bug. Mitigations, all active, don't strip without replacing: `web-process-terminated` → `.reload()` in `lib.rs .setup()`; `useAppActivityTracking` stamps `data-app-blurred`, CSS pauses animations; `webkit2gtk-nvidia-quirk` crate (skip via `CANON_WEBKIT_GPU_ACCEL=1`); `"visible": false` + `window.show()` on `on_page_load` with 5s fallback thread. **Never** call `set_hardware_acceleration_policy` without auditing what else touches compositing - `OnDemand` + `WEBKIT_DISABLE_COMPOSITING_MODE` collided into deterministic startup crashes.

**ALSA underrun under load.** rodio 0.19 + cpal small default buffer misses callback deadlines on CPU spikes. Mitigated by `PULSE_LATENCY_MSEC=60` set early in `run()` (Linux, if unset). Real fix needs rodio 0.20+ `OutputStreamBuilder`; deferred.

**Read-only rusqlite can't own WAL `-shm`** (fixed). `library_read.rs` now opens `READ_WRITE | NO_MUTEX | URI` (still issues no writes); `CREATE` deliberately omitted so a bad path errors loudly.

**Unbounded thread-per-request → SIGKILL** (fixed). Cover proxy spawned an OS thread per request; rapid nav burst-spawned dozens. Fixed: permit acquired *before* spawn, `spawn_blocking` on tokio pool, cap 16. Debug tell: `ps -eLf | grep canon | wc -l` climbing.

**Opaque "Load failed" after ~25s** was host systemd-resolved (VPN nameservers pinned globally), not Canon. All requests fail simultaneously because they share one DNS lookup; `curl` hits resolved's cache and looks fine. Check `journalctl -u systemd-resolved | grep -i "degraded\|timed out"`, `resolvectl status`, `resolvectl flush-caches && time getent ahosts <host>` before reading network code. Hardening done anyway: 12s `AbortController` timeout (not `AbortSignal.timeout`, missing on old WebKitGTK), 3 retries w/ backoff, alt URL every attempt, named errors; loved/playlist stages non-fatal via `skippedStages`; album-track pass gives up after 5 consecutive failures.

## Async / lifecycle classes

**A command naming a temp file after a caller-supplied id is single-writer only if TS makes it so** (fixed). Two `audio_extract_waveform` calls for one track truncated each other's `canon_wf_<id>.tmp`. Fix: `waveformInFlight: Set<trackId>` in `player.ts`. Also: a command that `Err`s without emitting its completion event strands one-shot `listen()`s - prefer one long-lived listener keyed by payload id.

**A handler resuming post-await must check intent, not assert state** (fixed). `playTrack` set `isPlaying: true` after `.load()`, discarding pauses that arrived mid-await (space/media keys bypass `disabled={isLoading}`). Fix: `pauseRequestedDuringLoad` flag. Track-id equality ≠ intent. Same file: `resume()` lacked a `currentTrack` guard, letting MPRIS tick against silence.

**One cancel token shared by several commands cancels intent, not effect** (fixed). `fade_gen` bumps by pause/resume/seek/volume skipped `audio_pause`'s terminal `sink.pause()`. Fix: separate `pause_pending: AtomicBool` checked before the terminal action regardless of generation. Ask what each spawned task does *after* its loop. Same pass: `audio_seek` no longer re-arms `play_start` while paused; ticker's natural-end fallback requires `isPlaying`; `seekGen` drops stale position polls.

**A fast path around the central action skips every guard that action owns** (fixed). Gapless advance mutated queue state on `track-advanced` without calling `next()`, so the sleep-timer check was dead on the default path. Fix: guard at both ends. When an optimization adds a second route, enumerate what the original did *besides* the obvious thing.

**A fire-and-forget command owes an event on every terminal path** (fixed). `gaplessActive` set at invoke, cleared only on success; Rust's silent bail-outs stalled playback dead. Fix: every bail-out emits `gapless-cancelled`. A `play_id` guard proves nothing newer started, never that the old thing is still wanted - final `sink.append` also checks `sink.empty()` now (slow download arriving after `track-ended` played a blip of the wrong track).

**Work scheduled ahead of time must carry what it decided** (fixed). Gapless resolves `queueIndex+1` at 80%; `track-advanced` recomputed it, so any queue edit in that window played a different track. Fix: `gaplessEnqueued: {track, position}`, followed through edits. Deeper: repeat-all re-shuffle anchored on the enqueued track, itself position-0 of the *old* order → every wrap reopened the same track (mirror bug: `next()` always anchored `buildShuffleOrder(len, 0)`). Fix: order built at enqueue time, travels as `gaplessEnqueued.wrapOrder`; `next()` passes `-1` = no anchor. An anchor constant right at one call site isn't right at another.

**A loading flag from `await invoke()` measures the IPC round trip, not the work** (fixed). `audio_play` returns at thread hand-off, so `isLoading` cleared before any audio buffered. Fix: separate `isBuffering`, cleared by the `audio-format` event with first non-zero ticker position as backstop; kept distinct so pause stays clickable. If a command ends in `thread::spawn`/`spawn_blocking`, only an event is honest. Same pass: `preloadWaveforms` now gates on audible playback, not on request.

**"Stream ended" and "stream stopped" are different signals** (fixed). Download thread called `writer.finish()` on every exit incl. read failures, so a dying server looked like a finished song. Fix: `fail()` (reader returns `UnexpectedEof`) vs `finish()`; `fail()` only if `play_id` still matches (skip isn't failure). Same pass: `reqwest` HTTP status now checked (404 bodies were decoded as "unrecognised format"); `Sink::try_new` error now emits instead of `eprintln!` (was stranding `isBuffering`).

**A resource acquired via await escapes the cleanup meant to free it** (fixed). `useWakeLock` stored its sentinel only on resolve; cleanup during the await freed nothing. Fix: `cancelled` flag set by cleanup, resolved sentinel self-releases. Also `if (lockRef.current) return` was wrong - browser auto-releases on tab-hide, so test `!lockRef.current.released`. A handle another party can invalidate makes non-null the wrong liveness test.

## Data / state classes

**A parallel-array invariant enforced by one writer holds only until another runs** (fixed). `shuffleOrder.length === queue.length` broke on shuffled 1-track queue + append; the `?? position` fallback turned a crash into a silent skip+duplicate. Fix: `playQueue` writes `[0]`; `normalizeShuffleOrder` repairs before splice sites. Grep for a length guard (`if (n > 1)`) one writer has and others don't.

**A "safe copy" helper must copy on every path, including the no-op one** (fixed). `normalizeShuffleOrder` returned the caller's live array on the equal-length fast path; callers spliced into store state, and reference-equality meant no re-render. Fix: `return [...order]` always. Grep for guard-clause returns of an unmodified parameter whose callers mutate the result.

**A restore path writing `currentTrack` without loading the engine is unplayable** (fixed). No `streamUrl`, no sink, position stuck at 0 forever. Fix: `resume()` treats null `streamUrl` like `error` → `retryCurrent()`. Server-side restore had the mirror bug (`playQueue()` then `pause()` downloaded a track nobody asked for) → state-only `restoreQueue` action. `currentTrack != null` is the store's proxy for "engine loaded"; any path breaking that must load the engine or tell the transport controls it didn't.

**A sync that only upserts diverges from its source, and the divergence feeds itself** (fixed). `syncLibrary` had no `DELETE`: orphan rows forever, and `existingTrackCount === songCount` could never match again, forcing a full re-fetch + FTS rebuild every 5 min permanently. Fix: prune albums/tracks absent from the fetch (+ derived rows), excluding user-authored tables (`album_identity`, `album_user_genres`, scrobbles). Guards: prune refuses an empty fetch (misconfigured server ≠ delete everything) or a partial one (`fetchAllAlbums` throws rather than returning short); chunked `NOT IN` refused outright (`executeIdChunks` is `IN`-only). Same pass:
- Playlist refresh was DELETE-then-INSERT, dropping Canon-owned columns (`is_smart`, `rules_json`, `custom_cover_data`). Fix: upsert naming only server-owned columns.
- Loved-stage compare was asymmetric (read scoped by id, write not) → permanent full rewrite every 5 min. Fix: both sides scope by id prefix.
- `playlist_tracks.position` doubles as remote Subsonic index; a local hole desyncs the second removal. Fix: compact positions post-delete via two negative-space passes (PK collision otherwise).

Grep `DELETE` against mirrored tables, and ask what depends on a row's *absence*.

**A skip fast-path freezes every column only the skipped path writes** (fixed). `tracks.play_count` lived in the usually-skipped track-fetch branch and froze at first-sync value, while `albums.play_count` kept moving and hid it. Fix: `useScrobbleFlush` increments both after each flush (after the queue DELETE, so a crash undercounts rather than double-counts). When a sync gains a skip, list every column that path solely writes.

**A drain loop that breaks on any error blocks on its first permanent failure** (fixed). `useScrobbleFlush` broke on Subsonic error 70 (track deleted server-side, fails forever), blocking every row behind it. Fix: `SubsonicError` carries the code; 70 drops the row and continues; auth codes 40/41/50 still break deliberately (recoverable via password, dropping would delete the offline backlog). Same file: no in-flight guard let a slow pass overlap the 60s tick and double-scrobble → `flushing` flag. Ask (1) can one item fail permanently and can the error channel tell, (2) can one pass outlast its interval.

**A repair effect whose repair invalidates its own trigger can loop forever** (fixed). `AlbumDetail`'s bitrate backfill ended in `bumpRefresh()`, refetching its own `tracks` dep - unrepairable condition = infinite network re-sync, silently. Fix: `useRef` marking the album id attempted, stamped *before* the repair. Grep for an effect calling `bumpRefresh()`/`invalidateQueries` while depending on what that refetches. Same pass: **selection stored as row indices repoints on reorder/refresh** (`TrackTableView` held `Set<number>`) - store by stable id.

**Converting the collection to ids while leaving the cursor into it an index fixes half the bug** (fixed). `TrackTableView`'s selection became `Set<string>` in that pass, but its shift-range anchor stayed `useRef<number>` holding a row index. A 5-minute library refresh reorders `sorted`, so the next shift-click extended the range from whatever track had landed on the anchored row - selecting tracks the user never anchored on, silently and only after a sync. Fix: `lastClickedIdRef` holds the track id, resolved via `sorted.findIndex` at use time; a missing anchor (first interaction, or the anchored track pruned) selects just the clicked row instead of falling through to the playback branch, which is how a bare shift-click used to start a song. Same pass: `bulkTarget` gated the bulk context menu on `selectedIds.size >= 2`, but ids of pruned tracks never leave the set, so a two-row selection that lost a row opened a bulk menu reading "Play 1 tracks" - the gate now counts the selected rows *present in `sorted`*. **Generalizes:** when a collection is re-keyed to stable ids, every cursor, anchor, count and gate derived from it must be re-keyed in the same pass; a surviving index or a raw `.size` reintroduces the whole bug against a set that now looks correct. Grep tell - an id-keyed collection sitting next to a numeric ref, or a `.size` compared against a threshold without filtering to what is on screen:
```
grep -rn "useRef<number" src --include='*.tsx' | grep -v '\.test\.'
grep -rn "Ids\.size\s*[<>=]" src --include='*.ts*' | grep -v '\.test\.'
```

**A prefetch that duplicates a query instead of sharing it warms a key nobody reads** (fixed). `useNowPlayingPrefetch` keyed on raw `currentTrack.artist` while the tab keyed on the feat.-stripped one, so "X feat. Y" always missed (2x Last.fm calls), and separately hit a broken `` ESCAPE '\' `` - each bug hid the other. Fix: shared `now-playing-queries.ts`, real `ESCAPE '\\'`. A prefetch counts only if key, `queryFn` and `staleTime` are byte-identical to the consumer's (consumer's `staleTime` ≥ prefetch's - it's an observer property). **Repo-wide: `ESCAPE '\'` in any template literal or single-quoted TS string is `ESCAPE ''` and always throws.**

**A `LIMIT` without `ORDER BY` silently redefines what the query returns** (fixed). Three FTS queries capped at 200 with no order, so FTS5 rowid order kept the 200 *oldest-synced* rows and the JS ranking afterwards ranked an arbitrary sample. Fix: shared `MATERIALIZED` CTE ranking by weighted `bm25` before the cap (`MATERIALIZED` load-bearing - a flattened CTE rejects `bm25`; bm25 also can't sit inside an aggregate, rank in the CTE and aggregate its column). Ask "was the cut thing chosen or just late," not "is the output sorted" - a later JS sort disguises it. Same pass: `useDeferredValue` defers rendering, not fetching; gating a `queryKey` with it still fires per keystroke.

**An identifier borrowed from an external service compared exactly against a local one** (fixed). `useSimilarInLibrary` exact-matched Last.fm artist names, misfiling owned artists, and the same string then addressed a lookup in `ArtistDetailRoute` that synthesized a plausible-looking empty page. Fix: both sides `LOWER(TRIM(...))`, ownership query unions `artist_aliases`, route selects the library's own `a.name`. Check every hop, not just the first comparison. Same route: `data ?? fallback` on `useQuery` renders the fallback while loading too - check `isPending` first.

**A mirror not scoped by owner depends entirely on its delete path** (fixed). `albums`/`tracks`/`artists`/`playlists` carry `server_id` but no read filtered on it; removing a server left its library in the grid, playable, 404ing. Fix: `purgeServerData` before the `servers` row delete. **Sharper form, found 4x:** the danger isn't the unscoped read, it's *reconstructing* the owner after - call sites built `AlbumRow`/`SearchAlbum` with `server_id: server.id` (currently selected) instead of the row's own column. Internally consistent, wrong host, passes typecheck. **Grep for any object literal assigning `server_id:` from something that isn't the source row.**

**Secret written before its owning row outlives the row** (fixed). Keychain credential written under a fresh id before the `servers` insert - failed insert orphaned it, and each retry stranded another. Removal had the mirror bug (row deleted first, keychain delete in a swallowed `catch`). Fix: insert rolls back the keychain write on failure; removal deletes the secret first and aborts loudly if that fails. Create the reference last but roll back; delete the reference last so a failed secret-delete stays retryable. Same pass: `keychain.get` *rejects* on a missing entry (doesn't resolve `""`), so the call site's `if (!credJson) throw` was dead code - grep for `invoke()` wrappers whose callers null-check the resolved value. That query also inherited global `retry: 3`; a permanently-missing secret wants `retry: false`.

**A "the thing just finished" test built only from state that restore also produces fires at startup** (fixed). `useRadio`'s auto-advance ran when `!isPlaying && !isLoading && queueIndex === queue.length - 1`, meaning "radio ran out of queue, start the pick I just appended". A queue restored at launch with `radio_active=1` satisfies all three without a note ever having played, so opening the app started a random radio track. Fix: `hasPlayedRef`, set by a `usePlayerStore.subscribe` on `isPlaying` (subscribe, not select - the effect must not re-render on every play/pause), ANDed into both `wasAtEnd` sites. An idle-and-at-the-end state is indistinguishable from a never-started one; the event needs its own witness. Grep for playback/side-effect starts that live in an effect rather than a handler:
```
grep -rn "playFromQueueIndex(\|playTrack(\|playQueue(\|\.resume()" src/hooks src/App.tsx | grep -v "\.test\."
```
Every hit must be reachable only from a user action or from a witness that the prior event actually occurred this session, never from restored state alone.

## UI classes

**State deciding which subtree renders, but absent from the URL, must be dismissed by navigation itself** (fixed). `AppShell.renderContent` returns the search overlay *instead of* `<AppRoutes>` while `searchOpen || searchQuery` (both `useState` in `App.tsx`), so navigating with search open mounts the route behind a painted overlay and reads as inert. Patched once in `5fa9b06` at `SearchResults`' two handlers; the command palette's four handlers 90 lines below stayed broken. Real fix: `useClearSearchOnNavigate(pathname, clearSearch)` in `App.tsx`. The per-call-site `clearSearch()` in `SearchResults` is kept deliberately - re-selecting the current route produces no pathname change, so the hook can't fire. Any state that decides which subtree renders and isn't in the URL is a second invisible router; enumerate everything that can navigate. Grep tell: a `renderX()` returning a component *instead of* `<Routes>`/`<Outlet>` from `useState`, or a top-level early return before the router. **Why it shipped twice:** the first fix never wrote this entry, so the class was never greppable. A generalizable fix owes an entry here in the same commit.

**A partial opt-out of a global base rule keeps the properties it forgot to name** (37 open instances). `src/App.css:178` gives `input, button` a `border-radius`, `border`, and `box-shadow`. A bare text button writing only `background: none; border: none` keeps the shadow, rendering a floating glassy pill. Fixed on `.album-suffix-add-btn` / `.album-suffix-toggle-btn`; spot-confirmed still open on `.settings-nav-item`, `.tags-seg-btn`, `.genre-line__item`. Find them:
```
python3 - <<'PY'
import re,glob
for f in sorted(glob.glob('src/**/*.css',recursive=True)):
    t=open(f).read()
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}',t):
        sel,body=m.group(1).strip(),m.group(2)
        if any(p in sel for p in (':hover',':focus',':active',':disabled','@')): continue
        if re.search(r'\bbackground(-color)?\s*:\s*(none|transparent)',body) and re.search(r'\bborder\s*:\s*none',body) and 'box-shadow' not in body:
            print(f"{f}:{t[:m.start()].count(chr(10))+1}  {sel}")
PY
```
Durable fix is to stop the base rule reaching bare buttons (scope it to a class, or reset in a shared `.btn-bare`), not to chase instances. Whenever the base rule gains a property, every partial opt-out silently gains it too.

**A geometry constant in TS restating a CSS value drifts silently** (fixed). `AlbumCarousel` scrolled `168 + 14` px/card against actual `160px + 12px gap`; overscroll accumulates into visible misalignment. Fix: measure from the DOM (`offsetWidth` + computed `columnGap`). A literal written as a sum is the tell someone hand-copied a box model. **Open instance: `AlbumGrid.tsx:316` scrubber jump is off by `PADDING`.**
