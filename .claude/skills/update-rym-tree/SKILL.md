---
name: update-rym-tree
description: Pull the latest RateYourMusic genre hierarchy, diff it against Canon's genre tree, make sense of every removed or renamed node, ask the user about any that don't make sense, then regenerate the tree and carry renamed ids with a migration. Use when user says "update rym tree", "update the genre tree", "new RYM scrape", or invokes /update-rym-tree.
---

Work through these phases in order. Paths are relative to the repo root, not this skill's dir.

## Phase 1 - Fetch

The source URL is in the `reference-rym-hierarchy-source` memory (deliberately not in the repo). Download it to `/tmp/rym-new.txt` with `curl -sSfL`. Stop and tell the user if the fetch fails or the file is empty.

## Phase 2 - Diff

Run `node scripts/parse-rym.mjs --input /tmp/rym-new.txt --stdout > /tmp/newtree.json` and compare node ids against `src/assets/canon-tree.json`: removed, added, and nodes whose `parents`, `type` or `sections` changed. No removed ids and no changed nodes that matter → install the file, regenerate, commit (Phase 5 without a migration).

The parser refuses a `custom-nodes.json` node whose id RYM now has or whose parent is missing. If it errors, that is a finding for Phase 3, not something to patch around.

## Phase 3 - Make sense of every removed id

Each removed id is either a **rename** (the same node under a new id) or a **true removal**. Decide per id with evidence, never by name similarity alone:

- Compare line positions in both txt files (`grep -n` the old name in the old txt, look at the same neighbourhood in the new one). A rename sits at the same positions, under the same parents, with the same `::type`.
- Compare the old node's `parents`/`type`/`sections` with the candidate's. Same parents plus a similar name is strong evidence.
- Spelling fixes (`Pyschedelic` -> `Psychedelic`) and singular/plural changes are renames. So is a renamed tradition that kept every position (`Sacred Harp Singing` -> `Shape Note Singing`).
- Check whether any `custom-nodes.json` node or any user node could be parented under a removed id.

Also scan the added list for anything odd (a type change, a node that now appears as its own parent, a parent that vanished).

**If any change doesn't make sense** - a removal with no plausible successor, a rename whose parents differ, a merge of two ids into one, a type change - use `AskUserQuestion`: state the change and the evidence, give your recommendation as the first option marked "(Recommended)", and wait for the answer. Don't guess on these.

## Phase 4 - Carry renamed ids (test-first)

Renames need a new numbered migration in `src/db/migrations.ts`, modelled on v52 (`RYM_ID_RENAMES` + `rymRenameSql()`). Never edit v52's list: it is frozen history. Add a new list for this scrape and a new block. The carry covers every table holding a tree id: `tag_mappings`, `track_tags`, `album_genres`, `album_user_genres` (+`name`), `album_genre_exclusions`, `user_tree_nodes.parent_ids`, smart `playlists.rules_json`. Re-check that list first:

```
python3 -c "import re;s=open('src/db/migrations.ts').read();print(sorted({m.group(1) for m in re.finditer(r'CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([^;]*?)\);',s,re.S) if 'canonical_id' in m.group(2)}))"
```

For each old name, check whether its `canonicalKey` still resolves to the new node, exactly or fuzzily (`findFuzzy`: allowance `floor(min(len)/5)`, capped at 2). Seed a manual `tag_mappings` row only for names that no longer resolve. Keep the `computed_at = NULL` re-normalize step for affected albums and albums with unresolved genres.

A true removal with no successor needs a decision too. Ask the user (Phase 3) before dropping user rows that point at it.

Write the tests in `src/db/migrations.test.ts` first (seed at the previous version, migrate, assert), watch them go red, then write the block. The "renames only ids the tree dropped, onto ids the tree has" test must cover the new list too.

## Phase 5 - Regenerate and commit

1. `cp /tmp/rym-new.txt scripts/data/rym-hierarchy.txt && node scripts/parse-rym.mjs`
2. Update the node counts on the `canon-tree.json` line of `docs/ARCHITECTURE.md` (total, genres, moods, categories, from-RYM, nodes in two sections).
3. `bash scripts/run-local-checks.sh` green.
4. Commit the data on its own first (`update genre tree to latest RYM hierarchy`), then the migration with its tests, `ARCHITECTURE.md` migration line and the `AGENTS.md` schema version. Both commits must go out in the same release: either one alone leaves ids dangling.

Report to the user: counts added/removed, every rename and its evidence, anything they decided, and anything that needs a release.
