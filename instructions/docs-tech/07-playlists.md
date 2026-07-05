# Playlists (regular)

For rule-based playlists, see [docs-tech/07-smart-playlists.md](07-smart-playlists.md). This doc covers manually-curated playlists: creating, viewing/playing, adding/removing tracks, custom cover art, deleting.

## What it is

Standard ordered track lists, synced to the Navidrome server (not local-only) — created/edited in Canon, changes push to the server immediately via Subsonic/OpenSubsonic playlist endpoints.

## Entry points

- **Sidebar → Playlists view → "New Playlist" button** (toolbar, `Plus` icon) → inline name input appears.
- **Playlist card** (grid in Playlists view) → click to open **PlaylistDetail**.
- **Add tracks from elsewhere**: right-click a track in Album Detail → "Add to Playlist ▸" submenu lists all playlists by name; right-click an album in the Album Grid → "Add to Playlist ▸" submenu adds every track on the album.
- **Custom cover**: in PlaylistDetail, hover the cover art → camera icon button ("Set custom cover image") opens a file picker; an X button ("Remove custom cover") appears once one is set.

## Step by step

### Create
1. Click **New Playlist**, type a name, press Enter or click **Create** (Escape or **Cancel** aborts). Empty/whitespace names are rejected (button disabled).
2. Canon calls `createNavidromePlaylist` on the server, then inserts a local `playlists` row keyed `"<server_id>:<native_playlist_id>"`.

### View / play
1. Click a card in the Playlists grid to open **PlaylistDetail** — same header layout as Album Detail (hero art, editable title/description, track count + total duration).
2. **Play All** button plays the whole list from track 1.
3. Click any row to play from that track. Right-click a row for a context menu: Play Now, Play Next, Add to Queue, Go to Album, Go to Artist, Remove from Playlist.
4. The track list uses a virtualized row list (only visible rows rendered) and remembers your last-played position per playlist (`playlist_resume` table) — reopening a playlist auto-scrolls back to where you left off.
5. Column picker (sliders icon, top-right of track list) toggles Artist/Genre/Album/Year/Duration/Format/Bitrate columns; choice persists in `localStorage` under `canon-playlist-cols`.

### Add / remove tracks
- **Add**: from a track's or album's context menu elsewhere in the app (see Entry points). No "add track" affordance exists inside PlaylistDetail itself — you add from the source (album/track), not from the playlist view.
- **Remove**: right-click a row inside PlaylistDetail → **"Remove from Playlist"** (styled as a destructive/danger menu item). No confirmation dialog — removes immediately, both from the local DB and the server.
- No drag-to-reorder inside a playlist — track order only changes by removing and re-adding, or (for smart playlists) via sort rule. This differs from the *queue* panel, which does support HTML5 drag-and-drop reordering.

### Rename / describe
- Click the playlist title (pencil icon) to rename inline; click the description line ("Add description…" when empty) to edit inline. Enter saves, Escape cancels. Both push to the server via `updateNavidromePlaylist`.

### Custom cover art
- Camera icon over the art → pick an image file → read as a data URI (`FileReader.readAsDataURL`) and stored directly in the local `playlists.custom_cover_data` column (not uploaded to the server). Takes precedence over the server's `cover_art_url` whenever set. Remove it with the X button to fall back to the server-provided cover (if any).

### Delete
- Trash icon in the header → button becomes **"Delete?"** (arm/confirm pattern) with a cancel (X) beside it → click again to confirm. Deletes server-side (`deleteNavidromePlaylist`) and cascades local `playlist_tracks` + `playlists` rows.

## Edge cases / gotchas

- Playlist IDs are composite: `"<server_id>:<native_id>"` — always stripped back to the native ID (`stripServerPrefix`) before any Navidrome API call.
- Removing a track calls the server with a **position index**, not a track ID — if local and server state ever drift (e.g. a concurrent edit from another Navidrome client), the wrong track could be removed server-side. No conflict detection exists.
- Adding the same track twice is silently deduped locally (`INSERT OR IGNORE` on `playlist_tracks`) but will still send a duplicate add call to the server — the server row can end up out of sync with track_count if this happens.
- Empty playlist shows "Playlist is empty." — no distinct empty state guiding you to add tracks.
- Custom cover images are stored inline as base64 data URIs in SQLite — no size limit enforced in the picker; very large images will bloat the local DB.

## Implementation

- `src/hooks/usePlaylists.ts:42-52` — `createPlaylist`
- `src/hooks/usePlaylists.ts:54-62` — `deletePlaylist` (deletes server + `playlist_tracks` + `playlists` rows)
- `src/hooks/usePlaylists.ts:64-89` — `addTrackToPlaylist`
- `src/hooks/usePlaylists.ts:91-106` — `renamePlaylist` (name + comment)
- `src/hooks/usePlaylists.ts:108-140` — `addAlbumToPlaylist` (adds every track on an album, ordered by disc/track number)
- `src/hooks/usePlaylists.ts:142-146` — `setCustomCover`
- `src/hooks/usePlaylistTracks.ts:33-52` — `removeTrack(position, playlist, swc)` — calls `removeTrackFromNavidromePlaylist` by position index, then deletes local row + decrements `track_count`
- `src/hooks/usePlaylistTracks.ts:13-31` — track list query, joined `playlist_tracks` + `tracks` + `albums`, ordered by `position`
- `src/components/PlaylistList.tsx:18-132` — Playlists grid + "New Playlist" form
- `src/components/PlaylistDetail.tsx:50-581` — detail view: play, rename/describe, cover, delete, column picker, context menu, resume-position tracking
- `src/components/PlaylistDetail.tsx:110-121,130-134` — `playlist_resume` table read + `virtualizer.scrollToIndex` to restore scroll position
- `src/components/AlbumDetail.tsx:958-977` — "Add to Playlist" submenu on a track's context menu
- `src/components/AlbumGrid.tsx:331-342` — "Add to Playlist" submenu on an album's context menu (adds whole album)
- DB: `playlists` (id, server_id, name, comment, track_count, cover_art_url, custom_cover_data, is_smart, rules_json), `playlist_tracks` (playlist_id, track_id, position), `playlist_resume` (playlist_id, last_track_id, track_position, updated_at)

## Open questions

- Whether multi-client conflicts (another Subsonic client reordering/removing tracks concurrently) are ever reconciled — no sync/merge logic found; Canon's local `position` values are only refreshed on next full track-list query.
