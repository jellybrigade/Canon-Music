---
name: next
description: Work the top item of instructions/donow.md (or, if donow is empty, the top item of what-to-do.md). Small, clear bugs go straight to a fix; features and unclear bugs run through feature-dev with Canon's rules. Then commit. Use when user says "next", "what's next", "do the next thing", "donow", or invokes /next.
---

Paths are relative to the repo root, never this skill's dir.

## Standing rules

- **Announce the item first.** Before any other work, tell the user which item this run works on, by its donow/what-to-do title, and which track (direct or feature-dev). Item swapped mid-run (already fixed, rewritten): announce the new one too.
- **One item per session.** This session already finished an item → recommend `/clear` and stop.
- **File every finding.** Any problem you hit that is not your item (failing/flaky test, red check, bug noticed in passing, stale donow entry) goes into `instructions/donow.md` before the run ends. Don't silently fix or ignore it. Stash and re-run to say whether it reproduces on a clean tree. File it under the right tier in donow's item format, with a `Done when:` line; a class gets its grep.
- **Never invent behavior.** A choice the item, `docs/decisions.md` and AGENTS.md don't settle (what the user sees, ordering, defaults, edge cases) → ask, then add a `docs/decisions.md` entry in the same commit as the code.
- **Done when.** Every item ends with 1-3 checkable points (a test that fails today, a command and its output, a user-visible behavior). Item has none → write them before implementing. The run is done only when each one is proven in the report.

## 1. Pick the item

1. Top item of `instructions/donow.md`, tier by tier. Only that one.
2. donow empty → top row of `instructions/what-to-do.md`, High priority first, user impact first. Take its detail section as the request.
3. Read the `docs/known-issues.md` sections matching the area and `docs/decisions.md`.

## 2. Verify bugs

Bug items only (skip for features): one `caveman:cavecrew-investigator` answers separately (a) does the symptom exist today (check `git log`, `git tag --contains`), (b) is the stated cause the real cause. Wrong cause: rewrite the item, tell the user, proceed. Not found or already fixed: delete it from donow and what-to-do, report evidence, take the next item (already fixed but unreleased: say `/release` is the work).

## 3. Choose the track

- **Direct**: verified bug with a known cause, or a donow item whose fix is already spelled out, touching about 1-3 files, no open behavior choice, no schema change. Go to section 4.
- **feature-dev**: everything else: every what-to-do feature, bugs with an unclear cause or a class across many places, races, new Rust commands, schema changes, anything with an open design choice. Go to section 5.
- Phase item (`instructions/<slug>.md`, see section 6): its plan is approved, so run section 5 from phase 5 onward on that phase only.

## 4. Direct track

1. **Plan** in 3 lines (what, files, risks) plus the `Done when` points, then proceed without waiting.
2. **Implement test-first** per AGENTS.md. UI work: have an investigator find the closest existing component and match its tokens and patterns. Don't launch the app or screenshot.
3. Continue with section 7.

## 5. feature-dev track

Invoke the `feature-dev:feature-dev` skill with the item text (title, detail section, any donow notes) as the request. Follow its phases, with these Canon rules on top:

- **Phase 1 Discovery**: the item is the request. Don't ask the user to confirm an understanding that the item already states; draft the `Done when` points here.
- **Phase 2 Exploration**: the `code-explorer` agents cover (a) precedent in `~/Projects/_ref/` (psysonic first for anything Rust or playback): files, pattern, gotchas; (b) where it slots into Canon: what data exists, schema/API changes, the store or query layer it touches; (c) for UI, the closest existing component and its tokens. Give each the AGENTS.md rules that apply to its area.
- **Phase 3 Questions**: ask everything in one message, together with the drafted `Done when` points so the user can correct them. Each answer that fixes behavior becomes a `docs/decisions.md` entry. No open questions → say so and move on.
- **Phase 4 Architecture**: the `code-architect` agents get the AGENTS.md constraints that bind this change (Rust scope, keychain, migrations, `library_write/` transactions, tokens, Biome/clippy rules). Present the recommendation and wait for approval. Work too big for one session → write the approved plan as `instructions/<slug>.md` (section 6) and implement only its first phase now.
- **Phase 5 Implementation**: test-first per AGENTS.md, waste assertions where they apply. Don't launch the app or screenshot.
- **Phase 6 Review**: fix every finding the `code-reviewer` agents return without asking, the same as `/release`. Ask only when a fix needs a behavior choice. Findings outside this item go to donow.
- **Phase 7 Summary**: becomes section 7 below.

## 6. Multi-session plans

`instructions/<slug>.md` (untracked, like the queues):

```markdown
# <Feature>

Goal: <one sentence, user-visible>
Not in scope: <list>
Decisions: D-<n>, ...

## [ ] 1 <phase title>
<what, files, risks>
Done when:
- <checkable point>

## [ ] 2 <phase title>
...
```

Add one donow item at the top of the matching tier: `**<Feature>, next phase.** See instructions/<slug>.md. Done when: that phase's points.` Finishing a phase: `## [ ]` → `## [x] (YYYY-MM-DD, <short hash>)`; keep the donow item until the last phase is checked, then delete it and the plan file.

## 7. Finish

1. **Done gate**: targeted only: `pnpm vitest run <touched areas>`, `pnpm tsc --noEmit` if TS changed, `cargo test` if Rust changed, ARCHITECTURE updated. Full `bash scripts/run-local-checks.sh` only when `/commit` step 4 calls for it (huge or possibly breaking). Prove each `Done when` point; one not met → the item stays, its open points are written back into it.
2. **Remove the item** from donow.md (and its row + detail section from what-to-do.md if it came from there); add this run's findings in the same edit.
3. **Commit** via `/commit`.
4. **Report**: what was built, each `Done when` point with its proof, decisions recorded, one-line `/release` suggestion if the work is user-visible, plus every failure hit, whether it's pre-existing, and that it's filed.
