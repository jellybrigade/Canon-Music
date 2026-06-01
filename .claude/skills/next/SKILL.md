---
name: next
description: Pick 1-3 items from what-to-do.txt, plan and implement them, then commit. Use when user says "next", "what's next", "do the next thing", or invokes /next.
---

You are invoked in plan mode. Work through these phases in order.

## Phase 1 — Read the backlog

Read `what-to-do.txt` in the project root.

## Phase 2 — Pick work

Select 1–3 items that form a coherent batch. Prefer:
- Items that touch the same area of the codebase (fewer context switches)
- Bugs over enhancements when both are present
- Smaller, self-contained items over large open-ended ones

Do not pick more than 3. One focused item is better than three sprawling ones.

## Phase 3 — Plan (stay in plan mode)

Present the plan to the user:
- Which items you picked and why
- High-level implementation approach for each
- Files likely touched
- Any risks or open questions

Wait for user approval before proceeding. If the user wants to adjust scope or approach, revise the plan until they approve.

## Phase 4 — Implement

Exit plan mode and implement the approved plan. Follow all rules in CLAUDE.md and the relevant `.claude/rules/` files for the files you touch. Keep ARCHITECTURE.md current if any files are added, moved, or substantially repurposed.

## Phase 5 — Commit

When implementation is complete, invoke the `/commit` skill. It will handle staging, cleanup of what-to-do.txt, and the commit message.

## Phase 6 — Release suggestion

After the commit, assess whether a release is warranted:
- **Suggest `/release`** if the work fixes a user-visible bug or completes a meaningful feature
- **Don't suggest** for internal refactors, partial work, or if other important items remain in what-to-do.txt that belong in the same release

State the suggestion in one sentence.
