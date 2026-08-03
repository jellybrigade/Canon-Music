---
name: tests
description: Pick exactly one manageable scope of unchecked work from instructions/tests.md, understand what it actually needs to test (including edge cases the checklist wording doesn't spell out), write it test-first per CLAUDE.md's TDD rule, and tick it off. Run repeatedly to work through the baseline. Use when user says "tests", "next test", "write tests", "cover the next item", or invokes /tests.
---

You are invoked in plan mode for Phase 2 (scoping) only - Phase 1 picking and Phase 3 understanding happen first, inline. Work the phases in order.

**Path note:** `instructions/tests.md` lives at repo root (`/home/mschachner/Projects/Canon/instructions/tests.md`), not inside this skill's directory.

**One scope per invocation.** Not one function, not the whole section. Run `/tests` again for the next scope.

Distinct from `/pipeline` (reviews an existing feature end-to-end for bugs) and `/code-review` (reviews a diff). This skill's only job is closing gaps in `instructions/tests.md` - it can fix a bug it finds along the way (a bugfix test must reproduce the bug per CLAUDE.md), but it is not hunting for bugs as its primary mode.

**Never end a turn before `instructions/tests.md` is updated and the work is committed.** Before handing control back to the user for any reason:

1. Every item covered this pass is ticked `[x]` in `instructions/tests.md`, and the "Progress log" section has a new entry naming the test file(s) and what they cover.
2. `pnpm test:run` (and `cargo test` if Rust was touched) is green.
3. The `/commit` skill has run.

If the user interrupts, redirects, or you're about to ask them something, record and commit what's done first, then respond. Partial progress within a scope still gets ticked/logged/committed for what's actually covered - don't let an interruption erase finished work from the file.

## Phase 1 - Pick a scope

`instructions/tests.md` is **not** a flat checklist - the "Baseline is complete when these are green" section near the top and the "Suggested order of work" section at the bottom define priority. Respect that order; don't cherry-pick an easy item out of sequence unless the user names one.

```bash
grep -n '^\- \[ \]' instructions/tests.md | head -20
```

Read enough surrounding context (not the whole file) to see which unchecked lines form one coherent unit of work. A scope is:

- **Too small:** a single bullet when its sibling bullets under the same `###`/`####` heading are also unchecked and touch the same file/function family. Don't tick one bullet and leave three siblings in the same file for a separate invocation - that's needless churn (re-reading the same source, re-running the same suite) for no isolation benefit.
- **Too large:** an entire numbered section (e.g. all of "2. Store logic") in one pass, or multiple unrelated files. `player.ts`'s queue invariants and its gapless hand-off logic are two scopes even though they're both under "Section 2" - they don't share edge cases and a scope that big won't get genuinely understood before code gets written.
- **Right-sized:** everything unchecked under one `###` subsection (typically one source file's listed functions), or one regression-backlog entry with its test. That was roughly one file, ~10-35 tests, one commit, in past sessions - use that as a calibration point, not a hard rule. A file with heavier state (a store, a sync routine) may need a narrower slice - e.g. just the queue/shuffle invariants, not transport intent too.

State clearly at the start which scope this invocation covers and why it's sized that way.

If nothing is unchecked, say so and stop.

## Phase 2 - Confirm scope with the user

Before reading source in depth, state the chosen scope and enter plan mode only long enough to confirm it isn't a surprise (skip this if the user named the exact item already). This is a scope check, not a design review - keep it short.

## Phase 3 - Understand what actually needs testing

This is the phase most likely to get skipped under time pressure - don't skip it. "Understanding" means having a concrete list of edge cases *before* writing the first test, not discovering them by re-reading the plan's bullet text literally.

1. **Read the real source file(s) in full**, not just the function signatures the plan bullet names. The plan's wording ("boundary at exactly staleDays") is a hint of depth expected, not the complete list - actual edge cases live in the code: every early return, every regex alternative, every documented comment explaining *why* something is written the way it is.
2. **Grep `.claude/rules/known-issues.md` for the file/area** being covered. Every entry there is a bug that shipped once; if this scope touches code near one, the regression test is mandatory (CLAUDE.md), not optional inventory.
3. **List edge cases explicitly before writing any test**, in your own words, covering at minimum:
   - every branch/early-return in the function, including ones the plan bullet didn't name
   - degenerate input (empty string/array, null, zero, one item, boundary value exactly)
   - anything with a comment explaining non-obvious behavior - that comment exists because someone got it wrong once
   - adjacent logic in the same file that shares state/helpers with what's being tested (e.g. a private alias table, a shared regex, a module-level cache) even if the plan bullet only named the public function
   - for anything using string matching against external data (Last.fm, MusicBrainz, server responses): casing, punctuation, unicode
4. If a listed edge case turns out to require access the pure-function surface doesn't give (e.g. it needs the real DB, a mocked network call, fake timers), say which mock/harness from `src/test/` covers it before writing code - don't discover the missing harness mid-test.
5. If understanding this scope reveals it's actually two scopes (found while reading, not obvious from the checklist wording alone), split it now rather than force both into one commit - note the split, do the smaller one, leave the other unchecked for next time.

Do not proceed to Phase 4 until you can list the edge cases without looking at the plan file again.

## Phase 4 - Write tests (test-first per CLAUDE.md)

For genuinely new coverage of existing, presumed-correct behavior (the common case in this file): write the test asserting the behavior you just enumerated, run it, confirm it passes for the right reason - not "it passed because I mistyped the assertion." Baseline work doesn't require watching it fail first (there's no code change yet to fail against), but it does require reading the assertion back against the source once more before moving on: does this actually pin the behavior, or just restate that a function returns *something*.

If Phase 3 turned up a real bug (not just an untested edge case - actual wrong behavior): stop, tell the user what's broken, and follow CLAUDE.md's bugfix rule - the test must reproduce the bug against the unfixed code first. Don't silently write a test that documents broken behavior as if it were correct.

Follow existing conventions: colocated `<file>.test.ts` next to source, `retry: false` implicitly (no QueryClient default retry to fight), fake timers for anything time-based, no snapshots, test names state behavior not function name.

## Phase 5 - Verify

```bash
pnpm test:run
cd src-tauri && cargo test    # only if Rust touched
pnpm tsc --noEmit             # confirm you didn't regress typecheck; note pre-existing red separately, don't chase it
```

All green, including the full suite - not just the new file. A new test file passing in isolation while breaking another (shared mock state, module-level cache bleed) is not done.

## Phase 6 - Record (mandatory, never deferred)

- Tick every `- [ ]` covered this pass to `- [x]` in `instructions/tests.md`.
- Add one row/entry to the "Progress log" section naming the new test file(s) and, in the same terse style as existing entries, exactly what's covered - specific enough that a future session can tell what's *not* covered without re-reading the test file.
- Bump the top-of-file test count line (`pnpm test:run` = N tests / M files) to the new totals.
- If Phase 3 found a real bug you fixed: add it to `.claude/rules/known-issues.md` per CLAUDE.md, same commit.
- If Phase 3 found a real bug you didn't fix (out of scope call): don't tick the box, write a `Follow-ups this pass created` bullet instead, and tell the user explicitly - don't bury a known bug in a passing-looking commit.

## Phase 7 - Commit (mandatory, never deferred)

Invoke the `/commit` skill. Then stop - the next scope is a separate invocation.

Do not stop at "tests pass". If you're about to end a turn and can't point to a `/commit` invocation in it, go back and run Phases 6 and 7.
