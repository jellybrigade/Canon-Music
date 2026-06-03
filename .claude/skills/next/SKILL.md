---
name: next
description: Pick 1-3 items from what-to-do.md, plan and implement them, then commit. Use when user says "next", "what's next", "do the next thing", or invokes /next.
---

You are invoked in plan mode. Work through these phases in order.

## Phase 1 — Read the backlog

Read `instructions/what-to-do.md`.

## Phase 2 — Pick work

Start by picking **1–2 items** as your anchor:
- Bugs over enhancements when both are present
- Smaller, self-contained items over large open-ended ones

Then scan the rest of the backlog: for each remaining item, check whether it touches the same files, components, or logic as your anchor. If it does, pull it into the batch — do all related work in one pass rather than revisiting the same area twice.

There is no hard cap, but the batch must stay coherent. If an item touches the same files but pulls in unrelated scope, leave it out.

## Phase 3 — Plan (stay in plan mode)

Present the plan to the user:
- Which items you picked and why
- High-level implementation approach for each
- Files likely touched
- Any risks or open questions

Wait for user approval before proceeding. If the user wants to adjust scope or approach, revise the plan until they approve.

## Phase 4 — Implement

Exit plan mode and implement the approved plan. Follow all rules in CLAUDE.md and the relevant `.claude/rules/` files for the files you touch. Keep ARCHITECTURE.md current if any files are added, moved, or substantially repurposed.

**Do not start Canon in dev mode and do not take screenshots to verify.** Typecheck (`pnpm tsc --noEmit`) is sufficient for frontend changes. Rust changes: `cargo check`. The app is long-running and a dev instance is usually already open.

## Phase 5 — Commit

When implementation is complete, invoke the `/commit` skill. It will handle staging and the commit message. Before invoking `/commit`, remove the completed items from `instructions/what-to-do.md`: delete each item's row from the table AND its detail section.

## Phase 6 — Release suggestion

After the commit, assess whether a release is warranted:
- **Suggest `/release`** if the work fixes a user-visible bug or completes a meaningful feature
- **Don't suggest** for internal refactors, partial work, or if other important items remain in what-to-do.md that belong in the same release

State the suggestion in one sentence.
