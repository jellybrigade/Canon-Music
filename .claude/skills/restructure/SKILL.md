---
name: restructure
description: Work the next unchecked step of the codebase structure plan in instructions/restructure.md (folder layout, file placement, doc organization), verify it, check it off and commit. Use when user says "restructure", "next restructure step", or invokes /restructure. Optional arg: a step number to work instead of the next one.
---

**Path note:** `instructions/restructure.md` is relative to project root
(`/home/mschachner/Projects/Canon/`), not this skill dir. After step 1 lands, some docs move
to `docs/`; follow the paths the plan and CLAUDE.md name at that point.

## 1. Pick the step

Read `instructions/restructure.md`. Work the first `- [ ]` step, or the step number passed
as an argument. One step per run. Tell the user in one line which step you are on.

If the step says "ask the user" or "stop and review", ask with AskUserQuestion before
moving anything. Don't guess a convention the user hasn't picked.

## 2. Map before moving

Delegate the inventory to `caveman:cavecrew-investigator` (per CLAUDE.md, no broad greps
inline): every file the step moves, and every place each old path is named - imports,
`vitest.config.ts`, `tsconfig.json`, CLAUDE.md, `.claude/rules/**` (including the greps
inside known-issues entries), `.claude/skills/**`, ARCHITECTURE.md, and the path globs in
guard tests (`coverArtGuard`, `serverScoping`, `sqlEscaping`, `cappedCacheGuard`,
`trackIdTables`).

Record each guard test's scanned-file count before the move, so you can confirm it after.

## 3. Move

- Tracked files: `git mv`. Untracked docs (`instructions/`): `mv` then `git add`.
- Behavior-neutral only. No logic changes, no drive-by fixes. A bug found mid-move goes to
  `instructions/donow.md` per its filing standard, not into this commit.
- Update every reference found in phase 2.
- Large-file splits (step 10): extract, don't rewrite. Moved code keeps its tests; a new
  seam holding logic gets a colocated test per CLAUDE.md.

## 4. Verify

1. `grep -rn "<old path>" . --exclude-dir={node_modules,target,dist,reference-projects,.git}`
   for each moved path: no hits.
2. Each guard test scans the same file count as before. A glob matching zero files passes
   silently - check it.
3. `bash scripts/run-local-checks.sh` green. Red: fix before committing. Pre-existing
   unrelated failure: confirm with `git stash`, file it in `donow.md`, say so.
4. The step's "Done when" holds. Verify it literally, don't assume it.

## 5. Record and commit

- Update ARCHITECTURE.md (wherever it lives by then) for every moved file.
- Check off the step in `instructions/restructure.md` (`- [x]`). If the step revealed
  something the plan got wrong, fix the plan text too.
- Commit on `development` per `git-standards.md`: subject only, no body, no trailer. A move
  is not a fix: "move tag files into one feature folder", "version architecture and test
  docs". A multi-commit step (7, 10) commits per unit.
- Don't stage anything still under `instructions/`.

## 6. Report

Two or three lines: step done, commit(s), anything filed to `donow.md`, next step name.
Don't start the next step unless the user asks.
