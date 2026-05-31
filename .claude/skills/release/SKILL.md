---
name: release
description: Merge development to main and publish a new release. Use when user says "release", "ship it", "merge to main", or invokes /release.
---

Release Canon to main. Run these steps in order — do not skip any.

1. **Code review** — run `/code-review` on development. Fix every blocker before continuing.

2. **Determine next version** — read the current version from `src-tauri/tauri.conf.json`, apply semver:
   - Bugfixes only → patch (`x.y.Z`)
   - New features → minor (`x.Y.0`)
   - Breaking changes → major (`X.0.0`)

3. **Bump version** — update `"version"` in both `src-tauri/tauri.conf.json` and `package.json`, then commit on development:
   ```bash
   git add src-tauri/tauri.conf.json package.json
   git commit -m "Bump version to X.Y.Z"
   ```

4. **Merge to main**:

   These branches have unrelated histories, so `--allow-unrelated-histories` is required and will produce add/add conflicts on every file. Resolve all conflicts by taking development's version, then write the commit message explicitly with `--no-edit` forbidden — use `-m` instead. **Never use `git commit --no-edit` after resolving conflicts**: git appends a `# Conflicts:` block to `MERGE_MSG` that ends up in the stored commit message.

   ```bash
   git checkout main
   git merge --no-ff --allow-unrelated-histories development
   # Merge will fail with add/add conflicts on every file — that's expected
   git checkout --theirs -- .
   git add -A
   git commit -m "$(cat <<'EOF'
   Canon vX.Y.Z

   ### Added
   - <new user-visible feature>

   ### Fixed
   - <bug fix>

   ### Changed
   - <behavioral change, refactor, or improvement>
   EOF
   )"
   ```
   Omit a subheading if it has zero items. Summarize all changes since the last release — run `git log main..development --oneline` before writing to make sure nothing is missed.

5. **Push**: `git push` — CI reads the version from `tauri.conf.json`, creates the `vX.Y.Z` tag, and builds Windows / macOS / Linux artifacts automatically.

6. **Return to development**: `git checkout development`

7. **Confirm** (after CI finishes, ~5–10 min): `gh release view vX.Y.Z`
