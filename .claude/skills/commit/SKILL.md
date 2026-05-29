---
name: commit
description: Commit changes or merge to main following Canon project conventions. Use when user says "commit", "make a commit", "merge to main", "release", or invokes /commit.
---

Commit changes or release to main following Canon conventions.

## Dev branch commit

1. Run `git status` and `git diff` to understand what changed
2. Stage only files relevant to the logical change — never `git add -A` blindly
3. Write the commit message:
   - Subject: plain English, ≤72 chars, what changed
   - Body: 2–4 sentences, what was done and why — no filler
   - No `feat:`/`fix:`/`chore:` prefix
   - No `Co-Authored-By` or any trailer lines
   - No mention of Claude, AI, or any tool
   - No reference to phases, sprints, tasks, or planning artifacts
4. Commit with `git commit -m "$(cat <<'EOF' ... EOF)"`

## Release to Canon-Music

Canon-Development has only one permanent branch: `development`. Releases go to Canon-Music via an ephemeral local `release` branch that is stripped of internal files and never pushed to Canon-Development.

**Two remotes:** `origin` = Canon-Development (private), `public` = Canon-Music (public). One-time setup: `git remote add public git@github.com:jellybrigade/Canon-Music.git`

**Run these steps in order. Do not skip.**

1. Run `/code-review` on development. Fix every blocker before proceeding.
2. Determine the next version from Canon-Music — not local tags:
   ```bash
   git ls-remote --tags public | grep -oP 'refs/tags/v\K[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1
   ```
   If empty → `v0.1.0`. Apply semver (bugfixes → patch, features → minor, breaking → major). Never reuse a version.
3. Bump `"version"` in `src-tauri/tauri.conf.json` and `package.json` to match `X.Y.Z`. Commit on `development`:
   ```bash
   git add src-tauri/tauri.conf.json package.json
   git commit -m "Bump version to X.Y.Z"
   git push origin development
   ```
4. Create the release branch, strip internal files, and commit:
   ```bash
   git checkout -b release
   git rm -r --cached .claude .vscode CLAUDE.md ARCHITECTURE.md audit.md HANDOFF.md plan.md v2-redesign.md what-to-do.txt reference-projects/ 2>/dev/null || true
   git commit -m "$(cat <<'EOF'
   Canon vX.Y.Z

   ### Added
   - ...

   ### Fixed
   - ...

   ### Changed
   - ...
   EOF
   )"
   ```
   Omit a subheading with zero real items. The PostToolUse hook auto-creates annotated tag `vX.Y.Z` on this commit.
5. Push to Canon-Music and clean up:
   ```bash
   git push public release:main && git push public --tags
   git checkout development
   git branch -d release
   ```
   Pushing the tag triggers `.github/workflows/release.yml` on Canon-Music, building Linux AppImage, macOS universal DMG, and Windows NSIS installer via matrix runners.
6. Confirm: `gh release view vX.Y.Z --repo jellybrigade/Canon-Music` (allow a few minutes for CI).
