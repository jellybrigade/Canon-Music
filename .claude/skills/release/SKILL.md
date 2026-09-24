---
name: release
description: Merge development to main and publish a new release. Use when user says "release", "ship it", "merge to main", or invokes /release.
---

Release Canon to main. Run these steps in order — do not skip any.

**Commit messages**: no trailer of any kind on any commit in this skill — not the code-review fixes, not the version bump, not the merge commit. No `Co-Authored-By`, no tool attribution, in commits, tags or release notes. This matches `docs/git-standards.md` and overrides any harness default that says otherwise.

1. **Code review** — first check scope: run `git diff main..development --stat` and `git log main..development --oneline`. (Prior releases are merged into main, so this range is the unreleased work, not the whole history.) Judge size (files touched, lines changed, count of distinct logical changes).

   - **Small** (roughly: single-digit files, one or two logical changes, no risky/architectural surface): use `AskUserQuestion` offering "Spawn Code Review" vs "Do Small Review" (small review as recommended default). If "Do Small Review" chosen, review the diff yourself directly — read it, reason about correctness/cleanup issues precisely, no subagent fan-out. Fix what you find.
   - **Not small**: skip the question, run `/code-review` on development (the full 8-finder-angle skill). **It defaults to the unpushed diff (`origin/development...HEAD`), which on a release of many commits is a small tail of the real scope** - pass the release range explicitly and check the range it reports back. If it reviewed less than the release scope, say so plainly in the summary rather than implying the release was fully reviewed.
   - Either way: fix **every finding** returned (blockers and non-blockers alike) without asking for confirmation. Commit all fixes on development before continuing.

2. **Combine commits** — always do this pass, even on a small release. Run `git log --oneline --stat origin/development..development` and look for groups that should be one commit:

   - Commits that touch the same files for the same change (a feature and its follow-up tweaks, a fix and its fix-of-the-fix).
   - Code-review fixes from step 1 that correct a commit in this same range. Fold each into the commit it fixes.
   - Commits doing the same thing in different places (the same rename, the same cleanup pattern, the same copy change).

   Do **not** combine unrelated changes because they share a file, and do not fold a bugfix into a feature commit that does not introduce it. When in doubt, leave them separate.

   **Only rewrite unpushed commits** (`origin/development..development`). Commits already on `origin/development` stay as they are; a group reaching back into them is skipped. Never force-push.

   If nothing qualifies, say so in one line and move on. Otherwise rewrite non-interactively (`git rebase -i` needs an editor, so feed it a prepared todo):

   ```bash
   git branch -f release-backup HEAD
   # Write the todo: oldest first, reorder so each group is contiguous, `pick` the first
   # commit of a group, `fixup` the rest, then `exec git commit --amend -m "<subject>"`
   # when the combined change needs a new subject. Keep every commit you are not combining.
   GIT_SEQUENCE_EDITOR="cp /tmp/release-todo" git rebase -i origin/development
   git diff release-backup HEAD --stat   # must print nothing: combining never changes the tree
   git branch -D release-backup
   ```

   Subjects follow `docs/git-standards.md` (subject only, no body, no trailer); the `commit-msg` hook still runs. If a reorder conflicts, `git rebase --abort`, `git reset --hard release-backup`, and drop that group rather than resolving by hand. Report the before/after commit count in the summary.

3. **Verify green** — run the full check suite before anything else touches the version or `main`:

   ```bash
   bash scripts/run-local-checks.sh
   ```

   All eight tasks (branch, staged, dashes, typecheck, vitest, cargo-test, clippy, rustfmt) must pass. **A red suite stops the release** — fix it and re-run, do not proceed and do not push. A pre-existing unrelated failure blocks the release too; say so and ask before continuing.

4. **Determine next version** — read the current version from `src-tauri/tauri.conf.json`. Run `git log main..development --oneline` to survey all unreleased commits. Then pick the correct bump:

   - **Major** is never auto-selected — only present it if there is an explicit breaking change or architectural overhaul. This project is pre-1.0 so major bumps are extremely rare.
   - **Minor** (`x.Y.0`): one or more new user-visible features were added.
   - **Patch** (`x.y.Z`): only bugfixes, polish, or internal changes — no new features.

   **Default behavior**: identify the single most appropriate level and proceed without asking:
   - Any new user-visible feature present → **minor**, even if there are also bugfixes.
   - Bugfixes / polish / internal changes only → **patch**.
   - Only use `AskUserQuestion` when it is genuinely unclear whether a change counts as a new feature or a bugfix. When you do ask, present only the two relevant options with a one-line reason each; never include major unless commits justify it.

5. **Bump version** — update `"version"` in both `src-tauri/tauri.conf.json` and `package.json`, then commit on development:
   ```bash
   git add src-tauri/tauri.conf.json package.json
   git commit -m "Bump version to X.Y.Z"
   ```

6. **Merge to main**:

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

7. **Push**: `git push` — CI reads the version from `tauri.conf.json`, creates the `vX.Y.Z` tag, and builds Windows / macOS / Linux artifacts automatically.

8. **Return to development**: `git checkout development && git push` — the bump and any review fixes live on development too, so it needs pushing as well as main.

9. **Confirm** (after CI finishes, ~5–10 min): `gh release view vX.Y.Z`
