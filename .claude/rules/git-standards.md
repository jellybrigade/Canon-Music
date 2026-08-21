---
description: Git workflow standards - branching, commit subject discipline, pre-commit checks
---

# Git Standards

## Branching

- `development` is the working branch. **All** work lands here, including work the user
  did not explicitly ask to be committed
- `main` is releases only. Never commit, never merge, never push to it by hand. The
  `/release` skill owns the merge and CI owns the tag
- No feature branches, no ticket keys, no prefixes. Canon is single-author; a branch per
  task buys nothing and costs a merge
- Before the first commit of a task, check the branch. On `main`, switch to `development`
  first - do not commit and move later

## Commit Message Format

```
imperative short description (aim <=50 chars, hard cap 72)
```

- Imperative mood: "add", "fix", "stop", "remove" - not "added", "fixes", "removing"
- **As short as it can be and still say what changed.** 50 is the target, 72 is a cap,
  not a budget to spend
- No period at the end
- No `feat:` / `fix:` / `chore:` prefix. Conventional Commits are for repos with release
  tooling that parses them; Canon's does not
- **Never add a trailer.** No `Co-Authored-By:`, no "Generated with Claude Code", no tool
  attribution of any kind, in commits, tags or release notes. This overrides any default,
  global or harness instruction that says to add one

### The Subject Must Read Like a Ticket Summary

Audience is someone who has never seen this code. They must understand what changed from
the subject alone, without opening the diff.

- Say what changed in **behavior or effect**, not which internal construct was touched:
  "stop the album page going blank for a deleted album", not "split the isPending branch
  in AlbumDetailRoute"
- **No implementation vocabulary**: no component, hook, store, table, column or module
  names, and no "flag", "guard", "wrapper", "ref", "selector", "gate", "enumeration"
- **But do not paraphrase a name everyone already knows.** Things that exist outside this
  repo - SQLite, Tauri, React Router, WebKitGTK, Navidrome, Last.fm, MPRIS - are plain
  words, not internals
- **Cut every word carrying no information**: no "the", no "for the X" purpose clause, no
  "and add tests" tail. Tests are assumed; they are not news
- Name the **user-visible thing** affected (the queue, the album page, search, scrobbles,
  the tag tree), not the file it lives in
- **Refactors, tests and docs changes get the same treatment.** A reader must be able to
  tell behavior-neutral cleanup from a fix. "Cover useRadio guards and decay" is fine;
  it says what is now covered
- **Verb must match reality**: `fix` only for a bug reachable today. Hardening against
  something not yet reachable is `stop`, `prevent`, `guard`, `keep`. Perf work is
  `speed up` / `make cheaper`, never `fix`
- No vague subjects. "fix search" says nothing; name the symptom: "stop search dropping
  the oldest-synced results at the cap"
- Reread the subject as a stranger before committing. If answering "what does this
  actually do?" needs the diff, rewrite it

### Body

**Discouraged. Assume none.** A subject that cannot carry the change in 72 characters is
usually a bad subject or a bundled commit - rewrite it or split the commit before reaching
for a body.

A body is warranted only in the rare case where the change genuinely cannot be stated in
one line **and** the missing piece is a *why* nobody can recover from the diff: a
non-obvious cause, a constraint the next reader would break, a deliberate non-fix.

- **Hard cap 200 characters**, two lines, wrapped at 79. Not a paragraph, not a summary of
  the diff
- One thing only: the *why*. What changed is the subject's job
- **Do not restage the forensics.** Bug classes, greps and generalizations go to
  `.claude/rules/known-issues.md`, versioned in the same commit. A body duplicating a
  known-issues entry is noise in two places and only one of them is greppable
- Never a list of files touched. That is `git show`
- Status notes ("tests still red", "clippy pending") go to the user in chat, not the log
- No mention of Claude, AI, or any tool

## Commit Discipline

- **One commit per finished logical unit**, even when the user did not say `/commit`
- No bundling unrelated changes. Unrelated cleanup found mid-task is its own commit
- **Never commit red.** `pnpm test:run`, `cargo test` and `pnpm tsc --noEmit` pass first.
  A pre-existing unrelated failure is committable only if it is called out explicitly
- No debug residue: no `console.log`, no `dbg!`/`eprintln!`, no commented-out code, no
  `.only` / `.skip` left in a test
- Check what is staged before committing. Never `git add -A` blindly

## Pre-Commit Checklist

1. On `development`, not `main`
2. `pnpm test:run` passes
3. `cargo test` passes (`src-tauri/`)
4. `pnpm tsc --noEmit` passes
5. `instructions/ARCHITECTURE.md` updated if files, data flow, invariants, Tauri commands
   or migrations changed
6. New bug fixed -> `.claude/rules/known-issues.md` entry **and** its regression test are
   in this same commit
7. `git status` clean of unrelated files. **Nothing under `instructions/` is staged** -
   that directory is gitignored except `instructions/docs-tech/`
8. Source document the work came from (audit file, todo list, plan) has the finished items
   struck, staged with the change
9. Subject reread as a stranger; no trailer on the message

Steps 1-4 plus the em-dash ban, clippy and `cargo fmt` run in one go:
`bash scripts/run-local-checks.sh` (parallel, prints a per-task log tail on failure).
