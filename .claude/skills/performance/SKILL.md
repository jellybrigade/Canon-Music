---
name: performance
description: Audit or fix exactly one item at a time from instructions/performance-audit.md (fixing CRITICAL findings immediately), targeting at least 2-3x faster. Run repeatedly to work through the list. Use when user says "performance", "check performance", "audit performance", "next perf item", or invokes /performance.
---

You are invoked in plan mode. Work through these phases in order.

**Path note:** `instructions/` lives at repo root (`/home/mschachner/Projects/Canon/instructions/`), not inside this skill's own directory (`.claude/skills/performance/`). Don't `find`/`ls` under the skill dir looking for it.

## Peek mode ("what's next" / "/performance next")

If the user only wants to know the next item — phrases like "what's next", "next perf item", "peek", or `/performance next` — do **not** read the whole file (it's large: trailing audit notes on each line make it tens of KB even though it's only ~50 lines). Instead `grep` for just the one line that matters and stop; don't enter plan mode, don't run any phase below.

```bash
# next un-audited item (missing first checkbox):
grep -m1 -n '^- \[ \] \[' instructions/performance-audit.md
# if that returns nothing, next un-fixed item (audited, missing second checkbox):
grep -m1 -n '^- \[x\] \[ \]' instructions/performance-audit.md
# if that also returns nothing, everything's done
```

Report just that one line (item name + severity + note if present) and which stage it belongs to (audit vs fix). Nothing else — no investigation, no fix, no file edits.

Each item in the doc has **two checkboxes**: `[audited] [fixed]`. This skill runs in two separate stages — never interleave them across items:

- **Audit stage**: investigate + profile exactly **one** item missing its first checkbox — the first one, top to bottom — then stop. No code changes — except if that item turns out **CRITICAL**, which gets fixed immediately, in place, before stopping. Never audit more than one item per invocation, and never spawn more than one investigation agent at a time (no parallel/batch fan-out across items) — run `/performance` again for the next item.
- **Fix stage**: only starts once every item has its first checkbox checked AND every CRITICAL item also has its second checkbox checked. Then implements the fix for exactly **one** remaining un-fixed item — the first one, top to bottom — then stops.

## Phase 1 — Pick a stage

Read `instructions/performance-audit.md`. If the user named a specific item, use that one (find its line; add it under the right section first if missing) and infer stage from its checkbox state — handle it per Phase 2-4 below, then stop (don't sweep the rest of the doc).

Otherwise, decide the overall stage:

- Any item missing its **first** checkbox → **audit stage**. Go to Phase 2 for the single first such item (top to bottom), then stop — do not continue to any other item in this invocation.
- Else (every item audited) but some CRITICAL item still missing its **second** checkbox → fix that CRITICAL item (Phase 4-7), then stop.
- Else, if every item is audited and all CRITICAL items are fixed, but other items still miss their **second** checkbox → **fix stage**. Go to Phase 4 for the single first remaining un-fixed item (top to bottom), then stop.
- If every item has both boxes checked, say so and stop.

State clearly at the start which stage you're running and which single item it covers.

### Audit stage (one item)

Run Phase 2-3 on the item, write its findings note, and check its first box. If the finding is critical (data loss, crash, unbounded memory/resource growth, or similarly severe — not just "slow"), prefix the note with **CRITICAL** and immediately run Phase 4-7 on it before stopping. Non-critical items only get the first box checked in this stage — their fix waits for a later `/performance` invocation (fix stage).

### Fix stage (one item)

Run Phase 4-7 using the findings note already written on the item's line as the profiling result. Don't re-investigate from scratch — re-read the referenced files to confirm the note still matches current code before trusting it; if the code moved on since the audit, say so and re-profile that part only. Commit (Phase 8) after this one item's fix.

## Phase 2 — Locate + understand (the one item)

Spawn a single `caveman:cavecrew-investigator` agent (or read directly if scope is small) to map the item's actual code: component file(s), hooks it calls, queries it fires, store subscriptions, effects/listeners/intervals it sets up. Note dependency arrays, memoization already in place, list sizes involved (how many rows/items typically render). Do not spawn multiple agents in parallel for other items.

## Phase 3 — Profile, don't guess (the one item)

Find the concrete bottleneck(s). Do not fix anything here, unless it turns out CRITICAL (see loop rule above). Look for:

**Always check database calls/writes, even if item looks purely render-related.** Grep item's code path for `execute`/`select`/`db.` calls (SQLite via `tauri-plugin-sql`) — trace every query and write it triggers, not just ones in obvious data-fetch hooks. Specifically confirm: no N+1 (query per row instead of batch/join), no unbatched writes inside a loop (each `INSERT`/`UPDATE` its own `db.execute` call vs one batched statement/transaction), indexes exist for columns filtered/joined on, no duplicate/redundant query firing across sibling components for the same data.

- **Unnecessary re-renders**: missing `useMemo`/`useCallback`, new object/array literals passed as props each render, Zustand/store subscriptions too broad (whole store vs a selector), context values that change identity every render.
- **Expensive computation on the render path**: sorting/filtering/scoring large arrays inline instead of memoized, recomputing derived data every keystroke/tick.
- **List rendering cost**: no virtualization on long lists (`AlbumGrid`, `ArtistGrid`, `TrackTableView`, tag trees) when item count can grow large.
- **React Query issues**: missing/too-short `staleTime`, refetching on every mount, structural-sharing breaks (see `feedback-rq-set-bug` memory — never return a `Set`/`Map` from a `queryFn`), overlapping queries doing redundant work. Check the global `QueryClient` defaults (`src/main.tsx`) before flagging a missing per-hook `staleTime` as a bug — it may already be covered by a sane default.
- **SQLite query cost**: N+1 query patterns, missing indexes, unbatched writes in loops (`lib/sync.ts`, `useScrobbleFlush.ts`).
- **Memory leaks**: `useEffect` without cleanup for listeners/intervals/timeouts, growing `Map`/`Set`/array closures across renders that never evict, event listeners added to `window`/`document` never removed, Rust-side caches (`CoverState` HashMap) with no eviction policy.
- **Playback-tick-driven re-renders**: anything subscribing to progress/time updates that re-renders more than the visible UI needs (`PlayerBar`, `PlayerProgress`, `WaveformBars`, lyrics sync).
- **Fan-out concurrency**: enrichment/network fan-out with no concurrency cap (see recent commit "Cap concurrent artist enrichment fan-out" for precedent) or, conversely, over-throttled fan-out serializing work that could run in parallel.

Use React DevTools Profiler reasoning, `console.time`/count mentally, or direct code inspection — whichever fits. If genuinely uncertain whether something is a bottleneck without runtime data, say so plainly rather than fixing a guess.

State the concrete bottleneck(s) found, with file:line. If nothing real turns up, that's a valid outcome too — write "already fine, reason" instead of inventing an issue.

### Write findings, check first box, stop

In `instructions/performance-audit.md`, append a short trailing note to the item's line: file:line + what's wrong (or "already fine, reason"). Prefix the note with **CRITICAL** if it qualifies (see loop rule above). Check the item's **first** `[x]` box. If CRITICAL, immediately run Phase 4-7 on this item. Otherwise stop here — no commit, next `/performance` invocation picks up the next un-audited item.

## Phase 4 — Plan the fix (the one item, fix stage or CRITICAL item)

Propose the fix in plan mode, based on the item's findings note. Target: item's operation (initial render, re-render on interaction, background task) at least 2-3x faster, or the leak fully closed. Prefer:

- Narrowing store/context subscriptions over adding memoization band-aids everywhere.
- Fixing the root cause (wrong dependency array, missing cleanup, N+1 query) over papering with `useMemo` around symptoms.
- Virtualization (e.g. `react-window`/`react-virtual` if already a dependency, or windowing manually) only when list sizes genuinely warrant it — don't add virtualization to lists that are always short.
- Following `.claude/rules/state-management.md` and `.claude/rules/audio-playback.md` for any touched store/audio code.

## Phase 5 — Implement

Exit plan mode. Apply the fix. Typecheck (`pnpm tsc --noEmit`) and, if Rust touched, `cargo check`.

## Phase 6 — Verify the improvement

Don't just claim faster — show why: re-render count before/after (e.g. count of component mounts, query count, computed complexity), or reasoning for memory leak closure (what was unbounded, what now bounds it).

If the fix is UI-visible, always write out a concrete, numbered manual verification checklist for the user — actions to take in the running app and what to look for, tied to exactly what this fix changed (not generic "click around and check it feels fast"). Each step should name: what to do, and what the before/after difference should look like given this specific fix. Present this checklist even though live verification wasn't run per `feedback-no-auto-browser-verify` memory — the user needs to know what to check, not just that checking is possible. Then ask if they want you to do a live check now.

## Phase 7 — Update the tracking doc

In `instructions/performance-audit.md`, update the item's trailing note if the fix diverged from the original finding, and check the item's **second** `[x]` box.

If the fix deliberately deferred a further, more invasive optimization (e.g. a bigger architectural change ruled out of scope for this pass), invoke the `/whattodo` skill to add it to the backlog rather than letting it evaporate — note enough context (file, what was deferred, why) that a future session can pick it up standalone.

## Phase 8 — Commit

Invoke the `/commit` skill. In the audit stage, only do this after a CRITICAL item's own fix (Phase 4-7) — not after plain audit notes. In the fix stage, commit once after this one item's fix.
