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

## Async / lifecycle

- **A temp file named after a caller id is single-writer only if TS makes it so.** `waveformInFlight: Set<trackId>` in `player.ts`. Also: a command that `Err`s without emitting strands one-shot `listen()`s.
- **A handler resuming post-await must check intent, not assert state.** `pauseRequestedDuringLoad`; track-id equality is not intent.
- **One cancel token shared by several commands cancels intent, not effect.** Separate `pause_pending: AtomicBool` checked before the terminal action. Ask what each task does *after* its loop.
- **A fast path around the central action skips every guard that action owns.** Gapless advance bypassed `next()`, killing the sleep timer. Guard both ends.
- **A fire-and-forget command owes an event on every terminal path.** Every gapless bail-out emits `gapless-cancelled`; final `sink.append` also checks `sink.empty()`.
- **Work scheduled ahead of time must carry what it decided.** `gaplessEnqueued: {track, position, wrapOrder}`; `next()` passes `-1` for no anchor.
- **A loading flag from `await invoke()` measures the IPC round trip, not the work.** Separate `isBuffering`, cleared by the `audio-format` event. A command ending in `thread::spawn` can only be honest via an event.
- **"Stream ended" and "stream stopped" are different signals.** `fail()` (reader returns `UnexpectedEof`) vs `finish()`; `fail()` only if `play_id` still matches.
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
- **A skip fast-path freezes every column only the skipped path writes.** `tracks.play_count` froze while `albums.play_count` moved. When a sync gains a skip, list what that path solely writes.
- **A drain loop that breaks on any error blocks on its first permanent failure.** `useScrobbleFlush` drops Subsonic error 70, still breaks on auth 40/41/50; `flushing` flag stops a slow pass overlapping the 60s tick.
- **An effect that bails on a ref the first render did not fill never runs at all, because nothing in its deps says the element arrived.** `useScrollMemory`'s save half depended on `[ref, key]` and returned early on a null `ref.current`; `ArtistGrid` renders its error, skeleton and empty branches *before* the scroller, so on a cold start the element did not exist yet, the scroll listener was never attached, no offset was ever recorded, and the restore could only ever be a no-op. `ready` is now a dep of both halves. The same grep found two more, both measuring: `ArtistGrid`'s own `useLayoutEffect(..., [])` never saw its scroller, so `containerWidth` stayed 0 and the whole artists page painted as one 190px column on any cold start; `TagReviewTab` never measured its list and fell back to a fixed page size. Both now use `useMeasuredElement`, whose callback ref has no deps to get wrong. Any effect reading a conditionally-rendered ref owes its deps the condition that renders it, or a callback ref (which fires on attach, whenever that is).
  ```
  grep -rn -B1 "if (!el) return\|if (!container) return" src/components src/hooks --include='*.ts*' | grep -v '\.test\.' | grep "Ref\.current\|ref\.current"
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
- **State deciding which subtree renders, but absent from the URL, must be dismissed by navigation itself** - and a mechanism built for one overlay leaves every other on the old per-handler pattern. `useDismissOnNavigate(pathname, dismissOverlays)` in `App.tsx`; add an overlay by composing into that callback. **OPEN:** it fires on a pathname *change*, so a palette item resolving to the current route still strands the search overlay.
  ```
  grep -n "useState(false)" src/App.tsx
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
