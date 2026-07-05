# Tags view — Decided tab

## What it is
Shows every tag you've already made a decision about — mapped to a genre/mood in Canon's tree, marked "Accepted" as-is, or "Ignored" — so you can review, undo, or lock those decisions without wading back through the Review queue. Complements the Review tab (unmatched tags triage): Review is the inbox, Decided is the sent-folder / audit log.

Note: the doc outline originally sketched this as three separate tabs (Mapped / Resolved / Cleanup). In the shipped app it's one tab, labeled **"Decided"**, with an internal All/Mapped/Accepted/Ignored filter — this doc covers the tab as built.

## Entry points
Sidebar → **Tags** → **Decided** tab (`src/components/TagsView.tsx:86`, tab id `"decided"`, badge = count of decided tags). Tabs in order: Review, Decided, Tree, Title Cleanup.

## Step by step
1. Open Tags view, click **Decided** tab.
2. Top bar: search box (filters by raw tag text) + four filter chips — **All**, **Mapped**, **Accepted**, **Ignored** — each showing a live count.
3. Default filter is **All**, grouped into three sections (only shown when mixed): "Mapped", "Accepted", "Ignored".
4. **Mapped section**: one row per canon-tree node you've mapped tags to. Row shows the canon node name (e.g. "Shoegaze") and total album count across all its mapped variants. If you mapped multiple raw tag spellings to the same node (e.g. "shoegaze", "Shoe-gaze", "SHOEGAZE") they collapse into one row, with the non-identical spellings shown as removable chips underneath.
   - Click **↩** (undo) on the row: reverts *all* variants for that node back to unresolved (Review tab).
   - Click **×** on an individual alias chip: unmaps just that one spelling, others stay mapped.
   - Click the lock icon: toggles lock for all variants in the group. Locked mappings show a filled lock icon and can't be edited/deleted until unlocked, and are skipped by the auto-mapper (`useAutoMapExact`).
5. **Accepted / Ignored sections**: simple rows, one per raw tag value, with album count (or "not in library" if the tag no longer appears in any album) and an ↩ undo button.
6. Pagination (20/page) at the bottom when a section/filter has more rows than fit.
7. Empty state: "No decisions yet — Map, accept, or ignore tags in the Review tab" (first-time use), or "No items match — Clear the search or change the filter" (search/filter with no hits).

## Edge cases / gotchas
- **AUTO/MANUAL source filter not implemented.** `TagVocabRow.mapping_source` (`"auto" | "manual" | null`) is fetched and stored per row (`src/hooks/useTagMappings.ts:23,160`) but the Decided tab never reads or filters on it — no UI exposes whether a mapping came from auto-exact-match vs a manual pick, despite `ARCHITECTURE.md:317` describing this as shipped. Treat as a known gap, not a bug to "fix" without checking with the user first.
- **Locked mappings block both edit and delete**, not just delete — `saveMapping`/`deleteMapping` both throw `Mapping for "X" is locked. Unlock it first.` if `tag_mappings.locked = 1` (`useTagMappings.ts:51,91`).
- **Grouping is per canon-tree node, not per mapping row** — if variants map to a node whose name no longer resolves in `treeNodes` (rare, e.g. mid-sync), the group falls back to showing the raw `canonical_id` string instead of a friendly name (`TagDecidedTab.tsx:150`).
- **A "Mapped" group only renders alias chips if at least one variant's raw value differs from the node's own name** (case-insensitive) — a solo tag mapped 1:1 to a node with the exact same name shows no alias row at all, just the group header.
- Undo on a Mapped group clears `tag_mappings` for every variant sharing the same `norm_value` (normalized: trimmed, lowercased, `-`/`_` → space), not just the exact raw string passed in — so unmapping "shoe-gaze" also unmaps "shoe gaze" and "Shoe_Gaze" if all three normalize the same (`useTagMappings.ts:94-98`).
- Sentinel canonical IDs (`__accepted__`, `__ignored__`) are deliberately never written to `track_tags.canonical_id` — only `tag_mappings.canonical_id` — so accepted/ignored tags never get treated as "resolved to a genre" elsewhere in the app (`useTagMappings.ts:59-70`).

## Implementation
- Tab definition/badge: `src/components/TagsView.tsx:84-89` (`tabs` array), tab state `TabId` at line 23.
- Component: `src/components/TagDecidedTab.tsx` — `TagDecidedTab` (line 98), `MappedGroup` (line 23), `SimpleRow` (line 78).
- Filter/search/grouping logic: `mappedRows`/`acceptedRows`/`ignoredRows` (lines 113-129), `mappedGroups` (line 138, groups by `canonical_id`, sorts variants by `album_count` desc, groups by `album_count` desc then name), `FILTERS` const (line 188).
- Data hook: `useTagVocab()` (`src/hooks/useTagMappings.ts:148`) — unions `tag_vocab_cache` LEFT JOIN `tag_mappings` (covers in-library tags) with any `tag_mappings` rows for tags no longer in the library (stale, `album_count = 0`).
- Mutations: `useTagMappings()` → `saveMapping`, `deleteMapping` (line 83), `lockMapping` (line 109) — all invalidate `QK.tagVocab()`, `QK.trackTagsAll()`, `QK.tagMappings()`, `QK.genreDisplayMappings()`.
- Schema: `tag_mappings` table — `raw_value, kind, canonical_id, created_at` (migration v9, `src/db/migrations.ts:207`); `+source ('auto'|'manual'), match_type` (v13, line 262); `+locked` (v14, line 269).
- Sentinels: `ACCEPTED = "__accepted__"`, `IGNORED = "__ignored__"` — defined in both `TagsViewHelpers.tsx:9-10` and `useTagMappings.ts:9-10` (duplicated constant, not re-exported between the two).
- Shared helpers used by this tab: `applySearch` (`TagsViewHelpers.tsx:24`), `Pagination` (line 123).
- Auto-mapper this tab's lock state protects against: `useAutoMapExact` (`useTagMappings.ts:215`), runs once per Tags-view mount (`TagsView.tsx:49-59`).

## Open questions
- Whether the AUTO/MANUAL filter (`ARCHITECTURE.md:317`) is planned/in-progress elsewhere or just stale documentation — couldn't confirm from code; flagging rather than guessing.
- Why `ACCEPTED`/`IGNORED` sentinel constants are defined twice (`TagsViewHelpers.tsx` and `useTagMappings.ts`) instead of one importing from the other — no functional issue found, just duplication.
