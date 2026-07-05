# Artist Detail Page

## What it is

The artist page pulls together everything Canon knows about an artist — synced library albums/tracks, plus enrichment fetched from Last.fm/MusicBrainz/Wikidata/Bandsintown — into one scrollable view: hero banner, popular/favorite tracks, essential picks, full discography by release type, guest appearances, similar-artist recommendations, and bio. It also handles two library-hygiene actions: merging a duplicate artist name into a canonical one, and confirming a MusicBrainz identity.

## Entry points

- Click any artist card (grid, search result, "More from Artist" strip, track row artist link, similar-artist card, etc.) → opens `ArtistDetail` full-page view.
- Back button top-left: "← Artists" (`src/components/ArtistDetail.tsx:607`) returns to prior view via `onClose`.
- Overflow menu (`⋯` icon button in hero actions row) → "Identify artist" / "Identify to add artwork", "Merge into another artist" (hidden if this artist is already an alias), "Open on MusicBrainz" (only once identity confirmed).

## Step by step

### Hero
- Portrait image (or a `Mic2` icon placeholder if none resolved) with an accent color extracted from the image and applied as `--artist-accent`, tinting the hero background.
- Name, then a meta row: listener count, scrobble count (if enrichment loaded), and "`N` album(s) in library" — plus an "alias of X" badge if this artist is itself merged into another, or an "N alias(es)" badge if other names have been merged into it.
- Canon genre line (top 5 canonical genres derived from this artist's albums).
- If aliases exist, a row of removable chips — click `×` to un-merge that alias immediately (no confirmation).
- Action buttons: **Play** (only shown if there are top tracks), **Shuffle** icon (only if >1 track), **Radio** icon (start radio seeded from the top track), **⋯** overflow menu.

### Popular / Favorites
Two columns side by side (single column if no loved tracks). "Popular" ranks tracks by matched Last.fm playcount (falls back to Last.fm chart rank, then album order if no Last.fm data). Shows 5 by default (`POPULAR_TRACKS_MIN`), "Show N more" expands to 10 (`POPULAR_TRACKS_MAX`). "Favorites" lists only the user's loved tracks from this artist, unranked. Below both, if Last.fm knows about tracks not present locally, a collapsed "More on Last.fm — not in your library" divider expands to a plain list with play counts.

Clicking a track row plays it (queues all visible top tracks starting from that one). Right-click opens a context menu: Play Now / Play Next / Add to Queue / Start Radio (submenu with radio modes).

### Essential
Only shown once the artist has more than 3 owned albums (`ESSENTIAL_MIN_ALBUMS`). Picks roughly the top 25% (`ESSENTIAL_RATIO`), preferring albums matched against the artist's Last.fm top-albums chart; pads with remaining owned albums if the Last.fm match doesn't fill the quota. Section is empty (not just unshown) while Last.fm top-albums is still loading.

### Discography
Tabs — Albums / EPs / Singles / Compilations — each showing a count, underline-style active tab. Classification (`classifyRelease`) first checks the synced `release_type` field, then falls back to name pattern-matching (e.g. title containing "EP", "single", "greatest hits", "anthology", "box set"). Only tabs with ≥1 item appear; first non-empty tab is selected by default.

### Appears On
Albums where a track is credited to this artist but the album's primary artist is someone else (e.g. compilations, features) — capped at 24, newest first.

### Fans also like
Two tabs, "In library (N)" / "Not in library (N)" — pulled from Last.fm's similar-artists list (top 12, `SIMILAR_ARTISTS_MAX`), split by whether that name exists in your library. Each card lazy-loads its own portrait/enrichment. Clicking a name that's in your library navigates to that artist's page.

### About
Only shown if a bio was fetched. Bio text truncates with "Show more"/"Show less" past 260 characters. Links out to MusicBrainz (if identity confirmed) and Last.fm. Beside the bio card sits the **tour dates card** (see below).

### Tour dates (Bandsintown)
Off by default (`enrichment.bandsintown_enabled` setting). Card shows "See upcoming tour dates?" with an info tooltip disclosing that enabling sends the artist name to the Bandsintown API — "No personal account information leaves your device." Clicking **Enable** turns it on globally (applies to all artists going forward, not just this one) and immediately fetches this artist's events. Once enabled, shows up to 5 upcoming shows (date, venue, city, weekday/time) with "Show N more"; clicking a show opens its Bandsintown page. If enabled but zero events found, the whole card hides itself.

### Footer
Shows "Last.fm updated `<relative time>`" or "Last.fm not loaded", plus a **Refresh** button to force re-fetch enrichment early (bypassing the normal staleness window).

### Merge Artist (dedup)
Overflow menu → "Merge into another artist" (hidden once this artist is already an alias of something else — can't chain aliases). Opens **"Merge Artist"** modal: search field to pick the canonical artist (results show album counts), Cancel/Merge buttons. Confirming inserts an alias row; the aliased artist's albums/tracks fold into the canonical artist everywhere (top tracks, genres, appears-on queries all match against `artist_aliases`). Reversible per-alias via the `×` chip on the canonical artist's hero. Merge is purely a local grouping — doesn't touch file tags or the source server.

### Identify artist (MusicBrainz)
Overflow menu → "Identify artist" (label reads "Identify to add artwork" if no portrait resolved yet). Opens the same `IdentifyDialog` component used for albums, artist variant: MusicBrainz search, manual MBID entry, Last.fm name override for ambiguous matches.

## Edge cases / gotchas

- **Last.fm per-title playcount ambiguity**: when multiple local tracks share a title (comment in `ArtistDetail.tsx:183-188` cites clipping.'s many "Intro" tracks), Last.fm's own chart merges them into one entry. Canon tries to match Last.fm's declared "representative album" against local copies; if none match, falls back to whichever local copy has the most local plays. The winner is flagged `lastfmCombined` so the UI can indicate the number spans more than one track — check `TrackRow` rendering if a playcount looks inflated for one specific track.
- **Essential albums section can vanish** if the artist has ≤3 owned albums, or hasn't finished loading Last.fm top albums yet (`lastfmAlbumsLoading` gate) — don't read "no Essential section" as "no albums."
- **Alias/merge is directional and non-transitive**: once artist A is merged as alias of B, A cannot itself become a canonical target for merges (menu item hidden) — avoids chained/circular aliasing.
- **Bandsintown enable is a global setting**, not per-artist — enabling from one artist's tour card turns it on for every artist page going forward. Tour lookup uses only the current artist's display name as the query — no MBID/alias resolution, so an aliased/merged name could return no results even if the canonical artist has listings.
- Portrait/accent-color extraction and enrichment fetch both race against component mount; if the artist changes quickly (e.g. clicking through similar-artist cards fast), stale hero accent or a flash of the previous bio/portrait can briefly show before the new query resolves — see cancellation flags in the `useEffect`s at `ArtistDetail.tsx:417-434` and `:506-514`.
- Manual portrait caching (Wikimedia rate-limit respecting, batched 2 per 500ms) is a separate opt-in flow, not automatic — see `useArtistImageCache.ts:121-148`.
- No artist-page-specific entries currently exist in `.claude/rules/known-issues.md`; the WebKitGTK left-click `ContextMenu` self-close bug (already fixed) applies here same as everywhere else, since both the track context menu and the overflow menu use the shared `ContextMenu` component.

## Implementation

**Main component**: `src/components/ArtistDetail.tsx:398` (`ArtistDetail`), ~980 lines. Props: `artist`, `serverWithCredential`, `onClose`, `onSelectAlbum`, `onSelectArtist`. Styles: `src/components/ArtistDetail.css` (675 lines).

**Hero / portrait**: render `ArtistDetail.tsx:596-602`; accent extraction `:501-514` via `extractAccent()` (`src/lib/artColor.ts`); portrait URL resolution chain — `resolvePortraitUrl()` (`src/lib/lastfm.ts:21`) → `resolveArtistImageUrl()` (`src/hooks/useArtistImageCache.ts:174-181`, prefers cached data URL over loopback proxy).

**Bio**: rendered `ArtistDetail.tsx:840-873`; `bioExpanded` state `:407`; bio value comes from `artist_identity.bio` via `useEnrichArtist` (`src/hooks/useEnrichArtist.ts:24-37` type, `:208-271` fetch/persist logic).

**Popular/Favorites**: `useArtistTopTracks()` (`ArtistDetail.tsx:57-74`, SQL joins `tracks`/`albums`/`artist_aliases`), matched against Last.fm via `matchLastfmTracks()` (`:189-`), rendered `:685-761`. Constants: `POPULAR_TRACKS_MIN = 5`, `POPULAR_TRACKS_MAX = 10` (`:170-171`).

**Essential**: memo `ArtistDetail.tsx:478-499`, rendered `:764-773` via shared `AlbumGrid`. Constants: `ESSENTIAL_MIN_ALBUMS = 3`, `ESSENTIAL_RATIO = 0.25` (`:172-173`).

**Discography**: `classifyRelease()` + `groupAlbums()` (`ArtistDetail.tsx:139-166`), rendered `:775-795` (tabs use underline style per `coding-standards.md`).

**Appears On**: `useAppearsOnAlbums()` (`ArtistDetail.tsx:99-119`), rendered `:797-806`, capped at 24 rows.

**Fans also like**: `similar` array parsed from `enrichment.similar_json` (`:516-518`, capped by `SIMILAR_ARTISTS_MAX = 12`, `:174`), library-presence split via `useSimilarInLibrary()` (`src/hooks/useSimilarInLibrary.ts:6-25`), rendered `:808-838` with `SimilarArtistCard` (`:350-396`).

**Tour dates**: setting `enrichment.bandsintown_enabled` via `useBoolSetting()` (`:414`); fetch effect `:417-434`; `TourCard` component `src/components/TourCard.tsx` (prompt state, tour list capped at `TOUR_LIMIT = 5`, "Show N more"); data fetch `fetchBandsintownEvents()` (`src/lib/bandsintown.ts:21-69`, REST call, 20-event cap, in-memory cache + inflight dedup).

**Merge**: menu item `ArtistDetail.tsx:903-909`; modal `src/components/ArtistMergeModal.tsx` (search/select/confirm, `useArtists()` for candidate list capped at 50, `useSetArtistAlias()` mutation); mutation does `INSERT OR REPLACE` into `artist_aliases` (`src/hooks/useArtistAliases.ts:50-68`); removal via `useRemoveArtistAlias()` (chip `×`, `ArtistDetail.tsx:638-646`).

**Identify**: menu item `:898-902`; dialog is the artist branch of the shared `IdentifyDialog` component (`src/components/IdentifyDialog.tsx:389-646`); identity load/save via `useArtistIdentity()` / `useIdentifyArtist()` / `useSaveArtistIdentity()` (`src/hooks/useArtistIdentity.ts:20-155`).

**DB schema** (`src/db/migrations.ts`):
- `artist_identity` (v15, `:291-296`): `artist_name` PK, `mb_artist_id`, `lastfm_artist_name`, `confirmed_at`
- `artist_identity` additions (v20, `:345-357`): `bio`, `listeners`, `playcount`, `similar_json`, `top_tags_json`, `lastfm_image_url`, `enriched_at`; (v21) `wikidata_image_url`
- `artist_aliases` (v38, `:529-537`): `alias_name` PK, `canonical_name`, `created_at`, indexed on `canonical_name`
- `artist_covers` (v44, `:579-585`): `artist_name` PK, `data_url` (cached portrait), `cached_at`

**React Query keys** (`src/lib/query-keys.ts`): `QK.artists()`, `artistAlbums`, `artistTopTracks`, `artistAppearsOn`, `artistGenres`, `lastfmArtistTopAlbums`/`lastfmArtistTopTracks` (7-day stale time), `artistAliases`, `artistCanonicalOf`, `artistIdentity`, `artistEnrichment`, `similarInLibrary`.

**Enrichment sources**: Last.fm (bio/stats/similar/top tracks/top albums), MusicBrainz (`searchArtists`), Wikidata, Fanart.tv, TheAudioDB, Wikipedia (portrait fallback chain) — orchestrated in `useEnrichArtist.ts:208-271`, 7-day default staleness.

## Open questions

- Exact ordering/priority of the portrait fallback chain (Wikidata vs Fanart.tv vs TheAudioDB vs Wikipedia) not fully traced beyond it being a fallback chain — would need a closer read of `useEnrichArtist.ts` to confirm precedence.
- Whether the footer's "Refresh" also re-fetches Bandsintown tour events or only Last.fm/MusicBrainz enrichment — not verified from the code read.
- Whether MBID auto-resolution runs silently as a side effect of any enrichment fetch (not just manual Identify) — flagged in an earlier draft of this doc but not independently re-verified against current `useEnrichArtist.ts` contents.
