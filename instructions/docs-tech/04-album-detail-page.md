# Album Detail Page

## What it is

The full-page view for a single album — cover art, genre/mood tags, tracklist with per-track actions, album bio, and "more like this" strips (more from the artist, fans-also-like). This is the primary place users play music, inspect/edit tags, and discover related albums/artists.

## Entry points

Opened from anywhere an album appears: Home carousels, Album grid, Search results, Artist detail page, Genre detail, "More from Artist" / "Fans Also Like" strips. All these call `openAlbum()` (`src/hooks/useAppNavigation.ts:60-62`), which navigates to `albumPath(album.id)` and stashes `{ album, fromView: view }` in router state.

Back button (top-left, "← Back") calls `onClose`, which resolves to `goBack()` (`useAppNavigation.ts:76-78`) — a plain `navigate(-1)`.

## Step by step

1. User clicks an album cover/row anywhere in the app → album detail page opens full-screen.
2. **Header**: blurred cover-art background, 140px cover thumbnail (falls back to iTunes cover art via `AlbumArt.tsx` if no local art, else a placeholder box), album title, artist name (clickable → artist detail if `onSelectArtist` provided), year.
   - If the album title had a suffix stripped (e.g. "(Deluxe Edition)"), a "···" toggle appears next to the title to reveal it, plus a "Keep" button to exempt just this album, or a "+ Strip "(...)" from all albums" / "↩ Strip "(...)" again" button to manage the global suffix allowlist (see Tags › Title Cleanup).
   - If MusicBrainz identity is confirmed, verified facts (year, label, country, catalog #) replace the plain year line. If auto-identify is on but the album isn't matched yet, an "Unidentified" badge (help-circle icon) appears — click opens the Identify dialog.
   - "Tags updated Xd ago" / "today" hint + a "Refresh" button to re-run tag normalization on demand.
   - Action row: "▶ Play Album" button (disabled until tracks load; respects the user's configured default play action — replace/queue-last/queue-next/shuffle), a disc icon button to open the Identify dialog, and (once identified) an external-link icon to open the release on MusicBrainz.
3. **Tag band** (`album-tag-band`): up to three columns — **Genres**, **Descriptors**, **Scenes & Movements** — each a list of pill chips. Descriptors/Scenes columns only render if non-empty.
   - Click a chip → filters the library by that tag (`onTagFilter`).
   - Right-click a chip → opens the tag drawer (raw per-track tag inspection) for the album.
   - Hovering a chip shows a tooltip with the raw source tag(s) it was derived from (e.g. `"post-rock" (file)`, `"Post Rock" (lastfm)`).
   - Pencil icon next to "Genres" heading toggles the inline **Album Genre Editor** (add/remove/remap genres, resolve unmatched).
   - If there are unmatched (unmapped) tags, a "N unmatched →" link appears under Genres, opening the same editor.
4. **Bio**: if Last.fm enrichment returned an album bio, it renders clamped with a "Show more" / "Show less" toggle (only shown if the text actually overflows the clamp, measured via `ResizeObserver`).
5. **Tracklist**: a flat table (not grouped by disc). Columns toggle via a sliders icon button (top-right of the table) — Artist, Genre, Disc #, Duration, Format, Bitrate, Play count are all optional and persisted to `localStorage`; Title and the heart column are always shown.
   - Click a row → plays that track immediately (replaces queue at that point).
   - Right-click a row → context menu: **Play Now**, **Play Next**, **Add to Queue**, **Start Radio** (submenu of radio modes), **Show tags** (opens tag drawer scoped to that track), **More genres** (submenu, only if the track has >3 genres — the table only shows the first 3 inline), **Add to Playlist** (switches the same menu into playlist-picker mode).
   - Heart icon per row toggles track love/favorite (stops row-click propagation).
   - Currently-playing track shows a small play-icon in place of the track number and gets an "active" row style.
6. **More from Artist**: strip of up to 6 other albums by the same artist (excludes the current album), rendered via the shared `AlbumGrid`. Hidden for "Various Artists" albums and when the artist has no other synced albums.
7. **Fans Also Like**: up to 6 albums from artists similar to this one (from stored `similar_json` on artist enrichment, cross-referenced against the local library), same `AlbumGrid` component. Hidden if no similar-artist albums are in the library.

## Edge cases / gotchas

- **Various Artists albums** skip "More from Artist" and similar-artist enrichment entirely (`isVariousArtists` check).
- **Legacy sync gap**: if every track in the album is missing `bit_rate` (pre-v32 schema), the component silently triggers a targeted re-sync for that album on mount.
- **Genre chip counts**: the tracklist genre column caps at 3 chips per track even if more exist — overflow only reachable via the right-click "More genres" submenu, easy to miss.
- **Back-button bug** (tracked in project memory, `project-nav-bug.md`): back sometimes lands back on an album view instead of the actual prior view. `goBack()` is a raw `navigate(-1)` relying on router history rather than the explicit `fromView` stashed in location state — suspect this is why it can desync from the intended "previous" screen.
- Title-suffix stripping has three independent states per album: stripped (default, if it matches a global pattern), "Keep" (per-album exemption), and "Strip again" (undo the exemption) — plus a separate global allowlist toggle. Easy to confuse "Keep" (this album only) with the allowlist button (all albums).
- "Refresh" button re-runs the tag normalization pipeline on demand but does not affect enrichment (bio/identity) — those refresh on their own staleness schedule.

## Implementation

- Main component: `src/components/AlbumDetail.tsx:65` (`AlbumDetail`)
- Route wrapper: `src/App.tsx:75-119` (`AlbumDetailRoute`) — loads album from router state or URL query param
- Navigation: `src/hooks/useAppNavigation.ts:60-62` (`openAlbum`), `:76-78` (`goBack`)
- Cover art: `coverArtUrl` via `getCoverArtUrl()` (`src/lib/navidrome.ts`), fallback `src/components/AlbumArt.tsx:14` (iTunes lookup), accent color extraction persisted to `albums.accent_color` (`AlbumDetail.tsx:297-316`)
- Tag band data: `trackTagRows` query (`:117-132`, `QK.trackTagsAlbum`), `displayGenres`/`genreGroups` memos (`:384-430`), unmatched genres query against `album_unresolved_genres` (`:432-450`)
- Genre editing: `src/components/AlbumGenreEditor.tsx:39` — writes to `album_user_genres` (insert `:81-88`, delete `:93-100`)
- Tracklist: `useTracks(album.id)` (`:67`), column visibility state persisted to `localStorage` (`:245-252`), row render (`:780-856`), context menu (`:883-981`)
- Playback: `handlePlayTrack` (`:341-345`), `handlePlayAlbum` respecting `album.play_action` setting (`:347-359`), Zustand `usePlayerStore` (`:69-74`)
- Loved tracks: `useLoved()` (`:68`)
- Related strips: "More from Artist" via `useArtistAlbums` (`src/hooks/useArtistAlbums.ts`, `QK.artistAlbums`), "Fans Also Like" via `useSimilarArtistAlbums` (`src/hooks/useSimilarArtistAlbums.ts`, `QK.similarArtistAlbums`)
- Bio: `useEnrichAlbum()` (`:91`), `QK.albumEnrichment`, clamp/expand logic (`:727-737`)
- React Query keys: `src/lib/query-keys.ts` — `trackTagsAlbum` (34), `artistAlbums` (45), `similarArtistAlbums` (51), `normalizedTags` (57), `albumUnmatchedGenres` (59), `albumGenreRawSources` (60), `albumIdentity` (84), `albumEnrichment` (85)
- Tables touched: `albums`, `album_identity`, `tracks`, `track_tags`, `album_unresolved_genres`, `album_user_genres`, `album_genres`, `tag_mappings`

## Open questions

- Exact ranking/scoring behind "Fans Also Like" (how similar-artist list is ordered) not traced here — likely lives in the similar-artists enrichment pipeline, out of scope for this component.
- Whether the back-button bug is specific to this view or a general router-state issue wasn't confirmed in code — flagged as suspected cause above, not verified root cause.
