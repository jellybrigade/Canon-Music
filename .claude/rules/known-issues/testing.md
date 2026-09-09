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
- **Shared mock `Response` breaks on double body read.** Real `fetch` = fresh `Response` per call. Use `mockImplementation(() => ...)` for repeat calls.
  ```
  grep -rn "mockResolvedValue(" src --include='*.test.ts*' | grep -iE "response|ok\(|httpStatus"
  ```
- **Fixed sleep pays ceiling every run; per-case rebuild pays per case.** Use `actUntil()` / `forkTestDb()` (`src/test/sqlite.ts`).
  ```
  grep -rn "setTimeout(r\|setTimeout(resolve" src --include='*.test.ts*' | grep -vE "[^0-9](0|[1-9][0-9]?)\)"
  ```
- **Self-registered listener state update isn't flushed by `act`.** Absence assertions need `waitFor`; presence self-corrects.
  ```
  grep -rn "toBeNull()" src --include='*.test.tsx' -B 3 | grep -A 3 "await act(async"
  ```
