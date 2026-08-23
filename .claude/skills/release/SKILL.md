---
name: release
description: Merge development to main and publish a new release. Use when user says "release", "ship it", "merge to main", or invokes /release.
---

Release Canon to main. Run these steps in order — do not skip any.

**Commit messages**: no `Co-Authored-By: Claude` trailer on any commit in this skill — not the code-review fixes, not the merge commit. Exception: the version bump commit (step 4) keeps the trailer as normal.

1. **Code review** — first check scope: run `git diff main..development --stat` and `git log main..development --oneline`. (Prior releases are merged into main, so this range is the unreleased work, not the whole history.) Judge size (files touched, lines changed, count of distinct logical changes).

   - **Small** (roughly: single-digit files, one or two logical changes, no risky/architectural surface): use `AskUserQuestion` offering "Spawn Code Review" vs "Do Small Review" (small review as recommended default). If "Do Small Review" chosen, review the diff yourself directly — read it, reason about correctness/cleanup issues precisely, no subagent fan-out. Fix what you find.
   - **Not small**: skip the question, run `/code-review` on development (the full 8-finder-angle skill). **It defaults to the unpushed diff (`origin/development...HEAD`), which on a release of many commits is a small tail of the real scope** - pass the release range explicitly and check the range it reports back. If it reviewed less than the release scope, say so plainly in the summary rather than implying the release was fully reviewed.
   - Either way: fix **every finding** returned (blockers and non-blockers alike) without asking for confirmation. Commit all fixes on development before continuing.

2. **Verify green** — run the full check suite before anything else touches the version or `main`:

   ```bash
   bash scripts/run-local-checks.sh
   ```

   All eight tasks (branch, staged, dashes, typecheck, vitest, cargo-test, clippy, rustfmt) must pass. **A red suite stops the release** — fix it and re-run, do not proceed and do not push. A pre-existing unrelated failure blocks the release too; say so and ask before continuing.

3. **Determine next version** — read the current version from `src-tauri/tauri.conf.json`. Run `git log main..development --oneline` to survey all unreleased commits. Then pick the correct bump:

   - **Major** is never auto-selected — only present it if there is an explicit breaking change or architectural overhaul. This project is pre-1.0 so major bumps are extremely rare.
   - **Minor** (`x.Y.0`): one or more new user-visible features were added.
   - **Patch** (`x.y.Z`): only bugfixes, polish, or internal changes — no new features.

   **Default behavior**: identify the single most appropriate level and proceed without asking:
   - Any new user-visible feature present → **minor**, even if there are also bugfixes.
   - Bugfixes / polish / internal changes only → **patch**.
   - Only use `AskUserQuestion` when it is genuinely unclear whether a change counts as a new feature or a bugfix. When you do ask, present only the two relevant options with a one-line reason each; never include major unless commits justify it.

4. **Bump version** — update `"version"` in both `src-tauri/tauri.conf.json` and `package.json`, then commit on development:
   ```bash
   git add src-tauri/tauri.conf.json package.json
   git commit -m "Bump version to X.Y.Z"
   ```

5. **Merge to main**:

   These branches have unrelated histories, so `--allow-unrelated-histories` is required. It usually produces add/add conflicts on every file; resolve them by taking development's version, then write the commit message explicitly with `-m`. **Never use `git commit --no-edit` after resolving conflicts**: git appends a `# Conflicts:` block to `MERGE_MSG` that ends up in the stored commit message.

   **The merge can also land clean** (once main already carries a previous merge of the same history). Then git has already committed it with the default `Merge branch 'development'` subject and there is nothing to resolve - do **not** run `git checkout --theirs`, just amend the message using the same heredoc shown below. Either way, confirm the trees match before writing the message: `git diff development main --stat` must print nothing.

   ```bash
   git checkout main
   git merge --no-ff --allow-unrelated-histories development
   # If it reports add/add conflicts on every file, that's expected - take development's side:
   git checkout --theirs -- .
   git add -A
   # If it merged clean, skip the two lines above and use --amend on the commit git just made.
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

6. **Push**: `git push` — CI reads the version from `tauri.conf.json`, creates the `vX.Y.Z` tag, and builds Windows / macOS / Linux artifacts automatically.

7. **Return to development**: `git checkout development && git push` — the bump and any review fixes live on development too, so it needs pushing as well as main.

8. **Confirm** (after CI finishes, ~5–10 min): `gh release view vX.Y.Z`
