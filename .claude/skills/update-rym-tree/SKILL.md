---
name: update-rym-tree
description: Pull the latest RateYourMusic genre hierarchy, diff it against Canon's genre tree, make sense of every removed or renamed node, ask the user about any that don't make sense, then record renamed ids in the rename history and regenerate the tree. Use when user says "update rym tree", "update the genre tree", "new RYM scrape", or invokes /update-rym-tree.
---

Work through these phases in order. Paths are relative to the repo root, not this skill's dir.

## Phase 1 - Fetch

The source URL is in the `reference-rym-hierarchy-source` memory (deliberately not in the repo). Download it to `/tmp/rym-new.txt` with `curl -sSfL`. Stop and tell the user if the fetch fails or the file is empty.

## Phase 2 - Diff

Run `node scripts/parse-rym.mjs --input /tmp/rym-new.txt --stdout > /tmp/newtree.json` and compare node ids against `src/assets/canon-tree.json`: removed, added, and nodes whose `parents`, `type` or `sections` changed. No removed ids and no changed nodes that matter → install the file, regenerate, commit (Phase 5, nothing to record).

The parser refuses a `custom-nodes.json` node whose id RYM now has or whose parent is missing. If it errors, that is a finding for Phase 3, not something to patch around.

## Phase 3 - Make sense of every removed id

Each removed id is either a **rename** (the same node under a new id) or a **true removal**. Decide per id with evidence, never by name similarity alone:

- Compare line positions in both txt files (`grep -n` the old name in the old txt, look at the same neighbourhood in the new one). A rename sits at the same positions, under the same parents, with the same `::type`.
- Compare the old node's `parents`/`type`/`sections` with the candidate's. Same parents plus a similar name is strong evidence.
- Spelling fixes (`Pyschedelic` -> `Psychedelic`) and singular/plural changes are renames. So is a renamed tradition that kept every position (`Sacred Harp Singing` -> `Shape Note Singing`).
- Check whether any `custom-nodes.json` node or any user node could be parented under a removed id.

Also scan the added list for anything odd (a type change, a node that now appears as its own parent, a parent that vanished).

**If any change doesn't make sense** - a removal with no plausible successor, a rename whose parents differ, a merge of two ids into one, a type change - use `AskUserQuestion`: state the change and the evidence, give your recommendation as the first option marked "(Recommended)", and wait for the answer. Don't guess on these.

## Phase 4 - Record renamed ids

Renames are data, never a schema migration. Append one `{ "from", "fromName", "to" }` per rename to `scripts/data/tree-renames.json` (`fromName` = the old node's display name). The file is append-only history: never edit or drop an entry, and a later rename of an id that was itself a rename target is just another entry (the parser resolves `a -> b -> c` to `c`).

The parser refuses a `to` the tree lacks, a `from` the tree still has, the same `from` twice, and a cycle. A refusal is a Phase 3 finding: if RYM re-added an old id, ask the user.

At startup the app compares the tree's `version` against `settings.genre_tree_version` and, when it moved, `carry_genre_renames` (`src-tauri/src/library_write/genre_carry.rs`) carries every holder in `src/db/genreIdTables.ts` in one transaction, seeds a manual mapping for each old name that no longer resolves (`planGenreRenames`), and re-normalizes touched and unresolved albums. A new table holding tree ids goes into that registry, not into this skill; `genreIdTables.test.ts` fails until it does.

A true removal with no successor needs a decision too. Ask the user (Phase 3) before dropping user rows that point at it.

## Phase 5 - Regenerate and commit

1. `cp /tmp/rym-new.txt scripts/data/rym-hierarchy.txt && node scripts/parse-rym.mjs`
2. Update the node counts on the `canon-tree.json` line of `docs/ARCHITECTURE.md` (total, genres, moods, categories, from-RYM, nodes in two sections).
3. `bash scripts/run-local-checks.sh` green.
4. One commit: `rym-hierarchy.txt`, `tree-renames.json` and the regenerated `canon-tree.json` together (`update genre tree to latest RYM hierarchy`). The tree and its rename history must never ship apart.

Report to the user: counts added/removed, every rename and its evidence, anything they decided, and anything that needs a release.
