---
name: next
description: Pick items from what-to-do.md prioritizing high user impact, plan and implement them, then commit. Use when user says "next", "what's next", "do the next thing", or invokes /next.
---

You are invoked in plan mode. Work through these phases in order.

**Path note:** all `instructions/*.md` paths below are relative to project root (`/home/mschachner/Projects/Canon/instructions/`), NOT `.claude/skills/next/instructions/`. Don't create files under the skill dir.

## Phase 0 — Check donow.md

Read `instructions/donow.md` (create it if it doesn't exist yet).

- **If the file is empty or missing** → go to Research Mode (Phase 1R).
- **If the file has items** → go to Implement Mode (Phase 1I).

---

## RESEARCH MODE (donow.md is empty)

### Phase 1R — Read the backlog

Read `instructions/what-to-do.md`. Pick **3–5 items** prioritizing high user impact: great new features and meaningful UX/UI improvements over smaller code-quality or internal improvements.

### Phase 2R — Deep research each item

Spawn one `caveman:cavecrew-investigator` agent per item (run them in parallel). Each agent prompt must include:
1. The item title and a one-sentence description of what it is
2. Two search tasks:
   - **A. Reference projects:** grep `reference-projects/` broadly — by behavior, function name, related terms. Not just one project. Return: which project(s), file paths, key function/component names, pattern used, any notable gotcha.
   - **B. Canon current state:** locate relevant Canon code in `src/`. Return: existing files/components/hooks that relate, where new code slots in (file + approx line), existing abstractions/data to reuse, schema or API changes needed.

Collect all agent results before proceeding to Phase 3R.

### Phase 3R — Write donow.md

Write `instructions/donow.md` with one section per item. Use this format:

```markdown
## [Item title from backlog]

**What:** One-sentence description of the feature/fix.

**Reference patterns:**
- `reference-projects/<name>/path/to/file.ts` — [what it does / pattern used]
- (repeat for each relevant file)

**Canon current state:**
- Relevant existing file: `src/...` — [what it does now]
- Where new code fits: `src/...` near line ~N, inside [function/component]
- Data already available: [Zustand slice / React Query key / SQLite table]
- Schema/API changes needed: [yes/no, describe if yes]

**Implementation sketch:** 2–4 sentences on the approach. No code, just the plan.
```

Do not implement anything. Do not exit plan mode. Tell the user: research done, donow.md written with N items, run /next again to start implementing.

---

## IMPLEMENT MODE (donow.md has items)

### Phase 1I — Read the first item

Read the first item in `instructions/donow.md`. That is the only item for this run.

### Phase 2I — Plan

Present a concise plan:
- What you're building (one sentence)
- Files touched
- Any risks or open questions

Then immediately proceed to Phase 3I — do not wait for approval.

### Phase 3I — Implement

Exit plan mode and implement the item. Follow all rules in CLAUDE.md and the relevant `.claude/rules/` files for the files you touch.

**If the item is user-visible UI** (modal, sidebar, drawer, panel, buttons, chips, cards, form, or any new visual component): before writing code, spawn a `caveman:cavecrew-investigator` agent to find the closest existing Canon components of the same type in `src/`. Use those as the design template — match spacing, color tokens, font sizes, border radii, interaction patterns, and CSS variable usage exactly. Do not invent a new visual style.

When building any UI with hover-reveal buttons, cards, or interactive chips, read `instructions/ui-patterns.md` first.

After implementation, if you encountered any non-obvious rendering quirk, browser/WebKit edge case, or layout gotcha that isn't already in `instructions/ui-patterns.md`, append it.

**Do not start Canon in dev mode and do not take screenshots to verify.** Typecheck (`pnpm tsc --noEmit`) is sufficient for frontend changes. Rust changes: `cargo check`. The app is long-running and a dev instance is usually already open.

### Phase 3.5I — Docs for big user-visible changes

If item added/changed something user-visible and non-trivial (new view, new button, new feature — not small tweak/bugfix): add a line for it to `instructions/docs.md` tree (unmarked `[ ]`), then invoke `/docs` skill to write draft doc for it.

### Phase 4I — Remove item from donow.md

Delete the completed item's section from `instructions/donow.md`. If donow.md is now empty, truncate it to an empty file (do not delete the file).

### Phase 5I — Commit

Invoke the `/commit` skill. It will handle staging and the commit message. Before invoking `/commit`, also remove the completed item from `instructions/what-to-do.md`: delete its row from the table AND its detail section.

### Phase 6I — Release suggestion

After the commit, assess whether a release is warranted:
- **Suggest `/release`** if the work fixes a user-visible bug or completes a meaningful feature
- **Don't suggest** for internal refactors, partial work, or if other important items remain in what-to-do.md that belong in the same release

State the suggestion in one sentence.
