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

**2026-07-17: `OnDemand` mitigation reverted — conflicted with `WEBKIT_DISABLE_COMPOSITING_MODE` and crashed on every single launch.** The `OnDemand` mitigation from 2026-07-16 above (never released, sat unmerged on `development`) turned the assertion from an occasional focus-toggle issue into a deterministic startup crash, plus audible ALSA underrun (choppy/robotic audio) right before the process died. Root cause: `lib.rs` already sets `WEBKIT_DISABLE_COMPOSITING_MODE=1` as an env var before the webview is even created (the older, still-active mitigation from `21af58e`/`16a0c07`) — then `.setup()` immediately called `settings.set_hardware_acceleration_policy(HardwareAccelerationPolicy::OnDemand)` on that same webview, flipping compositing back on right as the window became visible. That policy flip, not the hide/show-after-first-paint reveal (`cde9841`, also suspected and also reverted), was the actual trigger. Both `OnDemand` and the `useAppActivityTracking` blur-pause mitigation were reverted; only the `web-process-terminated` → `.reload()` safety net remains. **If re-attempting `OnDemand` (or any explicit `hardware_acceleration_policy` call) in the future: first remove/reconcile the `WEBKIT_DISABLE_COMPOSITING_MODE` env var — don't set both.**

## Unbounded thread-per-request in cover art proxy caused SIGKILL crash

Cover art proxy server (`src-tauri/src/lib.rs`, `cover-server` thread) spawned one new OS thread per incoming HTTP request with no concurrency cap. Rapid sidebar view-switching (artist → library → tracks → tags → artist...) fires a burst of cover-art fetches for every view's album grid, each getting its own thread.

**Symptom:** progressive UI lag during rapid navigation, then the whole app vanishes. No coredump, no Rust panic, no kernel OOM entry, no `systemd-oomd`/cgroup kill logged — looks like nothing happened.

**Root cause, confirmed via `gdb -p <pid>` attach (bypass `ptrace_scope` by launching under `gdb --args` instead of attaching to an already-running process):** `Program terminated with signal SIGKILL, Killed.` — uncatchable, explains the total absence of any trace. Log immediately before death shows dozens of threads spawned/destroyed in rapid succession, timed exactly with the rapid-navigation clicks. Exact external killer was never identified (ruled out kernel OOM, systemd-oomd, cgroup `pids`/`memory` limits, earlyoom-style daemons) — doesn't matter, the unbounded thread-spawn is a confirmed bug independent of whatever finally pulled the trigger.

**Fix applied:** `ThreadSemaphore` (`Mutex<usize>` + `Condvar`, no new deps) caps concurrent cover/artist-image request handling at 16. Permit acquired in the accept loop *before* spawning, so the accept loop backpressures instead of piling up work; `SemaphoreGuard` (RAII, `Drop` releases) moved into each spawned closure so every early `return` in the request handler auto-frees its slot.

**Follow-up (2026-07-14):** per-request handling switched from `std::thread::spawn` to `tauri::async_runtime::spawn_blocking` — same 16-permit cap, but requests now run on tokio's reused blocking-thread pool instead of a freshly created/destroyed OS thread each time. No behavior change, lower per-request overhead.

**If debugging a "gets laggier then vanishes" or unexplained SIGKILL on Linux:** check for thread-storm first (`ps -eLf | grep canon | wc -l` during repro, or watch thread count climb) before assuming it's the WebKitGTK freeze/thaw bug above — different signature, different fix.