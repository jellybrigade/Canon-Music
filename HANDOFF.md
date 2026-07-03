# Handoff: Fix duplicate Last.fm playcount bug (ArtistDetail "Popular" tracks)

## Goal

Artist page "Popular" section shows the **same fake Last.fm playcount** on every local track that shares a title, even across different albums. Repro: clipping. has 5 tracks named "Intro" across 5 albums — all 5 show identical "931.4K plays," which is really only true of one specific "Intro" (the CLPPNG one). Fix the matching so a Last.fm popularity entry attaches to at most one local track.

## Root cause (confirmed, don't re-investigate)

Last.fm's `artist.getTopTracks` API (`src/lib/lastfm.ts:411-437`, `fetchArtistTopTracks`) returns **title + playcount only** — no album, no MBID. This is an API limitation:
- `track.getInfo` only accepts `mbid` OR `artist+track` (no album param) — can't ask "get me info for this track on this specific album."
- The `duration` field sometimes present in top-tracks responses is unreliable (often `"0"`), not usable as a disambiguator.

In `src/components/ArtistDetail.tsx`, three places key off `normalizeTrackTitle()` (`src/lib/lastfm.ts:367-374`, title-only, no album component):

- `rankByLastfm()` — line 179-187 — ranks local tracks by matching normalized title. All same-titled tracks tie for the same rank.
- `lastfmPlaycountMap` — line 382-386 — `Map<normalizedTitle, playcount>` built from Last.fm response.
- Render lookups — line 614 and 642 — every `TrackRow` does `lastfmPlaycountMap.get(normalizeTrackTitle(track.title))`. Every local track sharing a normalized title pulls the identical playcount out of the same map entry.
- `lastfmOnlyTracks()` — line 189-192 — same title-only pattern, lower priority (drives the "popular on Last.fm but missing from your library" list).

`TopTrack` (interface at line 42-51) already carries `album_id`, `album_name`, and `play_count` (local scrobble/listen count from Canon's own DB, selected in `useArtistTopTracks`'s SQL at line 53-70) — these exist today and aren't being used to disambiguate.

## What worked (research done — don't repeat)

Checked ~25 open-source music clients in `reference-projects/` for prior art on this exact problem:

- **Subsonic/Navidrome-family clients** (feishin, sonixd, airsonic-refix, aonsoku, substreamer, Airdrome, Nocturne, psysonic, nokkvi, firmium): don't call Last.fm client-side at all. They call the server's `getTopSongs`/`getArtistInfo2`, and the *server* (Navidrome) already resolves Last.fm data to real local track IDs before the client sees it. Not applicable to Canon — Canon talks to Last.fm directly.
- **ampcast**: the one comparable app calling Last.fm's API directly like Canon does. It **sidesteps the problem** by never merging Last.fm top tracks into the local library list — shows them as a separate synthetic "Top Tracks" pseudo-list, unlinked from local files.
- **picard**: irrelevant (MusicBrainz/AcoustID fingerprint matching only, no Last.fm popularity).
- **Conclusion: nobody in the reference set actually solves per-album disambiguation for same-titled tracks.** Canon needs an original approach since it's both (a) hitting Last.fm directly and (b) merging results into per-album local rows (unlike ampcast's separate-list dodge).

## Chosen fix approach (exclusive-claim) — not yet implemented

Replace the three independent title-keyed lookups with **one unified matching pass** that assigns each Last.fm entry to at most one local track:

1. Build `Map<normalizedTitle, {playcount, rank}>` from `lastfmTracks` (first occurrence wins if Last.fm itself has duplicate normalized titles — rare, harmless either way).
2. Walk local tracks and claim map entries **exclusively**. When multiple local tracks share a normalized title, the winner is the one with the **highest local `play_count`** (real listen data Canon already has via `TopTrack.play_count`) — a genuine signal for "which album's copy is actually the popular one for this listener," better than arbitrary array order. Tie-break (all zero/equal `play_count`): fall back to the existing stable query order (`track_number`, then `title`) — deterministic, not random.
3. Losing tracks (same title, not claimed) get **no** Last.fm rank/playcount. They should not receive the fake shared value — render with no playcount badge (check `TrackRow`'s render to see what "no playcount" should look like; `lastfmPlaycount` prop is presumably already optional/undefined-safe since it's `Map.get()` today, which returns `undefined` on miss).
4. Produce **one enriched array** — e.g. attach `lastfmRank`/`lastfmPlaycount` fields directly onto each track object — so the sort (`rankByLastfm`'s replacement), the `popularTracks` slice, and the render playcount (lines 614, 642) all read from the **same resolved match**. Do NOT keep separate `normalizeTrackTitle()` lookups scattered at render time — that's what let rank-order and displayed-playcount silently drift out of sync as a class of bug.
5. `lastfmOnlyTracks()` (line 189-192) can reuse the same normalized-title map for its "is this title present locally at all" check. Exclusivity doesn't matter for that function (it's presence-only, not attribution) — fine to leave as-is or lightly refactor to share the map; not required for the fix.

## Out of scope — do not touch

`essentialAlbums` block further down in `ArtistDetail.tsx` (~line 393+) does a separate `normalizeTrackTitle()`-based **album** matching for a different feature (essential-albums recommendation). Unrelated to this bug, leave alone.

## Next steps

1. Implement steps 1-5 above in `src/components/ArtistDetail.tsx` (likely a new `matchLastfmTracks(tracks, lastfmTracks)` function replacing `rankByLastfm` + the `lastfmPlaycountMap` `useMemo`, plus a small type addition to carry `lastfmRank`/`lastfmPlaycount` on each track).
2. Check `TrackRow` component's render logic for `lastfmPlaycount` to confirm the "no data" fallback path already exists and looks reasonable when many rows have no Last.fm playcount.
3. Verify against the real repro case: open clipping. (or any artist with genuine duplicate track titles across albums) and confirm only one album's copy shows a Last.fm playcount/rank; the rest show none.
4. Run `pnpm tsc --noEmit`.
5. Commit to `development` branch per Canon workflow (never commit to `main` directly).
