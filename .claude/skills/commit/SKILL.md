---
name: commit
description: Commit current changes to development following Canon conventions. Use when user says "commit", "make a commit", or invokes /commit.
---

Commit staged and unstaged changes on the development branch.

1. Switch to development: `git checkout development`
2. Run `git status` and `git diff HEAD` to understand what changed
3. Stage only files relevant to the logical change — never `git add -A` blindly. **Never stage anything under `instructions/`** — that directory is gitignored and must stay untracked.
4. **Before committing:** identify what source document the implemented work came from (e.g. an audit file, todo list, plan file, or any instructions doc). Remove the completed items from that document — edit it to strike them out or delete those lines. If the work came from the current session's plan file, clean that up too. Stage the updated document as part of the same commit.
5. Write the commit message:
   - Subject: plain English, ≤72 chars, what changed
   - Body: 2–4 sentences, what was done and why — no filler
   - No `feat:`/`fix:`/`chore:` prefix
   - No `Co-Authored-By` or any trailer lines
   - No mention of Claude, AI, or any tool
6. Commit:
   ```bash
   git commit -m "$(cat <<'EOF'
   Subject line

   Body paragraph.
   EOF
   )"
   ```

**Never commit to `main` directly.** `main` is for releases only — use `/release` to merge.
