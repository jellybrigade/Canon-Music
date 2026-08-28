# Known Issues & Platform Gotchas

Bug classes that already shipped once. Heading is the lesson, one line each. Greps kept
because they are the only part that finds *tomorrow's* instance; forensics are in git.
Fixed unless marked OPEN.

## Platform (Linux / WebKitGTK / audio)

- **Left-click popup self-closes.** WebKitGTK catches the opening click's tail. `ContextMenu.tsx` defers the listener `setTimeout(...,0)`, uses `mousedown` capture + containment.
- **Freeze/thaw compositor crash.** Focus loss kills the WebProcess; upstream `wry` bug. Active mitigations, never strip without replacing: `web-process-terminated` -> `.reload()`, `useAppActivityTracking` blur stamp, `webkit2gtk-nvidia-quirk`, `"visible": false` + `window.show()` on page load. Never touch `set_hardware_acceleration_policy` without auditing compositing.
- **ALSA underrun under load.** rodio 0.19 buffer too small. `PULSE_LATENCY_MSEC=60` set early in `run()`. Real fix needs rodio 0.20+.
- **Read-only rusqlite can't own WAL `-shm`.** `library_read.rs` opens `READ_WRITE | NO_MUTEX | URI`, no `CREATE`.
- **Unbounded thread-per-request -> SIGKILL.** Cover proxy: permit acquired before spawn, `spawn_blocking`, cap 16. Tell: `ps -eLf | grep canon | wc -l` climbing.
- **Opaque "Load failed" after ~25s is systemd-resolved, not Canon.** Check `resolvectl status` and `journalctl -u systemd-resolved` before reading network code. Hardening shipped anyway: 12s `AbortController`, 3 retries, non-fatal `skippedStages`.

## Build / release pipeline

- **A devDependency the release has no use for still gets built by the release's install, and its toolchain is the one that breaks.** `better-sqlite3` exists only for `src/test/sqlite.ts`'s `FakeDatabase`, but `release.yml`'s bare `pnpm install` ran its `node-gyp rebuild` on every runner. When `windows-latest` moved to Visual Studio 18, node-gyp 10.3.1 (bundled inside pnpm 9.15.9) reported `unknown version "undefined" found at "C:\Program Files\Microsoft Visual Studio\18\Enterprise"` and failed the whole job before `tauri-action` ever started; `fail-fast: false` let Linux and macOS publish, so v0.48.0 and v0.48.1 shipped with no Windows asset and a green-looking release page. The install is now `--ignore-scripts` plus an explicit `pnpm rebuild esbuild`, the one script the frontend build needs. Ask of any release install: which of these packages does the shipped artifact contain, and why is the build compiling the rest? Cross-check the allowlist against what production actually imports:
  ```
  node -p "require('./package.json').pnpm.onlyBuiltDependencies.join(' ')"
  grep -rn "better-sqlite3" src --include='*.ts*' | grep -v '/test/\|\.test\.'
  ```
- **A green release page is not a complete release.** `fail-fast: false` across a platform matrix means one dead platform is silent. After `/release`, count the assets, not the run's colour.
  ```
  gh release view "v$(node -p "require('./src-tauri/tauri.conf.json').version")" --json assets --jq '.assets[].name'
  ```

## Async / lifecycle

- **A temp file named after a caller id is single-writer only if TS makes it so.** `waveformInFlight: Set<trackId>` in `player.ts`. Also: a command that `Err`s without emitting strands one-shot `listen()`s.
- **A handler resuming post-await must check intent, not assert state.** `pauseRequestedDuringLoad`; track-id equality is not intent.
- **One cancel token shared by several commands cancels intent, not effect.** Separate `pause_pending: AtomicBool` checked before the terminal action. Ask what each task does *after* its loop.
- **A fast path around the central action skips every guard that action owns.** Gapless advance bypassed `next()`, killing the sleep timer. Guard both ends.
- **A branch that pauses the sink owes the elapsed ticker the same stop the rest of the pause path gives it.** The gapless track-advanced handler's end-of-track sleep-timer branch called `activeTarget.pause(0)` and returned without `stopElapsedTimer()`, leaving the 200ms `audio_get_pos` poll armed for the track this transition moved away from running forever over a paused sink. Every other pause path in the file (`playTrack`'s early-pause branch, `next`, `stop`) calls both together; this one didn't because it returns early. Grep any `pause(0)` call and check the same scope also stops the ticker, unless a `startElapsedTimer()` never ran on that path to begin with.
  ```
  grep -n "activeTarget.pause(0)" src/store/player.ts
  ```
- **A fire-and-forget command owes an event on every terminal path.** Every gapless bail-out emits `gapless-cancelled`; final `sink.append` also checks `sink.empty()`.
- **Work scheduled ahead of time must carry what it decided.** `gaplessEnqueued: {track, position, wrapOrder}`; `next()` passes `-1` for no anchor.
- **A loading flag from `await invoke()` measures the IPC round trip, not the work.** Separate `isBuffering`, cleared by the `audio-format` event. A command ending in `thread::spawn` can only be honest via an event.
- **A timeout disarmed when the first phase of a request settles does not bound the phase the caller still awaits.** `fetchWithTimeout` cleared its abort timer in a `finally` wrapped around `fetch` alone, but `fetch` resolves at the response headers, so all 19 `apiPost` consumers read the body (`res.json()`) with no timeout and nothing armed to cancel it. A connection dying mid-transfer - the exact failure the 12s cap exists for - left that read pending forever: `apiPost` never rejected, `syncLibrary` never settled, and `useLibrarySync`'s `.catch` and `.finally` never ran, so `syncingRef.current` stayed true and every later auto-sync tick returned false with the spinner still up. The abort now spans a `res.text()` inside the same `try`, and the buffered text is re-wrapped in a `Response` (null body for 204/304, which reject a non-null one) so callers are unchanged. Ask of any timeout: does it cover every await the caller depends on, or only the call it wraps?
  ```
  grep -rn "AbortController" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **"Stream ended" and "stream stopped" are different signals.** `fail()` (reader returns `UnexpectedEof`) vs `finish()`; `fail()` only if `play_id` still matches.
- **A promise nobody can abort still owns every handler hung off it, and the cleanup that stops the timers cannot stop the code that arms them.** `useLibrarySync` hung `.then`/`.catch`/`.finally` on `syncLibrary` with no mounted guard, so a run outliving its hook set state on a dead hook, bumped six session stores and armed the 300/600/1000ms fan-out, the last of which invalidated a query cache the unmounted tree no longer read. The two existing `useEffect` cleanups cleared the retry timer and the auto-sync interval - neither could touch a timer the settle handler had not created yet. Fixed with a `mountedRef` gating all three handlers plus a held list of fan-out timer handles cleared on unmount. The flag is re-armed in the effect *body*: StrictMode's mount/unmount/mount would otherwise leave it false forever and disarm every later run. Ask of any un-abortable await: what does its settle handler touch, and does a cleanup exist that can reach all of it? The grep's last unguarded hit, `useGenreDisplay`'s canon-tree read, now carries the `cancelled` flag its siblings `useGenreTree` and `useLyrics` already had. React 18 no-ops the write silently, so the unmount test asserts the settle handler does no work at all (a counting getter on `tree.nodes`) rather than asserting rendered output. Every hit is guarded now, so a new one is real.
  ```
  grep -rn "^\s*\.then(\|^\s*\.finally(" src/hooks --include='*.ts*' | grep -v '\.test\.'
  ```
- **A resource acquired via await escapes the cleanup meant to free it.** `useWakeLock`: `cancelled` flag, resolved sentinel self-releases. Test `!released`, not non-null.
- **A guard keyed on one error type stands in for the broad condition it was meant to test.** `apiPost` retried non-idempotent writes on the alt url for every error `isTimeout` didn't name; now `if (!retriable) break`. Any branch deciding whether a side effect may repeat must assume unsafe on unrecognised errors.
  ```
  grep -rn "instanceof DOMException\|AbortError\|instanceof TypeError\|err\.name ===" src --include='*.ts*' | grep -v '\.test\.'
  ```

## Test / harness

- **Time it before theorising.** A timeout landing on a different case each run reads as a race and usually is not. `pnpm test:run --testTimeout=60000 --reporter=verbose` settles it; any case over ~1500ms owes an explanation.
- **A large fake-time advance costs one iteration per live interval tick.** Set the state the distant timer needs directly instead of starting a poller.
  ```
  grep -rn "advanceTimersByTime" src --include='*.ts*' | grep -E "60 \* 1000|3600|\* 60 \*"
  ```
- **A boundary test has to reach the boundary, so every field on the fixture it moves is paid for a boundary's worth of times.** `fetchAllAlbums`' 500,000-album ceiling means 1000 pages of 500 albums through the fetch mock; realistic album objects put the case at 1.2s alone in `JSON.parse`, which tipped it past the 5s timeout whenever the machine was loaded. Cut to the one field the walk reads and a shared tail built as text once, it is 360ms. Strip a boundary fixture to what the code under test actually looks at.
  ```
  grep -rn "Array.from({ length: [0-9_]\{4,\}" src --include='*.test.ts*'
  ```
- **An accessible-name query is a whole-tree scan (150-300ms/call).** Prefer a class selector, and pair any absence assertion with a positive control.
  ```
  grep -rc "ByRole(" src --include='*.test.tsx' | grep -v ":0$" | sort -t: -k2 -rn
  ```
- **A fetch mock handing back one shared `Response` diverges from the real thing the moment the code reads a body twice.** `mockResolvedValue(httpStatus(503))` gave all three retry attempts the same object, so once `apiPost` started reading bodies the second attempt died on "Body is unusable". Real `fetch` builds a fresh `Response` per call; a mock that does not will either hide a body-handling bug or invent one. Use `mockImplementation(() => ...)` wherever the same call is expected more than once.
  ```
  grep -rn "mockResolvedValue(" src --include='*.test.ts*' | grep -iE "response|ok\(|httpStatus"
  ```
- **A fixed sleep costs its ceiling every run; a per-case rebuild pays for it per case.** Use `actUntil()` and `forkTestDb()` (`src/test/sqlite.ts`).
  ```
  grep -rn "setTimeout(r\|setTimeout(resolve" src --include='*.test.ts*' | grep -vE "[^0-9](0|[1-9][0-9]?)\)"
  ```
- **A state update from a listener the app registered itself is not flushed by `act`.** Absence assertions must `waitFor` the DOM they check; presence is self-correcting.
  ```
  grep -rn "toBeNull()" src --include='*.test.tsx' -B 3 | grep -A 3 "await act(async"
  ```

## Data / state

- **A claim stamped when work starts and cleared only on success is permanent after the first failure.** `useLibrarySync` now arms a bounded backoff `[30s, 2min, 5min]` from the settle handler. Every terminal path owes the flag a decision. Third instance, same grep: `useEnrichAlbumTracks` stamped `ranRef` before the run and its `.catch` was a bare silent no-op, so one failed album left every track unenriched for the life of that mount. The clear goes in `.catch` here (unlike `useLibrarySync`, whose settle handler re-enters) because nothing but a dep moving re-runs the effect.
  ```
  grep -rn "Ref.current = " src/hooks --include='*.ts*' | grep -v '\.test\.'
  ```
- **A per-mount claim on work keyed by an argument stands against every later value of that argument.** `useEnrichAlbumTracks`, `useEnrichArtist` and `useNormalizeAlbum` held `useRef(false)`; `AlbumDetail` has no `key`, so navigating between two cached albums swaps `albumId`/`album.artist` inside one mount and the stamp from the first silently suppressed the second. Refs now hold the id (`ranRef.current === albumId`), and every clear checks the id it clears. Each hit below must guard work that cannot change identity within one mount, or hold the id.
  ```
  grep -rn "useRef(false)" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A parallel-array invariant enforced by one writer holds only until another runs.** `shuffleOrder.length === queue.length`; `normalizeShuffleOrder` repairs before splice sites. Grep for a length guard one writer has and others don't.
- **A parallel-array invariant every writer is supposed to hold is only as good as the one writer that skips it.** `removeFromQueue` and `removeManyFromQueue` indexed `shuffleOrder[position]` directly, though `normalizeShuffleOrder`'s own comment already named them (`moveQueueItem` was fixed, these were not) as writers that could read past a short order. Reachable via `loadSettings`' `queue_state` restore, which writes `saved.shuffleOrder` straight from persisted JSON with no length check against `saved.queue`. A short order made the non-null assertion resolve `undefined`, which `Array.prototype.splice` coerces to index 0 and removed the wrong track. Both now normalize before indexing, like `moveQueueItem` already did.
  ```
  grep -rn "shuffleOrder\[.*\]!" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A "safe copy" helper must copy on every path, including the no-op one.** `return [...order]` always, or reference equality kills the re-render.
- **A restore path writing `currentTrack` without loading the engine is unplayable.** `resume()` treats null `streamUrl` as `error`; server-side restore uses state-only `restoreQueue`.
- **A sync that only upserts diverges from its source, and the divergence feeds itself.** `syncLibrary` prunes albums/tracks absent from the fetch, refusing an empty or partial one. Same pass: playlist refresh upserts server-owned columns only; loved-stage compare scopes both sides by id prefix; `playlist_tracks.position` compacted via two negative-space passes. Grep `DELETE` against mirrored tables and ask what depends on a row's absence.
- **A paging loop whose only exit is a condition the server controls is not bounded.** `fetchAllAlbums` walked `offset` until a page came back short, so a server ignoring `offset` looped forever and grew the array until the process died, with no error to report. Now a repeated first id throws, and `offset` is capped at 500,000 albums. Any `while (true)` over a remote cursor owes both an advance check and a ceiling.
  ```
  grep -rn "while (true)\|while(true)" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A cache table exempted from a prune inherits the exemption written for user-authored rows beside it.** `pruneAlbums` deleted `album_genres`/`album_unresolved_genres` but not `album_covers`, whose neighbours (`album_identity`, `album_user_genres`, `album_genre_exclusions`) are kept on purpose; the cache is a base64 `data_url`, so every album that disappears server-side stranded tens to hundreds of KB no read path can reach, forever, and `useAlbumCoverMap`'s keyset scan grew with them. A table is exempt only if *its own* content justifies it. Compare the two delete lists whenever either moves:
  ```
  grep -n "viaAlbums(\"\|DELETE FROM album" src/lib/sync.ts
  ```
- **A read filtered in the loop body instead of in SQL costs its whole table on every pass, and any count beside it tells a different story.** `useScrobbleFlush` selected all of `scrobble_queue` and `continue`d past rows lacking the current server's id prefix, so a second server's backlog was re-read every 60s forever while being unsendable, and the Diagnostics count (unscoped `COUNT(*)`) reported a backlog no wait could clear. Both now scope on `track_id LIKE ? ESCAPE '\\'` via one `ownerPattern` helper, and the count's query key carries the server id. `purgeServerData` was never the gap - it has covered `scrobble_queue` since `d153621`. Ask of any per-row `continue`: could the WHERE clause have said this, and does every count over the same table agree with it?
  ```
  grep -rn "continue;" src/hooks src/lib --include='*.ts*' | grep -v '\.test\.'
  ```
- **A retry armed on a rejected write assumes the write never happened, and half the time it did.** `useScrobble` cleared its stamp on any insert rejection, so a commit whose response was lost queued the same play twice and Navidrome was scrobbled twice; a fresh `Date.now()` per attempt also defeated any `(track_id, timestamp)` dedupe downstream. The timestamp is now stamped once per play and the retry re-reads the row before re-arming, treating "cannot confirm" as sent. Ask of any retry: can the operation be observed, and is it safe if it already applied?
  ```
  grep -rn "\.catch(" src/hooks --include='*.ts*' | grep -v '\.test\.' | grep -iE "retry|current = false|current = null"
  ```
- **A partial delete out of a positionally-ordered table must repair the ordering, and a change detector comparing membership cannot see the damage.** `pruneAlbums`/`deleteTracksByIds` dropped the `playlist_tracks` rows of every pruned track and left the positions around them, so a playlist went 0, 2. The server dropped the same tracks, so its ordered id list matched the stored one and both playlist gates (the server-wide signature and the per-playlist `sameTracks`) said nothing moved. `position` is the `songIndexToRemove` `PlaylistDetail` sends, so the next removal deleted the wrong track server side - the same invariant `library_write.rs::remove_playlist_track` compacts for. A `holedPlaylists` set now feeds both gates. Any delete not scoped to a whole ordered group owes the group a renumber, and any "did it change" test over that group must compare positions, not just membership.
  ```
  grep -rn "playlist_tracks" src --include='*.ts*' | grep -v '\.test\.' | grep -v "playlist_id = ?\|playlist_id IN\|INSERT"
  ```
- **Two failures that suppress the same write owe the caller the same report.** `syncLibrary`'s playlist stage blocks every playlist write on any fetch failure, but only the *listing* failure pushed `"playlists"` onto `skippedStages`; a per-playlist track fetch failure set `playlistWritesBlocked` and bumped `failedPlaylists` silently. `useLibrarySync` builds its partial-sync message out of `skippedStages` alone, so one flaky playlist blocked every playlist update while the run reported an empty `skippedStages` and `changed.playlists === false` - indistinguishable from "read cleanly, nothing changed", indefinitely. The push now sits with the flag, guarded so several failing playlists report the stage once. Ask of every flag that suppresses a write: does each path that sets it also name the stage the caller reads? Check each `*Blocked`/`*Incomplete` assignment against the reporting pushes beside it.
  ```
  grep -n "skippedStages.push\|Blocked = true\|Incomplete = true" src/lib/sync.ts
  ```
- **A progress report emitted only on an interval never lands on the end, and a gate on the wrong quantity never lands on the start.** `syncLibrary`'s `onAlbumBatch` fired at the first fetch and every 25th and nothing after the loop, so unless the album count was a multiple of 25 the bar stopped up to 24 albums short of the total - the longest operation in the app could never reach 100%. The opening `{done: 0}` tick was gated on `processedCount > 0 || prunedAlbums > 0`, which measures what the album *upsert* wrote, not whether there is a track pass to run: an album whose row is byte-identical but whose local tracks were pruned still needs a full fetch, so that run reported nothing at all until its first success. Both now go through one `reportProgress` gated on `albumsNeedingTracks.length`, with a final emit suppressed when the interval already landed on it. `done` deliberately counts attempts, not successes, so failures do not strand the bar below the total; the early-break path keeps its shortfall on purpose, because that is what `albumTracksIncomplete` means. Ask of any interval-driven progress callback: what emits the last one, and is the first gated on the work or on a side effect of some earlier stage?
  ```
  grep -rn "% BATCH_NOTIFY_INTERVAL\|% NOTIFY_INTERVAL\|Count % " src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A cache built to make one expensive read cheap is worth nothing while a second caller does the read itself.** `useServerWithCredential` pins the server credential with `staleTime: Infinity`/`gcTime: Infinity` and a comment saying a refetch "re-round-trips to the OS Secret Service over D-Bus for a value that cannot have changed" - and `syncLibrary` then opened `canon.server.<id>` itself, with its own copy of the legacy-payload migration, so every launch spent two blocking D-Bus calls into gnome-keyring/kwallet at the moment the app is already contending for the DB and the network. The two callers passed identical arguments, so no test could attribute a call to either one and the waste was invisible to the suite. `syncLibrary` now takes the credential as a parameter and `useLibrarySync` takes the whole `ServerWithCredential`, which also means a sync cannot start before the credential resolves. Ask of any value a query deliberately caches forever: who else fetches it, and does the expensive part actually happen once? The tell is a second copy of the parsing beside a second copy of the read.
  ```
  grep -rn "keychain\.get\|invoke(\"get_credential\"" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A `retry: false` written for the failures the user has to fix also disables the ones that fix themselves, and a value cached forever has no second chance.** `useServerWithCredential` refused every retry on the reasoning that a missing entry, a locked keyring and a corrupt payload are all permanent until the user acts. Two of those three are; a *locked or not-yet-running* secret store is not - Canon can autostart at login before gnome-keyring/kwallet is up. That became session-fatal once `syncLibrary` stopped reading the keychain itself: the query is now the session's only keychain read, `staleTime`/`gcTime` are `Infinity`, `refetchOnWindowFocus` is off globally and only a Settings save invalidates the key, so one unlucky read left `serverWithCred` undefined for the life of the process. No sync ever started, which meant `useLibrarySync`'s `[30s, 2min, 5min]` ladder never armed either, because it is armed from a *started* run's settle handler. The two failure kinds are now told apart at the source: `lib.rs::friendly_keyring_error` prefixes `PlatformFailure`/`NoStorageAccess` with `SECRET_STORE_UNAVAILABLE`, `credentialReadError` strips that marker before display and throws a distinct class for it, and `shouldRetryCredentialRead` retries only that class over a 31s ladder. `CredentialGate` and the library header also gained a **Try again**, because a ladder that is spent still needs a way back that is not restarting the app. Ask of any `retry: false`: is every failure it covers really permanent, and if the value is also cached forever, what re-reads it?
  ```
  grep -rn "retry: false" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A skip fast-path freezes every column only the skipped path writes.** `tracks.play_count` froze while `albums.play_count` moved. When a sync gains a skip, list what that path solely writes.
- **A drain loop that breaks on any error blocks on its first permanent failure.** `useScrobbleFlush` drops Subsonic error 70, still breaks on auth 40/41/50; `flushing` flag stops a slow pass overlapping the 60s tick.
- **An effect that bails on a ref the first render did not fill never runs at all, because nothing in its deps says the element arrived.** `useScrollMemory`'s save half depended on `[ref, key]` and returned early on a null `ref.current`; `ArtistGrid` renders its error, skeleton and empty branches *before* the scroller, so on a cold start the element did not exist yet, the scroll listener was never attached, no offset was ever recorded, and the restore could only ever be a no-op. `ready` is now a dep of both halves. The same grep found two more, both measuring: `ArtistGrid`'s own `useLayoutEffect(..., [])` never saw its scroller, so `containerWidth` stayed 0 and the whole artists page painted as one 190px column on any cold start; `TagReviewTab` never measured its list and fell back to a fixed page size. Both now use `useMeasuredElement`, whose callback ref has no deps to get wrong. Any effect reading a conditionally-rendered ref owes its deps the condition that renders it, or a callback ref (which fires on attach, whenever that is).
  ```
  grep -rn -B1 "if (!el) return\|if (!container) return" src/components src/hooks --include='*.ts*' | grep -v '\.test\.' | grep "Ref\.current\|ref\.current"
  ```
- **A query that only reads local SQLite must not gate on the credential fetch that guards network calls.** `CommandPalette` and `DiagnosticsTab`'s scrobble-queue count keyed their `enabled`/query id off `serverWithCredential?.server.id` though neither ever touches the network; while the keychain read is pending or has permanently failed (`retry: false`), the query stays `enabled: false` forever with `isError` still `false`, so the palette showed "Searching..." forever and the backlog count stuck at "-". Both now take a plain `serverId` prop. A query is credential-gated only if its `queryFn` actually needs the token.
  ```
  grep -rn "serverWithCred.*\.server\.id\|serverWithCredential?.server.id" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A repair effect whose repair invalidates its own trigger can loop forever.** `AlbumDetail` marks the album id attempted *before* repairing. Grep for an effect calling `bumpRefresh()`/`invalidateQueries` on what it depends on.
- **Re-keying a collection to ids means re-keying every cursor, anchor, count and gate.** `TrackTableView` kept a numeric shift-anchor and a raw `.size` after moving to `Set<string>`.
  ```
  grep -rn "useRef<number" src --include='*.tsx' | grep -v '\.test\.'
  grep -rn "Ids\.size\s*[<>=]" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A cache-hit test written as "is there a value" never caches the answer "there is none", which is the case that repeats.** `useLyrics` treated a row with null `plain`/`synced` as a miss so `refresh` could force a re-lookup, but the queryFn writes exactly that row when every source comes back empty - so every track with no lyrics anywhere re-ran the OpenSubsonic call, LRClib and lyrics.ovh on every open of the tab, forever. `source` now carries a `"cleared"` sentinel written by `refresh` and by the offset-only insert, and anything else is a completed lookup. Both columns are NOT NULL, so absence could not be the witness. Ask of any cache: what does a successful "nothing found" look like in the table, and does the hit test recognise it?
  ```
  grep -rn "if (cached\|if (rows\[0\]\|if (hit\|cached\.length > 0" src/hooks src/lib --include='*.ts*' | grep -v '\.test\.'
  ```
- **A prefetch that duplicates a query instead of sharing it warms a key nobody reads.** Key, `queryFn` and `staleTime` must be byte-identical; shared in `now-playing-queries.ts`. **Repo-wide: `ESCAPE '\'` in a TS string is `ESCAPE ''` and always throws - write `ESCAPE '\\'`.**
- **A `LIMIT` without `ORDER BY` silently redefines what the query returns.** FTS queries rank by weighted `bm25` in a `MATERIALIZED` CTE before the cap. Ask if the cut thing was chosen or just late. Also: `useDeferredValue` defers rendering, not fetching.
- **An identifier borrowed from an external service must not be compared exactly to a local one.** Last.fm artist names: both sides `LOWER(TRIM(...))`, ownership unions `artist_aliases`. Check every hop.
- **A mirror not scoped by owner depends entirely on its delete path.** `purgeServerData` runs before the `servers` row delete. **Sharper form, found 4x: grep for any object literal assigning `server_id:` from something that isn't the source row.**
- **A row looked up by an id the URL supplied is not a row the selected server owns, and a globally unique id hides that.** `AlbumDetailRoute` read `FROM albums WHERE id = ?` under the key `["album-by-id", albumId]`, while `ArtistDetailRoute` beside it scoped both. Album ids are `<serverId>:<nativeId>` and `id` is the primary key, so the lookup could never return the *wrong* row - which is exactly why the gap read as safe. The damage is the other half: the row it returned was a *foreign* server's, and `AlbumDetail` builds every cover URL (`getCoverArtUrl(server.url, ...)`) and stream URL from the *selected* `serverWithCredential`, so the page painted with an id one host has never heard of and `syncAlbumTracks` wrote against the wrong server. Reachable from any `/album/:albumId` link outliving a server switch, and from `openAlbumById`, which had the same unscoped read. Both now scope the WHERE, and the query key carries the server id so a server switch cannot serve the previous one's cached row. Ask of any id-keyed read of a mirrored table: does the id's own uniqueness prove ownership, or only that the row is unambiguous? Scope to files where the wrong-host consequence exists; the remaining hits are writes keyed by a row the caller already holds.
  ```
  grep -rln "serverWithCred\|ServerWithCredential" src --include='*.ts*' | grep -v '\.test\.' | xargs grep -n "FROM albums WHERE id\|FROM tracks WHERE id\|FROM artists WHERE\|FROM playlists WHERE id" | grep -v server_id
  ```
- **An artist name is not an owner, and a read keyed on one returns every server's rows.** The id-keyed form of this (the `album-by-id` entry above) could only ever return the *wrong owner* of an unambiguous row; a name carries no server prefix, so the name-keyed form returns the wrong *rows*. Eight reads of `albums`/`tracks` filtered on an artist column had no `server_id` bind: all three now-playing About-tab queries, `useArtistAlbums` (the artist page's discography and `AlbumDetail`'s "More from Artist"), `useSimilarArtistAlbums` ("Fans Also Like"), `ArtistDetail`'s top-tracks, seed-track, genre-count and appears-on queries, and the radio seed pick in `handleStartRadioFromArtist`. Every consumer builds its cover and stream URLs from the *selected* `serverWithCredential`, so with two servers configured each strip padded itself with albums whose art 404s against a host that has never heard of the id, and the artist radio could seed on a track that cannot play. Three of them combined the name match with aliases or feat. variants as an OR group, so the scope has to bracket the group - an `AND` next to the first alternative silently leaves the rest library-wide. The query keys took only the name, so a server switch also served the previous server's cached rows. `useAlbumIdentity` and `useEnrichArtist` stay library-wide on purpose: they resolve a global MusicBrainz identity, and no row of theirs reaches a URL. Enforced repo-wide by `src/lib/server-scoping.test.ts`, which also fails if an exemption stops being needed. Ask of any name-keyed read: does the key itself prove ownership, or only the row's own column?
  ```
  python3 - <<'PY'
  import re, glob
  read = re.compile(r'`([^`]*\bSELECT\b[^`]*\b(?:FROM|JOIN)\s+(?:albums|tracks)\b[^`]*)`', re.S)
  for f in sorted(glob.glob('src/**/*.ts', recursive=True) + glob.glob('src/**/*.tsx', recursive=True)):
      if '.test.' in f: continue
      for m in read.finditer(open(f).read()):
          sql = m.group(1)
          if re.search(r'\b\w*\.?artist\s*(?:=\s*\?|IN\s*\(|LIKE\s*\?)', sql) and not re.search(r'\bserver_id\s*=\s*\?', sql):
              print(f, ' '.join(sql.split())[:90])
  PY
  ```
- **A guard that holds only because of what the data happens to look like is not a guard.** Five `LIKE ?` prefix binds had no `ESCAPE`; safe only while ids are UUIDs. One `escapeLike` in `src/lib/sql.ts`, enforced repo-wide by `src/lib/sql-escaping.test.ts`. Literal patterns (`NOT LIKE 'raw:%'`) need no escaping.
  ```
  grep -rn "LIKE ?" src --include='*.ts*' | grep -v '\.test\.' | grep -v ESCAPE
  ```
- **A secret written before its owning row outlives the row.** Insert rolls back the keychain write; removal deletes the secret first and aborts loudly. `keychain.get` *rejects* on a missing entry, so callers null-checking the resolved value hold dead code, and that query wants `retry: false`.
- **A cleanup step that treats "already gone" as a failure makes the mess it was cleaning permanent.** Removing a server deletes the keychain entry before the `servers` row (right ordering, see below) and aborts the whole removal if that step rejects - and `delete_credential` surfaced keyring's `NoEntry`. A server whose secret had been lost (keyring reset, a rolled-back insert, a profile copied between machines) could then never be removed, and its rows and library stayed forever. `ignore_missing_entry` in `lib.rs` now folds `NoEntry` into `Ok`. Ask of every abort-on-failure cleanup: is one of those failures just the desired end state?
  ```
  grep -rn "keychain\.delete\|keychain\.get" src --include='*.ts*' | grep -v '\.test\.' | grep -v "catch"
  ```
- **A "the thing just finished" test built only from state that restore also produces fires at startup.** `useRadio` needs `hasPlayedRef` as a witness. Side-effect starts belong in handlers, not effects.
  ```
  grep -rn "playFromQueueIndex(\|playTrack(\|playQueue(\|\.resume()" src/hooks src/App.tsx | grep -v "\.test\."
  ```
- **A statement sequence whose intermediate states are invalid is a transaction, whether or not anyone wrote one.** `runMigrations` now wraps each block *and its version row* in `BEGIN`/`COMMIT`, `ROLLBACK` rethrowing the original error; v27's seed gained `OR IGNORE`. Ask per statement: if the process dies here, does the block's first statement still work next launch?
- **A stored version compared in one direction only answers "what still needs doing", never "is this too new for me".** `LATEST_SCHEMA_VERSION` + `SchemaTooNewError` (`>`, not `>=`), rendered by `DatabaseErrorScreen` with no retry button. Any persisted format version wants a ceiling checked at open.
- **A transaction is real only if the statements reach the same connection.** `tauri-plugin-sql` pools 10 connections with no affinity, so a TS `BEGIN` reachable from a user gesture is a silent no-op *and* a deadlock. `src/db/migrations.ts` is the only legitimate TS `BEGIN` (its awaits are sequential and `getDb()` gates every other caller); multi-write mutations go to `src-tauri/src/library_write.rs`, as `playlist_remove_track` did.
  ```
  grep -rn '"BEGIN"\|BEGIN TRANSACTION' src --include='*.ts*' | grep -v '\.test\.'
  ```

## UI

- **A window-level shortcut that `preventDefault`s owes every branch its own focus guard.** `isTextEntryTarget` (`src/lib/keyboard.ts`) shared by both listeners; Ctrl+K, Ctrl+F and Escape each need a different exemption, so a blanket bail breaks all three. Read options through a ref so keystrokes don't re-register the listener.
  ```
  grep -rn "addEventListener(\"keydown\"" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **An overlay's own Escape handler answers "am I open", never "am I on top".** Nothing calls `stopPropagation`, so registration order saves nothing. `useSearchShortcuts` takes `overlayAbove`.
  ```
  grep -rn 'e\.key === "Escape"' src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A stacking guard written as a hand-kept list only covers the layers its author could see.** `useModalChrome`'s module-level registry (`useAnyModalOpen()`) replaced the enumeration; menus and dropdowns must *not* register. **OPEN:** `TagDrawer`, `TagTreeTab`'s `NodeModal`, `FeedbackModal`, `UpdatePrompt` still hand-roll their dismissal.
  ```
  grep -rln "createPortal" src/components --include='*.tsx' | xargs grep -Ln "useModalChrome"
  ```
- **Dismissing a backdrop on `click` dismisses on a gesture that only ended there.** `useOverlayDismiss` arms on `mousedown` at the backdrop and closes only if the release matches; the dialog needs no handler. Target identity, never `stopPropagation`.
  ```
  grep -rn "onClick={(e) => e.stopPropagation()}" src --include='*.tsx' | grep -v '\.test\.'
  ```
- **`Number(x) || fallback` deletes a legal zero,** and makes any `Math.max` floor beside it dead. Branch on `""` explicitly, then clamp.
  ```
  grep -rn "Number(.*)\s*||\|parseInt(.*)\s*||\|parseFloat(.*)\s*||" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **State deciding which subtree renders, but absent from the URL, must be dismissed by navigation itself - and "navigation" means the intent, not the pathname moving.** The search overlay and the command palette are plain state in `App.tsx`, so a navigation that leaves them up paints them over the route the user just asked for and the click reads as inert. Fixed once with `useDismissOnNavigate(pathname, dismissOverlays)`, which fires on a pathname *change* - and every navigation to the route already open (the active sidebar item, the album whose page is showing, a palette item for the current view, Alt+ArrowLeft at the first history entry, the thumb button at either end) moves the router nowhere, so it could never fire for any of them. The residue was patched at two call sites only, `SearchResults`' own handlers, which is the per-handler pattern this class keeps coming back to. `useAppNavigation` now takes `dismissOverlays` and runs it at the top of `navigateTo`/`openAlbum`/`openArtist`/`openPlaylist`/`goBack` and in both window handlers, through a ref so a fresh closure cannot re-arm the listeners; the per-call-site `clearSearch()` and four of the five `setCommandPaletteOpen(false)` calls are gone, the fifth kept because `onPlayTrack` does not navigate. `useDismissOnNavigate` stays for the one navigation that never reaches the hook: a route navigating on its own (`AppRoutes` after a playlist delete). Ask of any non-URL state that hides the router: is it dismissed where the user expressed the intent, or where the URL happened to change? The grep is for a `navigate` outside the one hook that owns navigation - each hit needs its own dismissal or a reason it cannot strand anything.
  ```
  grep -rn "useNavigate()" src --include='*.ts*' | grep -v '\.test\.' | grep -v useAppNavigation
  ```
- **A dismissal scheduled at the same priority as the navigation it accompanies cannot land before that navigation does.** The fix above ran `dismissOverlays` inside `startTransition`, on the reasoning that React Router commits its own location update as a transition and matching the priority puts both in one commit. Every route is `React.lazy` under the already-mounted `<Suspense fallback={null}>` in `AppShell` that also contains the search overlay, and React keeps a boundary's *committed* content rather than showing its fallback while a transition suspends - so on the first visit to any route the chunk had not been imported yet, both lanes waited on the dynamic import, and the overlay stayed painted over the click for as long as the download took. That is the same "the click reads as inert" symptom the dismissal exists to remove, reintroduced by the mechanism meant to tidy it. Urgent, the dismissal renders on its own: the router has not moved yet, so the route the user came from is what stays painted for the frame or two until the transition lands, and nothing is ever blank. Ask of any `startTransition` around a *response* to a user gesture: is it sharing a Suspense boundary with the work it is waiting on, and what does the user see meanwhile?
  ```
  grep -rn "startTransition" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A route that returns `null` for "don't know yet" and for "isn't there" paints the same blank page for both.** `data ?? null` collapses the one distinction `useQuery` gives you. Name the pending state.
  ```
  grep -rn "data:.*\} = useQuery" src/app --include='*.tsx' | grep -v '\.test\.'
  ```
- **A prerequisite gate is a state machine too.** `if (!serverWithCred) return null` was a permanent blank page (`retry: false`). Shared `CredentialGate` in `AppRoutes.tsx`. `isPending` is useless on a gated query (disabled = pending forever); derive `!!server && !serverWithCred && !credError`. **OPEN:** `renderLibraryContent` still says "No server connected" during the keychain read.
  ```
  grep -rn "if (!serverWithCred\|if (!credential\|if (!server)\|if (!session" src --include='*.tsx' | grep -v '\.test\.'
  ```
- **Decoding a value the framework already decoded is a no-op on almost every input and a crash on the rest.** react-router decodes params once; a second decode threw `URIError` from a render body (unmounting the tree) or silently resolved `%20`. A hand-rolled round-trip test cannot see it - drive a real router (`src/lib/routes.router.test.tsx`). Known limit: a literal `%2F` in a name can't round-trip.
  ```
  grep -rn "decodeURIComponent\|unescape(" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A partial opt-out of a global base rule keeps the properties it forgot to name.** `src/App.css:178` gives `input, button` a `border-radius`/`border`/`box-shadow`; `background: none; border: none` keeps the shadow. **OPEN, 37 instances.** Durable fix is scoping the base rule or a shared `.btn-bare`, not chasing hits.
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
- **A geometry constant in TS restating a CSS value drifts silently.** Measure from the DOM. A literal written as a sum (`168 + 14`) is the tell someone hand-copied a box model.
- **A layout constant the component applies by hand is invisible to the library computing offsets in the same space.** `AlbumGrid` added `PADDING` itself, so `scrollToIndex` parked rows under the top edge. Pass `paddingStart`/`paddingEnd` and keep one writer.
  ```
  grep -rn "virtualRow\.start\|virtualItem\.start\|getTotalSize()" src --include='*.tsx' | grep -v '\.test\.' | grep "[+-]"
  ```
