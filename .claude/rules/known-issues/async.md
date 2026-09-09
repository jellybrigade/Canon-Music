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

- **Caller-id temp file is single-writer only if TS enforces it.** `waveformInFlight: Set<trackId>` in `player.ts`. Also: `Err` without emit strands one-shot `listen()`.
- **Handler resuming post-await: check intent, not state.** `pauseRequestedDuringLoad`; track-id equality != intent.
- **Shared cancel token cancels intent, not effect.** Separate `pause_pending: AtomicBool`, checked before terminal action.
- **Fast path around central action skips its guards.** Gapless advance bypassed `next()`, killed sleep timer. Guard both ends.
- **Pause branch owes elapsed ticker the same stop.** Gapless end-of-track branch called `pause(0)` without `stopElapsedTimer()`, poll ran forever. Every `pause(0)` stops ticker same scope.
  ```
  grep -n "activeTarget.pause(0)" src/store/player.ts
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
  grep -rn "^\s*\.then(\|^\s*\.finally(" src/hooks --include='*.ts*' | grep -v '\.test\.'
  ```
- **Resource acquired via await must escape its own cleanup.** `useWakeLock`: `cancelled` flag, resolved sentinel self-releases. Test `!released`, not non-null.
- **Guard keyed on one error type != the broad condition.** `apiPost` retried non-idempotent writes on unnamed errors; now `if (!retriable) break`. Unrecognised = unsafe.
  ```
  grep -rn "instanceof DOMException\|AbortError\|instanceof TypeError\|err\.name ===" src --include='*.ts*' | grep -v '\.test\.'
  ```
