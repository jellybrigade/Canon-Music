---
description: Known test/harness bugs already shipped once - full detail
paths:
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
- **A timeout ceiling set against an idle machine is measured against a busy one.** Vitest's 5s default failed `migrations.test.ts` (cost quadratic in migration count) at 5164ms inside `run-local-checks.sh`; alone it takes 0.8-2.4s. Fix: `testTimeout: 15000` in `vitest.config.ts`, one writer, not per-test annotations; `findBy*`'s window stays short. Reproduce a load failure with every core saturated (`for i in $(seq 1 $(nproc)); do timeout 400 sh -c 'while :; do :; done' & done`) and the whole suite.
  ```
  grep -n "testTimeout" vitest.config.ts src/test/appMount.ts
  pnpm test:run --reporter=verbose 2>&1 | grep -oE "[0-9]{4,}ms$" | sort -rn | head
  ```
- **A real sleep inside a real debounce window is a race, not a wait.** Search tests slept `DEBOUNCE_MS / 2` then asserted no `?q` write; under load the sleep overran the window and the write landed first. Sleeping past a window is safe, inside one never is. Fix: fake timers for in-window cases. In `App`-mount suites fake timers stall `waitFor`, so assert directly inside `act` and put `vi.useRealTimers()` in `afterEach`.
  ```
  grep -rn "setTimeout(r\|setTimeout(resolve" src --include='*.test.ts*' | grep -iE "/ ?2|debounce|window"
  ```
- **Self-registered listener state update isn't flushed by `act`.** Absence assertions need `waitFor`; presence self-corrects.
  ```
  grep -rn "toBeNull()" src --include='*.test.tsx' -B 3 | grep -A 3 "await act(async"
  ```
