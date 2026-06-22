---
name: next
description: Pick items from what-to-do.md prioritizing high user impact, plan and implement them, then commit. Use when user says "next", "what's next", "do the next thing", or invokes /next.
---

You are invoked in plan mode. Work through these phases in order.

## Phase 1 — Read the backlog

Read `instructions/what-to-do.md`.

## Phase 2 — Pick work

**Prioritize high user impact first:** great new features and meaningful UX/UI improvements over smaller code-quality or internal improvements. An item that delights the user beats one that tidies the codebase.

Then estimate effort for your top candidates:
- **Low effort** (cosmetic, config, small isolated change) → pick up to **5** items
- **Medium effort** (single feature, moderate cross-file change) → pick up to **3** items
- **High effort** (new subsystem, broad refactor, complex feature) → pick **1** item

Use that cap as the batch size. Then scan the remaining backlog: for each item, check whether it touches the same files, components, or logic as your anchor picks. If it does and stays within the cap, pull it in — do all related work in one pass rather than revisiting the same area twice.

The batch must stay coherent. If an item touches the same files but pulls in unrelated scope, leave it out.

## Phase 2.5 — Research reference projects

Before planning, grep `reference-projects/` for how they handle the problem:

- **For any item** (bug, idea, or audit finding): search all reference projects, not just the one credited in the audit table. A feature attributed to one project may be implemented better in another. Cast wide — search by behavior, function name, and related terms.
- Use the findings to inform the implementation approach: copy the best pattern, adapt it to Canon's stack, and note in the plan which project(s) you drew from.

## Phase 3 — Plan (stay in plan mode)

Present the plan to the user:
- Which items you picked and why
- High-level implementation approach for each
- Files likely touched
- Any risks or open questions

Then immediately proceed to Phase 4 — do not wait for approval.

## Phase 4 — Implement

Exit plan mode and implement the approved plan. Follow all rules in CLAUDE.md and the relevant `.claude/rules/` files for the files you touch.

When building any UI with hover-reveal buttons, cards, or interactive chips, read `instructions/ui-patterns.md` first.

After implementation, if you encountered any non-obvious rendering quirk, browser/WebKit edge case, or layout gotcha that isn't already in `instructions/ui-patterns.md`, append it. One section per pattern: what the symptom was, root cause, fix.

**Do not start Canon in dev mode and do not take screenshots to verify.** Typecheck (`pnpm tsc --noEmit`) is sufficient for frontend changes. Rust changes: `cargo check`. The app is long-running and a dev instance is usually already open.

## Phase 5 — Commit

When implementation is complete, invoke the `/commit` skill. It will handle staging and the commit message. Before invoking `/commit`, remove the completed items from `instructions/what-to-do.md`: delete each item's row from the table AND its detail section.

## Phase 6 — Release suggestion

After the commit, assess whether a release is warranted:
- **Suggest `/release`** if the work fixes a user-visible bug or completes a meaningful feature
- **Don't suggest** for internal refactors, partial work, or if other important items remain in what-to-do.md that belong in the same release

State the suggestion in one sentence.
