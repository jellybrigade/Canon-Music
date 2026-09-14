---
description: Known Linux/WebKitGTK/audio platform bugs already shipped once - full detail
globs:
  - "src-tauri/**"
  - "src/hooks/**"
  - "src/components/**"
---

# Platform (Linux / WebKitGTK / audio)

Bug classes that already shipped once. Heading = lesson. Greps kept, forensics in git.
Fixed unless marked OPEN.

- **Left-click popup self-closes.** WebKitGTK eats opening click's tail. Fix: `useClickOutside` (deferred attach, capture `mousedown`, containment check). No local copies.
  ```
  grep -rn 'addEventListener("mousedown"' src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Freeze/thaw compositor crash.** Focus loss kills WebProcess, upstream `wry` bug. Mitigations, don't strip: `web-process-terminated` -> `.reload()`, `useAppActivityTracking` blur stamp, `webkit2gtk-nvidia-quirk`, `"visible": false` + `window.show()` on load. Never touch `set_hardware_acceleration_policy` blind.
- **ALSA underrun under load.** rodio 0.19 buffer too small. `PULSE_LATENCY_MSEC=60` in `run()`. Real fix: rodio 0.20+.
- **Read-only rusqlite can't own WAL `-shm`.** `library_read.rs`: `READ_WRITE | NO_MUTEX | URI`, no `CREATE`.
- **Unbounded thread-per-request -> SIGKILL.** Cover proxy: permit before spawn, `spawn_blocking`, cap 16. Tell: `ps -eLf | grep canon | wc -l` climbing.
- **Two HTTP stacks means two proxy configurations, and only the webview honours PAC.** Canon reaches the API through the webview (libsoup, so the desktop's `GProxyResolver`) and covers through Rust reqwest (env proxy only, no PAC). A desktop left on `/system/proxy/mode` = `auto` with no working PAC/WPAD made every `fetch` hang on a 25s D-Bus call to `org.gtk.GLib.PACRunner`, so Canon's 12s abort fired first, three attempts per call, and the library was unusable - while cover art loaded fine, `curl` answered in 100ms and Chrome (own WPAD, own fallback) was untroubled. It reads as "Canon is broken" and logs as a bare `timed out after 12000ms`. Fix: `net_probe.rs::probe_server` reaches the server over the stack that is *not* stalling, so the message names the machine's HTTP configuration instead of the server; `transport-health.ts` stops the ladder after two lost to timeouts. User-side cure is `dconf write /system/proxy/mode "'none'"`. Ask of any transport failure: which of Canon's two HTTP clients saw it, and would the other agree?
  ```
  dconf read /system/proxy/mode   # 'auto' with no reachable PAC stalls every webview fetch
  grep -rn "timed out after\|Load failed" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **"Load failed" ~25s = systemd-resolved, not Canon.** Check `resolvectl status` / `journalctl -u systemd-resolved` first. Hardening: 12s `AbortController`, 3 retries, non-fatal `skippedStages`.
