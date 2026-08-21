#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$SCRIPT_DIR/.."
cd "$REPO_ROOT"

TMP_DIR=$(mktemp -d -t canon-checks-XXXXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT

GREEN="\033[0;32m"; RED="\033[0;31m"; YELLOW="\033[0;33m"; NC="\033[0m"

run_task() {
  local name="$1"; shift
  ("$@") >"$TMP_DIR/$name.log" 2>&1 &
  echo $! >"$TMP_DIR/$name.pid"
}

wait_task() {
  local name="$1"
  if wait "$(cat "$TMP_DIR/$name.pid")"; then echo 0 >"$TMP_DIR/$name.status"
  else echo 1 >"$TMP_DIR/$name.status"; fi
}

print_status() {
  local name="$1"
  local code; code=$(cat "$TMP_DIR/$name.status")
  if [ "$code" -eq 0 ]; then
    echo -e "${GREEN}ok${NC}   $name"
  else
    echo -e "${RED}FAIL${NC} $name"
    echo -e "${YELLOW}--- $name log (tail) ---${NC}"
    sed -e 's/^/  /' "$TMP_DIR/$name.log" | tail -n 120
  fi
}

# Not on main: development is the only branch that takes commits.
branch_check() {
  local branch; branch=$(git rev-parse --abbrev-ref HEAD)
  if [ "$branch" = "main" ]; then
    echo "On main. All work belongs on development (see .claude/rules/git-standards.md)." >&2
    return 1
  fi
  echo "On $branch."
}

# instructions/ is gitignored except docs-tech; nothing else from it may be staged.
staged_check() {
  local bad
  bad=$(git diff --cached --name-only | grep '^instructions/' | grep -v '^instructions/docs-tech/' || true)
  if [ -n "$bad" ]; then
    echo "Staged files under instructions/ (must stay untracked):" >&2
    echo "$bad" >&2
    return 1
  fi
  echo "No forbidden staged paths."
}

# Repo bans em/en dashes anywhere under src/ (see coding-standards.md).
dash_check() {
  local hits
  hits=$(grep -rn $'—\|–' src --include='*.ts' --include='*.tsx' --include='*.css' || true)
  if [ -n "$hits" ]; then
    echo "Em/en dash under src/:" >&2
    echo "$hits" >&2
    return 1
  fi
  echo "No em/en dashes in src/."
}

echo "Running local checks..."

run_task branch     branch_check
run_task staged     staged_check
run_task dashes     dash_check
run_task typecheck  pnpm tsc --noEmit
run_task vitest     pnpm test:run
run_task cargo-test bash -c 'cd src-tauri && cargo test'
run_task clippy     bash -c 'cd src-tauri && cargo clippy --all-targets -- -D warnings'
run_task rustfmt    bash -c 'cd src-tauri && cargo fmt --check'

TASKS=(branch staged dashes typecheck vitest cargo-test clippy rustfmt)
for t in "${TASKS[@]}"; do wait_task "$t"; done

echo
FAILED=0
for t in "${TASKS[@]}"; do
  print_status "$t"
  [ "$(cat "$TMP_DIR/$t.status")" -eq 0 ] || FAILED=1
done

echo
if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}All checks passed.${NC}"
else
  echo -e "${RED}Checks failed. Do not commit.${NC}"
fi
exit "$FAILED"
