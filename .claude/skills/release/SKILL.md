---
name: release
description: Merge development to main and publish a new release. Use when user says "release", "ship it", "merge to main", or invokes /release.
---

Release Canon to main. Run these steps in order — do not skip any.

1. **Code review** — run `/code-review` on development. Fix every blocker before continuing.

2. **Determine next version** — read the current version from `src-tauri/tauri.conf.json`. Run `git log main..development --oneline` to survey all unreleased commits. For each semver bump level, identify the single strongest reason from the commit list:
   - **Major** (`X.0.0`): breaking change or architectural overhaul — quote the most significant commit
   - **Minor** (`x.Y.0`): new user-visible feature — quote the most significant commit
   - **Patch** (`x.y.Z`): bugfixes / polish only — quote the most significant commit

   Then use `AskUserQuestion` to present all three options with their reasons. Example shape:
   - Option "Major X.0.0" → description: biggest breaking-change commit summary
   - Option "Minor x.Y.0" → description: biggest new-feature commit summary
   - Option "Patch x.y.Z" → description: biggest bugfix commit summary

   Wait for the user to choose before proceeding.

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

   **Release note tone**: write for users, not developers. Describe what changed from the user's perspective — what they can now do, what no longer breaks, what behaves differently. No internal names (function names, SQL, hook names, variable names). No jargon. Each bullet should be one plain sentence a non-technical user can understand.

   Good: "Clicking Refresh in the lyrics panel now returns to the track's original lyrics even when a manual search was active."
   Bad: "Refresh button clears lyricsOverride before calling lyricsRefresh()."

   Good: "Tags with multiple spellings (e.g. Post-Rock and Post Rock) are now fully removed when you undo a mapping."
   Bad: "deleteMapping clears track_tags by norm_value instead of raw_value."

5. **Push**: `git push` — CI reads the version from `tauri.conf.json`, creates the `vX.Y.Z` tag, and builds Windows / macOS / Linux artifacts automatically.

6. **Return to development**: `git checkout development`

7. **Confirm** (after CI finishes, ~5–10 min): `gh release view vX.Y.Z`
