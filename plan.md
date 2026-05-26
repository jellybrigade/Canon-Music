# Canon — Product Plan

A cross-platform desktop music player for Navidrome, Jellyfin, and Plex that doubles as a library cleaner and tag enrichment tool. Fast, modern, non-destructive.

---

## The Problem It Solves

Self-hosted music libraries are only as good as their tags. Most are a mess — genres that say "Progressive Rock" on a rap album, fifteen different spellings of "Midwest Emo" treated as separate genres, missing artist info, broken radio because the data feeding it is garbage. No existing tool fixes this in a way that's accessible. MusicBrainz Picard is powerful but intimidating. Feishin is a great player but read-only. There's nothing that plays your music *and* quietly helps you fix it.

---

## What It Is

A desktop app you install like any other. You connect it to your Navidrome, Jellyfin, or Plex server. You get a modern music player. But alongside the player, you get a full tag management layer — genre normalization against a canonical genre tree, Last.fm enrichment, a tag editor, and a review-before-save flow so nothing ever changes without your say-so.

---

## Tech Stack

| Layer | Choice |
|---|---|
| App framework | Tauri — thin Rust layer (file I/O and audio only); all business logic in TypeScript |
| Frontend | React + TypeScript |
| State | Zustand (playback, UI) + React Query (library data, server fetching) |
| Local DB | SQLite via `tauri-plugin-sql` |
| Auth storage | OS keychain via `tauri-plugin-keychain` (Keychain / libsecret / Credential Manager) |
| Audio backend | Rust — `rodio` + `symphonia` (gapless, native, streams from server); streaming decoder (not full-file buffering); `sink.get_pos()` polled every 200ms for elapsed |
| Distribution | GitHub Releases + Tauri auto-updater |

---

## Servers Supported

- **Navidrome** — OpenSubsonic API, username/password → token
- **Jellyfin** — username/password → API key
- **Plex** — OAuth2 via plex.tv
- Multiple servers simultaneously — unified library view across all; v1: duplicate albums shown separately with server badge; v2: dedup by album+artist with user preference toggle (show all / show one)

All tokens stored in OS keychain, never written to disk unencrypted.

---

## Sidecar Agent

Tag writes require filesystem access to the music files. The app cannot do this over server APIs. Solution: a small sidecar process running on the same machine as your music server.

- Lives in `sidecar/` subdirectory of the Canon monorepo
- **Language**: Python + `mutagen` (handles FLAC, MP3, ALAC, AIFF, OGG, Opus)
- Distributed as a **Docker image** (Docker Hub)
- **API**: `GET /health` → `{ ok: true }` | `POST /write` → `{ file_path: string, tags: Record<string, string> }` → `{ ok: true }` or error
- Secured with a **shared secret token** set at install time, passed as `Authorization: Bearer <secret>` header; token stored in OS keychain under `canon.sidecar.{server.id}`
- **Configured per-server** (not global) — sidecar URL + secret attached to each server connection, since sidecar is co-located with the music server
- **Optional path prefix remap**: `path_prefix_map: { from, to }` for when Navidrome's file path prefix differs from the Docker volume mount point (e.g. Navidrome sees `/data/music`, sidecar mounts at `/music`)
- `file_path` comes from Navidrome's `getAlbum` response (`path` field), stored in SQLite `tracks.file_path`
- Playback works without sidecar. Tag editing requires it.
- On confirmed write: Canon POSTs to sidecar `/write` → sidecar writes file → returns success → Canon moves edits to `edit_history` → Canon triggers server rescan directly via Navidrome API

---

## Player Features

- Stream music from any connected server
- **Gapless playback** — Rust audio backend (`rodio`) pre-fetches next track bytes at ~80% elapsed, appends via `sink.append()` for sample-accurate scheduling; requires streaming decoder (not full-file buffering); pre-fetch triggers on explicit next/skip too
- Queue management — add tracks, albums, drag to reorder; **Play Next** (insert immediately after current) vs **Add to Queue** (append to end) are distinct actions available everywhere a track or album appears via right-click context menu; dedicated queue panel (drawer/sidebar) is a separate feature after context menus ship
- **Stop behavior**: stop = pause + seek to 0; queue always survives stop; "Clear queue" is a separate explicit action
- **Repeat modes**: off / repeat-all / repeat-one — toggle in player bar, persisted across sessions in SQLite settings table
- **Shuffle**: toggle in player bar; uses shadow index array (`shuffleOrder: number[]`) so toggling off restores original queue order; current track stays playing when toggling on
- Scrobbling to Last.fm and ListenBrainz — logic lives in dedicated `useScrobble(track, elapsed)` hook
  - Offline queue: scrobbles stored in SQLite, flushed on reconnect
  - Threshold: 50% played or 4 minutes, whichever first (Last.fm standard)
  - Duplicate prevention: timestamp + track dedup on flush
- Artist page — bio and image from Last.fm (`artist.getInfo`), similar artists from Last.fm (`artist.getSimilar`); bio + image cached in `artists` table (`bio TEXT, image_url TEXT`); falls back gracefully when API key absent or call fails
- Album page — artwork, tracklist, release info
- **Radio / Auto-DJ** — powered by Canon genre tree + Last.fm signal (see Radio section); eager N=10 lookahead queue, visible in queue panel, auto-refills as tracks play
- Search across all connected servers
- Keyboard shortcuts for everything; hotkeys are suppressed when any text field is focused to prevent playback controls firing during search or tag editing
- **Context menus** on every track and album: Play Now / Play Next / Add to Queue / Go to Artist / Go to Album; queue has its own context menu with Move to Top / Move to Next / Move to Bottom / Remove
- **OS media key integration** — `navigator.mediaSession` metadata + action handlers (play, pause, next, prev); hardware media keys and lock screen controls work
- Offline playback from recently-played LRU cache (default 1GB cap, user-configurable); cache written implicitly on every play (no user action); metadata (path, size, last_accessed) in SQLite `audio_cache` table; eviction runs after each write
- **Seek**: `audio_seek` Tauri command → `Sink::try_seek(Duration)`; fall back to HTTP range request if symphonia decoder rejects seek on streaming input
- **Search**: SQLite FTS5 v1 (offline-safe, instant); server-side search API fallback in v2

---

## The Canon Genre Tree

This is the defining feature of the app — and the source of the name.

Canon ships with a **canonical genre and mood taxonomy** seeded from the RateYourMusic genre hierarchy (~8000 entries). It covers genres (`Hip-Hop → Hardcore Hip-Hop → Memphis Rap → Phonk`) and descriptors/moods (`Dark`, `Hypnotic`, `Party`, etc.) as a **DAG** — a genre can have multiple parents.

### Two-file system

| File | Purpose |
|---|---|
| `src/assets/canon-tree.json` | Generated from `RateYourMusic Hierarchy.txt` via `scripts/parse-rym.ts`; bundled with app |
| `user-tree.json` | User override — if this file exists and is non-empty, it replaces the canon tree entirely |

Users can edit their tree via the app UI or directly in `user-tree.json`. Structured JSON: nodes with `id`, `name`, `type: genre|mood|category`, `parents: [id, ...]`.

`category` nodes are suffix-less organizational groupings from the RYM hierarchy (e.g. `Atmosphere`, `Form`). They are valid DAG parents used in ancestor-chain scoring but are not taggable genre/mood values themselves.

### Genre normalization

Two-pass approach:
1. `canonical_key = lowercase + strip all punctuation + collapse spaces` — exact-match clustering (catches "Hip-Hop" = "Hip Hop" = "hip hop")
2. `fuzzy_key = lowercase + trim` — Levenshtein ≤ 2 on strings that didn't exact-match

Steps:
1. Normalize input via canonical_key → look up in genre tree
2. Found → snap to canonical display name
3. Not found → Levenshtein on fuzzy_key, threshold ≤ 2 → suggest mapping
4. Semantic aliases (`rnb` → `R&B`) handled via bundled ruleset in canon-tree

### Genre Unifier workflow

1. Scan library → collect all unique genre strings
2. Cluster: normalize + Levenshtein grouping
3. Present **bulk table UI**: all clusters in scrollable table with columns — raw strings, track count, suggested canonical; user edits inline, skips obvious ones, batch-confirms
4. Full diff shown before any write — "X tracks will change"
5. Confirmed mappings saved as reusable ruleset — reruns on new imports

Rulesets exportable and shareable. Canon ships a default community ruleset covering common genre garbage (UUIDs, playlist names written as genres, obvious duplicates).

---

## Radio / Auto-DJ

Given current track's genre and mood tags, score candidate tracks:

1. For each tag, walk DAG ancestors — weight = `1 / 2^depth` (direct = 1.0, parent = 0.5, grandparent = 0.25 ...)
2. Multi-parent nodes propagate weight up all parent chains
3. Moods contribute at lower base weight than genres (configurable)
4. Sum scores per candidate track
5. Blend: **60% genre/mood tree score + 40% Last.fm similar artists**

A track tagged `Phonk` scores high against other Phonk tracks, medium against Memphis Rap, low-but-nonzero against Hip-Hop broadly. Radio degrades gracefully as library depth decreases.

---

## Tag Management

All tag operations follow the same principle: **show the user what will change, let them confirm or adjust, then write.**

### Tag Editor

Click any track or album → edit title, artist, album artist, album, year, genre, track number, disc number, comment. Album-level changes apply to all tracks at once. Shows current value and proposed change side by side.

### Last.fm Tag Enrichment

Public API only (no OAuth) for v1. User pastes Last.fm API key in Settings; stored in SQLite `settings` table under key `lastfm_api_key`.

1. Right-click album → "Fetch tags from Last.fm" → calls `album.getInfo`
2. Side-by-side diff: current tags left, Last.fm suggestions right
3. Accept all, reject all, or cherry-pick field by field
4. Only accepted changes staged as `pending_edits` with `source = 'lastfm'`
5. **Bulk mode**: select multiple albums → fetch all → **collapsed table**: each album is a row, expand to see field-level diff, "accept all" per row or globally

### Tag Issue Detection

Passive background scan flags:
- Genres that look like non-genres (UUIDs, URLs, playlist names)
- Tracks missing genre, artist, or album
- Albums with inconsistent artist name spelling across tracks
- Duplicate albums (same name + artist, differing tags)

Badge count on library. Review and fix or dismiss each issue.

### Tag Editor

Inline accordion below track row in AlbumDetail — no modal. Album-level edits (apply to all tracks) live in the AlbumDetail header.

### Tag Staging Model

All edits accumulate in `pending_edits` before any file is touched:

```
pending_edits: id, track_id, field, old_value, new_value, source, created_at, error
source: manual | lastfm | genre_unifier
```

- User reviews batch in "Review Changes" view → confirms → sidecar writes files
- Confirmed edits move to `edit_history` (audit log)
- Failed writes stay in `pending_edits` with `error` column — user can retry
- **Conflict resolution**:
  - `manual` source wins over all others silently — if a `manual` row exists for `(track_id, field)`, `lastfm` and `genre_unifier` skip that field
  - `lastfm` vs `genre_unifier` conflict on same `(track_id, field)` → surface to user, never silently overwrite
- **Undo**: 1 level deep via `edit_history` — "recently changed" list with revert button per edit

---

## Library Sync

- App start: poll server via `lastModified` timestamps, pull only changed/new items — non-blocking background sync
- First run: full sync with progress indicator, app usable immediately for already-synced data
- Manual "Rescan library" button always available
- Artwork lazy-loaded on first view, LRU cache in separate dir
- All library data in local SQLite — fast cold open, playback works offline for cached content

---

## Library View

- Browse by artist, album, genre, year
- **Genre view**: tree browser — expand `Hip-Hop → Hardcore Hip-Hop → Memphis Rap → Phonk`
- Filter and search across all connected servers (SQLite FTS5; server-side API fallback v2)
- Album grid with artwork
- "Needs attention" filter — items with flagged tag issues only
- All list and grid views virtualized (windowed rendering) — library of 50k+ tracks must not degrade scroll performance
- **Implementation priority order**: (1) Artist view, (2) Genre tree browser, (3) Year filter, (4) Needs attention filter

---

## Settings

- Manage server connections (add, edit, remove, test); each server has optional sidecar URL + shared secret (per-server, not global)
- Last.fm account (scrobbling + tag fetching)
- ListenBrainz account (scrobbling)
- Genre tree — view, edit, import/export `user-tree.json`
- Genre normalization ruleset — view, edit, import, export
- Offline cache size limit
- Keyboard shortcut customization
- Theme — light / dark / system

---

## Non-Negotiables

- Never writes a single tag without showing a diff and getting confirmation first
- Works offline for playback (recently-played LRU cache)
- No telemetry, no accounts required, no cloud dependency
- Fast — opens under 2 seconds, library loads instantly from SQLite cache; large libraries (50k+ tracks) scroll without jank (virtualized lists)
- Cross-platform — Windows, macOS, Linux, same behavior

---

## Distribution

- **App**: GitHub Releases — `.msi` (Windows), `.dmg` (macOS), `.AppImage` (Linux)
- **Auto-update**: Tauri built-in updater — checks GitHub releases API, prompts user
- **Sidecar**: Docker Hub image

---

## v1 Scope

Player + queue + gapless + scrobbling + Genre Unifier + Last.fm enrichment + manual tag editor + tag issue detection + Canon genre tree + Radio.

## v2 / Later

- AcoustID / MusicBrainz fingerprint identification (sidecar runs `fpcalc`, identifies unknown/wrong-tagged tracks)
- Explicit offline sync (user marks albums for offline)
- Multi-server dedup: match albums across servers, show once, user toggle (show all / show one)
- Server-side search API fallback (per-server: Navidrome/Jellyfin/Plex search endpoints)
- Jellyfin webhook support for real-time library updates
- Package manager distribution (Homebrew, winget, Flatpak/AUR)
- MusicBrainz account integration (submit corrections back)
- Community genre tree contributions
