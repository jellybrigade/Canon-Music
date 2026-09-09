---
description: Known build/release pipeline bugs already shipped once - full detail
globs:
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
