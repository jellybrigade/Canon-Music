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

**Follow-up (2026-08-01), same entry, one level deeper:** carrying *which track* was handed over is not enough when the hand-off also implies a *decision about future state*. `track-advanced` re-shuffled on a repeat-all wrap and anchored the new order on the enqueued track, which is correct as far as it goes, but the enqueued track had itself been resolved as position 0 of the *old* order. So the track that opened pass N opened pass N+1, and every pass after that, forever. The non-gapless path had the mirror-image bug for a different reason: `next()` called `buildShuffleOrder(queue.length, 0)`, pinning queue index 0 to position 0, so every wrap opened with `queue[0]`. Both look like re-shuffles in review, and both produce a fresh order for positions 1..n while position 0 never moves.

**Fix:** the new order is built at enqueue time and travels with `gaplessEnqueued.wrapOrder`, so the source handed to the engine really is position 0 of the order that will be installed; `next()` passes `-1` as the anchor, which is the documented "no anchor" value.

**Generalizes:** an anchor argument that is right at one call site (keep the playing track at position 0 when shuffle is switched on mid-track) is not automatically right at another (nothing is playing at a wrap). Grep for shared shuffle/order builders called with a constant index and ask what that constant means at each site. And the symptom to watch for is statistical, not a crash: "random" that is fresh everywhere except the one position anyone actually notices.

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

## A parallel-array invariant enforced by only one of its writers holds until the other one runs (fixed 2026-08-01)

`shuffleOrder` in `src/store/player.ts` is a permutation of queue indices, and the whole playback path assumes `shuffleOrder.length === queue.length` whenever shuffle is on. `resolveTrack` reads `shuffleOrder[position] ?? position`, so a violated invariant does not throw, it silently resolves to the wrong track and keeps going.

Three writers established the order and each got the one-track case differently. `toggleShuffle` correctly wrote `[0]` for a single-track queue. `playQueue` guarded its build on `workingTracks.length > 1` and so left `[]`. `addToQueue` / `playNext` appended into whatever was already there without checking. So `playQueue([oneTrack])` under shuffle followed by an append produced `[1]`: an order one entry short, offset by one, with queue index 0 unreachable. The `??` fallback then resolved two different positions to the same track, so the seed was skipped and the appended track played twice.

This was not an exotic path. Every "start radio" entry point (`AlbumDetail`, `ArtistDetail`, `PlaylistDetail`, `HomeView`) seeds playback with `playQueue([track])` and then lets `useRadio` append to it, so the bug fired on the first radio track of every shuffled session.

**Fix:** `playQueue` writes `[0]` for the single-track shuffled case, and a `normalizeShuffleOrder` helper rebuilds any order whose length does not match the queue before either append splices into it. Repair keeps the positions the order does describe and appends the queue indices it omitted, so an order that is merely short does not lose the shuffle the user already heard.

**Generalizes:** when two arrays have to stay index-aligned, the invariant belongs to the *type*, not to the writers - and an `?? fallback` on the lookup is what converts a loud crash into a quiet wrong answer. Worth grepping for: a length guard like `if (n > 1)` on one writer that the other writers do not share, since the degenerate case is exactly where the array of indices and the array it indexes diverge. Related trap found in the same pass: once appends can *shrink* the queue (trimming played history to stay under `maxQueueSize`), any caller that captured a pre-append length and used it as the new entry's position is wrong by the amount trimmed. `useRadio` did this twice; both now read the length back off the store after the mutation.

## A resource acquired through an await escapes the cleanup that was supposed to free it (fixed 2026-08-01)

`useWakeLock` (`src/hooks/useWakeLock.ts`) held its sentinel in a ref and released `lockRef.current` from the effect's cleanup. But `navigator.wakeLock.request("screen")` is async, and the ref is only written *after* it resolves. Pausing inside the request window ran cleanup against a ref that was still `null`, so nothing was released; the request then resolved and stored a live sentinel that no later cleanup could reach, because the next effect run overwrites it. The screen stayed awake for the rest of the session with playback stopped, and nothing surfaced it - a wake lock has no visible UI, so the only symptom is a display that never sleeps.

**Fix:** a `cancelled` flag in the effect closure, set by cleanup. The resolved sentinel checks it and releases itself immediately rather than being stored.

Second bug in the same file, opposite direction: the guard for "already holding a lock" was `if (lockRef.current) return`. The browser auto-releases the lock when the document is hidden, so after a hide/show cycle the ref pointed at a dead sentinel and the guard refused to re-acquire. It now tests `!lockRef.current.released`.

**Generalizes:** this is the `pauseRequestedDuringLoad` / `pause_pending` rule applied to a *resource handle* rather than to state. Whenever an acquire is awaited and the handle is stored on resolve, the teardown that runs during the await has nothing to free, so the resource has to be freed by the acquiring path itself. Worth grepping for: any `ref.current = await something()` whose cleanup reads `ref.current`. Note also that a handle another party can invalidate (wake locks on hide, aborted controllers, closed sockets) makes "is the ref non-null" the wrong liveness test - ask the handle.

Adjacent, found in the same pass and worth its own grep: a value handed to the OS or another process must be resolvable *by that process*. Canon's media session artwork was `currentTrack.coverArtUrl`, which the play paths build at 64px (`App.tsx`, `useQueueSync.ts`) for queue rows, while `useMediaSession` declared it to the OS as `sizes: "500x500"` and `type: "image/jpeg"`. Radio tracks set `coverArtUrl: null` entirely, so they had no OS artwork at all despite carrying `artworkRef`. Building the media-session URL from `artworkRef` at a size the hook itself owns fixes all three at once. The deeper version of this is still open (see `instructions/review.md`): `cover://` is registered only on Canon's webview, so an external MPRIS consumer cannot fetch it regardless of size.

## A normalize helper that returns its input on the fast path hands callers the live state to mutate (fixed 2026-08-01)

`normalizeShuffleOrder` (`src/store/player.ts`) exists so callers can splice into a shuffle order that is guaranteed to cover the queue. Its first line was `if (order.length === queueLength) return order` - the already-correct case returned the caller's own array. Every caller then mutated the result: `addManyToQueue` pushed onto it, `playNextMany` spliced into it. Since the argument was the store's live `shuffleOrder`, the common case mutated committed state in place, before `set()` ran, and handed `set()` back the same reference. Zustand's default equality is reference equality per slice, so components subscribed to `shuffleOrder` did not re-render at all; the Now Playing up-next list kept rendering the pre-append order until some other state change forced a pass.

The bug is invisible in review because the helper is *called correctly* everywhere and the mutation reads as operating on a local. It only shows up if you follow the fast-path return.

**Fix:** `return [...order]` on the fast path, so the helper always yields a fresh array. Same pass: `moveQueueItem` was the one splice site that never called the helper at all, so a short order silently shifted every position after the splice point.

**Generalizes:** a helper whose contract is "give me a safe copy to modify" must copy on *every* path, including the one where no repair was needed. Worth grepping for: any function that returns its own parameter unchanged in a guard clause while its name promises a normalized, sanitized, or defaulted value, and whose callers then push/splice/sort/assign into the result. In a store, the second symptom is worse than the first - the in-place write corrupts state and the unchanged reference suppresses the re-render that would have made it visible.

## A restore path that writes `currentTrack` without loading the engine cannot be played (fixed 2026-08-01)

Session restore (`loadSettings` in `src/store/player.ts`, and `src/hooks/useQueueSync.ts` for the Navidrome-side queue) sets `queue`, `queueIndex` and `currentTrack` from a saved snapshot. Nothing calls `playTrack`, so there is no `streamUrl` and no Rust sink. `resume()` guarded only on `!currentTrack` and `error`, so pressing play - or space, or an OS media key - called `activeTarget.resume()` against an empty sink, set `isPlaying: true` and started the elapsed ticker. The position stayed 0 forever, and the stall watchdog could not arm because it requires the position to have advanced at least once. The restored queue was unplayable and nothing said so.

**Fix:** `resume()` treats a null `streamUrl` the same way it already treats `error` - route to `retryCurrent()`, which rebuilds the URL through `streamUrlFor` and calls `playTrack`. If `streamUrlFor` is also unset it returns without setting `isPlaying`, so the phantom-play state is unreachable either way.

The server-side path had the opposite problem: it called `playQueue()` (which does load the engine) and then `pause()`, so every launch downloaded and decoded a whole track for playback nobody requested, with the pause racing the download thread's `sink.append`. Replaced with a `restoreQueue` action that only writes store state.

**Generalizes:** `currentTrack != null` is the store's proxy for "the engine has something loaded", and a restore path breaks that equivalence by construction. Any code path that populates playback state from persistence, a URL, or another process has to either load the engine or make the transport controls aware that it did not. Related: `queue.restore_on_startup` was honoured by the SQLite path and ignored by the server path, so turning the setting off suppressed one restore and let the other put the queue straight back - when two mechanisms implement one user-facing setting, both read it.

## A sync that only upserts diverges from its source, and the divergence feeds itself (fixed 2026-08-01)

`syncLibrary` (`src/lib/sync.ts`) wrote the server's album and track list into SQLite with `INSERT OR REPLACE` / `ON CONFLICT DO UPDATE` and nothing else. There was no `DELETE FROM albums` or `DELETE FROM tracks` anywhere in `src/`. Every stage was carefully incremental, so an unchanged library really did write nothing, but the local copy could only ever grow: an album removed on the server stayed in the grid, in search, in radio candidates, and 404'd when played.

The second-order effect was worse than the stale rows. The incremental skip test is `existingTrackCount === album.songCount` (`sync.ts`, `skipTracks`). One track deleted server-side leaves an orphan row, so the stored count sits permanently above `songCount`, the test can never match again, and that album is re-fetched on *every* sync forever. `fetchedCount > 0` then dragged the whole-server FTS rebuild, `scanForIssues` and `rebuildTagVocabCache` along with it, on the 5-minute auto-sync tick, for the life of the install. A single upstream deletion converted the "idle sync writes nothing" design into permanent full-library churn.

**Fix:** prune albums absent from the fetched list along with their tracks and every derived row keyed off either, and prune per-album tracks missing from each successfully fetched album. `album_identity`, `album_user_genres` and the scrobble tables are excluded on purpose: user-authored data and listening history are not the server's to delete.

**Two guards this needs, both non-obvious:**
- Pruning is only sound when the fetched list is known complete. `fetchAllAlbums` throws on any failed page rather than returning a short list, which is what makes the diff trustworthy; an empty list against a non-empty stored library is still refused outright, so a misconfigured or not-yet-scanned server cannot wipe the local library in one tick. Any future pagination change that starts returning partial results silently turns this prune into data loss.
- A chunked `NOT IN` is a correctness bug, not just a perf detail: each chunk deletes the rows the other chunks were keeping. `executeIdChunks` in `src/lib/db-batch.ts` is documented as `IN`-only for this reason, and the per-album track prune refuses to run rather than chunk.

**Generalizes:** any local mirror of a remote collection needs a deletion path, and the test for whether it has one is a grep for `DELETE` against the mirrored tables, not a reading of the write path (which will look complete and well-factored). Ask separately what the *absence* of a row is used for downstream: here a count derived from the mirror fed the incremental heuristic, so the missing deletion did not merely leave junk, it disabled the optimisation that the rest of the file was built around.

Related shape found in the same pass, in `src/hooks/useLibrarySync.ts`: the effect stamped `syncedRef.current = server.id` and *then* called `runSync`, which is a no-op while another sync is in flight. Switching servers mid-sync therefore consumed the "already synced" marker with no sync having run, and nothing retried until the next auto-sync tick, or never when the interval is set to 0. A guard must be claimed by the action succeeding, not by the attempt being made: `runSync` now reports whether it started, and the settle handler re-checks which server is selected now rather than which one the finished run was for.

## A secret written before the row that references it outlives the row (fixed 2026-08-01)

Server setup mints an id with `crypto.randomUUID()`, writes the credential to the OS keychain under `canon.server.<id>`, and only then inserts the `servers` row (`src/components/setup/Wizard.tsx`, and the add branch of `src/components/settings/ServerTab.tsx`). The id is the only link between the two. A failed insert therefore left a password-derived token in the OS keychain that nothing referenced and nothing could ever find again, and because a retry mints a *fresh* id, every failed attempt stranded another copy.

Removal had the mirror-image bug: the `servers` row was deleted first and the `keychain.delete` that followed was wrapped in `catch { /* not fatal */ }`. A locked or absent Secret Service therefore left the credential behind permanently, with the one record naming it already gone.

**Fix:** the insert paths roll the keychain entry back on failure; the removal path deletes the keychain entry *first* and aborts the removal (surfacing the error, which previously had no UI at all) if it fails.

**Generalizes:** whenever a secret and its owning row live in two different stores, the write order decides which failure is recoverable. Write the secret first and the row's absence orphans it; delete the row first and the secret outlives its only reference. The rule that falls out: create the referencing record last but roll back on failure, and delete the referencing record last so a failed secret delete can still be retried.

Related, found in the same pass: **a Tauri command that returns `Err` for "not found" makes a falsy-check at the call site dead code.** `keychain.get` is typed `Promise<string>` and maps to `invoke("get_credential")`, which *rejects* on a missing entry rather than resolving to `""`. So `if (!credJson) throw new Error("No credentials found... Re-enter in Settings.")` in `src/hooks/useServer.ts` could never fire, and the user saw the raw keyring string instead of the message written for them. Worth grepping for: any `invoke()` wrapper whose caller null-checks the resolved value. The same query also inherited the global `retry: 3`, so a permanently missing or locked keychain entry was retried three times with backoff before the UI could say so; a failure that cannot resolve itself wants `retry: false`.

## A mirror whose reads are not scoped by owner depends entirely on its delete path (fixed 2026-08-01)

`albums`, `tracks`, `artists` and `playlists` all carry a `server_id`, but nothing on the read path uses it: `src-tauri/src/library_read.rs` selects `FROM albums` unfiltered. Removing a server (`ServerTab.tsx`) deleted only the `servers` row and its keychain entry, so the entire mirrored library survived. Adding a different server then produced a grid mixing both libraries, where the old server's albums 404 on play, because stream URLs are built from whatever server is selected now (`src/App.tsx`) against the removed server's track ids.

**Fix:** `purgeServerData` in `src/lib/sync.ts`, called before the `servers` row is deleted.

**Generalizes:** a `server_id`-style ownership column that no query filters on is not an invariant, it is a comment. Either the reads enforce it or a delete path has to, and the way to tell which you have is to grep the read path for the column, not the schema for its presence. Note this is the same shape as the sync-prune entry above one level up: that one is about rows the *server* dropped, this one about rows the *user* dropped, and both fail silently by leaving plausible-looking data in the grid.

**Sharper corollary (found 2026-08-03 on the home screen, fixed there):** the dangerous move is not the unscoped read, it is *reconstructing* the owner afterwards. `useRecommendedAlbum` selected only `id, name, artist, year, artwork_url` from a query spanning the whole mirror, and `HomeView` then built its `AlbumRow` with `server_id: server.id` - the currently selected server, which is the one value guaranteed *not* to be derived from the row. An unscoped read that carries `server_id` through degrades to "shows an album from the other server", recoverable and visible; one that stamps the selection instead produces a row that is internally consistent, passes every type check, and silently builds its stream URL against the wrong host. **Worth grepping for: any object literal assigning `server_id:` (or a similar owner/tenant field) from a variable that is not the source row.** If a query returns rows whose owner can vary, it must select the owner column, and no call site may supply it.

## A geometry constant in TS that restates a CSS value drifts silently and accumulates (fixed 2026-08-03)

`AlbumCarousel` (`src/components/HomeView.tsx`) scrolled by `CARD_WIDTH = 168 + 14` per card. `home.css` says `.carousel-card { width: 160px }` and `gap: var(--space-sm)`, which is 12: a real stride of 172. Nothing was ever wrong at the moment the constant was written, the CSS moved afterwards and the constant could not follow. One click over-scrolls by 30px, which reads as nothing; three clicks put a card half-cut against the edge, which reads as a rendering bug in the card rather than an arithmetic bug in the scroller.

**Fix:** measure at use time from the DOM, `firstElementChild.offsetWidth + parseFloat(getComputedStyle(track).columnGap)`.

**This is a family, not a one-off.** The same shape is recorded as an open `LATER` against `src/components/AlbumGrid.tsx:316`: the scrubber calls `virtualizer.scrollToIndex`, which works in `virtualRow.start` coordinates, while rows are painted at `PADDING + virtualRow.start`, so every jump lands 20px short. Same root cause, different pair of numbers.

**Generalizes:** any number in TypeScript that only makes sense because of a value in CSS is a copy with no link back to its original. Scroll strides, virtualizer row heights and paddings, sticky-header offsets, and popover collision margins are where this lives. Three ways out, in order of preference: measure from the DOM at use time, read the value from a CSS custom property (`getComputedStyle(el).getPropertyValue("--card-w")`), or set the CSS *from* the TS constant so there is one writer. Worth grepping for: arithmetic on bare pixel literals in a component whose CSS file defines the same dimension, and especially a literal written as a sum (`168 + 14`) - the sum is the tell that someone was reproducing a box model by hand.

## A mirror refreshed by DELETE-then-re-INSERT erases every column the source does not know about (fixed 2026-08-02)

The playlist stage of `syncLibrary` (`src/lib/sync.ts`) refreshed by `DELETE FROM playlists WHERE server_id = ?` followed by an INSERT built from the `getPlaylists` payload. That payload has no idea `playlists` also carries `is_smart`, `rules_json` and `custom_cover_data`, which are Canon's alone: the smart-playlist rules and the user's chosen cover image. Every refresh silently dropped them, so a smart playlist degraded into an ordinary one and could never be refreshed again, and a custom cover reverted to the server's.

The refresh was gated on a server-wide signature, which made it look rarer than it was. It is not rare: creating a smart playlist changes the signature by itself, because the local INSERT writes no `cover_art_url` while the server immediately reports one. So the feature broke within one auto-sync tick of being used.

**Fix:** upsert the server-owned columns with `ON CONFLICT(id) DO UPDATE SET name, comment, track_count, cover_art_url` and prune only the playlists absent from the fetched list. `playlist_tracks` is still rewritten wholesale, but per playlist and only where that playlist's own ordered ids moved, rather than for every playlist whenever any one of them changed.

**Generalizes:** the sync-prune entry above establishes that a mirror needs a deletion path. This is the opposite failure of the same write: a deletion path wide enough to take out columns the remote never supplied. Before a DELETE-then-INSERT refresh, diff the table's columns against the fields the fetched payload actually carries; anything in the gap is data the refresh destroys. An upsert naming only the source-owned columns is the shape that cannot have this bug. Worth grepping for: a `DELETE FROM <table> WHERE server_id` immediately followed by an INSERT whose column list is shorter than the table's.

Two more findings from the same pipeline, both worth their own grep:

- **An asymmetric read/write scope makes a change-detection comparison unable to ever match again.** The loved stage compared `SELECT ... FROM loved_tracks WHERE track_id IN (SELECT id FROM tracks WHERE server_id = ?)` against a write that inserted *every* id `getStarred2` reported. A starred track with no local row (its album's track fetch failed, or it was pruned server side) was written, was invisible to the next comparison, and so held the counts permanently unequal: full rewrite of both loved tables plus a session-store bump across ~8 mounted `useLoved` consumers, every five minutes, forever, while the join-scoped DELETE could never clear the orphan that caused it. Both sides now scope by id prefix. The rule: a comparison used to decide "did anything change" has to read exactly the set its write produces, or the answer is yes forever.
- **A local index that doubles as a remote index must be compacted whenever the remote compacts.** `playlist_tracks.position` is both Canon's ordering and the `songIndexToRemove` sent to Subsonic. Deleting one row locally left a hole while the server closed its own, so the *second* removal in a session deleted the wrong track on the server. Positions are now compacted after the delete, in two passes through negative space (`position = -(position - 1)`, then `position = -position`) because `PRIMARY KEY (playlist_id, position)` is enforced per row and a single in-place decrement collides with the row still holding the target position whenever SQLite scans descending.

## A skip heuristic freezes every column only the skipped path writes (fixed 2026-08-02)

`syncLibrary` (`src/lib/sync.ts`) skips an album's track fetch when its `created` and `songCount` both match what is stored, which is the steady state for essentially every album after the first sync. `tracks.play_count` was written *only* inside that fetch, so each album's per-track play counts froze at whatever the first sync captured and never moved again, no matter how much the user listened.

The album-level `play_count` *does* refresh, because it rides the album row that every sync compares and upserts. That is what hid this: the numbers on the home screen kept moving while the per-track column underneath them was dead. Everything reading `tracks.play_count` was stale in the same way - the play column in `AlbumDetail`, the `play_count DESC` ordering that picks an artist's top tracks, sort-by-plays in `TrackTableView`, and play-count rules in smart playlists, which could therefore never match a track that was not already matching. `useListeningStats`'s finish-the-album and almost-done queries were the only survivors, and only because they OR against `scrobble_history`.

The deeper problem was that nothing incremented a play count locally at all. Canon sent a scrobble to the server and then waited for a sync that structurally could not bring the number back.

**Fix:** `useScrobbleFlush` increments `tracks.play_count` and the owning `albums.play_count` after each successfully flushed row. Deliberately after the queue DELETE, so a crash in that window loses a count (cosmetic, corrected by the next real track fetch) rather than double-counting one. It converges rather than drifting: a later track fetch overwrites with the server's value, which by then already includes the play.

**Generalizes:** whenever a sync gains a skip fast-path, list the columns the skipped path is the sole writer of. Those columns are now frozen for exactly as long as the skip condition holds, which for a well-designed heuristic is *forever*. The tell is a mirrored column whose value the user can change by using the app rather than by changing the source, since the skip condition is derived from the source and cannot see it. Related in shape to the DELETE-then-INSERT entry above: that one is about a refresh wide enough to destroy local columns, this one about a refresh narrow enough never to reach remote ones.

## A queue drained by a loop that breaks on any error blocks on its first permanent failure (fixed 2026-08-02)

`useScrobbleFlush` walked `scrobble_queue` and `break`'d on any thrown error, which is right for "the server is unreachable, try again in 60s" and wrong for anything the server will refuse identically forever. `callSubsonicVoid` (`src/lib/navidrome.ts`) threw a bare `Error` for both, so the two were indistinguishable at the call site. A scrobble for a track deleted server side answers with Subsonic error 70 every time; that row sat at the head of the queue, failed, broke the batch, and nothing behind it ever sent again. The queue then grew without bound, and because `useListeningStats` counts unflushed rows as `pending`, the album's play count was permanently inflated by the backlog.

**Fix:** an exported `SubsonicError` carrying the `subsonic-response` error code. Code 70 drops the row and continues; everything else still breaks. Auth codes (40/41/50) are deliberately *not* in the drop set - re-entering the password makes those rows sendable again, so treating them as permanent would delete the user's offline backlog at the exact moment it is most recoverable.

Second bug in the same file: no in-flight guard. `scrobble` is in `NON_IDEMPOTENT_ENDPOINTS`, so each row gets one 12s attempt per route (24s with an alt URL). A handful of queued rows against a slow server outlasts the 60s interval, and the next tick re-`SELECT`s rows the running flush has not deleted yet and sends them again; the `online` listener could collide at any moment for the same reason. `INSERT OR IGNORE` on `scrobble_history` deduped it locally, so the duplicate was invisible on this side while the server counted the play twice. A `flushing` flag in the effect closure fixes it - same shape as the `waveformInFlight` guard documented above.

**Generalizes:** two questions to ask of any drain loop. First, can a single item fail permanently, and if so does the loop distinguish that from a transient failure - if the error channel does not carry the distinction, the loop cannot make it, and head-of-line blocking is the default outcome. Second, can one pass take longer than the interval that schedules it, and if so what stops the next pass from re-reading work the current one has not yet marked done. Note the asymmetry in which direction to err: dropping a transient failure loses user data, retrying a permanent one only wastes a request, so the permanent set should be small and explicitly enumerated rather than inferred.

## A repair effect whose repair invalidates its own trigger data runs forever (fixed 2026-08-03)

`AlbumDetail.tsx` carried a backfill for a v32 migration leftover: if every track of the open album reported `bit_rate === null`, re-sync the album from the server. The repair, `doSyncTracks`, ends in `useTrackListSessionStore.getState().bumpRefresh()`, and `useTracks` (`src/hooks/useTracks.ts`) refetches on that tick and hands back a *new array*. The effect listed `tracks` in its deps, so it re-ran against fresh rows and re-evaluated the same condition. Whenever the condition was not actually repairable - the server genuinely reports no `bitRate` for those files - it was still true, and the album re-synced over the network for as long as the page stayed open. One full `syncAlbumTracks` fetch plus DB write per iteration, as fast as the round trip allows, with no log line saying anything was wrong.

The shape hides well in review because every individual link is correct: the condition is right, the repair is right, refetching after a write is right, and listing `tracks` in the deps is what the exhaustive-deps lint asks for. It is the cycle that is wrong, and nothing local to any one line shows it.

**Fix:** a `useRef` holding the album id already attempted, stamped *before* the repair is invoked so the re-entry finds it set regardless of how fast the tick lands. One attempt per album per mount; a different album still gets its own.

**Generalizes:** for any effect that writes, ask whether its write reaches the data its own condition reads. If it does, the condition must be paired with a "have I already tried this" marker, because a repair that cannot succeed will otherwise retry at full speed forever. The marker has to be claimed by the *attempt*, not by the success - the same rule as the `useLibrarySync` guard noted above, inverted: there the guard was claimed too early and swallowed a real run, here nothing claimed it at all. Worth grepping for: an effect body that calls something ending in `bumpRefresh()`, `invalidateQueries`, or a session-store tick, while depending on the value that tick refetches. Canon has several session-store `refreshTick` pairs (`trackListSessionStore`, `allTracksSessionStore`, `lovedSessionStore`), and each one is a potential cycle back into whatever effect triggered it.

Related, found in the same pass and cheap to check anywhere a list is virtualized: **a selection stored as row indices silently repoints when the list reorders.** `TrackTableView` held `Set<number>` of indices; any background refresh or re-sort left the same rows highlighted while they now denoted different tracks, and no bulk action existed to make the divergence visible. Store selections keyed by stable id and resolve to indices only at the moment of a range click.

## A prefetch that duplicates a query instead of sharing it warms a key nobody reads (fixed 2026-08-03)

`useNowPlayingPrefetch` warms three React Query keys when the track changes so the now-playing About tab paints instantly on first open. It held its own copies of the three `queryFn`s rather than sharing `NowPlayingView`'s, and it derived the cache key from `currentTrack.artist` while the tab derived it from the `feat.`-stripped lead artist. So for every "X feat. Y" track the prefetch spent two Last.fm calls and two table scans writing `["nowplaying-top-tracks", "X feat. Y"]`, which nothing ever read, and the tab opened cold.

The copies had also drifted: the tab matched `artist LIKE '% feat.%'` variants and excluded the current track id, the prefetch did neither. Two functions under one cache key are one function with a race on which version's results the user gets.

**What made it invisible rather than merely slow:** the tab's own SQL was broken and had been for as long as it existed. The pattern `ESCAPE '\'` written inside a JavaScript template literal is not an escaped backslash - `\'` is an escape for the quote, so the SQL SQLite receives reads `ESCAPE ''`, and SQLite rejects an empty escape character outright. That query therefore threw *every time it actually ran*, which the key mismatch made exactly the collaboration case. Non-feat artists hit the prefetched entry and never ran it; feat artists missed the cache, ran it, threw, and rendered no "Top tracks" section at all. Each bug concealed the other: the mismatch looked like a cache-efficiency nit, and the broken SQL looked like it could not be reached.

A third, quieter one in the same triple: `staleTime` is a property of the *observer*, not of the cache entry. The prefetch wrote albums with `staleTime: 30min`, the tab's `useQuery` left it at the default `0`, so the warmed entry was stale the instant it landed and the tab refetched on every open regardless.

**Fix:** one `src/lib/now-playing-queries.ts` holding the three query functions, the `staleTime` constants and `primaryArtistOf`, imported by both sides. Wildcards escaped in the parameter with a real `ESCAPE '\\'`.

**Generalizes:** a prefetch is only a prefetch if the key and the work are byte-identical to the read. Three things to check on any `prefetchQuery`, none of which the type system covers: the key is built by the *same* expression as the consumer's (not an equivalent-looking one), the `queryFn` is the *same function* rather than a copy, and the `staleTime` is at least as long on the consumer as on the prefetch. Worth grepping for: a `queryKey:` argument in a prefetch whose parameter is a raw field where the consumer passes a derived one, and any `prefetchQuery` whose `queryFn` body is written inline rather than imported. And separately, worth grepping across the whole repo: **`ESCAPE '\'` inside a template literal or a single-quoted TS string is always `ESCAPE ''` and always throws** - the correct form is `ESCAPE '\\'`. The tell is a LIKE query that works in a SQL console and fails from the app.

## A LIMIT without an ORDER BY silently redefines what the query returns (fixed 2026-08-03)

All three FTS queries in `src/hooks/useSearch.ts` ended in a bare `LIMIT 200`. FTS5 with no `ORDER BY` hands back matches in rowid order, so the cap kept the 200 *oldest-synced* rows, not the 200 best ones. The file then re-ranked those rows in JS with `scoreMatch` and sorted them carefully by exact-match, starts-with and word-start tiers. The ranking was correct and the code reads as if relevance is handled; it just ranked an arbitrary sample. On a broad query in a large library the exact-title match could be absent from the 200 rows entirely and no amount of JS scoring could bring it back.

**What makes this hard to see in review:** a `LIMIT` reads as a performance guard, and the ranking that follows reads as the relevance mechanism. Nothing looks wrong at either line. And the failure is invisible in normal use because a specific query returns few enough matches to fit under the cap, so it only misbehaves on exactly the broad queries where a user is least able to tell a bad result set from a plausible one.

**Fix:** a shared CTE selects the top 2000 hits by weighted `bm25(tracks_fts, 0.0, 10.0, 8.0, 4.0, 1.0)` (weights mirroring the JS scoring intent: title, then artist, then album, then genre), and the per-section queries draw from that. bm25 decides which rows survive the cap; `scoreMatch` still decides the order the user sees.

**Two SQLite specifics worth keeping, both discovered by running the queries rather than by reading them:**
- `MATERIALIZED` on that CTE is load-bearing, not a hint. A plain CTE or subquery gets flattened into the outer join and SQLite then rejects the statement outright with `unable to use function bm25 in the requested context`. Requires SQLite 3.35+; the bundled one is 3.46 via `libsqlite3-sys` 0.30.1.
- An FTS auxiliary function cannot appear inside an aggregate, so `MIN(bm25(tracks_fts, ...))` fails with the same message. Rank in the CTE, aggregate the CTE's column: `MIN(r.rank)`.

**Generalizes:** any `LIMIT` without an `ORDER BY` is a silent sampling decision, and the sample is whatever the storage engine visited first. Worth grepping for across the repo: a `LIMIT` whose query has no `ORDER BY`, especially where the caller sorts the result afterwards - the later sort is what disguises it, because sorted output looks ranked whatever it was drawn from. The question to ask is not "is this sorted" but "was the thing that got cut chosen or was it just late in the file".

Same pass, and the reason to re-read the server-scoping entries above: `useSearch` was the last search-path read with no `server_id` filter, and both consumers (`CommandPalette.tsx`, `SearchResults.tsx`) built their `AlbumRow` with `server_id: server.id` off the selected server. That is the pattern the "sharper corollary" note above says to grep for, found again in a fourth place. The queries now filter by server and `SearchAlbum`/`SearchTrack` carry `server_id`, so no call site supplies it.

Also worth its own grep, from the same file: **`useDeferredValue` is not a debounce.** It defers *rendering*, so a query keyed on the deferred value still fires once per keystroke. `CommandPalette.tsx` used it where it wanted a debounce and ran three FTS scans per character typed. The tell is `useDeferredValue` feeding a `queryKey` rather than feeding an expensive render.
