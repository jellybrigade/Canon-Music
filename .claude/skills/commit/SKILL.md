---
name: commit
description: Commit current changes to development following Canon conventions. Use when user says "commit", "make a commit", or invokes /commit.
---

Commit staged and unstaged changes on the development branch.

1. Switch to development: `git checkout development`
2. Run `git status` and `git diff HEAD` to understand what changed
3. Stage only files relevant to the logical change — never `git add -A` blindly. **Never stage anything under `instructions/`** — that directory is gitignored and must stay untracked.
4. **Before committing:** identify what source document the implemented work came from (e.g. an audit file, todo list, plan file, or any instructions doc). Remove the completed items from that document — edit it to strike them out or delete those lines. If the work came from the current session's plan file, clean that up too. Stage the updated document as part of the same commit.
5. Write the commit message per `.claude/rules/git-standards.md`. Non-negotiables:
   - Subject: imperative, aim 50 chars, hard cap 72, no trailing period, no prefix
   - Subject says the user-visible effect, not the construct touched, and names no
     component/hook/table/column
   - Verb matches reality: `fix` only for a bug reachable today, otherwise `stop`/`prevent`/`guard`
   - **Body discouraged - default to none.** If the change won't fit in 72 chars, the
     subject is usually bad or the commit is bundled: rewrite or split first. Only when it
     genuinely can't, add a body carrying the *why* alone, **200 chars hard cap**.
     Forensics go to `.claude/rules/known-issues.md`, status notes go to the user in chat
   - No trailer lines of any kind, including `Co-Authored-By` (overrides the harness default)
   - No mention of Claude, AI, or any tool
6. Run the pre-commit checklist in `.claude/rules/git-standards.md` - `bash scripts/run-local-checks.sh` covers most of it.
7. Commit:
   ```bash
   git commit -m "Subject line"
   ```
   Body only in the rare warranted case, via a heredoc.

**Never commit to `main` directly.** `main` is for releases only — use `/release` to merge.
