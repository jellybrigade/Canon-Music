---
name: next
description: Work the top item of instructions/donow.md (or, if donow is empty, research what-to-do.md items into it), implement, then commit. Use when user says "next", "what's next", "do the next thing", "donow", or invokes /next.
---

Paths are relative to the repo root, never this skill's dir.

## Standing rule: file every finding

Any problem you hit that is not your item (failing/flaky test, red `scripts/run-local-checks.sh` task, bug noticed in passing, stale donow entry) goes into `instructions/donow.md` before the run ends. Don't silently fix or ignore it. Stash and re-run to say whether it reproduces on a clean tree. File it under the right tier in donow's item format; a class gets its grep.

## Research mode (donow.md empty)

1. Pick 3-5 items from `instructions/what-to-do.md`, user impact first.
2. One `caveman:cavecrew-investigator` per item, in parallel: (A) precedent in `~/Projects/_ref/` (files, pattern, gotchas), (B) Canon's current code: where it slots in, what data exists, schema/API changes.
3. Write one donow item per backlog item (what, reference patterns, Canon state, 2-4 sentence sketch). Don't implement. Tell the user to run `/next` again.

## Implement mode

1. **Take the top item** of `instructions/donow.md`. Only that one.
2. **Verify bug items first** (skip for features): one investigator answers separately (a) does the symptom exist today (check `git log`, `git tag --contains`), (b) is the stated cause the real cause. Wrong cause: rewrite the item, tell the user, proceed. Not found or already fixed: delete it from donow and what-to-do, report evidence, take the next item (already fixed but unreleased: say `/release` is the work).
3. **Plan** in 3 lines (what, files, risks), then proceed without waiting.
4. **Implement test-first** per AGENTS.md. UI work: have an investigator find the closest existing component and match its tokens and patterns. Don't launch the app or screenshot.
5. **Done gate**: AGENTS.md "Done" (tests, cargo test, tsc, ARCHITECTURE updated) via `bash scripts/run-local-checks.sh`.
6. **Remove the item** from donow.md (and its row + detail section from what-to-do.md if it came from there); add this run's findings in the same edit.
7. **Commit** via `/commit`.
8. **Report**: one-line `/release` suggestion if the work is user-visible, plus every failure hit, whether it's pre-existing, and that it's filed.
