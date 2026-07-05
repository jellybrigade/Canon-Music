# Automatic tag normalization pipeline

## What it is

Canon automatically figures out an album's genres for you — pulling from your file tags, Last.fm, and MusicBrainz, then matching each raw tag string (which can be messy: "rnb", "Hip-Hop", "shoegaze-ish") against Canon's built-in genre tree — so you get clean, consistent genre chips on albums and artists without manually tagging anything. It also flags whatever it *can't* confidently match so you can resolve it yourself in the Tags view.

## Entry points

No button most of the time — it just happens:
- **Opening an album** you haven't viewed recently (or ever) quietly computes its genres in the background; you'll see the tag band appear/update on the album page within a moment.
- **Idle background pass**: while the app sits idle, Canon works through albums/artists whose genre data has gone stale (default: older than 30 days, set in Settings → Metadata & Tags → staleness). If more than 300 items are stale at once, Canon won't auto-run — it shows a pending count and waits for you to confirm, so it doesn't hammer Last.fm/MusicBrainz unexpectedly.
- **Settings → Metadata & Tags tab → "Refresh All Now"** button — forces a full re-run across every stale album/artist, ignoring the 300-item pause.
- **Resolving a tag manually** (Tags view drawer, or the inline genre editor on an album page) re-runs normalization for just that album so your change takes effect immediately.

## Step by step (what you'll notice)

1. You open an album that hasn't been tagged yet, or whose tags are stale. The genre chip band is empty or shows old data briefly.
2. Canon checks file tags from your server, Last.fm's tags for that album, and MusicBrainz genre data (if the album's been identified). It also checks per-track Last.fm tags — if the same genre shows up on at least half the album's tracks, it counts even without an album-level tag.
3. Each raw tag gets matched against Canon's genre tree. Exact matches, known aliases ("rnb" → "R&B"), and close near-misses (typos) all resolve automatically. Anything that doesn't match becomes an "unresolved" tag.
4. Up to 6 genres, 6 descriptors, and 4 scene/movement tags are chosen and shown, prioritized: your own manual picks first, then file tags, then Last.fm, then MusicBrainz.
5. Genres also carry their tree ancestors (e.g. picking "Dream Pop" implicitly includes "Shoegaze"/"Alternative" lineage) — this is what powers Radio's genre-based scoring and the sidebar genre filter tree.
6. Anything left unresolved shows up in the Tags view's Review tab, and any manual decision you make there (map it, ignore it, accept as-is) is remembered globally — the same raw tag on any other album gets the same treatment automatically from then on.
7. If you exclude a genre from one album (via the album's inline genre editor), that album alone stops showing it, even if the source data still contains it.

## Edge cases / gotchas

- Excluding one genre from an album doesn't stop it being re-added if the underlying tag data changes — the exclusion is remembered per album, so it stays suppressed.
- If you tag-map or ignore a raw value once, it applies to **every** album/track with that same raw tag, not just the one you were looking at — a single decision can ripple across your library.
- Genres that look like years ("1990s", "'90s") are silently dropped by default before matching even happens (toggle: `tags.skip_year_genres`, on by default).
- A genre appearing on only some tracks of an album (below the 50% threshold) won't show up on the album page at all, but still feeds Radio when playing that specific track.
- If Canon's data ever gets internally inconsistent (cached summary says "done" but the resolved genre list is empty), it silently forces a re-run rather than showing stale/broken chips.
- Last.fm has no data for the album itself, Canon tries the artist's tags as a fallback — but only when there's truly nothing else (no file tags, no Last.fm album tags, no MusicBrainz data at all).

## Implementation (reference)

- Trigger hooks: `src/hooks/useNormalizeAlbum.ts` (on-open, checks staleness/new MB identity), `src/hooks/useBackgroundNormalizer.ts:102` (idle background pass, `tags.auto_refresh` setting, 300-item auto-run cap), `runEnrichment()` at `useBackgroundNormalizer.ts:144` (manual "Refresh All Now", `src/components/settings/TagsTab.tsx:165`). Manual mapping saves re-trigger via `TagDrawer.tsx:205,279` and `AlbumGenreEditor.tsx:70,119`.
- Core pipeline: `normalizeAlbum()` / `_doNormalizeAlbum()` in `src/lib/tag-normalize.ts:83-404` — in-flight dedupe map per albumId; merges file/`track_tags`, Last.fm (`fetchAlbumTags`, artist-fallback `fetchArtistGenreTags`), MusicBrainz genres + folksonomy (thresholded by `getMinFolksonomyCount()`), and 50%-consensus-promoted per-track Last.fm tags.
- Tree matching: `findCanonicalSync()` in `src/lib/canonicalize.ts:256` — order: existing-mapping lookup → exact same-kind → cross-type exact → alias table (`RAW_ALIASES`) retried through the above → Levenshtein ≤2 fuzzy (keys ≥5 chars, same kind only) → unmatched. Tree merges bundled `canon-tree.json` with user-added `user_tree_nodes` via `getCanonTree()`.
- Bucketing/capping: `bucketize()` (`src/lib/tag-buckets.ts:9`), caps 6 genres / 6 descriptors / 4 scenes, source-priority order manual > file > lastfm > musicbrainz > folksonomy.
- DB writes per run: `album_genres` (direct + DAG ancestors, `relation` column, fully replaced) and `album_unresolved_genres` (fully replaced) — schema at `src/db/migrations.ts:310` and `:320` (migration m17). Manual state lives in `tag_mappings` (`migrations.ts:207`, sentinels `__accepted__`/`__ignored__`) and `album_user_genres`/`album_genre_exclusions` (`migrations.ts:409`, `:473`). Raw source tags live in `track_tags` (`migrations.ts:189`), `source` ∈ `server|lastfm|lastfm-track|manual|musicbrainz|musicbrainz-folksonomy`. Cached final result: `albums.normalized_tags_json` + `albums.computed_at`.
- React Query: `QK.normalizedTags(albumId)` (`staleTime: Infinity`, invalidated post-run), `QK.albumUnmatchedGenres(albumId)`.
- Tags view components: `src/components/TagsView.tsx` (container; tabs Review/Decided/Tree/Title-Cleanup — outline in `docs.md` says Review/Mapped/Resolved/Cleanup, actual shipped names differ, reconcile before publishing), `TagReviewTab.tsx`, `TagDecidedTab.tsx`, `TagTreeTab.tsx`, `TitleCleanupTab.tsx` (unrelated feature — album title suffix stripping), `TagDrawer.tsx`, `AlbumGenreEditor.tsx`. Genre reads for dropdowns/filters: `src/hooks/useGenres.ts:12` (`album_genres WHERE relation='direct'`).

## Open questions

- Exact UI copy/behavior difference between "accepted" and "ignored" in `TagReviewTab.tsx`/`TagDecidedTab.tsx` not verified against running app — only DB-level sentinel semantics confirmed in code.
- Whether unresolved tags that get "ignored" still ever surface anywhere in the UI, or vanish entirely, not confirmed.
