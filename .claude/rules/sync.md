---
description: Library sync and scrobbling — Navidrome client, sync flow, scrobble queue, FTS maintenance
paths:
  - "src/lib/**"
  - "src/hooks/useAlbums.ts"
  - "src/hooks/useArtists.ts"
  - "src/hooks/useGenres.ts"
  - "src/hooks/useSearch.ts"
  - "src/hooks/useLoved.ts"
  - "src/hooks/useScrobble.ts"
---

# Library Sync

## Sync Flow (`sync.ts`)

On app start: `syncLibrary(server)` runs in background — app is immediately usable from SQLite cache.

Current flow:
1. `fetchAllAlbums` (paginated `getAlbumList2`, 500 per page)
2. For each album: `fetchAlbumTracks` (`getAlbum`)
3. `INSERT OR REPLACE` albums + tracks into SQLite
4. Delete + reinsert `tracks_fts` FTS5 rows per track
5. `fetchStarred2` pass: full replace of `loved_tracks`/`loved_albums` for this server

Loved sync is **independent of `DEV_ALBUM_LIMIT`** — covers all tracks in SQLite regardless of sync window.

Manual "Rescan" always available. `syncedRef` in `App.tsx` prevents double-sync on re-render; Rescan bypasses it.

**`DEV_ALBUM_LIMIT = 15` at `sync.ts:8` — remove before shipping.**

## Navidrome Auth

- Endpoint: `ping.view` (not `authenticate.view` — that doesn't exist)
- Auth params: MD5 token + salt, `c=canon`, `v=1.16.1`
- Credential format stored in keychain: `JSON.stringify({ token, salt })`

## FTS5 Search

`tracks_fts` virtual table: `id UNINDEXED, title, artist, album, genre`, `tokenize='unicode61'`.
Manually maintained (not a content table) — rebuilt per track during sync.

**Bug**: `useSearch.ts` uses hard `LIMIT 5`. "Show all" toggle in `SearchResults.tsx` cannot reveal more — fix before shipping.

## Scrobbling

Threshold: 50% elapsed OR 240 seconds. Guard: `scrobbedRef` (resets on track-id change only).

Write: `INSERT INTO scrobble_queue` immediately on threshold.
Flush: **not yet implemented** — nothing reads from `scrobble_queue`. Wire to Navidrome `scrobble.view` + `scrobble_history` dedup before v1 ship.

Dedup on flush: skip if `(track_id, timestamp)` already in `scrobble_history`.

## Known Issues

- `syncLibrary` aborts on first album failure — `fetchAlbumTracks` throw stops entire sync. Fix: catch per-album, log, continue.
- No incremental sync — `INSERT OR REPLACE` every run. `last_modified` column exists but unused.
- `tracks_fts` not rebuild in a transaction — partial failure leaves FTS desynced.
