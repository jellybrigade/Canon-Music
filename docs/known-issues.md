# Known Issues

Bug classes that shipped once. Entry = bold lesson + 1-2 sentence cause/fix + optional grep. New bug → add entry here + regression test, same commit; keep file ≤150 lines by merging or dropping entries now guarded by tests.

Enforced by sweep tests, so no entry here: `src/lib/cappedCacheGuard.test.ts` (pre-write `size >= MAX` without `!has(key)`), `src/lib/coverArtGuard.test.ts` (`!` on cover ids), `src/lib/serverScoping.test.ts` (name-keyed `albums`/`tracks` reads without `server_id`), `src/lib/sqlEscaping.test.ts` (`LIKE ?` without `escapeLike`), `src/lib/cssTokenGuard.test.ts` (undefined `var(--x)`), `src/lib/bottomChromeGuard.test.ts` (routes padding for player bar themselves), `src/db/trackIdTables.test.ts` + `src/db/genreIdTables.test.ts` (tables keyed by a track/genre id), `src/test/cleanup.test.tsx` (RTL cleanup registered).

## Platform / WebKitGTK / audio

- **Left-click popups self-close on WebKitGTK.** The opening click's tail reaches the outside-click listener. Use `useClickOutside` (deferred attach, capture `mousedown`), no local copies. grep: `grep -rn 'addEventListener("mousedown"' src --include='*.ts*' | grep -v '\.test\.'`
- **Focus-loss compositor crash is upstream `wry`; keep the mitigations.** `web-process-terminated` → `.reload()`, `useAppActivityTracking` blur stamp, `webkit2gtk-nvidia-quirk`, `"visible": false` + `window.show()` on load. Never touch `set_hardware_acceleration_policy` blind.
- **ALSA underruns under load.** rodio 0.19 buffer too small; `PULSE_LATENCY_MSEC=60` in `run()`. Real fix is rodio 0.20+.
- **Read-only rusqlite can't own the WAL `-shm`.** `library_read/mod.rs` opens `READ_WRITE | NO_MUTEX | URI`, no `CREATE`.
- **Unbounded thread-per-request gets SIGKILLed.** Cover proxy takes a permit before spawning, `spawn_blocking`, cap 16. Tell: `ps -eLf | grep canon | wc -l` climbing.
- **Two HTTP stacks = two proxy configs; only the webview honours PAC.** API calls go through libsoup (GProxyResolver, PAC), covers through reqwest (env proxy); `/system/proxy/mode` = `auto` with a dead PAC stalls every `fetch` 25s. Ask of any transport failure: which client saw it, would the other agree? grep: `dconf read /system/proxy/mode`
- **Two HTTP stacks = two certificate stores.** reqwest on bundled webpki roots failed a private-CA server the webview trusted; now `rustls-tls-native-roots`. A client seconding the webview must trust what it trusts. grep: `grep -n "rustls-tls\|native-tls" src-tauri/Cargo.toml`
- **"Something answered" is not "the right thing answered".** `probe_server` called any HTTP response reachable (404, 502, 407). Only 2xx earns "up"; a boolean built from "no error" answers a narrower question than its name.
- **A diagnosis used only for message text is not a decision.** The breaker got a 2xx probe, wrote it in the notice, and opened anyway. First 2xx probe in a streak closes it. grep: `grep -rn "probe_server\|ServerProbe" src --include='*.ts*' | grep -v '\.test\.'`
- **WebKit's `err.stack` has no message line.** Logging the stack alone lost every message; `formatLogValue` prefixes `name: message`. grep: `grep -rn "\.stack" src --include='*.ts*' | grep -v '\.test\.'`
- **A scroller whose content grows keeps painting at its old width.** New tabs in an `overflow-x: auto` list clipped until hover; key the list on the toggle so it remounts. Not reproducible in jsdom. grep: `grep -rn "overflow-x: auto" src --include='*.css'`
- **"Load failed" after ~25s is usually systemd-resolved.** Check `resolvectl status` / `journalctl -u systemd-resolved` first. Hardening: 12s `AbortController`, 3 retries, non-fatal `skippedStages`.

## Build / release

- **Test-only devDependency breaks the release build.** `better-sqlite3` node-gyp broke Windows silently under `fail-fast: false`; install with `--ignore-scripts` + `pnpm rebuild esbuild`. grep: `grep -rn "better-sqlite3" src --include='*.ts*' | grep -v '/test/\|\.test\.'`
- **Green release page != complete release.** After `/release`, count assets: `gh release view "v$(node -p "require('./src-tauri/tauri.conf.json').version")" --json assets --jq '.assets[].name'`
- **`commit-msg` runs before git's own cleanup.** Strip `core.commentChar` lines and everything after the `>8` scissors before counting body lines.
- **Message-shape hook must exempt the release merge.** `MERGE_HEAD` present or `HEAD` on `main` skips the body check; trailers stay banned everywhere.

## Async / lifecycle

- **Single-writer temp files need TS enforcement.** `waveformInFlight: Set<trackId>` in `playerRuntime.ts`. A Rust `Err` without an emit strands a one-shot `listen()`.
- **Handler resuming after an await checks intent, not state.** `pauseRequestedDuringLoad`; track-id equality is not intent. A shared cancel token cancels intent, not effect: separate `pause_pending`.
- **A fast path around a central action skips its guards.** Gapless advance bypassed `next()` and killed the sleep timer; guard both ends. Every `pause(0)` also stops the elapsed ticker. grep: `grep -n "runtime.activeTarget.pause(0)" src/features/playback/store/*.ts`
- **A poller diffing two readings misses a change that goes out and back between them.** Gapless hand-off inferred from `sink.len()` dropping missed 1→2→1 inside 100ms; `append_gapless` now inserts an `EmptyCallback` that records the `play_id`.
- **Fire-and-forget commands owe an event on every exit.** Gapless bail-outs emit `gapless-cancelled`; `await invoke()` on a `thread::spawn` command measures IPC, not work (`isBuffering` cleared by `audio-format`).
- **Pre-scheduled work must carry its decision.** `track-advanced` re-derived "wrap" from live queue length, so a radio replace dropped the hand-off; `gaplessEnqueued` carries `{track, position, wraps, wrapOrder}`. grep: `grep -n "queue.length\|queueIndex + 1" src/features/playback/store/playerEngine.ts`
- **A timeout cleared when headers arrive doesn't bound the body.** `fetchWithTimeout` abort now spans `res.text()`. grep: `grep -rn "AbortController" src --include='*.ts*' | grep -v '\.test\.'`
- **"Stream ended" and "stream stopped" are different signals.** `fail()` (`UnexpectedEof`) vs `finish()`; `fail()` only if `play_id` matches.
- **Un-abortable promises write to dead components.** `useLibrarySync` `.then`/`.finally` needed a mounted guard and timers cleared on unmount, re-armed in the effect body (StrictMode-safe).
- **An in-flight guard must live as long as the work, not the effect.** `useScrobbleFlush` kept `flushing` per effect, so a credential refetch mid-send started a second pass that resent the undeleted row; the claim is a module `Set` keyed by server. grep: `grep -rnE "^\s{4,}let \w+ = false;" src --include='*.ts*' | grep -v '\.test\.'`
- **A resource acquired via await must escape its own cleanup, and a second request in the window orphans the first.** `useWakeLock`: `cancelled` flag, a late-resolved sentinel self-releases; `isRequesting` stops a visibilitychange from starting a second request.
- **Router-owned callbacks in deps re-arm listeners.** react-router replaces `navigate` per location change, arming one extra listener per navigation; hold it in a ref. Fine for handlers, a defect for listeners/timers. grep: `grep -rnE "^\s*\}, \[[^]]*(navigate|setSearchParams|searchParams|location)[^]]*\]\)" src --include='*.ts*' | grep -v '\.test\.'`
- **A module-scoped promise memo cleared only on success stays poisoned.** Clear it in `catch` under the same generation check and rethrow. Deliberate exception: `dbPromise` in `src/db/index.ts`. grep: `grep -rn "^let .*: Promise<\|^let .*Promise<.*> | null" src --include='*.ts*' | grep -v '\.test\.'`
- **A guard keyed on one error type is not the broad condition.** `apiPost` retried non-idempotent writes on unnamed errors; unrecognised = unsafe. grep: `grep -rn "instanceof DOMException\|AbortError\|instanceof TypeError\|err\.name ===" src --include='*.ts*' | grep -v '\.test\.'`
- **Idempotency can live in a parameter, not the endpoint name.** `scrobble` with `submission=false` is safe to repeat; `isRetriableEndpoint` takes params. grep: `grep -n "NON_IDEMPOTENT_ENDPOINTS" -A 6 src/clients/navidromeTransport.ts`
- **A reset written in an effect is one commit late.** `useTracks` showed the previous album's rows on the key-switch commit; store the key with the result and derive `result.key === key ? result : null` during render.
- **A mounted flag cleared only in cleanup is false forever under StrictMode.** Set it in setup, or better derive ownership from a key. Test with `renderHook(..., { reactStrictMode: true })`, not a `<StrictMode>` wrapper. grep: `grep -rn "useRef(true)" src --include='*.ts*' | grep -v '\.test\.'`
- **A one-shot report of live state is wrong once the state moves.** `useScrobble` now-playing must gate on `isPlaying` and name it in deps; ask what re-asserts it after the far side forgets. grep: `grep -rn "playStartedAt" src --include='*.ts*' | grep -v '\.test\.'`
- **A timer measures awake time; a deadline vs `Date.now()` measures wall time.** GLib timers stop during suspend; sleep timer chains ≤`SLEEP_TIMER_CHECK_MS` timeouts that re-read `Date.now()`. grep: `grep -rn "Date.now() +" src --include='*.ts*' | grep -v '\.test\.'`
- **A startup write racing first render must refresh what the render read.** Any `void getDb().then(...)` in `main.tsx` that writes queried rows must invalidate that query (`refreshGenreIdReads`). grep: `grep -n "void getDb()" -A1 src/main.tsx`

## Data / SQL / sync

- **A claim stamped on start and cleared only on success is stuck after the first failure.** Every terminal path decides the flag (`useLibrarySync` backoff `[30s, 2min, 5min]`, `useEnrichAlbumTracks` clears in `.catch`).
- **A per-mount claim keyed by nothing breaks when the arg changes within the mount.** Ref holds the id (`ranRef.current === albumId`), not a boolean. grep: `grep -rn "useRef(false)" src --include='*.ts*' | grep -v '\.test\.'`
- **`shuffleOrder.length === queue.length` must hold at every writer.** `normalizeShuffleOrder` before any index or splice; a "safe copy" helper copies on the no-op path too. grep: `grep -rn "shuffleOrder\[.*\]!" src --include='*.ts*' | grep -v '\.test\.'`
- **Restoring `currentTrack` without loading the engine is unplayable.** Server restore uses state-only `restoreQueue`; `resume()` treats a null `streamUrl` as an error.
- **A paging loop bounded only by the server is unbounded.** `fetchAllAlbums` throws on a repeated first id, caps offset at 500,000. grep: `grep -rn "while (true)\|while(true)" src --include='*.ts*' | grep -v '\.test\.'`
- **Clearing an in-memory cache on every refetch blanks what's on screen.** Cover/image maps keep loaded entries and drop only ids gone from the keyset. grep: `grep -rn "\.clear()" src --include='*.ts*' | grep -v '\.test\.'`
- **A cache table must not inherit a prune exemption meant for user rows.** `album_covers` was skipped beside identity tables and stranded forever. grep: `grep -n 'viaAlbums("\|DELETE FROM album' src/features/sync/syncPrune.ts`
- **Filter in SQL, not the loop body.** `useScrobbleFlush` read every server's queue and `continue`d past others forever.
- **Retrying a rejected write assumes it never landed.** Timestamp once per play; retry re-reads the row first.
- **Partial delete from an ordered table needs a renumber.** Pruned `playlist_tracks.position` gaps made the next removal hit the wrong track; `holedPlaylists` feeds both gates. grep: `grep -rn "playlist_tracks" src --include='*.ts*' | grep -v '\.test\.' | grep -v "playlist_id = ?\|playlist_id IN\|INSERT"`
- **Two failures suppressing the same write need the same report.** `skippedStages.push` sits beside the blocking flag. grep: `grep -n "skippedStages.push\|Blocked = true\|Incomplete = true" src/features/sync/sync.ts src/features/sync/syncLoved.ts src/features/sync/syncPlaylists.ts`
- **Interval-only progress never lands on the end.** One `reportProgress` gated on the actual work queue. grep: `grep -rn "% BATCH_NOTIFY_INTERVAL\|% NOTIFY_INTERVAL\|Count % " src --include='*.ts*' | grep -v '\.test\.'`
- **A cache-forever value is worthless if a second caller re-fetches it.** Pass the credential as a param instead of reopening the keychain. grep: `grep -rn 'keychain\.get\|invoke("get_credential"' src --include='*.ts*' | grep -v '\.test\.'`
- **`retry: false` for permanent failures also kills self-healing ones.** A locked-but-starting secret store at autostart is transient: retry ladder + **Try again**. grep: `grep -rn "retry: false" src --include='*.ts*' | grep -v '\.test\.'`
- **A skip fast-path freezes columns only that path writes, and is only as good as a probe of what it skips.** Navidrome 0.64 rewrote track ids under unchanged albums; `songExists` probes three mirrored ids, only a Subsonic 70 disables the skip.
- **A server-assigned id is a cache, not an identity.** `planTrackIdRemap` pairs by exact `file_path`; `remap_track_ids` carries every track-keyed row in one transaction before upsert and prune. Store the natural key beside the assigned one.
- **A rename escapes the prune, orphaning every mirror keyed by the old id.** `rebuildTracksFts` deletes by old id too. grep: `grep -rn "SET id = \|SET track_id = " src src-tauri/src | grep -v '\.test\.'`
- **Watermark upstream identity, not only per-row timestamps.** `server_version`/`last_scan_at`/`song_count` moving forces a full track pass; an unreadable `getScanStatus` is no evidence and falls through to the probe.
- **All-or-nothing progress never completes under a flaky transport.** `albums.tracks_read_scan` stamps each album with the identity it was read under, so a forced pass resumes.
- **"The user asked for this" is a parameter, not state a fallback can flatten.** Resync passes `forceTrackPass: true`. grep: `grep -rn "clearSyncWatermark\|forceTrackPass" src --include='*.ts*' | grep -v '\.test\.'`
- **Per-statement conflict handling decides per statement, not per record.** `UPDATE OR IGNORE` moved child rows onto a destination `tracks` refused; check `SELECT EXISTS` once per record first.
- **An error rebuilt from the message alone drops the code the caller branches on.** Login threw `new Error(message)`, so Subsonic code 40 could never read as "wrong password"; every envelope failure throws `SubsonicError`. grep: `grep -rn 'throw new Error(.*error?\.message' src --include='*.ts*' | grep -v '\.test\.'`
- **A code nobody reads outside the screen that caused it is silent everywhere else.** Only login checked 40, so a password rotated on the server failed every request behind a healthy server card; `checkEnvelope` records 40/44 per server for Settings. grep: `grep -rn 'status !== "ok"' src/clients --include='*.ts' | grep -v '\.test\.'`
- **Drain loops breaking on any error block on the first permanent failure.** Scrobble flush drops error 70, still breaks on 40/41/50.
- **An effect bailing on an unfilled ref never runs** when the target renders after a skeleton. Use readiness as a dep, or a callback ref (`useMeasuredElement`).
- **A local-only query must not gate on the network credential.** Gate `enabled` on the token only if `queryFn` uses it. grep: `grep -rn "serverWithCred.*\.server\.id\|serverWithCredential?.server.id" src --include='*.ts*' | grep -v '\.test\.'`
- **A repair effect invalidating its own trigger loops.** Mark the id attempted before repairing.
- **Re-keying a collection to ids means re-keying every cursor, anchor, count and gate.** grep: `grep -rn "useRef<number" src --include='*.tsx' | grep -v '\.test\.'`
- **A source that failed has not said "there is none".** `useLyrics` cached a miss as final when LRClib, lyrics.ovh or the server was unreachable; only a lookup every source answered records one. grep: `grep -rn "\.catch(() => null)" src --include='*.ts*' | grep -v '\.test\.'`
- **A "has a value" cache test can't cache "there is none".** `useLyrics` uses a `"cleared"` sentinel. grep: `grep -rn "if (cached\|if (rows\[0\]\|if (hit\|cached\.length > 0" src/hooks src/lib src/clients src/features --include='*.ts*' | grep -v '\.test\.'`
- **Inline `queryKey` means nothing else can invalidate it.** Use shared `QK.*`. grep: `grep -rn "queryKey: \[" src --include='*.ts*' | grep -v '\.test\.' | grep -v "QK\."`
- **A write updating one cached copy leaves others stale.** For each `UPDATE`, list every copy of the column: RQ keys and session stores (`albumBrowseSessionStore`). grep: `grep -rn "UPDATE \(albums\|artists\|tracks\) SET" src --include='*.ts*' | grep -v '\.test\.'`
- **A duplicated prefetch warms a key nobody reads.** Key, `queryFn`, `staleTime` shared from `nowPlayingQueries.ts`.
- **Bare columns under `GROUP BY` and `LIMIT` over ties pick arbitrarily.** Every `LIMIT` needs a total `ORDER BY` (tiebreak on id / `name COLLATE NOCASE`, every branch); use `ROW_NUMBER()` or `MIN()` over bare columns. grep: `grep -rn "GROUP BY" src-tauri/src --include='*.rs' | grep -v "COUNT(\|MIN(\|MAX(\|SUM("`
- **A computed number reaching a URL is a cache key.** `getCoverArtUrl` clamps `size` (finite, ≥1, integer) at the one writer.
- **External identifiers need normalized compares.** Last.fm names: `LOWER(TRIM(...))` both sides, ownership unions `artist_aliases`.
- **Every mirrored read is scoped by `server_id` from the row.** `purgeServerData` runs before the `servers` delete; id lookups carry `server_id` in WHERE and query key; `purgeStrandedServers` sweeps rows whose server is gone.
- **Process-wide state for a per-server fact answers for servers it never saw.** Key breaker state by server; exempt `ping.view` so Settings can re-test.
- **A counter fed by every request of one burst counts one event many times.** Ignore breaker re-opens inside its own cooldown.
- **A breaker refusal is not evidence about the record.** `TransportStalledError` stops the pass uncounted instead of feeding `CONSECUTIVE_FAILURE_LIMIT`. grep: `grep -rn "Failures++\|failed\w*++" src/lib src/clients src/hooks src/features --include='*.ts*' | grep -v '\.test\.'`
- **Global state holding server-scoped ids outlives the server.** `loadSettings` drops a `queue_state`/`radio_seed` snapshot naming a server not in `servers`.
- **A secret written before its owning row outlives the row.** Insert rolls back the keychain write; removal treats keyring `NoEntry` as done (`ignore_missing_entry`). grep: `grep -rn "keychain\.delete\|keychain\.get" src --include='*.ts*' | grep -v '\.test\.' | grep -v "catch"`
- **"Just finished" built from restore-shared state fires at startup.** `useRadio` needs a `hasPlayedRef` witness; start side effects in handlers.
- **A 2xx body is not the type you asked for.** Subsonic errors ride HTTP 200 JSON; `classify_stream_response` checks the body head on live, prefetch and gapless paths. A header is a claim. grep: `grep -rn "Decoder::new\|::load_from_memory\|image::load" src-tauri/src`
- **A stand-in for a missing measurement must be neutral, not the value that binds the limit.** Absent ReplayGain peak applies no cap. grep: `grep -rnE "Math\.(min|max)\([^)]*\?\?" src --include='*.ts*' | grep -v '\.test\.'`
- **An empty read and a broken button look the same.** Play paths use `loadAlbumTracksForPlay`, which fetches on a miss and reports failure; don't `void` it.
- **A fixed edit distance is a bigger share of a short key; file order is not a tiebreak.** `findFuzzy` allows `floor(min(len)/5)` capped at 2, ties by node id. grep: `grep -rn "levenshtein(\|similarity(" src --include='*.ts*' | grep -v '\.test\.'`
- **A lookup miss skipped with `continue` silently deletes user data.** Deleting a genre clears every `canonical_id` table; `resolveGenreTags` sends missing nodes to unmapped. grep: `grep -rn "byId.get(" src --include='*.ts*' -A1 | grep -v '\.test\.' | grep "continue\|if (node &&"`
- **A multi-statement write with invalid intermediate state is a transaction, and only real on one connection.** `tauri-plugin-sql` pools without affinity, so TS `BEGIN` is a no-op + deadlock; use `library_write/`. Only `migrations.ts` may `BEGIN` in TS. grep: `grep -rn '"BEGIN"\|BEGIN TRANSACTION' src --include='*.ts*' | grep -v '\.test\.'`
- **Version compares must also catch "too new".** `SchemaTooNewError` on `>` `LATEST_SCHEMA_VERSION`, no retry.
- **Recall and ranking must see the same query.** `toSearchTokens` feeds FTS and `scoreMatch`. grep: `grep -rn 'split(/\\s+/)\|replace(/"/g' src --include='*.ts*' | grep -v '\.test\.'`
- **A prefix the format lets repeat must be consumed as a run.** `parseLrc` emits one cue per timestamp in `[a][b]line`.
- **A non-`Option` Rust field over a nullable column fails the whole read on one row.** `collect::<Result<Vec<_>>>` turned one track with NULL `album_id` into an empty tracks view; filter in SQL or type it `Option`. grep: `grep -rnE "^\s+\w+: (String|i64|f64),$" src-tauri/src/library_read`
- **A field added to a type built in many places lands only where you looked.** ReplayGain reached 4 of ~15 `CurrentTrack` builders; album-grid, playlist, artist, radio and restored plays used the fallback gain. Shared `REPLAY_GAIN_COLUMNS` + `replayGainFromRow`. grep: `grep -rln "artworkRef:" src --include='*.ts*' | grep -v '\.test\.' | xargs grep -L replayGainFromRow`
- **Text `REPLACE` over a JSON column hits every string in it.** Parse, map, dedupe the id list (`genre_carry.rs`).

## UI / overlays / navigation

- **Window `keydown` shortcuts need per-branch focus guards.** Suspension comes from one shared `overlayAbove`; Alt+Arrow is exempt in text fields. grep: `grep -rn 'addEventListener("keydown"' src --include='*.ts*' | grep -v '\.test\.'`
- **An overlay's Escape must ask "am I on top", not "am I open".** Modals use `useModalChrome`'s registry (`useAnyModalOpen()`); menus/dropdowns must not register. grep: `grep -rln "createPortal" src --include='*.tsx' | grep -v '\.test\.' | xargs grep -Ln "useModalChrome"`
- **Backdrop `click` fires on a drag that only ended there.** `useOverlayDismiss` requires `mousedown` and release on the backdrop; never `stopPropagation`. grep: `grep -rn "onClick={(e) => e.stopPropagation()}" src --include='*.tsx' | grep -v '\.test\.'`
- **`Number(x) || fallback` deletes a legal zero.** Branch on `""` explicitly, then clamp. grep: `grep -rn "Number(.*)\s*||\|parseInt(.*)\s*||\|parseFloat(.*)\s*||" src --include='*.ts*' | grep -v '\.test\.'`
- **Non-URL overlay state is dismissed by navigation intent, urgently.** `useAppNavigation` runs `dismissOverlays` on every nav call, outside `startTransition`. grep: `grep -rn "useNavigate()\|useSearchParams()\|startTransition" src --include='*.ts*' | grep -v '\.test\.' | grep -v useAppNavigation`
- **Navigating to the page already showing pushes a duplicate entry.** `goTo` skips `navigate` when target equals `pathname`. grep: `grep -rn "navigate(" src --include='*.ts*' | grep -v '\.test\.' | grep -vE "navigate\((-?1|\+1)\)"`
- **`location.key === "default"` stops marking the first entry once it's replaced.** Track it off `useNavigationType()`. grep: `grep -rn "location\.key\|useNavigationType" src --include='*.ts*' | grep -v '\.test\.'`
- **A router value copied into `useState` never resyncs while mounted.** Resync during render against what the view last wrote (`lastWrittenRef`), not the param. grep: `grep -rnE "useState\((searchParams|params|query|pathname)" src --include='*.ts*' | grep -v '\.test\.'`
- **`null` for "don't know yet" and "isn't there" paints the same blank.** Name the pending state; `data ?? null` collapses it (waveform placeholder too).
- **A refetch with rows on screen is not loading.** `isLoading` means no rows for the current key. grep: `grep -rn "setIsLoading(true)\|setLoading(true)" src --include='*.ts*' | grep -v '\.test\.'`
- **A query keyed by what's playing blanks on each track change.** `placeholderData: keepPreviousData` where the old answer is still fair (not lyrics/tags). grep: `grep -rnE "use[A-Z][A-Za-z]*\((currentTrack|currentAlbumId|track)" src --include='*.tsx' | grep -v '\.test\.'`
- **A prerequisite gate is a state machine: pending vs failed vs absent.** Use `CredentialGate`/`CredentialNotice`. grep: `grep -rn "if (!serverWithCred\|if (!credential\|if (!server)\|if (!session" src --include='*.tsx' | grep -v '\.test\.'`
- **An error path that builds its own value can fail before reporting.** `new URL(baseUrl)` threw on the typo'd host it was reporting; `pingFailureMessage` reports the URL actually used. grep: `grep -rn "new URL(" src --include='*.ts*' | grep -v '\.test\.'`
- **Decoding an already-decoded router param crashes or mangles.** react-router decodes once; test via `src/lib/routes.router.test.tsx`. Literal `%2F` can't round-trip.
- **Partial opt-out of the `input, button` base rule keeps what it forgot.** `background: none; border: none` still inherits `base.css` box-shadow/radius. Open; fix via scoped base rule or shared `.btn-bare`.
- **A hit-area halo grown toward a neighbour steals its clicks.** Grow away from neighbours, else ≤ half the gap. grep: `grep -rn "inset: -" src --include='*.css'`
- **An overlay sized to a variably-shaped container breaks.** Animate the content directly instead of an `inset: 0` pseudo-element.
- **A grid cell that can render `null` hands its column to the next sibling.** With `display: contents`/subgrid, the row owns one wrapper per column. grep: `grep -rn "display: contents\|subgrid" src --include='*.css'`
- **An option's "selected" test must compare to that option.** Store which preset was chosen (`sleepTimerMinutes`), not just that one was.
- **Popup sub-mode state must die with the popup.** `TrackContextMenu` owns its mode. grep: `grep -rnE 'useState<"main"|[mM]enuMode' src --include='*.tsx' | grep -v '\.test\.'`
- **A flex item with a fixed basis narrower than its content overflows neighbours.** Not reproducible in jsdom. grep: `grep -rnE "flex: 0 0 [0-9]+px" src --include='*.css'`
- **An index sampled from one element per group misses what starts mid-group.** A-Z scrubber scans every album, jumps to the row.
- **TS geometry restating CSS drifts; layout constants applied by hand are invisible to the virtualizer.** Measure from the DOM; pass `paddingStart`/`paddingEnd`. grep: `grep -rn "virtualRow\.start\|virtualItem\.start\|getTotalSize()" src --include='*.tsx' | grep -v '\.test\.' | grep "[+-]"`
- **A slide transition on a polled value eases across seeks.** `useSeekBar`'s `isJump` drops it for backward or >1s steps. grep: `grep -rnE "transition:.*(transform|width).*linear" src --include='*.css'`

## Testing

- **Time it before theorising.** `pnpm test:run --testTimeout=60000 --reporter=verbose`; >1500ms owes an explanation. Timeout ceiling lives once in `vitest.config.ts` (`testTimeout: 15000`); reproduce load failures with every core saturated.
- **A large fake-time advance runs one iteration per live tick.** Set distant-timer state directly. grep: `grep -rn "advanceTimersByTime" src --include='*.ts*' | grep -E "60 \* 1000|3600|\* 60 \*"`
- **Fixture cost is paid per boundary unit; accessible-name queries scan the whole tree.** Strip fixtures to the field under test; prefer class selectors, pair absence assertions with a positive control.
- **A shared mock `Response` breaks on the second body read.** Use `mockImplementation(() => ...)`; a green test whose subject never ran is worse than none. grep: `grep -rn "mockResolvedValue(" src --include='*.test.ts*' | grep -iE "response|ok\(|httpStatus"`
- **Fixed sleeps pay the ceiling every run; a sleep inside a debounce window is a race.** Use `actUntil()`/`forkTestDb()` (`src/test/sqlite.ts`) and fake timers for in-window cases; in `App`-mount suites assert inside `act` and `vi.useRealTimers()` in `afterEach`. grep: `grep -rn "setTimeout(r\|setTimeout(resolve" src --include='*.test.ts*'`
- **A self-registered listener's state update isn't flushed by `act`.** Absence assertions need `waitFor`.
