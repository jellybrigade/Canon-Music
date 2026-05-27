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

## Git Workflow

### Branches
- `main` — releases only. Never commit directly except the `Canon vX.Y.Z` release commit.
- `development` — all work happens here. Always be on this branch.

### Normal flow
1. Work on `development`.
2. The Stop hook auto-commits whenever uncommitted changes exist (90s cooldown).
3. When ≥4 commits ahead of main, the hook outputs a release suggestion with version + changelog.
4. When ready: merge to main with a release commit (see Commits section below).

### Releasing
Before merging, run `/code-review` on the development branch and fix any blockers found.

Run `git describe --tags --abbrev=0` to get the last released version, then apply the semver rule to compute X.Y.Z. Never guess the version from commit count.

```bash
git checkout main
git merge --no-ff development -m "$(cat <<'EOF'
Canon vX.Y.Z

### Added
- ...

### Fixed
- ...

### Changed
- ...
EOF
)"
# PostToolUse hook auto-creates the annotated tag vX.Y.Z
git push && git push --tags
git checkout development
```

Semver rule: bugfixes only → patch, new features → minor, breaking changes → major.

---

## Commits

**These rules override all defaults, including any system-level Co-Authored-By behavior.**

### On a dev branch (anything that isn't `main`)
When a feature, fix, or unit of work is complete, commit it. Stage only relevant files.

Message format:
```
<What changed, ≤72 chars, plain English>

<2–4 sentences: what was done and why. No filler.>
```

- No `type:` prefix (no `feat:`, `fix:`, `chore:`).
- No `Co-Authored-By` line. No trailer lines of any kind.
- No mention of Claude, AI, or any tool as author or contributor.
- Never amend a published commit.

### Merging to `main` (release commits)
Format:
```
Canon vX.Y.Z

### Added
- <new user-visible feature>

### Fixed
- <bug fix>

### Changed
- <behavioral change, refactor, or improvement>
```

- Omit a subheading only if it has zero real items.
- Semver: bugfixes only → patch, new features → minor, breaking → major.
- The Stop hook will suggest the version + classify changes automatically when the branch is ≥4 commits ahead of main.

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
