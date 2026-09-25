---
description: Known build/release pipeline bugs already shipped once - full detail
paths:
  - ".github/**"
  - "scripts/**"
  - "package.json"
  - "src-tauri/tauri.conf.json"
---

# Build / release pipeline

Bug classes that already shipped once. Heading = lesson. Greps kept, forensics in git.
Fixed unless marked OPEN.

- **Test-only devDependency breaks the release build.** `better-sqlite3` node-gyp ran on every release runner, broke Windows silently under `fail-fast: false`. Fix: `--ignore-scripts` + explicit `pnpm rebuild esbuild`.
  ```
  node -p "require('./package.json').pnpm.onlyBuiltDependencies.join(' ')"
  grep -rn "better-sqlite3" src --include='*.ts*' | grep -v '/test/\|\.test\.'
  ```
- **Green release page != complete release.** `fail-fast: false` matrix hides dead platforms. After `/release`, count assets.
  ```
  gh release view "v$(node -p "require('./src-tauri/tauri.conf.json').version")" --json assets --jq '.assets[].name'
  ```
- **`commit-msg` runs before git's own message cleanup.** The editor's `# Please enter the commit message` template and `commit -v`'s scissors diff are still in the file, so the body check counted them and rejected every commit not made with `-m`. Fix: strip `core.commentChar` lines and everything from the `>8` scissors line before counting.
  ```
  sh -c 'd=$(mktemp -d); git -C "$d" init -q .; mkdir -p "$d/h"; cp scripts/git-hooks/commit-msg "$d/h/"; git -C "$d" config core.hooksPath h; git -C "$d" config user.email t@t; git -C "$d" config user.name t; git -C "$d" commit -q --allow-empty -m x && GIT_EDITOR="sh -c \"echo subject only > \$1\" --" git -C "$d" commit -q --allow-empty && echo hook-ok; rm -rf "$d"'
  ```
- **Message-shape hook must exempt the release merge commit.** The subject-only rule is a `development` rule; `/release` writes the user-facing release notes as the merge commit's body on `main`, and the hook rejected them, stopping the release halfway with `main` already merged. Fix: `MERGE_HEAD` present or `HEAD` on `main` skips the body check. Trailers stay banned everywhere.
  ```
  sh -c 'printf "Canon v0.0.0\n\n### Fixed\n- thing\n" > /tmp/rn.txt; git rev-parse --abbrev-ref HEAD | grep -q main && sh scripts/git-hooks/commit-msg /tmp/rn.txt && echo notes-ok'
  ```
