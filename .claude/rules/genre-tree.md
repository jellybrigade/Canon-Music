---
description: Genre tree and radio weighting — DAG structure, user override, scoring formula
paths:
  - "src/assets/**"
  - "scripts/**"
---

# Genre Tree

## Structure: DAG, Not Tree

The Canon genre tree (`canon-tree.json`) is a **directed acyclic graph**. Genres can have multiple parents. Do not flatten to single-parent. Do not add tree-assumption shortcuts.

Node format: `{ id, name, type: "genre" | "mood", parents: string[] }`

Source: `RateYourMusic Hierarchy.txt` → `scripts/parse-rym.ts` → `src/assets/canon-tree.json`

## User Override

If `user-tree.json` exists and is non-empty, use it **instead of** `canon-tree.json`. Never merge them — it is a full replacement.

## Radio Weighting

Genre/mood match score walking up ancestor chains:

```
weight = 1 / 2^depth
```

- Multi-parent nodes propagate up **all** parent chains independently.
- Final track score = **60% tree score + 40% Last.fm similar artists**.
- Moods weighted lower than genres by default.

## Clustering (Genre Unifier, Goal T4)

Two-pass approach:
1. Exact match on `canonical_key` (lowercased, punctuation-stripped)
2. Levenshtein ≤ 2 on `fuzzy_key`

Approved mappings stored in `genre_mappings` table, staged as `pending_edits source='genre_unifier'`.
