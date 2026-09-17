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
- **Two HTTP stacks also means two certificate stores.** reqwest was built on `rustls-tls` (bundled webpki roots) while WebKitGTK uses the system store, so a Navidrome behind a private CA failed TLS in the probe alone and `describeStall` told the user "the server or the connection is down" - the exact opposite of the truth, in the one message written to be believed. Fix: `rustls-tls-native-roots`. Any client that seconds the webview's opinion has to trust what the webview trusts.
  ```
  grep -n "rustls-tls\|native-tls" src-tauri/Cargo.toml
  ```
- **"Something answered" is not "the right thing answered".** `probe_server` sets `reachable` for any HTTP response, so a 404 from a wrong URL, a 502 from a proxy in front of a dead server and a 407 from an intercepting proxy all reported "the server is up, check your proxy settings". The `status` was collected and never read. Fix: only 2xx earns the up verdict; anything else names the code and points at the address. A boolean built from "no error" answers a narrower question than its name.
  ```
  grep -rn "reachable" src src-tauri/src | grep -v '\.test\.'
  ```
- **A diagnosis collected and used only for the message text is not a decision.** After two
  timed-out ladders the breaker called `probe_server`, got `reachable: true, status: 200` in
  94ms, wrote that into the notice, and opened anyway: every sync request for the next 15s was
  refused against a server that had just answered, and the notice told the user to check a
  desktop proxy setting that was fine. The probe was the one piece of evidence that the stall
  was one lost connection rather than a stalled transport, and nothing branched on it. Fix: the
  first 2xx probe in a streak excuses the stall and closes the breaker again, with a message
  that says the server is up; a further timeout with nothing through since opens it as before,
  since a webview that keeps timing out while Rust keeps getting through is exactly the PAC
  stall above, and vetoing every time would bring back 37s per request. Ask of any check whose
  result only reaches a string: would the code do anything different if it said the opposite?
  ```
  grep -rn "probe_server\|ServerProbe" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **WebKit's `err.stack` carries no message line, so logging the stack alone loses the error.** `logger.ts` stored `v.stack ?? v.message`, which on V8 opens with `Error: <message>` and on WebKitGTK - every shipped Canon build - is frames only. All 500 rows of `app_logs` read `Cn@tauri://localhost/assets/index-DO98X4Wg.js:430:23778` and nothing else, so a real user report of failing syncs could not be diagnosed from the logs at all, only from the surrounding message the call site happened to pass. Fix: `formatLogValue` puts `name: message` in front unless the stack already starts with it. Any place a browser API's output is stored rather than shown owes the question: is this the same string on the engine we actually ship?
  ```
  grep -rn "\.stack" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **"Load failed" ~25s = systemd-resolved, not Canon.** Check `resolvectl status` / `journalctl -u systemd-resolved` first. Hardening: 12s `AbortController`, 3 retries, non-fatal `skippedStages`.
