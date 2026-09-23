---
description: Known async/lifecycle bugs already shipped once - full detail
globs:
  - "src/store/**"
  - "src/hooks/**"
  - "src/lib/**"
  - "src-tauri/**"
---

# Async / lifecycle

Bug classes that already shipped once. Heading = lesson. Greps kept, forensics in git.
Fixed unless marked OPEN.

- **Caller-id temp file is single-writer only if TS enforces it.** `waveformInFlight: Set<trackId>` in `playerRuntime.ts`. Also: `Err` without emit strands one-shot `listen()`.
- **Handler resuming post-await: check intent, not state.** `pauseRequestedDuringLoad`; track-id equality != intent.
- **Shared cancel token cancels intent, not effect.** Separate `pause_pending: AtomicBool`, checked before terminal action.
- **Fast path around central action skips its guards.** Gapless advance bypassed `next()`, killed sleep timer. Guard both ends.
- **Pause branch owes elapsed ticker the same stop.** Gapless end-of-track branch called `pause(0)` without `stopElapsedTimer()`, poll ran forever. Every `pause(0)` stops ticker same scope.
  ```
  grep -n "runtime.activeTarget.pause(0)" src/features/playback/store/*.ts
  ```
- **Fire-and-forget command owes event on every exit.** Gapless bail-outs emit `gapless-cancelled`; final `sink.append` checks `sink.empty()`.
- **Pre-scheduled work must carry its decision.** `gaplessEnqueued: {track, position, wrapOrder}`; `next()` passes `-1` for no anchor.
- **`await invoke()` loading flag = IPC round trip, not work.** Separate `isBuffering`, cleared by `audio-format` event. `thread::spawn` commands only honest via event.
- **Timeout cleared on first-phase settle doesn't bound the rest.** `fetchWithTimeout` cleared abort in `finally` around `fetch` alone; body read after headers had no timeout, could hang forever. Fix: abort spans buffered `res.text()` same `try`.
  ```
  grep -rn "AbortController" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **"Stream ended" vs "stream stopped" = different signals.** `fail()` (`UnexpectedEof`) vs `finish()`; `fail()` only if `play_id` matches.
- **Un-abortable promise: cleanup can't reach handlers it didn't create yet.** `useLibrarySync`'s `.then`/`.catch`/`.finally` had no mounted guard, wrote to dead state, armed unreachable timers. Fix: `mountedRef` gates all handlers, timer handles cleared on unmount, re-armed in effect body (StrictMode-safe).
  ```
  grep -rn "^\s*\.then(\|^\s*\.finally(" src/hooks src/ui src/features --include='*.ts*' | grep -v '\.test\.'
  ```
- **Resource acquired via await must escape its own cleanup.** `useWakeLock`: `cancelled` flag, resolved sentinel self-releases. Test `!released`, not non-null.
- **Router-owned callback in a deps array re-arms the listener it is named in.** react-router replaces `navigate` on every location change, so `useAppNavigation`'s Alt+Arrow/thumb-button effect listed `[navigate, dismiss]` and armed one extra window listener per navigation - invisible while search was an overlay, one per keypress once Ctrl+F became a route. Fix: `navigateRef`, deps `[dismiss]`. Same shape as the `dismissOverlays` ref beside it. Each hit below: fine for a handler, a defect if it arms a listener, timer or subscription.
  ```
  grep -rnE "^\s*\}, \[[^]]*(navigate|setSearchParams|searchParams|location)[^]]*\]\)" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Module-scoped promise memo assigned only on the success side stays poisoned.** `manualMappings.ts` cleared `inFlight` inside the resolved branch, so one rejected read handed the same rejection to every later caller and manual genre mappings silently stopped applying for the life of the process - reading as a mapping bug, not a db one. Fix: `try`/`catch` around the whole body, clearing under the same generation check the success path uses, then rethrow. `src/db/index.ts`'s `dbPromise` is the deliberate exception: a failed migration must not silently retry, and it surfaces on `DatabaseErrorScreen`.
  ```
  grep -rn "^let .*: Promise<\|^let .*Promise<.*> | null" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Guard keyed on one error type != the broad condition.** `apiPost` retried non-idempotent writes on unnamed errors; now `if (!retriable) break`. Unrecognised = unsafe.
  ```
  grep -rn "instanceof DOMException\|AbortError\|instanceof TypeError\|err\.name ===" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A result from the previous key is still visible to the commit that switches the key.** `useTracks` reset its rows with `setData(undefined)` inside the effect, so the render carrying the new album id, and every effect in that commit, still saw the old album's rows with `isLoading: false`. The album page's missing-tracks repair read an empty list from the previous album as the new album's and fetched tracks already mirrored. Its own fetch outcome had the same shape: one `fetching`/`error` pair shared by every album, so album A's late failure painted on album B. Fix: store the key beside the result and derive `current = result.key === key ? result : null` during render (`useTracks`, `usePlaylistTracks`, `useMissingTracksRepair`). A reset written in an effect is always one commit late.
  ```
  grep -rn "prev\w*IdRef.current !== " src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A mounted flag cleared only in cleanup is false for good under StrictMode.** `AlbumDetail`'s `useRef(true)` plus `useEffect(() => () => { ref.current = false })`: StrictMode's simulated unmount ran the cleanup and nothing set it back, so "Getting this album's tracks" never cleared in `pnpm tauri dev`. Setting it in the setup is the fix; not needing it (derive ownership from a key) is better. Test with `renderHook(..., { reactStrictMode: true })` - a `<StrictMode>` `wrapper` does not double-run effects there.
  ```
  grep -rn "useRef(true)" src --include='*.ts*' | grep -v '\.test\.'
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
- **A timer measures awake time; a deadline shown against `Date.now()` measures wall time.** The sleep timer displayed `sleepTimerEndsAt - Date.now()` but paused from one `setTimeout(preset)`, and GLib timers stop during suspend. After a laptop slept past the deadline the countdown read 0 while the music played on for the remaining *awake* minutes. Fix: a chained timeout of at most `SLEEP_TIMER_CHECK_MS` (15s) re-reads `Date.now()` and pauses once past `endsAt`. Ask of any long timer paired with a wall-clock number: which one does the user see, and which one acts?
  ```
  grep -rn "Date.now() +" src --include='*.ts*' | grep -v '\.test\.'
  ```
