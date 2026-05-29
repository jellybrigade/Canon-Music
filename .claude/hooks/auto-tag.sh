#!/usr/bin/env bash
# Fires after any Bash tool use.
# When a release commit lands on main (title: "Canon vX.Y.Z"), creates an annotated tag.

cd /home/mschachner/Projects/Canon || exit 0

BRANCH=$(git branch --show-current 2>/dev/null || true)
[[ "$BRANCH" != "main" && "$BRANCH" != "release" ]] && exit 0

TITLE=$(git log -1 --format=%s 2>/dev/null || true)
VERSION=$(printf '%s' "$TITLE" | grep -oP '(?<=Canon v)[0-9]+\.[0-9]+\.[0-9]+' || true)
[[ -z "$VERSION" ]] && exit 0

# Skip if already tagged
EXISTING=$(git tag --points-at HEAD 2>/dev/null || true)
[[ -n "$EXISTING" ]] && exit 0

BODY=$(git log -1 --format=%B 2>/dev/null)
git tag -a "v$VERSION" -m "$BODY"
echo "Tagged v$VERSION — push with: git push && git push --tags"
