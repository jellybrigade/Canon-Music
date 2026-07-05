# Tags View — Review Tab

## What it is

Lets you clear the backlog of tags Canon pulled from your files, Last.fm, and MusicBrainz that it couldn't automatically match to the canon genre tree — decide per tag whether to map it to a real genre, accept it as-is, or ignore it, so your genre filters and Radio stay accurate.

## Entry points

Sidebar → **Genre Tags** view → tab bar → **Review** tab (default tab on entering the view). Tab shows a badge with the count of pending (unresolved) tags. Header also has a **↻** refresh button ("Refresh tag data") that re-runs the vocab/tree queries.

On first entering the view, an auto-map pass runs once per session (exact-string matches only); if it maps anything, a dismissible banner appears above the toolbar: "`N tag(s) auto-mapped on entry.`"

## Step by step

1. Open **Genre Tags** in the sidebar, land on **Review** tab.
2. Each row shows: colored source dots (hover for tooltip: Last.fm / MusicBrainz / Folksonomy / File tags), the raw tag string, up to 6 small album-art thumbnails pulled from albums carrying that tag, the album count, then action controls.
3. A legend at the top of the toolbar explains the source-dot colors. A search box filters rows by raw tag text. Pagination controls sit next to the search box; page size auto-fits to the panel's height (rows are 56px each).
4. Per row, three ways to resolve a tag:
   - Type into the **canon-node combobox** and pick an existing genre/mood node → tag is mapped to that node.
   - Type a name that doesn't exist and choose the "create new" option in the combobox → opens the **Add node** modal (same modal used by the Tree tab) prefilled with the typed name; saving it both creates the node and maps the tag to it.
   - Click **Accept** → tag kept in genre output verbatim, no canon mapping.
   - Click **Ignore** → tag excluded from genre output entirely.
5. Once resolved, the tag drops out of Review and reappears under the **Decided** tab (mapped/accepted/ignored tags, filterable by AUTO/MANUAL source).
6. Empty states: if there are zero unresolved tags at all, shows "All tags resolved" + total tag count; if a search filters out everything, shows "No tags match" and a hint to clear the search.

## Edge cases / gotchas

- **The outline's "Focus mode" and "Grid mode" toggle does not exist yet.** `instructions/ARCHITECTURE.md:317` describes a planned split — Focus mode (guided one-at-a-time triage with `A`/`I`/skip keyboard shortcuts and a progress bar) vs Grid mode (card grid with flow/pages toggle) — but the shipped `TagReviewTab` is a single list view with search + pagination only. No keyboard shortcuts exist for accept/ignore/skip today.
- A tag only counts as "unresolved" (shows in Review) if `album_count > 0` — a mapping-less tag with zero current albums (e.g. tag data went stale after a library change) is invisible here; it still exists in `tag_mappings`/`tag_vocab_cache` but won't surface until it's attached to an album again.
- Deleting a canon-tree node (from the Tree tab) clears any tag mappings pointing to it, which can silently push previously-resolved tags back into Review.
- Album art thumbnails depend on the first configured server's credentials (`useServerWithCredential(servers?.[0]?.id)`) — with no server or no cached credential, rows render with no art strip (not an error state, just empty).

## Implementation

- **Components**
  - `src/components/TagReviewTab.tsx` — the tab body. `ReviewRow` (`TagReviewTab.tsx:27-61`) renders one tag; `TagReviewTab` (`TagReviewTab.tsx:76-190`) handles data fetch, search, pagination, resize-based page sizing (`ROW_HEIGHT = 56`, `TagReviewTab.tsx:73`).
  - `src/components/TagsView.tsx` — parent shell: tab bar (`review` / `decided` / `tree` / `title-cleanup`, `TagsView.tsx:84-89`), badge counts (`TagsView.tsx:80-82`), one-shot auto-map-on-entry effect (`TagsView.tsx:49-60`), refresh button (`TagsView.tsx:74-78`).
  - `src/components/TagsViewHelpers.tsx` — shared pieces: `ACCEPTED`/`IGNORED` sentinel strings (lines 9-10), `AlbumArtStrip` (32-64), `TagSourceDots` + `SOURCE_META` legend map (68-94), `SegToggle` (98-116, currently unused by Review — reserved for the planned mode toggle), `Pagination` (123-150), re-exported `CanonCombobox`.
  - Node creation reuses `NodeModal` from `src/components/TagTreeTab.tsx`, opened via `openCreateModal` in `TagsView.tsx:91-95`.
- **Data layer**
  - `useTagVocab()` (`src/hooks/useTagMappings.ts:148-186`) — the single source query joining `tag_vocab_cache` (per raw_value/kind, with `album_count` and `sources`) against `tag_mappings` (via `norm_value`+`kind`), classification documented inline at lines 137-146: unresolved = `!canonical_id && album_count > 0`.
  - `saveMapping` mutation from `useTagMappings()` (`TagReviewTab.tsx:78`, called for map/accept/ignore at `TagReviewTab.tsx:115-123`).
  - `useAutoMapExact()` — exact-string auto-mapper run once on view mount (`TagsView.tsx:45,49-60`).
  - React Query key: `QK.tagVocab()` (invalidated by refresh button, `TagsView.tsx:75`).
  - Tables: `tag_vocab_cache`, `tag_mappings` (`raw_value`, `norm_value`, `kind`, `canonical_id`, `source`, `locked`) — schema in `src/db/migrations.ts` (mappings table around line 207-213). `album_unresolved_genres`/`album_genres` (`migrations.ts:320-326` and nearby) exist in schema but are not read/written by this tab — they belong to the album-detail genre editor, not Review.
  - No Tauri commands involved; everything is local SQLite via `tauri-plugin-sql`.

## Open questions

- Whether/when Focus mode and Grid mode (per `ARCHITECTURE.md:317`) will actually be built — treat as roadmap, not shipped behavior, until confirmed.
- No confirmation was found for exact keyboard-shortcut bindings (`A`/`I`/skip) — these appear only in the architecture doc's prose spec, not in any current code.
