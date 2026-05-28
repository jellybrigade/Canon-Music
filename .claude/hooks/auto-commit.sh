#!/usr/bin/env bash
# Fires on Stop. On dev branches: commits staged changes if any exist.
# If working-tree has untracked/modified-but-unstaged files, stages them too.
# After commit, checks if branch is significantly ahead of main → prints release suggestion.

set -euo pipefail
REPO=/home/mschachner/Projects/Canon
cd "$REPO"

# Only dev branches
BRANCH=$(git branch --show-current 2>/dev/null || true)
if [[ -z "$BRANCH" || "$BRANCH" == "main" ]]; then exit 0; fi

# Skip if tree is already clean
if git diff --quiet HEAD 2>/dev/null; then exit 0; fi

# Cooldown: skip if last commit was less than 90 seconds ago (prevents mid-task churn)
LAST_COMMIT_AGE=$(( $(date +%s) - $(git log -1 --format=%ct 2>/dev/null || echo 0) ))
if [[ "$LAST_COMMIT_AGE" -lt 90 ]]; then exit 0; fi

# Build context for message generation (skip lockfiles/build artifacts)
STAT=$(git diff HEAD --stat 2>/dev/null)
DIFF=$(git diff HEAD -- . \
  ':!*.lock' ':!pnpm-lock.yaml' ':!Cargo.lock' \
  ':!dist/' ':!node_modules/' ':!target/' \
  2>/dev/null | head -600)

MSG=$(claude -p "Write a git commit message for these changes to Canon (a Tauri+React desktop music player).

STAT:
$STAT

DIFF (truncated):
$DIFF

Rules:
- Title: ≤72 chars, plain English, what changed. No conventional-commit type prefix. No mention of AI, Claude, or any tool.
- Blank line after title.
- Body: 2-4 sentences explaining what changed and why.
- No Co-Authored-By line. No trailer lines of any kind.
- Output ONLY the raw commit message text. No markdown, no quotes, no preamble." 2>/dev/null || true)

[[ -z "$MSG" ]] && exit 0

git add -A
git commit -m "$MSG"

TITLE=$(printf '%s' "$MSG" | head -1)
echo "auto-committed: $TITLE"

# ── Release suggestion ────────────────────────────────────────────────────────
AHEAD=$(git rev-list --count main..HEAD 2>/dev/null || echo 0)
if [[ "$AHEAD" -lt 4 ]]; then exit 0; fi

COMMITS=$(git log main..HEAD --oneline 2>/dev/null)
LAST_VER=$(git describe --tags --abbrev=0 2>/dev/null | grep -oP '[0-9]+\.[0-9]+\.[0-9]+' || true)
[[ -z "$LAST_VER" ]] && LAST_VER="0.0.0"

RELEASE=$(claude -p "These $AHEAD commits are on dev branch '$BRANCH', not yet merged to main. Last release: v$LAST_VER.

$COMMITS

Classify each commit: does it add new user-visible functionality (minor), fix a bug (patch), or introduce a breaking change (major)?
Take the highest applicable tier, then calculate the next semver from $LAST_VER.

Output EXACTLY this format with real content (omit a subheading only if it has zero real items):

---
Suggest merging '$BRANCH' → main as: Canon vX.Y.Z

### Added
- <new feature>

### Fixed
- <bug fixed>

### Changed
- <behavioral or structural change>
---

Output ONLY the block above. No markdown fences, no extra text." 2>/dev/null || true)

[[ -n "$RELEASE" ]] && printf '\n%s\n' "$RELEASE"
