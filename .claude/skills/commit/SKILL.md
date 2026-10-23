---
name: commit
description: Commit current changes to development following Canon conventions. Use when user says "commit", "make a commit", or invokes /commit.
---

1. Be on `development` (or the current multi-session branch). Never `main`.
2. `git status` + `git diff HEAD`. Stage only files of this logical change by name; never `git add -A`, never anything under `instructions/`.
3. Strike finished items from their source queue (`instructions/donow.md`, `instructions/what-to-do.md`); those stay untracked.
4. `bash scripts/run-local-checks.sh` does not need to be run. It should be run at release time. If the feature is huge, and has possibly breaking changes - then still run the script.
5. Fold or separate: read `git log --oneline main..HEAD` (unreleased) and `git log --oneline @{u}..HEAD` (unpushed). If the change fixes, tweaks or finishes something an unpushed commit introduced (e.g. "Add visualizer" unpushed, then a visualizer bug fix or sizing change), fold it in: HEAD → `git commit --amend --no-edit`; older → `git commit --fixup=<sha>` then `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <sha>~1`. Reword the subject if it no longer describes the result. Already pushed, or a separate user-visible effect → own commit; never rewrite pushed history.
6. `git commit -m "<subject>"` per AGENTS.md Git rules: subject only, no body, no trailer, no mention of AI or tools.
