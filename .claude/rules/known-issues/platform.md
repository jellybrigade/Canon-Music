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
- **"Load failed" ~25s = systemd-resolved, not Canon.** Check `resolvectl status` / `journalctl -u systemd-resolved` first. Hardening: 12s `AbortController`, 3 retries, non-fatal `skippedStages`.
