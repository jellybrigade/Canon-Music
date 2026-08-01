---
name: pipeline
description: Review exactly one feature pipeline at a time from instructions/review.md, front to back (UI to state to data to storage to native), fixing bugs, leaks, and unclean code found along the way. Run repeatedly to work through the list. Use when user says "pipeline", "review pipeline", "next pipeline item", "review a feature", or invokes /pipeline.
---

You are invoked in plan mode. Work the phases in order.

**Path note:** `instructions/` lives at repo root (`/home/mschachner/Projects/Canon/instructions/`), not inside this skill's directory (`.claude/skills/pipeline/`). Don't `find`/`ls` under the skill dir looking for it.

**One item per invocation. Never two.** No batching, no "while I'm here I'll also check the neighbouring item", no parallel fan-out across items. Run `/pipeline` again for the next one.

Distinct from `/performance` (which profiles for speed against `performance-audit.md`) and `/code-review` (which reviews a diff). This skill reviews one *whole feature path* in the existing codebase, regardless of what changed recently.

## Phase 1 — Pick the item

Don't `Read` the whole file once it accumulates trailing notes. `grep` for the next unchecked item:

```bash
grep -m1 -n '^- \[ \] ' instructions/review.md
```

That first match, top to bottom, is the item. Exception: if the user named a specific feature, `grep -n` for its line by name instead (add it under the right section first if missing).

If no unchecked items remain, say so and stop.

State clearly at the start which single item this invocation covers.

## Phase 2 — Map the pipeline

**Mapping is ALWAYS delegated to an agent. Never map inline.** The main thread's context window is the scarce resource in this skill: Phase 3 needs room to hold the key files *and* reason across them, and a pipeline's grep/`ls`/dead-end output will eat that room before the review starts. So no inline `grep -rn` sweeps, no "quick" `ls`, no reading a file to find out whether it is relevant. If the agent's map comes back thin, send it back for more (`SendMessage`) or spawn a second one — do not fall back to searching yourself.

This holds even if the user rejects the agent call, interrupts, or tells you to carry on: re-propose the agent (a narrower prompt, a different agent type) and say why. Carrying on inline is not the fallback. The only searching the main thread ever does is `Read` on a specific file:line the map already named.

Spawn **one** `caveman:cavecrew-investigator` agent (per CLAUDE.md: research via explorer agents, never broad inline searches) to map the feature's full path. Ask it for a file:line map covering, wherever they apply:

- entry point UI — component(s), the control the user actually touches
- hooks called, and what they call in turn
- Zustand store slices read/written, and how broadly components subscribe
- React Query keys involved, their `staleTime`/invalidation, who else uses the same key
- SQLite reads/writes (`db.execute`/`select`, `src/db/**`, migrations touched)
- network calls (`src/lib/navidrome.ts`, `lastfm.ts`, `musicbrainz.ts`, external services) and their retry/timeout/rate-limit behaviour
- Tauri commands into `src-tauri/`, and what the Rust side does with them
- effects/listeners/intervals/timers set up, and their cleanup
- CSS files owning the feature's visual states

Read the key files directly yourself afterward — the agent locates, it does not judge. Read them by path from the map, not by searching for them.

## Phase 3 — Review the pipeline

Go stage by stage along the path. Hunt for:

**Correctness**
- race conditions: overlapping async writes, stale closures in effects, out-of-order responses applied to newer state, missing abort on unmount
- error paths that swallow failures silently (`catch {}`, ignored rejections) or surface an opaque message to the user
- state that can desync between store, cache, and SQLite (e.g. optimistic update with no rollback)
- edge cases: empty library, one item, very large library, offline, server 500, partial sync

**Memory & resources**
- `useEffect` without cleanup for listeners/intervals/timeouts/subscriptions
- `window`/`document` listeners never removed
- object URLs / blobs created and never revoked
- unbounded `Map`/`Set`/array caches with no eviction (check `src/lib/boundedCache.ts` — reuse it rather than rolling a new one)
- Rust-side caches (`CoverState`) and thread/permit lifetimes — see `.claude/rules/known-issues.md` for the thread-storm precedent

**Efficiency**
- N+1 queries, unbatched writes inside loops (`src/lib/db-batch.ts` exists — use it)
- duplicate queries fired by sibling components for the same data
- expensive computation on the render path instead of memoized
- store subscriptions broader than needed, causing re-render storms (playback-tick-driven UI especially)
- uncapped network fan-out (`src/lib/async-pool.ts`, `rate-limiter.ts` exist — use them)

**Cleanliness**
- dead code, unreachable branches, leftover debugging
- duplicated logic that belongs in one shared helper
- logic living at the wrong altitude (business logic in a component, presentation in a hook)
- em dashes / en dashes anywhere in `src/` (banned, see `.claude/rules/coding-standards.md`)

**UI completeness** (per `.claude/rules/design-guidelines.md`)
- missing loading / empty / error states, or a spinner where a skeleton belongs
- unstyled interactive states (hover, focus, active, disabled, selected)
- raw literals where a design token scale already exists
- empty state that says "nothing here" instead of teaching the interface

**Improvement — run this pass even when nothing above turned up.** Absence of bugs is not the end of the review. A pipeline with zero defects can still be slower, heavier, or clumsier than it needs to be. Ask, explicitly, for this feature:

- **Faster?** What is the actual latency the user feels here, and where does it go? Could work move off the critical path (prefetch, background, lazy), start earlier (fire the request before the view mounts), or not happen at all (cached, precomputed, derived)? Is a round trip to the server doing what a local query already answers, or vice versa?
- **Less work?** Is anything recomputed, refetched, or re-read that could not have changed? Could two passes over the same data become one? Could a query return fewer rows/columns? Is the app fetching a whole album to show one field?
- **Better shaped?** Is the data in the wrong form for how it is used (list scanned repeatedly where a lookup map belongs, sort on every render where sorted storage belongs, a shape the DB could return directly)?
- **Fewer moving parts?** Could this be done with one hook instead of three, one state source instead of two kept in sync, one query key instead of overlapping ones? Simpler is an improvement in its own right.
- **Scales?** Behaviour at 10 items vs 50,000 — does cost grow linearly with the library, and does it need to?
- **Better UX for the same cost?** Perceived speed (optimistic update, skeleton matching final layout, progressive reveal) often beats real speed and is usually cheaper.

Anything found here is a legitimate finding, ranked like the rest.

State findings plainly with file:line. **"Already clean, reason" is valid only after the improvement pass has genuinely run** — no defects found is common; *nothing at all worth improving* is rare, so say what you considered and rejected rather than closing the item with one line. Do not invent problems to justify the invocation either. Rank by severity/payoff; volume is not the goal.

## Phase 4 — Plan the fixes

In plan mode, propose what to change. Split explicitly:

- **fix now** — small, safe, clearly correct
- **ask first** — risky, cross-cutting, or a behaviour change the user should sign off on
- **backlog** — real but out of scope for this pass

Anything in the ask-first or backlog set is recorded as a `LATER:` line under the item (see Phase 7), whatever the user decides. Nothing found is allowed to evaporate just because it wasn't fixed.

Never silently widen scope from "review this feature" into a refactor of adjacent systems.

## Phase 5 — Implement

Exit plan mode. Apply the fix-now set. Then:

```bash
pnpm tsc --noEmit
cd src-tauri && cargo check     # only if Rust touched
```

For anything in the ask-first set, ask before touching it. Anything the user declines goes to backlog.

## Phase 6 — Verify

Show why each fix is correct, don't just assert it. For a leak: what was unbounded, what bounds it now. For a race: the interleaving that broke, and why it can't happen now.

If the change is UI-visible, write a concrete numbered manual check for the user — actions in the running app and the specific before/after difference this fix produces, not "click around". Then ask if they want a live check. **Do not auto-launch the app or browser automation** (`feedback-no-auto-browser-verify`).

## Phase 7 — Record

- Check the item's box in `instructions/review.md` and append a one-line trailing note: what was found and what changed (or "already clean, reason").
- Update `ARCHITECTURE.md` in the same commit if any file was added, moved, deleted, or repurposed, or a Tauri command / migration / invariant changed.
- **Everything found but not changed gets written into `instructions/review.md` directly beneath the item, one indented `LATER: <thing>` bullet each.** This covers anything left out because scope wouldn't allow it, because it was too risky, because it belongs to a different item, or because the user declined it. Each `LATER:` line carries enough context to be picked up standalone: the file:line, what the problem is, and the intended fix. Write these even when the user says no to acting on them — the point is that the finding survives the session.
- Anything deferred that is a genuine backlog item in its own right (a feature, not a defect in this pipeline) also goes to `/whattodo`.
- If a finding is a genuine platform gotcha or a bug class likely to recur, add it to `.claude/rules/known-issues.md`.

## Phase 8 — Commit

Invoke the `/commit` skill. Then stop — the next item is a separate invocation.
