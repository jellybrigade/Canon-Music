# Canon

Desktop music player + tag management tool for Navidrome, Jellyfin, and Plex. Full product spec in `plan.md`. File map and data flow in `ARCHITECTURE.md`.

---

## Development Workflow

Every implementation cycle follows this loop — do not skip steps:

1. **Plan the next immediate goal** — one focused, shippable unit of functionality
2. **Fit it into the big picture** — which part of the architecture this touches, what it depends on, what depends on it
3. **Design the implementation** — data flow, component boundaries, Tauri command surface if needed, SQLite schema changes
4. **Implement it** — see `.claude/rules/coding-standards.md`
5. **Test it** — run automated tests, verify the feature manually end-to-end
6. **Ask the user to test it** — hand off with a clear description of what to exercise and what edge cases to try
7. **Plan the next immediate goal** — repeat

Never implement two goals at once. Never skip user testing before moving on.

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
pnpm dev                        # frontend-only dev (no native window)
pnpm build                      # frontend-only build
pnpm tsc --noEmit               # typecheck
cd src-tauri && cargo check     # rust typecheck
cd src-tauri && cargo fmt       # rust format
cd src-tauri && cargo clippy    # rust lint
```

---

## Architecture Rules

### Keep ARCHITECTURE.md current
`ARCHITECTURE.md` at the repo root is the canonical map of every file and its purpose, the data flow, and key invariants. Any change that adds, moves, deletes, or substantially repurposes a file **must** update `ARCHITECTURE.md` in the same commit. New Tauri commands, new migrations, and new architectural invariants also belong there. Treat this as part of "done" — same as tests passing.

### Rust stays thin
Only use `#[tauri::command]` for: audio control, file reads/writes via sidecar, OS keychain access. No business logic in Rust. See `.claude/rules/audio-playback.md`.

### Tag writes always go through the diff flow
Never write tags directly. All edits → `pending_edits` → diff review → sidecar. See `.claude/rules/tag-editing.md`.

### Genre tree is a DAG
Do not flatten to single-parent. Do not merge `canon-tree.json` and `user-tree.json`. See `.claude/rules/genre-tree.md`.

---

## Status

**v1 is feature-complete.** Schema v10, all workstreams shipped:

- Full library sync (incremental, artists table, tag issues scan)
- Scrobble queue + flush to Navidrome (`useScrobbleFlush`)
- Tag writes wired end-to-end: inbox accept / vocab save → `pending_edits` → Review & Apply → sidecar
- Tag issue detection + `TagIssuesView` with dismiss + sidebar badge
- Shuffle re-seeds on repeat-all wrap
- Drag-to-reorder queue (HTML5 DnD)
- OS media keys (`navigator.mediaSession`, exposes MPRIS on Linux)
- Radio Auto-DJ: canon tree ancestor scoring + Last.fm similar artists; 10-track lookahead
- Lyrics: LRClib fetch + SQLite cache + synced auto-scroll in NowPlayingOverlay

**Needs manual testing before release:**
- Hardware media keys / `playerctl` on Linux
- Radio: start from a track, verify genre-related lookahead, stop leaves queue intact
- Lyrics tab on a popular track (synced scroll, offline cache replay)
- Tag issues: corrupt a genre, Rescan, Issues view picks it up; dismiss survives next Rescan
- Scrobble flush: offline play → queue grows → reconnect → queue drains within 60s
- Sidecar end-to-end: accept inbox item → Pending → Confirm Write → file tag updated (`mutagen-inspect`)

**v2 (do not implement):** AcoustID fingerprinting, true sample-accurate gapless (`Sink::append`), streaming HTTP (`Read + Seek`), Jellyfin webhooks, package manager distribution, MusicBrainz submission, light theme toggle, undo via `edit_history` revert.

---

## Detailed Rules (auto-loaded by path)

| File | Loaded when editing |
|---|---|
| `.claude/rules/coding-standards.md` | always |
| `.claude/rules/state-management.md` | always |
| `.claude/rules/audio-playback.md` | `src-tauri/**`, `src/store/player.ts` |
| `.claude/rules/tag-editing.md` | `src/db/**`, `src/components/AlbumDetail.tsx`, `sidecar/**` |
| `.claude/rules/genre-tree.md` | `src/assets/**`, `scripts/**` |
| `.claude/rules/sync.md` | `src/lib/**`, `src/hooks/use*.ts` |
| `.claude/rules/server-auth.md` | `src/keychain.ts`, `src/hooks/useServer.ts`, `src/lib/navidrome.ts` |
