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
- **Read-only rusqlite can't own WAL `-shm`.** `library_read/mod.rs`: `READ_WRITE | NO_MUTEX | URI`, no `CREATE`.
- **Unbounded thread-per-request -> SIGKILL.** Cover proxy: permit before spawn, `spawn_blocking`, cap 16. Tell: `ps -eLf | grep canon | wc -l` climbing.
- **Two HTTP stacks means two proxy configurations, and only the webview honours PAC.** API calls go through the webview (libsoup, the desktop's `GProxyResolver`, PAC), covers through reqwest (env proxy only). `/system/proxy/mode` = `auto` with a dead PAC stalled every `fetch` 25s while covers and `curl` worked. Fix: `net_probe.rs::probe_server` checks over the other stack so the message names the HTTP configuration; `transportHealth.ts` stops after two timed-out ladders. Ask of any transport failure: which client saw it, and would the other agree?
  ```
  dconf read /system/proxy/mode   # 'auto' with no reachable PAC stalls every webview fetch
  grep -rn "timed out after\|Load failed" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Two HTTP stacks also means two certificate stores.** reqwest was built on `rustls-tls` (bundled webpki roots) while WebKitGTK uses the system store, so a Navidrome behind a private CA failed TLS in the probe alone and `describeStall` told the user "the server or the connection is down" - the exact opposite of the truth, in the one message written to be believed. Fix: `rustls-tls-native-roots`. Any client that seconds the webview's opinion has to trust what the webview trusts.
  ```
  grep -n "rustls-tls\|native-tls" src-tauri/Cargo.toml
  ```
- **"Something answered" is not "the right thing answered".** `probe_server` sets `reachable` for any HTTP response, so a 404 from a wrong URL, a 502 from a proxy in front of a dead server and a 407 from an intercepting proxy all reported "the server is up, check your proxy settings". The `status` was collected and never read. Fix: only 2xx earns the up verdict; anything else names the code and points at the address. A boolean built from "no error" answers a narrower question than its name.
  ```
  grep -rn "reachable" src src-tauri/src | grep -v '\.test\.'
  ```
- **A diagnosis collected and used only for the message text is not a decision.** The breaker got a 2xx from `probe_server` in 94ms, wrote it into the notice and opened anyway, refusing 15s of requests to a live server. Fix: the first 2xx probe in a streak excuses the stall and closes the breaker; a further timeout with nothing through opens it (the PAC-stall case). Ask of any check whose result only reaches a string: would the code act differently if it said the opposite?
  ```
  grep -rn "probe_server\|ServerProbe" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **WebKit's `err.stack` carries no message line, so logging the stack alone loses the error.** `logger.ts` stored `v.stack ?? v.message`; on WebKitGTK the stack is frames only, so every `app_logs` row lost its message. Fix: `formatLogValue` prefixes `name: message` unless the stack already starts with it. Ask of any stored browser output: is it the same string on the engine we ship?
  ```
  grep -rn "\.stack" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A scroller whose content grows keeps painting at its old width on WebKitGTK.** Unlocking For You adds disabled tabs to an `overflow-x: auto` list; the new tabs were clipped at the locked row's old end until hovered. Fix: key the list on the lock state so it remounts. Not reproducible in jsdom (no paint). Ask of any scroller whose item set swaps on a toggle: does it get a fresh box?
  ```
  grep -rn "overflow-x: auto" src --include='*.css'
  ```
- **"Load failed" ~25s = systemd-resolved, not Canon.** Check `resolvectl status` / `journalctl -u systemd-resolved` first. Hardening: 12s `AbortController`, 3 retries, non-fatal `skippedStages`.
