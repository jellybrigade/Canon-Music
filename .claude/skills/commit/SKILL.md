---
name: commit
description: Commit current changes to development following Canon conventions. Use when user says "commit", "make a commit", or invokes /commit.
---

1. Be on `development` (or the current multi-session branch). Never `main`.
2. `git status` + `git diff HEAD`. Stage only files of this logical change by name; never `git add -A`, never anything under `instructions/`.
3. Strike finished items from their source queue (`instructions/donow.md`, `instructions/what-to-do.md`); those stay untracked.
4. `bash scripts/run-local-checks.sh` green. Pre-existing unrelated failure: say so.
5. `git commit -m "<subject>"` per AGENTS.md Git rules: subject only, no body, no trailer, no mention of AI or tools.
