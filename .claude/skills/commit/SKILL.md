---
name: commit
description: Commit current changes to development following Canon conventions. Use when user says "commit", "make a commit", or invokes /commit.
---

Commit staged and unstaged changes on the development branch.

1. Run `git status` and `git diff HEAD` to understand what changed
2. Stage only files relevant to the logical change — never `git add -A` blindly
3. Write the commit message:
   - Subject: plain English, ≤72 chars, what changed
   - Body: 2–4 sentences, what was done and why — no filler
   - No `feat:`/`fix:`/`chore:` prefix
   - No `Co-Authored-By` or any trailer lines
   - No mention of Claude, AI, or any tool
4. Commit:
   ```bash
   git commit -m "$(cat <<'EOF'
   Subject line

   Body paragraph.
   EOF
   )"
   ```
