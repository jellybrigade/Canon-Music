# Inline Album Genre Editor

## What it is

Lets you correct an album's genre tags directly on the album page — add a genre Canon missed, remove one you added by mistake, or exclude a genre that Canon auto-assigned but doesn't fit this album. No modal, no separate settings screen — edits happen inline, next to the genre chips themselves, and take effect immediately (re-running local tag normalization, never touching your music files).

## Entry points

- Album detail page → **Genres** tag column (top of the tag band, above track list) → pencil icon button (`album-tag-add-genre-btn`, title "Edit genres") next to the "Genres" heading. Click toggles an inline panel titled **Edit Genres** open directly below the tag band.
- If the album has unmatched/unmapped tags, a **"N unmatched →"** hint button appears in the same column (only when the editor is closed) and also opens the editor.
- Right-clicking any genre/descriptor/scene chip opens the separate **Tag Drawer** instead (a side panel) — different entry point, not this editor, but shares the same "unmatched genres" resolver UI (see below).

## Step by step

1. Click the pencil icon in the Genres column header. The **Edit Genres** panel expands inline, showing genre chips grouped by source: **Added by you** (manual, removable), **File**, **Last.fm**, **MusicBrainz**, **Folksonomy**, and any unsourced chips.
2. **Remove a manually-added genre**: hover a chip in "Added by you" → an ✕ button appears → click to delete. Only manual chips are deletable this way (title "Remove").
3. **Exclude an auto-assigned genre** (File/Last.fm/MusicBrainz/Folksonomy): click the chip's ✕ (title "Exclude from this album"). This doesn't delete the source tag — it records an exclusion so that genre stops appearing on this specific album even though it's still present in the raw data.
4. **Add a genre**: type into the "Add genre…" input at the bottom. As you type, up to 8 matching canon-tree genre nodes appear in a dropdown. Click a suggestion, or press Enter to accept the top match. Press Escape to clear the input.
5. **Resolve unmatched tags**: if the album has raw tags Canon couldn't map to the canon genre tree, an "Unmatched genres" section appears below the add-row, one row per raw tag with its source badge. Three options per tag: **Accept** (keep as-is, no remapping), **Ignore** (drop from output), or type into the combobox to map it to an existing canon-tree node.
6. Click the ✕ in the panel's top-right corner (or the pencil icon again) to close the editor. Changes are already saved — closing is just visual.

Every add/remove/exclude/resolve action triggers a full re-run of local tag normalization for the album and invalidates the relevant caches, so the genre chips on the album page update immediately without a reload.

## Edge cases / gotchas

- Chips with `g.id === null` (raw/unresolved genre display) can't be removed or excluded via the ✕ — the button is disabled for those (`AlbumGenreEditor.tsx:172`). They must go through the unmatched-genre resolver instead.
- "Exclude" is per-album, not global — the underlying tag mapping stays intact for every other album; only this album's `album_genre_exclusions` row suppresses it.
- The autocomplete dropdown only searches nodes where `type === "genre"` — you can't add a descriptor or scene node through this input.
- The "Unmatched genres" resolver (`UnmatchedSection`) is a shared component also rendered inside the separate Tag Drawer (right-click on a chip) — same query keys, same cache, so editing from either surface stays in sync.

## Implementation

- Component: `src/components/AlbumGenreEditor.tsx` — props take pre-grouped `genreGroups: GenreGroups` (manual/file/lastfm/musicbrainz/folksonomy/unsourced) and `rawSourcesByCanonicalId` computed by the parent.
- Mounted from: `src/components/AlbumDetail.tsx:714-724`, gated by `showGenreEditor` state (`AlbumDetail.tsx:269`); toggle button at `AlbumDetail.tsx:636-642`; unmatched-hint button at `AlbumDetail.tsx:647-655`.
- Add: `INSERT OR IGNORE INTO album_user_genres (album_id, canonical_id, name)` (`AlbumGenreEditor.tsx:81-84`).
- Remove: `DELETE FROM album_user_genres WHERE album_id = ? AND canonical_id = ?` (`AlbumGenreEditor.tsx:98-101`).
- Exclude: `INSERT OR IGNORE INTO album_genre_exclusions (album_id, canonical_id)` (`AlbumGenreEditor.tsx:115-118`).
- Both actions call `normalizeAlbum()` (`src/lib/tag-normalize.ts`) then invalidate React Query keys `QK.normalizedTags(albumId)` and (for exclude) `QK.albumGenreExclusions(albumId)`.
- Unmatched resolver: `UnmatchedSection` in `src/components/TagDrawer.tsx:176-253`, backed by `useAlbumUnmatchedGenres` (`TagDrawer.tsx:74`, query key `QK.albumUnmatchedGenres`) and `useTagMappings().saveMapping` (`src/hooks/useTagMappings.ts:29`) which writes to `tag_mappings`. Accept/Ignore pass sentinel canonical IDs `ACCEPTED`/`IGNORED`; picking a tree node passes its canonical ID via `CanonCombobox`.
- Autocomplete source: `getCanonTree()` from `src/lib/canonicalize.ts`, filtered client-side.
- Schema (`src/db/migrations.ts`):
  - `album_genres` (v17, line 310) — resolved genre output per album (`album_id`, `canonical_id`, `relation` direct/ancestor, `section`, `name`).
  - `album_unresolved_genres` (v17, line 320) — raw tags pending resolution.
  - `album_user_genres` (v26, line 409) — manually added genres.
  - `album_genre_exclusions` (v33, line 473) — per-album suppression of otherwise-resolved genres.

## Open questions

None — `saveMapping` writes a global `tag_mappings` row keyed on `(raw_value, kind)` (schema v9+, `norm_value` added v27), so Accept/Ignore/Map decisions apply to every album sharing that raw tag, not just the current one. Accept/Ignore use sentinel canonical IDs `ACCEPTED`/`IGNORED` from `src/components/TagsViewHelpers.tsx`, both of which clear `track_tags.canonical_id` to null (no canon mapping) — Accept keeps the raw tag in output, Ignore drops it.
