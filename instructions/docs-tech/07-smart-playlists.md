# Smart Playlists

## What it is

Smart playlists build themselves from rules (genre, year, artist/album/title text, play count) instead of manual track-by-track adding. Add matching new tracks later by hitting **Refresh** — no manual re-curation.

## Entry points

- **Playlists view → "Smart Playlist" button** (top toolbar, next to "New Playlist"; icon: `ListMusic`, title attr "New smart playlist") → opens **"New Smart Playlist"** modal.
- Existing smart playlist → open it → detail header has **"Refresh"** button (re-run rules, `RefreshCw` icon) and **"Edit Rules"** button (`ListMusic` icon, opens same modal titled "Edit Smart Playlist").
- Smart playlists are visually distinguished in the playlist grid: `ListMusic` icon (vs `Music` for regular), and card metadata shows `"Smart · N tracks"` prefix (`PlaylistList.tsx:110,117`).

## Step by step

1. Click **Smart Playlist**. Modal opens with fields: Name, Limit (1–500, default 50), Sort (Random / Most played / Newest first / Oldest first / Title A→Z / Title Z→A), Artist contains, Album contains, Title contains, Year from/to, Min play count, and a Genres picker.
2. Genres: search box filters a chip list of all canonical genres; click a chip to add it to "selected" (shown above as removable chips). A toggle switches genre matching between **Include** and **Exclude** — applies to *all* selected genres at once (no per-genre mode).
3. Click **Create** (button disabled until Name is non-empty). This immediately runs the rule query against the local SQLite `tracks` table, creates the playlist on the Navidrome server, uploads matching track IDs, and inserts a local `playlists` row with `is_smart = 1` and the filters serialized to `rules_json`.
4. Open the playlist later: header shows **Refresh** and **Edit Rules** next to Play All.
   - **Refresh**: re-runs the stored rules against the current library state, replaces the full server-side track list via `replace_navidrome_playlist_tracks`, and rewrites local `playlist_tracks`. Use after library sync to pull in newly added/tagged tracks matching the rules.
   - **Edit Rules**: reopens the modal pre-filled with the saved filters (title "Edit Smart Playlist", save button reads "Save & Refresh"). Saving updates `rules_json`, renames on the server if changed, and immediately triggers a refresh.

## Edge cases / gotchas

- **Zero matches**: playlist is created/refreshed with 0 tracks; detail view shows "Playlist is empty." No warning is shown at save time if rules match nothing.
- **Exclude-all**: setting genre mode to Exclude with genres selected uses `NOT IN (subquery)`, so albums with no genre mapping at all still pass (no genre match to exclude).
- **Text filters** (artist/album/title contains) are simple `LIKE '%...%'` substring matches, case-insensitivity depends on SQLite's default collation (ASCII-only, so non-ASCII text is case-sensitive). `%`, `_`, and `\` in user input are escaped so they aren't treated as SQL wildcards.
- **Album contains** is the only filter that requires a join (`LEFT JOIN albums`); it's added conditionally, so leaving it blank costs nothing.
- **Limit** is clamped to 1–500 both in the UI input and again in `buildSmartQuery` (`Math.max(1, Math.min(500, ...))`) — can't be bypassed by editing rules_json externally... unless rules_json is hand-edited, which the app never validates on read.
- **Refresh on a non-smart playlist**: `refreshSmartPlaylist` early-returns if `is_smart`/`rules_json` is falsy — no-op, not an error.
- **Random sort** means Refresh reshuffles track order every time, even if the same tracks still match.
- Regular (non-smart) playlists never show Refresh/Edit Rules — those buttons only render when `playlist.is_smart` is true.

## Implementation

- `src/lib/smartPlaylist.ts:9-21` — `SmartFilters` type (name, limit, sort, artistContains, albumContains, titleContains, selectedGenres, genreMode, yearFrom, yearTo, minPlayCount)
- `src/lib/smartPlaylist.ts:23-35` — `DEFAULT_SMART_FILTERS`
- `src/lib/smartPlaylist.ts:37-44` — `SORT_OPTIONS` (sort code → label)
- `src/lib/smartPlaylist.ts:46-55` — `sortToSql`
- `src/lib/smartPlaylist.ts:57-116` — `buildSmartQuery(filters, serverId)` — builds the `SELECT DISTINCT t.id FROM tracks ...` SQL + params; this is the entire rule engine
- `src/components/SmartPlaylistModal.tsx:22-272` — create/edit modal UI (genre chip picker, filter form)
- `src/hooks/usePlaylists.ts:148-172` — `createSmartPlaylist`: runs query, creates Navidrome playlist, uploads tracks, inserts local `playlists` row (`is_smart=1`, `rules_json`)
- `src/hooks/usePlaylists.ts:174-198` — `refreshSmartPlaylist`: re-runs query, calls `replaceNavidromePlaylistTracks`, rewrites local `playlist_tracks`, updates `track_count`
- `src/hooks/usePlaylists.ts:200-208` — `updateSmartPlaylistRules`: persists new `rules_json`/name, renames on server, then calls `refreshSmartPlaylist`
- `src/db/migrations.ts:543-546` — schema: `playlists.is_smart`, `playlists.rules_json` columns
- `src/components/PlaylistList.tsx:62-69` — "Smart Playlist" entry button; `:110,117` — grid icon/label distinction
- `src/components/PlaylistDetail.tsx:387-407` — Refresh / Edit Rules buttons (smart-only); `:241-251` — `handleRefreshSmart`; `:571-578` — modal render for edit mode
- No keyboard shortcuts specific to this feature.

## Open questions

- Whether `rules_json` is validated/migrated if `SmartFilters` shape changes across app versions — not verified, no migration code found for it.
