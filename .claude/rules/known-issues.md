# Known Issues & Platform Gotchas

Bugs + non-obvious behaviors worth remember — not conventions (see `coding-standards.md` for those).

## WebKitGTK closes left-click-opened menus on their own opening click

`ContextMenu` (`src/components/ContextMenu.tsx`) closes on outside interaction via document listener added in `useEffect`. On Linux/WebKitGTK, listener can attach fast enough to still catch tail of *same* click that opened menu — closes it instantly, before ever visibly render.

Only affects menus opened via `onClick` (left click). Menus opened via `onContextMenu` (right click) unaffected — different event type.

**Symptom:** button's `onClick` fires, state update, `ContextMenu` even run render function — but `document.querySelector('.context-menu')` come back empty. Look like "button does nothing."

**Fix already applied:** outside-close listener deferred with `setTimeout(..., 0)` so can't catch opening click. Listener itself (as of 2026-07-05) uses `mousedown` (capture) + containment check (`!menuRef.current.contains(e.target)`) rather than `click` + unconditional close — ported from ampcast's `PopupMenu.tsx`. Closing only on true outside pointer-down means item selection can't be eaten by a close-before-click race.

**If new left-click popover "does nothing":** don't assume fresh bug. Confirm with `console.log` in popover's render body plus `document.querySelectorAll(...)` right after — if render fire but DOM query come back empty, same class of bug.

## WebKitGTK freeze/thaw compositor crash kills whole app on window focus loss/regain

Dev and prod builds on Linux can crash entirely with:
```
Gdk-CRITICAL **: gdk_window_thaw_toplevel_updates: assertion 'window->update_and_descendants_freeze_count > 0' failed
ERROR: WebKit encountered an internal error. This is a WebKit bug.
Source/WebKit/WebProcess/Network/WebLoaderStrategy.cpp(641) : void WebKit::WebLoaderStrategy::internallyFailedLoadTimerFired()
```
or a JavaScriptCore VM trap (`received NeedDebuggerBreak trap`) on the WebProcess.

**Trigger:** any window focus-loss-then-regain — i3 workspace switching, WM focus resets, or simply opening/clicking into WebKit devtools and back into the app window. No rapid switching needed, a single toggle reproduces it.

**Why:** upstream WebKitGTK/GTK3 bug — the freeze/thaw counter around GPU-accelerated compositing races on unmap/remap, corrupting WebProcess state and killing it (crashed process brings the whole app down since `wry` doesn't handle a WebProcess death gracefully — see `web-process-terminated` hook below). Not caused by anything in Canon's own hide/show logic.

**Only known full workaround:** `settings.set_hardware_acceleration_policy(HardwareAccelerationPolicy::Never)` in `src-tauri/src/lib.rs` disables WebKitGTK GPU compositing entirely, avoiding the race at the source — but this also disables trackpad/touchpad wheel scroll app-wide (only scrollbar-drag scroll still works). Currently NOT applied because of that tradeoff. Don't re-enable it without confirming trackpad scroll is acceptable to lose, or without a narrower fix.

**Mitigations applied (2026-07-16, ported from reference project psysonic):** two additive, lower-risk attempts, neither previously tried in Canon (only `Never` was ever tried, reverted in `d86c373` for breaking trackpad scroll — `OnDemand` never appears anywhere in Canon's git history before this):
- `HardwareAccelerationPolicy::OnDemand` set at webview setup (Linux only, `lib.rs`) instead of leaving policy unset. Psysonic defaults to this specifically because its own code confirms `Never` is what breaks wheel scroll, while `OnDemand` still reduces GPU compositor churn without that cost.
- `useAppActivityTracking` hook (`src/hooks/useAppActivityTracking.ts`) stamps `data-app-blurred` on `<html>` on window blur/focus; `App.css` pauses all CSS animations (`animation-play-state: paused`) while that attribute is set. Reduces compositor load exactly at focus-loss/regain, the trigger condition above.

Neither is a confirmed fix (upstream race is still there) — they reduce the odds of triggering it. The `web-process-terminated` → `.reload()` mitigation below stays as the safety net regardless.

**Mitigation applied instead:** `lib.rs` `.setup()` connects to `webkit2gtk::WebView`'s `web-process-terminated` signal (via `WebviewWindow::with_webview`, Linux only) and calls `.reload()` on the view instead of letting the process die. This does not fix the underlying race — it just turns a full app crash into a page reload when the WebProcess does die.

**If debugging a Linux-only crash matching this signature:** don't re-diagnose from scratch. This is the root cause, confirmed repeatedly via direct `pnpm tauri dev 2>&1 | tee <file>` terminal capture (journalctl is an unreliable secondary source — it only captures what gets forwarded to it, and timestamps can be misleading if there were multiple recent crashes). Go straight to checking whether a newer WebKitGTK/GTK version has fixed the upstream bug before spending time re-investigating.

**Note (2026-07-07):** this bug was re-reproduced (assertion fired) via i3 stress testing but stayed non-fatal that time (no WebProcess death, no reload fired) — inconclusive whether it's still exploitable on current webkit2gtk, or whether the existing `web-process-terminated` mitigation is masking it. Don't assume every unexplained crash is this one — see the separate thread-storm crash below, which turned out to be the actual cause of a "gets laggier then vanishes" report initially suspected to be this bug.

**2026-07-17: `OnDemand` mitigation reverted — conflicted with `WEBKIT_DISABLE_COMPOSITING_MODE` and crashed on every single launch.** The `OnDemand` mitigation from 2026-07-16 above (never released, sat unmerged on `development`) turned the assertion from an occasional focus-toggle issue into a deterministic startup crash, plus audible ALSA underrun (choppy/robotic audio) right before the process died. Root cause: `lib.rs` already sets `WEBKIT_DISABLE_COMPOSITING_MODE=1` as an env var before the webview is even created (the older, still-active mitigation from `21af58e`/`16a0c07`) — then `.setup()` immediately called `settings.set_hardware_acceleration_policy(HardwareAccelerationPolicy::OnDemand)` on that same webview, flipping compositing back on right as the window became visible. That policy flip, not the hide/show-after-first-paint reveal (`cde9841`, also suspected and also reverted), was the actual trigger. Only `OnDemand` was reverted — the `useAppActivityTracking` blur-pause mitigation stays live (see its entry above), alongside the `web-process-terminated` → `.reload()` safety net. **If re-attempting `OnDemand` (or any explicit `hardware_acceleration_policy` call) in the future: first remove/reconcile the `WEBKIT_DISABLE_COMPOSITING_MODE` env var — don't set both.**

**2026-07-17: show-after-first-paint deliberately re-applied — this is `cde9841` brought back on purpose, do not "re-revert" it.** `tauri.conf.json` sets `"visible": false` on the main window; `.on_page_load()` in `lib.rs` calls `window.show()`, with a 5s fallback thread in `.setup()` in case the frontend never loads (JS bundle error, dead dev server) and `on_page_load` never fires.

Without this, Canon has no `visible` key at all, so WebKitGTK maps an unpainted webview immediately at window creation — a known startup-crash/white-flash trigger and the biggest structural gap against `reference-projects/psysonic`, which sets `"visible": false` and reveals on `PageLoadEvent`.

**Why re-applying a reverted commit is not a mistake here:** the 2026-07-17 entry above establishes that the `OnDemand` policy flip, *not* `cde9841`, was the deterministic-startup-crash trigger. `cde9841` was reverted as collateral in the same sweep while both were suspects, never because it was shown to cause anything. Re-landing it alone, with no `hardware_acceleration_policy` call anywhere (and `WEBKIT_DISABLE_COMPOSITING_MODE=1` left untouched), avoids the collision that actually broke things.

Difference from `cde9841`: the reveal now happens in Rust from `on_page_load` instead of from `src/main.tsx` via a double-`requestAnimationFrame`. Both map the window exactly once and never unmap it — the freeze/thaw race needs an unmap/remap cycle, and neither has one. `on_page_load` re-fires on reload (including the `web-process-terminated` → `.reload()` recovery above), which is harmless: there is deliberately no `hide()` on that path, and `show()` on a visible window is a no-op.

`WEBKIT_DISABLE_COMPOSITING_MODE=1` stays set and unchanged by this — no `hardware_acceleration_policy` call was added, so the collision documented above is still not live.

**2026-07-17 (later): `WEBKIT_DISABLE_COMPOSITING_MODE=1` removed — replaced with targeted `webkit2gtk-nvidia-quirk`.** The blanket env var forced CPU software rendering on *every* Linux machine, making all scrolling/clicking/painting sluggish app-wide — including on Intel/AMD GPUs where WebKitGTK compositing is stable (confirmed by psysonic running the same stack on the same Intel Iris Xe machine with compositing on, no crashes, no lag). Replaced in `lib.rs` with the same approach psysonic uses: `webkit2gtk-nvidia-quirk = "1.3"` applies `WEBKIT_DISABLE_DMABUF_RENDERER` / `__NV_DISABLE_EXPLICIT_SYNC` only when an NVIDIA setup that needs it is detected; no-op elsewhere. `CANON_WEBKIT_GPU_ACCEL=1` skips even the quirk. The `web-process-terminated` → `.reload()` safety net stays. Note the OnDemand-collision warning above is now moot in one direction (env var gone) but still applies in spirit: don't add `hardware_acceleration_policy` calls without checking what else touches compositing. If NVIDIA-machine crash reports come in, the quirk crate is the right place to look first — not re-adding the blanket env var.

## ALSA underrun (choppy/robotic audio) under CPU/compositor load (mitigated 2026-07-17)

`ALSA: underrun occurred` / audible glitching during playback when the machine is under load (heavy git/CPU, a WebProcess spike, a decode+download thread burst). rodio 0.19's `OutputStream::try_default()` (`src-tauri/src/lib.rs`) uses cpal's default ALSA buffer, which is small enough that the realtime audio callback misses its deadline when the CPU is saturated. rodio 0.19 exposes no buffer/period knob through `try_default` (only rodio 0.20+'s `OutputStreamBuilder` does), so this isn't fixable in-engine without a version bump + cpal patch (psysonic runs rodio 0.22 + a patched cpal 0.15.3).

**NOT the same as the OnDemand-compositing ALSA underrun** documented in the 2026-07-17 `OnDemand` entry above — that one was a deterministic startup crash from a compositing-policy collision, already reverted. This one is transient, load-dependent, mid-playback.

**Mitigation applied:** set `PULSE_LATENCY_MSEC=60` early in `run()` (Linux only, only if the user hasn't already set it). Most modern Linux desktops route ALSA through PipeWire/PulseAudio, which honors this to enlarge the client buffer and give the callback more headroom. No-op on a pure-ALSA setup. This reduces the odds under load; it is not a hard fix — the real fix is the rodio version bump + non-blocking source, deferred as too invasive. If underruns persist, the next lever is bumping rodio to get `OutputStreamBuilder` and requesting a larger `BufferSize` explicitly.

## Read-only rusqlite connection can't own WAL `-shm` (fixed 2026-07-17)

`src-tauri/src/library_read.rs` `open_read_conn` opened `canon.db` with `OpenFlags::SQLITE_OPEN_READ_ONLY`. `canon.db` is WAL mode (`src/db/migrations.ts`), and a READ_ONLY connection cannot create or recover the `-wal`/`-shm` shared-memory files — it can only attach to ones a writer already established. Canon runs two engines against one file (the `tauri-plugin-sql`/sqlx writer pool plus this rusqlite reader), so depending on launch ordering the reader could open before the writer pool had created `-shm`, failing every query with `SQLITE_READONLY` or "unable to open database file".

**Fix:** opened `SQLITE_OPEN_READ_WRITE | NO_MUTEX | URI` instead. Still only ever runs SELECTs — READ_WRITE is about being allowed to participate in WAL, not about issuing writes. `SQLITE_OPEN_CREATE` deliberately omitted so a missing or misresolved path errors loudly instead of silently creating an empty db that shadows the real one.

**Note this was never the "silent vanish" crash** — it surfaces as a query error, not a process death. Don't credit it if the vanish stops.

## Unbounded thread-per-request in cover art proxy caused SIGKILL crash

Cover art proxy server (`src-tauri/src/lib.rs`, `cover-server` thread) spawned one new OS thread per incoming HTTP request with no concurrency cap. Rapid sidebar view-switching (artist → library → tracks → tags → artist...) fires a burst of cover-art fetches for every view's album grid, each getting its own thread.

**Symptom:** progressive UI lag during rapid navigation, then the whole app vanishes. No coredump, no Rust panic, no kernel OOM entry, no `systemd-oomd`/cgroup kill logged — looks like nothing happened.

**Root cause, confirmed via `gdb -p <pid>` attach (bypass `ptrace_scope` by launching under `gdb --args` instead of attaching to an already-running process):** `Program terminated with signal SIGKILL, Killed.` — uncatchable, explains the total absence of any trace. Log immediately before death shows dozens of threads spawned/destroyed in rapid succession, timed exactly with the rapid-navigation clicks. Exact external killer was never identified (ruled out kernel OOM, systemd-oomd, cgroup `pids`/`memory` limits, earlyoom-style daemons) — doesn't matter, the unbounded thread-spawn is a confirmed bug independent of whatever finally pulled the trigger.

**Fix applied:** `ThreadSemaphore` (`Mutex<usize>` + `Condvar`, no new deps) caps concurrent cover/artist-image request handling at 16. Permit acquired in the accept loop *before* spawning, so the accept loop backpressures instead of piling up work; `SemaphoreGuard` (RAII, `Drop` releases) moved into each spawned closure so every early `return` in the request handler auto-frees its slot.

**Follow-up (2026-07-14):** per-request handling switched from `std::thread::spawn` to `tauri::async_runtime::spawn_blocking` — same 16-permit cap, but requests now run on tokio's reused blocking-thread pool instead of a freshly created/destroyed OS thread each time. No behavior change, lower per-request overhead.

**If debugging a "gets laggier then vanishes" or unexplained SIGKILL on Linux:** check for thread-storm first (`ps -eLf | grep canon | wc -l` during repro, or watch thread count climb) before assuming it's the WebKitGTK freeze/thaw bug above — different signature, different fix.
## `fetch()` fails with opaque "Load failed" after exactly ~25s when a stale resolver entry is configured (diagnosed 2026-07-28)

Sync dies with `Error: Load failed` (WebKit's generic `TypeError` for a rejected `fetch()`). Instrumentation showed every in-flight request stalling **exactly ~25s** then failing together, `navigator.onLine === true`, while `curl` did 5 parallel POSTs to the same server in 0.45s.

**Root cause was outside Canon:** `/etc/systemd/resolved.conf.d/vpn-anexia.conf` pinned corporate VPN nameservers (`DNS=10.61.242.1 10.61.242.2`) into systemd-resolved's **global** scope unconditionally. Off VPN those servers are unreachable, so resolved kept flapping its feature set on them (`Using degraded feature set UDP instead of TCP for DNS server 10.61.242.1.` every 5-15s in `journalctl -u systemd-resolved`), and any name not already cached took tens of seconds to resolve. Measured on the affected machine: `getent hosts <server-host>` 10.02s, `getent hosts wpad` 20.02s, while `resolvectl query <same host>` answered in 2.1ms marked `Data from: cache`.

**Why it looked like a Canon bug:**
- All concurrent requests fail at the same instant because they all block on the *same* host resolution, not on each other. Request concurrency is a red herring; a single sequential request fails identically.
- `curl` tests always looked fine because they hit resolved's cache (`time_namelookup=0.006`), so they never paid for a resolution.
- Intermittent by cache TTL: a cold-cache sync fails, a sync a few minutes later completes in 3s.
- `online=true` throughout, since routing and sockets are fine. Only name lookup is broken.

**Host-side fix:** make the VPN drop-in routing-only (`Domains=~anx.local ~anexia.com`), so the global scope stops being a default route and only corporate suffixes consult those servers. Better still, write/remove the drop-in from the VPN up/down script instead of leaving it permanent.

**If a Linux-only "Load failed" / uniform-timeout network report comes in, check DNS before reading Canon's network code:**
```bash
journalctl -u systemd-resolved --since "-1h" | grep -i "degraded\|timed out"
resolvectl status | head -20              # look for unreachable servers in the Global scope
sudo resolvectl flush-caches && time getent ahosts <server-host>
```

**Canon-side hardening applied in the same pass (`src/lib/navidrome.ts`, `src/lib/sync.ts`):** `apiPost` now caps each attempt at 12s via an `AbortController` (not `AbortSignal.timeout`, which is missing on older WebKitGTK), retries up to 3 attempts with exponential backoff, tries the alt URL on every attempt rather than only the first, and throws a named error (`getAlbumList2 failed after 3 attempts: timed out after 12000ms`) instead of propagating an opaque `Load failed`. `syncLibrary` treats the loved (`getStarred2`) and playlist stages as non-fatal, since albums and tracks are already committed by then; a failed fetch there leaves the stored rows untouched, reports the stage via the new `skippedStages` return field, and the album-track pass gives up after 5 consecutive failures rather than burning the retry budget once per remaining album. This does not fix a broken resolver, it just keeps one from destroying a whole sync.

## Rust helpers keyed by a shared temp path need an in-flight guard on the TS side (fixed 2026-08-01)

`audio_extract_waveform` (`src-tauri/src/lib.rs`) writes every download to `std::env::temp_dir()/canon_wf_<track_id>.tmp`. The path is derived purely from the track id, so two concurrent invocations for the same track both `File::create` (truncating) and `io::copy` into one file. The analysis then reads interleaved bytes and produces a garbage waveform, which gets cached in `waveform_cache` and looks like a persistent per-track defect rather than a race.

This was reachable on the normal play path: `preloadWaveforms` extracts the next two queue entries, and `fetchWaveform` extracts the current one, so a preloaded track that becomes current before its extraction finishes got extracted twice at once. The tell was already in the code as a workaround, `fetchWaveform`'s "less than 50% of bars have meaningful data, the cache entry is corrupt" check.

**Fix:** module-level `waveformInFlight: Set<trackId>` in `src/store/player.ts`. A second caller for the same id skips the invoke entirely and just attaches to the running extraction's `waveform_chunk`/`waveform_complete` events, which are broadcast, so it still gets its display update for free and the track is downloaded once instead of twice. The marker is cleared on `waveform_complete` and on invoke rejection.

**Generalizes:** any Rust command that names a temp file, cache slot, or lock file after a caller-supplied id is only single-writer if the TypeScript side makes it so. Either guard the id in TS or make the Rust path unique per invocation. Also note the related listener rule: a Tauri command that returns `Err` without emitting its completion event will strand any one-shot `listen()` registered for that event. Prefer one long-lived listener keyed by payload id over one listener per request.

## An async load handler that sets terminal state discards input received during the load (fixed 2026-08-01)

`playTrack` in `src/store/player.ts` awaited `activeTarget.load()` and then ran `set({ isPlaying: true, isLoading: false })`, guarded only by a check that the current track id had not changed. Any transport input arriving inside that await window was silently overwritten. Pausing during load (reachable from the space bar and OS media keys, both of which skip the `disabled={isLoading}` guard the on-screen buttons have) left the engine paused while the store claimed to be playing, with the position frozen at 0. Nothing recovered it: the stall watchdog requires `hasAdvanced`, which never becomes true at position 0.

**Fix:** module-level `pauseRequestedDuringLoad` flag, cleared at the start of `playTrack` and on `stop()`/`resume()`, checked by the completion handler, which re-applies the pause against the sink that now exists rather than asserting `isPlaying: true`.

**Generalizes:** a track-id equality check is not a substitute for intent. Whenever a handler resumes after an await and writes state the user can also write, ask what happens if they wrote to it mid-flight. Related trap in the same file: `resume()` used to set `isPlaying: true` with no `currentTrack` guard, so an MPRIS play after the queue emptied started a 200ms elapsed ticker against silence forever.

## One cancellation counter shared by several commands cancels intent, not just the effect (fixed 2026-08-01)

`AudioState.fade_gen` (`src-tauri/src/lib.rs`) is a generation counter bumped by `audio_pause`, `audio_resume`, `audio_seek` and `audio_volume`; every spawned fade thread exits early once it sees a generation other than its own. That is correct for the volume ramp, which genuinely is superseded. It was wrong for the *action at the end of the ramp*: `audio_pause`'s thread called `sink.pause()` only after re-checking the generation, so any unrelated bump skipped the pause entirely.

**Symptom:** hit pause, then click the progress bar within the 150ms fade. The store shows paused, the pause button shows a play icon, and the audio keeps playing. Same shape as the "phantom play" bugs already fixed on the load path, but reached through seek instead.

**Fix:** a separate `pause_pending: AtomicBool` carries the *intent*, set by `audio_pause` and cleared by `audio_resume` / `audio_play` / `audio_stop`. The fade thread `break`s out of the ramp on a generation change but still consults `pause_pending` before its terminal `sink.pause()`.

Two related seek bugs fixed in the same pass:
- `audio_seek` set `pos.play_start = Some(Instant::now())` unconditionally, so seeking while paused restarted `PosTracker`'s wall clock and the reported position climbed in real time against silent audio. It now only re-arms `play_start` when it was already `Some`. The frontend's natural-end fallback in `src/store/player.ts` had no `isPlaying` guard, so that phantom position eventually skipped the user to the next track while paused; it now requires `isPlaying`.
- `seek()` in `src/store/player.ts` wrote `elapsed`, but a `getPosition()` poll issued by the 200ms ticker just before the seek resolved just after it and wrote the pre-seek position back, making the bar visibly jump backwards for one tick. A module-level `seekGen` is sampled before each poll; a tick whose generation changed is dropped whole.

**Generalizes:** when several commands share one cancellation token, check what each spawned task does *after* its loop. Cancelling "the work in progress" and cancelling "the outcome the user asked for" are different things, and a single counter cannot distinguish them. Same question as the `pauseRequestedDuringLoad` entry above, one level lower: state written after an await must be checked against intent, not just against whether something else happened.

## A fast path that bypasses the central action function bypasses every guard that function owns (fixed 2026-08-01)

Gapless playback advances the track without ever calling `next()` in `src/store/player.ts`: the Rust engine appends the next source to the same sink, and the `track-advanced` listener updates queue state in place. Every guard that lives inside `next()` is therefore skipped on the gapless path. The end-of-track sleep timer lived inside `next()`, so with gapless on (the default), "stop after this track" silently did nothing at all. Not a subtle failure, the whole feature was dead on the default path.

**Fix:** the guard now sits at both ends. The elapsed ticker refuses to call `audio_enqueue_next`/`setNext` while `sleepTimerEndOfTrack` is set, so the hand-off never gets set up; and the `track-advanced` handler pauses on arrival, for the case where the timer was armed after the enqueue had already gone out.

**Generalizes:** whenever an optimisation introduces a second route to the same outcome, enumerate what the original route did besides the obvious thing. `next()` also handles repeat-one, consume mode and shuffle re-seeding; those happened to be excluded from gapless deliberately (`canGapless` checks them), which is what makes the missing sleep-timer check an oversight rather than a design gap. A `canGapless`-style predicate is the right place for this class of condition, not a check buried in the slow path.

## A suppression flag set optimistically by TS must have a cancellation event, not just a success event (fixed 2026-08-01)

`gaplessActive` in `src/store/player.ts` is set the moment `audio_enqueue_next` is invoked, and suppresses the ticker's position-based fallback advance so it can't interrupt a gapless transition. It was cleared only by `track-advanced` (success) or the next `playTrack`. But `audio_enqueue_next` returns `Ok` immediately and does its work on a spawned thread with three silent bail-out paths: fetch error, decode error, and a superseded `play_id`. On any of those, TS never learned, `gaplessActive` stayed true, and the fallback stayed disabled. Self-healing only via `track-ended`, which is exactly the event the fallback exists to cover, so the double failure stops playback dead.

**Fix:** every bail-out path emits `gapless-cancelled`; a listener in `player.ts` clears the flag.

A second bug in the same command: the final `sink.append(source)` was guarded by `play_id` alone. If the download outlasted the current track, the watcher had already seen `sink.empty()` and emitted `track-ended`, but `play_id` is not bumped until the frontend's `audio_play` completes an IPC round trip. In that window the append fired on the empty sink, which starts playback immediately, producing an audible blip of the wrong track start before `audio_play`'s `old.stop()` killed it. It now checks `sink.empty()` before appending.

**Generalizes:** a fire-and-forget Tauri command that returns `Ok` before doing its work owes the frontend an event on *every* terminal path, not just the happy one. And `play_id`-style generation guards only prove no newer request has *started*, never that the older one is still wanted.

## A hand-off decided ahead of time must carry what it decided, not just that it happened (fixed 2026-08-01)

The gapless hand-off is committed up to a fifth of a track before it is heard: the elapsed ticker resolves `queueIndex + 1` at 80% and hands that URL to `audio_enqueue_next`, which appends it to the live sink. `track-advanced` then recomputed `queueIndex + 1` a second time, against the queue as it stood *at the transition*.

Everything the user can do to the queue in that window breaks the second computation. "Play next" inserts at `queueIndex + 1`, so the store showed, scrobbled, fetched lyrics and extracted a waveform for the newly inserted track while the previously enqueued one was audibly playing, then played that one again on the following advance. Reorder and remove do the same thing. Worse, shuffle plus repeat-all needed no user action at all: the handler built a *fresh* shuffle order and displayed position 0 of it, while the engine had started whatever position 0 of the order being replaced pointed at, so the wrap mismatched every single time.

**Fix:** a module-level `gaplessEnqueued: { track, position }` records what was actually handed to the engine. `track-advanced` follows that track to wherever the queue holds it now, falls back to a scan, and only then to `queueIndex + 1`; the repeat-all re-shuffle anchors on it instead of `queue[0]`.

**Note rodio cannot un-append.** Once `sink.append` has run there is no cancel, and `audio_enqueue_next` drops a second call because `gapless_queued` is already claimed. So the record is written once per transition and deliberately never overwritten - re-recording on a queue edit would name a track the engine never received, which is the exact mismatch the record exists to prevent. This also means "play next" during the lead window still does not actually play next; only the display was made honest.

**Generalizes:** the same shape as the `pauseRequestedDuringLoad` and `pause_pending` entries above, one step further out. Those ask what happens when state is written during an await. This one asks what happens when a *decision* is committed to another process early and the inputs to that decision keep moving. Whenever work is scheduled ahead of the moment it takes effect, the completion handler must be told what was scheduled, not left to re-derive it.

A second guard in the same family: a "already did the hand-off for this track" flag keyed only on the current index never notices that the *successor* changed. Canon's ticker now keys it on `queueIndex` plus a `queueRevision` counter bumped by every queue mutation, so an edit re-arms the DLNA `setNext` instead of locking it out for the rest of the track.

## A loading flag derived from awaiting a fire-and-forget `invoke()` measures the IPC round trip, not the work (fixed 2026-08-01)

`playTrack` in `src/store/player.ts` set `isLoading: true`, awaited `activeTarget.load()`, then cleared it. On the local target that await is `invoke("audio_play")`, and `audio_play` (`src-tauri/src/lib.rs`) spawns its download/decode thread and returns `Ok(())` immediately. So the flag lived for a few milliseconds of IPC while the entire user-visible wait - HTTP connect, first bytes, `Decoder::new` blocking on a Condvar until it has enough to probe the format - happened after it had already cleared.

**Symptom:** the loading spinner on the play button is a sub-frame flash nobody ever sees, and during the actual buffering the UI asserts the opposite of the truth: pause icon showing, `0:00`, static progress bar, silence. Easy to read as "the app is slow" rather than "the app has no buffering state". The same store already documented the consequence elsewhere without connecting it: the stall watchdog cannot arm during buffering because the position stays at 0.

**Fix:** a separate `isBuffering` flag spanning "playback asked for, no sound yet", cleared by the `audio-format` event (Rust emits it immediately after `sink.append(source)`, which is the real start of audio) with the elapsed ticker's first non-zero position as a backstop. Deliberately not merged into `isLoading`, which gates `disabled` on the transport buttons - widening it would have made pause unclickable for the length of a slow buffer.

**Generalizes:** before deriving user-visible state from `await invoke(...)`, check what the Rust side does at the end of the command. If it ends in `thread::spawn` or `spawn_blocking`, the promise resolves at hand-off, not at completion, and the only honest completion signal is an event. The same rule that makes such a command owe the frontend an event on every terminal path (see the `gapless-cancelled` entry above) makes it owe one on the success path too, and Canon's `audio-format` already was that event - it was just being used only to populate a codec label.

A related trap in the same fix: work kicked off from a load handler competes with the load. `preloadWaveforms()` ran from `playTrack`'s completion and starts up to two more full track downloads (`audio_extract_waveform`) against the same server as the audio still being fetched. Gate background prefetch on the foreground work being *audible*, not on it having been *requested*.

## A stream that ends early is indistinguishable from one that ended (fixed 2026-08-01)

`audio_play`'s download thread (`src-tauri/src/lib.rs`) ended its read loop with `writer.finish()` on every exit path, including `Err(_) => break` on a mid-body read failure. `finish()` sets `finished` on the streaming buffer, which makes the reader return `Ok(0)`: a clean EOF. The decoder therefore saw a well-formed short file, the source ended normally, the sink emptied, the watcher emitted `track-ended`, and the frontend advanced to the next track. A server dying halfway through a song looked exactly like a song that had played to its end - no error, no retry, no log, just a track that was quietly shorter than it should have been.

**Fix:** the writers gained `fail()` alongside `finish()`, setting a `failed` flag; the reader serves the bytes that did arrive (so the user hears what downloaded) and then returns `UnexpectedEof` instead of `Ok(0)`. The download thread only calls it when `play_id` still matches, because a skip or a stop bumps `play_id` and exits the same loop, and cancellation is not a failure.

Two adjacent holes in the same command, same pass. `reqwest`'s `send()` returns `Ok` for a 404 or a 500, and nothing checked `response.status()`, so an error page body streamed into `Decoder::new` and surfaced seconds later as an unrelated "unrecognised format" message - after the frontend's retry ladder had spent four attempts and 30 seconds on a URL that was never going to work. And `Sink::try_new`'s error arm was an `eprintln!` with no `emit`, leaving the frontend asserting `isBuffering` forever with no way out: the position never leaves zero, so the stall watchdog cannot arm either.

**Generalizes:** "the stream ended" and "the stream stopped" are different events and a byte reader cannot tell them apart on its own. Anywhere a producer signals completion to a consumer, check that every way the producer can exit maps to the right signal - the failure exits usually outnumber the success one. The companion rule is the one already recorded above for `gapless-cancelled`: a spawned thread owes the frontend an event on every terminal path. This entry is that rule applied to `audio_play` rather than `audio_enqueue_next`, and the reason it went unnoticed for so long is that the missing events produced *plausible* behaviour rather than visibly broken behaviour.

Related, and worth checking first in any "playback silently stopped" report: an error state that nothing renders is the same as no error state. `error` had been present on the player store, and set correctly from four separate paths, since long before this pass; not one component ever read it.

## A proxy that maps a protocol's error channel onto a success return makes every downstream fallback dead code (fixed 2026-08-01)

`upnp_soap` (`src-tauri/src/lib.rs`) treated HTTP 500 as a non-error and returned the response body to the frontend as `Ok`. UPnP has no other error channel: a renderer reports every failed action as 500 plus a SOAP fault body carrying `<errorCode>`/`<errorDescription>`. So an unsupported or rejected action resolved as a fulfilled promise holding a fault document, and the whole DLNA path was error-blind by construction. A `SetAVTransportURI` the renderer refused looked like a successful load, leaving the UI reporting playback against a silent device.

The sharper consequence is what it did to code that was written correctly. `DlnaTarget.setNext` wrapped `SetNextAVTransportURI` in a `try/catch` that set `failedToSetNext` and fell back to a `load()`-driven transition, the standard handling for a renderer that lacks the action. Since the "Invalid Action" fault arrived as a resolved promise, the `catch` could never run, the fallback could never engage, and `supportsSetNext` recorded `true` for every renderer regardless of what the renderer said. The fallback was not wrong, it was unreachable, and nothing in it looked suspicious in review.

**Fix:** the command parses the fault fields out of a 500 body and returns `Err`; non-500 handling is unchanged. Because that turns transient faults into rejections at every call site, `DlnaTarget` had to stop treating one failure as proof of anything: a failed `GetTransportInfo` used to mean "assume the track ended" on the first try, which would now skip a track over a momentary fault. Three consecutive failures are required before it reports an error, and the `onError` callback added in the same pass is what finally surfaces a dead renderer to the user at all.

**Generalizes:** when wrapping a protocol in a proxy, first ask which of its outcomes are errors *in that protocol*, not which HTTP status codes look alarming. Anywhere the mapping flattens an error into a success, every `catch`, retry, and capability-detection branch behind it becomes unreachable while still reading as fully handled. Two symptoms worth grepping for: a capability flag that is only ever assigned its optimistic value in practice, and a fallback path no log line has ever come from. Note also the converse pressure this fix creates, which is the second half of the entry: tightening an error channel makes previously silent transients loud, so anything that acted on a single failure has to be rechecked at the same time.
