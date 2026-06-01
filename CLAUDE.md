# Canon

Desktop music player and tag management tool for self-hosted music servers. Currently supports Navidrome; Jellyfin and Plex are planned. Built with Tauri + React. Full product spec in `plan.md`. File and data flow map in `ARCHITECTURE.md`.

---

## Stack

| Layer | Choice |
|---|---|
| App framework | Tauri — thin Rust layer (audio + keychain only); all business logic in TypeScript |
| Frontend | React + TypeScript |
| State | Zustand (playback) + React Query (library data) |
| Local DB | SQLite via `tauri-plugin-sql` |
| Auth storage | OS keychain via `tauri-plugin-keychain` — never disk |
| Audio | `rodio` + `symphonia` in Rust; streaming from server |
| Distribution | GitHub Releases + Tauri auto-updater |

## Commands

```bash
pnpm install                    # install JS deps
pnpm tauri dev                  # run app in dev mode (hot reload)
pnpm tauri build                # production build (.AppImage/.dmg/.msi)
pnpm tsc --noEmit               # typecheck
cd src-tauri && cargo check     # rust typecheck
cd src-tauri && cargo clippy    # rust lint
cd src-tauri && cargo fmt       # rust format
```

---

## Git Workflow

Two branches:

- `development` — all work happens here. Commit whenever a logical unit of work is done. The auto-commit hook will also pick up uncommitted changes on stop.
- `main` — releases only. One commit per release, tagged `vX.Y.Z` by CI. Never commit to main directly.

To release, run `/commit`. That skill handles code review, version bump, merge, and push.

---

## Architecture Rules

### Keep ARCHITECTURE.md current
Canonical map of every file, its purpose, data flow, and key invariants. Any change that adds, moves, deletes, or substantially repurposes a file must update `ARCHITECTURE.md` in the same commit. New Tauri commands, new migrations, and new architectural invariants belong there too. Part of "done".

### Rust stays thin
Only `#[tauri::command]` for: audio control, OS keychain access. No business logic in Rust. See `.claude/rules/audio-playback.md`.

### Enrichment is local-only — no file writes
Metadata enrichment (Last.fm tags, artist bio/stats/similar, MusicBrainz identity) writes only to SQLite. Canon never modifies the user's music files. The sidecar file-write subsystem was removed; `pending_edits` / `edit_history` tables and `servers.sidecar_*` columns are inert legacy schema. File-write design is TBD for a future version.

### Genre tree is a DAG
Do not flatten to single-parent. Do not merge `canon-tree.json` and `user-tree.json`. See `.claude/rules/genre-tree.md`.

---

## Status

**v0.5.x — active development.** Schema v20, all workstreams shipped:

- Full library sync (incremental, artists table, tag issues scan)
- Scrobble queue + flush to Navidrome (`useScrobbleFlush`)
- Local tag normalization: Last.fm + MusicBrainz genres → canon tree → `album_genres` / `album_unresolved_genres`
- Artist enrichment: bio, stats, similar artists persisted to `artist_identity` (schema v20); on-open + background
- Tag issue detection + `TagIssuesView` with dismiss + sidebar badge
- Shuffle re-seeds on repeat-all wrap
- Drag-to-reorder queue (HTML5 DnD)
- OS media keys (`navigator.mediaSession`, exposes MPRIS on Linux)
- Radio Auto-DJ: canon tree ancestor scoring + Last.fm similar artists; 10-track lookahead
- Lyrics: LRClib fetch + SQLite cache + synced auto-scroll in NowPlayingOverlay
- Settings: centered layout, unified "Metadata & Tags" section

**Not in scope / TBD:** Writing tags back to music files (removed; to be re-designed), AcoustID fingerprinting, true sample-accurate gapless, streaming HTTP seek, Jellyfin webhooks, package manager distribution, MusicBrainz submission, light theme.

---

## Detailed Rules (auto-loaded by path)

| File | Loaded when editing |
|---|---|
| `.claude/rules/coding-standards.md` | always |
| `.claude/rules/state-management.md` | always |
| `.claude/rules/audio-playback.md` | `src-tauri/**`, `src/store/player.ts` |
| `.claude/rules/tag-editing.md` | `src/db/**`, `src/components/AlbumDetail.tsx` |
| `.claude/rules/genre-tree.md` | `src/assets/**`, `scripts/**` |
| `.claude/rules/sync.md` | `src/lib/**`, `src/hooks/use*.ts` |
| `.claude/rules/server-auth.md` | `src/keychain.ts`, `src/hooks/useServer.ts`, `src/lib/navidrome.ts` |
