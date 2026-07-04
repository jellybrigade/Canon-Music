---
name: docs
description: Pick the most important undocumented item from instructions/docs.md, research the actual code, and write a highly technical draft doc for it. Use when user says "docs", "write docs", "next doc", or invokes /docs.
---

Paths below are relative to project root (`/home/mschachner/Projects/Canon/instructions/`), NOT the skill dir.

## Phase 1 — Pick the target

Read `instructions/docs.md` (the outline/feature inventory) and `instructions/docs-tech/` (create dir if missing — holds written drafts, one file per outline item, filename = slugified item text, e.g. `09-tags-review-tab.md`).

Items already documented are marked `[x]` (done) in `docs.md`; undocumented items are unmarked (or `[ ]`) — add checkboxes to any line lacking one. Pick the **single most important unmarked item** — prioritize by user impact and complexity (features a user would get stuck on without docs beat trivial/self-evident ones). Skip items that are just section headers with no concrete feature.

State which item you picked and why, in one sentence.

## Phase 2 — Research the code

This doc is technical, not user-facing — capture implementation truth, not prose explanation.

Spawn a `caveman:cavecrew-investigator` agent (or search directly if scope is small) to find:
- Every component/file/hook implementing this feature
- Every Tauri command, DB table/column, React Query key, Zustand slice it touches
- Exact UI structure: what button/menu/tab triggers it, what element opens, what it's labeled, keyboard shortcuts if any
- Edge cases, gotchas, or known issues already noted in `.claude/rules/known-issues.md` or code comments

Then read the actual files yourself — don't rely solely on agent summary — to verify exact strings (labels, prop names, table/column names) and get line numbers.

## Phase 3 — Write the doc

Write `instructions/docs-tech/<slug>.md`. Lead with the user's perspective — what they see, do, and get — and keep implementation detail in support of that, not as the main event. This still isn't final end-user prose (later pass rewrites for tone), but it should already read like a feature explanation a user could follow, not a code walkthrough.

1. **What it is** — one line, framed as user value ("lets you X" / "automatically does Y so you don't have to Z"), not as a pipeline/mechanism description.
2. **Entry points** — exact click path: "Settings → Metadata & Tags tab → 'Refresh All Now' button", including what opens (modal/panel/inline) and its exact heading text.
3. **Step by step** — numbered, literal, from the user's chair: what they press, what appears, what changes on screen, in order. Include keyboard shortcuts verbatim. Only mention internal mechanics here when they explain something the user would actually notice (a delay, a badge, a state change) — save the rest for Implementation.
4. **Edge cases / gotchas** — anything non-obvious a user could hit or get confused by, found in code or `known-issues.md`. Prioritize this section; it's more valuable than exhaustive internals.
5. **Implementation** — keep, but as reference/appendix, not the doc's center of gravity: file paths + line numbers for components/hooks/commands, DB schema touched, Tauri commands, React Query keys / Zustand slices. Don't narrate every function call — point to where the logic lives, don't reproduce it line-by-line.
6. **Open questions** — anything you couldn't verify from code (mark clearly, don't guess).

Precision still matters — don't soften facts or guess — but weight the doc toward what a user experiences, not toward a function-by-function trace of the code.

## Phase 4 — Mark done

In `instructions/docs.md`, check off the item: `[ ]` → `[x]`, and append a link to the written file, e.g. ` — see docs-tech/09-tags-review-tab.md`.

## Phase 5 — Done

Report the file written and one-sentence summary of what got documented. Do not commit — `instructions/` is gitignored and out of scope for `/commit`.
