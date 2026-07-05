# Identifying Albums/Artists via MusicBrainz

## What it is

Links your album and artist records to canonical MusicBrainz entries so Canon can pull in verified metadata — record label, country, catalog number, release date — and disambiguate artists with same/similar names. Runs automatically in the background when enabled, or can be triggered/corrected manually per album or artist.

## Entry points

- **Setting**: Settings → **Metadata** nav item → "MusicBrainz" section → toggle **"Auto-identify albums when opened"** (description: "Runs MusicBrainz lookup automatically when you open an album."). `src/components/settings/TagsTab.tsx:245-254`.
- **Manual identify — album**: Album detail page → disc icon button, tooltip "Identify on MusicBrainz" (`src/components/AlbumDetail.tsx:584-591`). If auto-identify is on but no match found yet, an **"Unidentified"** badge button appears instead (`AlbumDetail.tsx:550-557`) — clicking it opens the same dialog. Dialog heading: **"Identify Album"**.
- **Manual identify — artist**: Artist detail page → overflow menu → **"Identify artist"** (or **"Identify to add artwork"** if the artist has no portrait yet) (`src/components/ArtistDetail.tsx:899-901`). Dialog heading: **"Identify Artist"**.
- **Bulk review queue**: Sidebar → **"Unidentified"** nav item (badge shows count of albums that failed lookup) → **"Unidentified Albums"** page.

## Step by step

### Automatic identification
1. User opens an album detail page for the first time (no existing identity row) with the setting enabled.
2. Canon searches MusicBrainz for the release group, scores candidates, and silently confirms a match if the top score ≥ 0.80 and it beats the runner-up by ≥ 0.10.
3. If no confident match, the album is marked "needs review" or "ambiguous" — user sees the "Unidentified" badge on that album, and it appears in the Unidentified Albums queue.
4. Once confirmed (auto or manual), verified facts (label, country, catalog #) show as a compact meta line under the album header.

### Manual identify dialog
1. Click the identify icon (album) or "Identify artist" (artist menu). Dialog opens.
2. **MusicBrainz** section shows initial search results as candidate buttons — each with title, match %, artist, year, release type, raw MBID, and a link to browse the entry on musicbrainz.org.
3. **Last.fm strings** section lets user override the artist/album name used for Last.fm lookups (fix typos/alternate titles) — separate text fields for Artist and Album.
4. **MusicBrainz** ID section: manual text fields for Release Group MBID, Release MBID (optional, specific pressing), Artist MBID (optional) — for pinning an exact entry when search fails.
5. Click **"Look up"** (shows "Looking up…" while running).
6. Results section: a status badge, then either:
   - **Ambiguous**: hint text "Multiple matches — select one:" (or "Select to confirm:" if only one candidate) with clickable candidate cards.
   - **Found**: confirmed fact rows — Album, Artist, Year, Label, Country, Catalog #, Genres, RG MBID (for albums); Name, Disambiguation, Country, Genres, MBID (for artists).
7. Click **"Confirm"** (shows "Saving…") to persist, or **"Cancel"** to discard.

### Unidentified Albums queue
1. Open sidebar → **"Unidentified"**. Page heading "Unidentified Albums" with a count.
2. Empty state: "All albums have been identified."
3. Each row has an **"Identify"** button (disc icon) opening the same manual dialog.
4. **"Rescan All"** button re-runs auto-identify against every row in the queue, showing live progress ("{done} / {total}"), and auto-persists any newly high-confidence matches without further confirmation.

## Edge cases / gotchas

- No skip/ignore/dismiss action exists in the Unidentified queue — the only ways out are Identify (manual) or Rescan All (auto). An album with no MusicBrainz release at all stays in the queue indefinitely.
- MusicBrainz's own search ranking can tie same-titled releases by different artists/years at 100% — Canon re-ranks raw search results locally by its own fuzzy score (title + artist + year similarity) rather than trusting MB's order.
- Typing a search override into the Last.fm name fields does not get silently saved as a confirmed override — it's only used for that lookup unless explicitly confirmed (guards against a typed *search query* being mistaken for a real correction).
- When inferring a likely artist MBID from a previously-identified album (to help disambiguate future lookups), Canon only counts **manually confirmed** identities — auto-matched albums (`auto_matched = 1`) are excluded from this inference.
- If the initial MusicBrainz search for an album returns zero results, Canon retries once with trailing bracketed suffixes stripped from the title (e.g. "Album (Deluxe Edition)" → "Album").
- Feature is pure TypeScript — no Rust/Tauri commands involved (direct HTTP calls to the MusicBrainz API), consistent with the "Rust stays thin" architecture rule.

## Implementation

- **Dialog**: `src/components/IdentifyDialog.tsx` — `AlbumIdentifyDialog` (line 44), `ArtistIdentifyDialog` (line 389).
- **Auto-identify hook/logic**: `src/hooks/useAutoIdentifyAlbum.ts:21-60`; core scoring in `src/lib/album-identify.ts` `autoIdentifyAlbum()` (lines 43-127) — `AUTO_CONFIRM_THRESHOLD = 0.80` (line 35), `MIN_SCORE_GAP = 0.10` (line 36), `stripTrailingBrackets()` (lines 38-41).
- **Candidate ranking**: `src/lib/fuzzy-match.ts` `rankCandidates()` (line 172), `filterByTrackCount()` (line 139).
- **MusicBrainz API client**: `src/lib/musicbrainz.ts` (`searchReleaseGroups`, `searchArtists`, `lookupReleaseGroup`, `lookupRelease`, `combineGenres`).
- **Settings**: `useBoolSetting("mb.auto_identify", false)`, key stored in generic `settings` table (`src/db/migrations.ts:103`), read in `src/components/settings/TagsTab.tsx:68`.
- **DB tables** (`src/db/migrations.ts`):
  - `album_identity` (lines 275-290, extended 302-304, 387, 562-564): `album_id` (PK), `mb_release_group_id`, `mb_release_id`, `mb_artist_id`, `lastfm_artist_name`, `lastfm_album_name`, `lastfm_match_confirmed`, `combined_genres_json`, `label`, `country`, `catalog_number`, `barcode`, `release_date`, `confirmed_at`, `auto_matched`, `match_score`, `looked_up_at`, `combined_tags_json`, `album_bio`, `lastfm_url`, `album_enriched_at`.
  - `artist_identity` (lines 291-296, extended 346-352, 357): `artist_name` (PK), `mb_artist_id`, `lastfm_artist_name`, `confirmed_at`, plus enrichment columns.
- **Unidentified queue**: `src/components/UnidentifiedView.tsx`; route `/unidentified` (`src/App.tsx:939-945`); sidebar badge from `useFailedLookupAlbumIds()` (`src/hooks/useAlbumIdentity.ts:341-353`, query filters `album_identity` rows where `mb_release_group_id IS NULL AND looked_up_at IS NOT NULL`); failures recorded via `useRecordFailedLookup` (`useAlbumIdentity.ts:355-374`); bulk rescan logic `UnidentifiedView.tsx:27-76`.
- **React Query keys** (`src/lib/query-keys.ts`): `QK.albumIdentity`, `QK.albumIdentityAll`, `QK.artistIdentity`, `QK.confirmedArtistMbid`, `QK.identifyAlbum`, `QK.autoIdentifyAlbum`, `QK.failedLookupAlbumIds`, `QK.failedLookupAlbums` (lines 63-91).
- **Hooks**: `src/hooks/useAlbumIdentity.ts`, `src/hooks/useArtistIdentity.ts`, `src/hooks/useAutoIdentifyAlbum.ts`.

## Open questions

- None — code review confirmed all behavior described above.
