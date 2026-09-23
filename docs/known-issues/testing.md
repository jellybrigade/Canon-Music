---
description: Known test/harness bugs already shipped once - full detail
globs:
  - "src/**/*.test.ts"
  - "src/**/*.test.tsx"
  - "src/test/**"
---

# Test / harness

Bug classes that already shipped once. Heading = lesson. Greps kept, forensics in git.
Fixed unless marked OPEN.

- **Library `afterEach` hooks only self-register under `globals: true`.** RTL's `cleanup` never ran, so every `render`/`renderHook` stayed mounted for the rest of its file - timers ticking, listeners armed, effects hitting a closed DB - and any exact-count waste assertion could be measuring an earlier test. Fix: `src/test/setup.ts` registers it explicitly, node-env guarded; `src/test/cleanup.test.tsx` pins it. Ask of any test library: what does it assume about globals?
  ```
  grep -n "globals" vitest.config.ts || grep -rn "afterEach(cleanup)\|cleanup()" src/test/setup.ts
  ```
- **Time it before theorising.** Flaky-looking timeout != race, usually. `pnpm test:run --testTimeout=60000 --reporter=verbose`; >1500ms owes explanation.
- **Large fake-time advance = one iteration per live tick.** Set distant-timer state directly, don't run the poller.
  ```
  grep -rn "advanceTimersByTime" src --include='*.ts*' | grep -E "60 \* 1000|3600|\* 60 \*"
  ```
- **Boundary test pays fixture cost per boundary unit.** 500k-row ceiling test w/ realistic fixtures: 1.2s in `JSON.parse` alone. Stripped to one field: 360ms.
  ```
  grep -rn "Array.from({ length: [0-9_]\{4,\}" src --include='*.test.ts*'
  ```
- **Accessible-name query = whole-tree scan, 150-300ms/call.** Prefer class selector; pair absence assertions with a positive control.
  ```
  grep -rc "ByRole(" src --include='*.test.tsx' | grep -v ":0$" | sort -t: -k2 -rn
  ```
- **Shared mock `Response` breaks on double body read.** Real `fetch` = fresh `Response` per call. Use `mockImplementation(() => ...)` for repeat calls. **Found again:** a `mockResolvedValue(httpStatus(503))` retry-ladder test passed while every call after the first rejected with "Body is unusable", so the property it named (a server that answers does not trip the transport breaker) was never exercised. A green test whose subject cannot have run is worse than a missing one.
  ```
  grep -rn "mockResolvedValue(" src --include='*.test.ts*' | grep -iE "response|ok\(|httpStatus"
  ```
- **Fixed sleep pays ceiling every run; per-case rebuild pays per case.** Use `actUntil()` / `forkTestDb()` (`src/test/sqlite.ts`).
  ```
  grep -rn "setTimeout(r\|setTimeout(resolve" src --include='*.test.ts*' | grep -vE "[^0-9](0|[1-9][0-9]?)\)"
  ```
- **A timeout ceiling set against an idle machine is measured against a busy one.** vitest's 5s
  default failed `migrations.test.ts > reaches the same schema from every intermediate version` at
  5164ms inside `scripts/run-local-checks.sh`, which runs the whole suite beside `cargo test` and
  clippy; alone the same test takes 0.8-2.4s and passes. Not a race and not a slow test to delete:
  it replays every migration block from every rung, so its cost is quadratic in the block count and
  grows with each migration added. The protection already existed but only covered the family its
  author had in front of them - `allowSlowAppMounts()` raises `testTimeout` to 30s for the 8 `App`
  suites, leaving every other suite on the default, and the two heaviest non-App tests (3.9s and
  2.1s idle) were one scheduling accident from the ceiling. Fix: `testTimeout: 15000` in
  `vitest.config.ts`, one writer, rather than an annotation per slow test that the next slow test
  has to remember to add. Testing Library's `findBy*` window stays short, since that is the one
  that must fail fast. Reproduce a load-dependent failure before believing a fix: saturate every
  core (`for i in $(seq 1 $(nproc)); do timeout 400 sh -c 'while :; do :; done' & done`) and run
  the whole suite, not the one file.
  ```
  grep -n "testTimeout" vitest.config.ts src/test/appMount.ts
  pnpm test:run --reporter=verbose 2>&1 | grep -oE "[0-9]{4,}ms$" | sort -rn | head
  ```
- **A real sleep inside a real debounce window is a race, not a wait.** Two search tests armed
  the 200ms `?q` debounce, slept `DEBOUNCE_MS / 2` to sit "mid-window", then unmounted or
  navigated and asserted no `?q` was written. Under `scripts/run-local-checks.sh`, which runs
  the suite beside `cargo test` and clippy, the half-window sleep overran the whole window, the
  write landed *before* the unmount, and `expected '/search?q=abba' to be '/search'` failed on a
  correct component - a flake that reads as a product bug. Sleeping *past* a window is safe
  (overrunning changes nothing); sleeping *inside* one is not, and no margin fixes it, because
  the ceiling is set by whatever else the machine is doing. Fix: fake timers for the in-window
  case, so real time cannot advance the debounce at all. In an `App`-mount suite, fake timers
  also stall `waitFor`'s polling (30s timeout, a background normalizer waiting on real time), so
  the navigation assertion there is a direct `expect` inside `act` rather than a `waitFor` - and
  `vi.useRealTimers()` belongs in `afterEach`, since switching back mid-test drops the pending
  fake timer the assertion depends on.
  ```
  grep -rn "setTimeout(r\|setTimeout(resolve" src --include='*.test.ts*' | grep -iE "/ ?2|debounce|window"
  ```
- **Self-registered listener state update isn't flushed by `act`.** Absence assertions need `waitFor`; presence self-corrects.
  ```
  grep -rn "toBeNull()" src --include='*.test.tsx' -B 3 | grep -A 3 "await act(async"
  ```
