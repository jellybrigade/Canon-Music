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
    echo "On main. All work belongs on development (see AGENTS.md)." >&2
    return 1
  fi
  echo "On $branch."
}

# instructions/ is gitignored; nothing from it may be staged.
staged_check() {
  local bad
  bad=$(git diff --cached --name-only | grep '^instructions/' || true)
  if [ -n "$bad" ]; then
    echo "Staged files under instructions/ (must stay untracked):" >&2
    echo "$bad" >&2
    return 1
  fi
  echo "No forbidden staged paths."
}

# Repo bans em/en dashes anywhere under src/ (see AGENTS.md).
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

# Comments cap at 3 content lines per run, and total comments cap at 40% of code lines
# (min 10) per file (see AGENTS.md); src/ has its own vitest sweep (commentLengthGuard.test.ts),
# this covers src-tauri/ which that sweep can't reach.
rust_comment_check() {
  local hits
  hits=$(find src-tauri/src -name '*.rs' -not -name '*_test.rs' -print0 | xargs -0 awk '
    function strip(l) { sub(/^\/\*\*?/, "", l); sub(/\*\/$/, "", l); sub(/^\/\/\/?!?/, "", l); sub(/^\*/, "", l); gsub(/^[ \t]+|[ \t]+$/, "", l); return l }
    function reset(   ) { run_len = 0; comment_lines = 0; code_lines = 0 }
    FNR == 1 { reset() }
    /^[ \t]*$/ { next }
    {
      line = $0; sub(/^[ \t]+/, "", line)
      is_comment = (line ~ /^(\/\/|\/\*|\*)/)
      if (is_comment) {
        if (run_len == 0) run_start = FNR
        if (strip(line) != "") { run_len++; comment_lines++ }
      } else {
        if (run_len > 3) print FILENAME ":" run_start " run"
        run_len = 0
        code_lines++
      }
    }
    ENDFILE {
      if (run_len > 3) print FILENAME ":" run_start " run"
      cap = code_lines * 0.4; if (cap < 10) cap = 10
      if (comment_lines > cap) print FILENAME ": " comment_lines " comments, cap " int(cap) + 1 " density"
    }
  ')
  if [ -n "$hits" ]; then
    echo "Comment cap exceeded in src-tauri/ (see AGENTS.md):" >&2
    echo "$hits" >&2
    return 1
  fi
  echo "No comment cap violations in src-tauri/."
}

# Fingerprint of every modified or untracked file, so the fix phase can name what it rewrote.
dirty_fingerprint() {
  { git diff HEAD --name-only; git ls-files --others --exclude-standard; } | sort -u | while read -r f; do
    [ -f "$f" ] && md5sum "$f"
  done | LC_ALL=C sort
}

# Fixers rewrite files in place, so they run one at a time before the checks read anything.
fix_phase() {
  local before after changed restage failed=0
  before=$(dirty_fingerprint)
  echo "Fixing formatting and lint..."
  pnpm biome check --write . >"$TMP_DIR/fix-biome.log" 2>&1 || true
  (cd src-tauri && cargo fmt) >"$TMP_DIR/fix-rustfmt.log" 2>&1 || failed=1
  (cd src-tauri && cargo clippy --fix --allow-dirty --allow-staged --all-targets) >"$TMP_DIR/fix-clippy.log" 2>&1 || true
  after=$(dirty_fingerprint)
  changed=$(LC_ALL=C comm -13 <(echo "$before") <(echo "$after") | awk '{print $2}')
  if [ -n "$changed" ]; then
    echo -e "${YELLOW}Rewrote these files; review and stage them again:${NC}"
    echo "$changed" | sed -e 's/^/  /'
  fi
  if [ "$failed" -ne 0 ]; then
    echo -e "${RED}cargo fmt failed:${NC}"
    sed -e 's/^/  /' "$TMP_DIR/fix-rustfmt.log"
  fi
  # Checks read the working tree, so a staged copy the fixers rewrote would pass here and commit unfixed.
  restage=$(LC_ALL=C comm -12 <(echo "$changed" | LC_ALL=C sort) <(git diff --cached --name-only | LC_ALL=C sort))
  if [ -n "$restage" ]; then
    echo -e "${RED}Staged files were rewritten; stage them again before committing:${NC}"
    echo "$restage" | sed -e 's/^/  /'
    failed=1
  fi
  return "$failed"
}

fix_phase || exit 1

echo "Running local checks..."

run_task branch      branch_check
run_task staged      staged_check
run_task dashes      dash_check
run_task rustcomment rust_comment_check
run_task typecheck   pnpm tsc --noEmit
run_task vitest      pnpm test:run
run_task cargo-test  bash -c 'cd src-tauri && cargo test'
run_task clippy      bash -c 'cd src-tauri && cargo clippy --all-targets -- -D warnings'
run_task biome       pnpm biome check .

TASKS=(branch staged dashes rustcomment biome typecheck vitest cargo-test clippy)
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
