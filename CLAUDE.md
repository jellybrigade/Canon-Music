# Canon

Desktop music player + tag management tool for self-hosted music servers. Supports Navidrome. Built Tauri + React. Full spec: `plan.md`. File/data flow map: `ARCHITECTURE.md`.

**"donow" always means `instructions/donow.md`.** When the user says "donow" (or "do now"), read that file and work its top task.

**Research via explorer agents, never in chat.** When you need to research something (grep reference-projects, map unfamiliar code, locate patterns), delegate it to `caveman:cavecrew-investigator` / Explore agents to keep main-thread context lean. Don't run broad searches inline.

---

## Stack

| Layer | Choice |
|---|---|
| App framework | Tauri — thin Rust layer (audio + keychain only); all business logic TypeScript |
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
pnpm test                       # vitest watch
pnpm test:run                   # vitest one-shot (run before commit)
pnpm test:cov                   # coverage
cd src-tauri && cargo test      # rust tests
cd src-tauri && cargo check     # rust typecheck
cd src-tauri && cargo clippy    # rust lint
cd src-tauri && cargo fmt       # rust format
```

---

## Git Workflow

Two branches:

- `development` — all work here. Commit when logical unit done. Auto-commit hook also picks up uncommitted changes on stop.
- `main` — releases only. One commit per release, tagged `vX.Y.Z` by CI. Never commit main direct.

**Always commit after change done**, even if user skip `/next` or `/commit`. Every finished logical unit lands commit before session end/move on.

Release: run `/release`. Skill handle code review, version bump, merge, push.

---

## Testing — TDD from now on

Canon test plan + baseline inventory: `instructions/tests.md`. Read it before writing tests. Tooling: Vitest (+ jsdom, React Testing Library) for `src/`, `cargo test` for `src-tauri/`.

### Test-first is default

New feature or bugfix → **write failing test first, then code until green.** Order:

1. Write test asserting intended behavior. Run it. Confirm it fails, and fails for the right reason (not import error, not typo).
2. Write minimum code to pass.
3. Refactor with test green.

Bugfix has extra rule: **test must reproduce the bug against unfixed code.** Fix that lands with a test that passed before the fix proves nothing. If reproducing is genuinely impossible (needs real WebKit, real renderer, real audio device), say so explicitly instead of shipping a fake test.

### What gets a test

| Kind | Bar |
|---|---|
| Pure function (`src/lib/`, `src/utils/`) | Always. Happy path + each edge case + degenerate input |
| Store action (`src/store/`) | Always. Plus invariants it touches (e.g. `shuffleOrder.length === queue.length`) |
| DB / sync logic | Always, against in-memory SQLite harness. Include the delete/prune path, not only writes |
| Hook | Yes when it holds logic. Skip pure-passthrough wrappers |
| Component | Behavior only: renders, primary action fires, loading/empty/error distinguishable. No snapshots |
| Rust pure fn | Always |
| Rust command touching `AudioState`/app handle | Extract logic to free fn, test that. Don't skip because command shape awkward |

### Rules

- **No snapshot tests.** They pass on wrong output and rot.
- **No mocking the thing under test.** Mock the boundary (`invoke`, `fetch`, DB), never the module you're asserting on.
- Tests colocated: `foo.ts` → `foo.test.ts` next to it.
- Test names state behavior, not function name: `"drops scrobble row on Subsonic error 70"`, not `"test flush"`.
- `retry: false` on every React Query client in tests. Otherwise failures take 30s and hide.
- Fake timers for anything with backoff, debounce, interval, or fade.
- A flaky test is a broken test. Fix or delete it same session, never leave it to rot the suite's credibility.

### Waste is a defect, test it like one

Correct output is half of "done". The other half is what it cost: how many renders, how many fetches, how much work per second. A component that re-renders 5x/sec, a hook that fetches the same album four times, an effect that re-runs itself forever - all of these pass every correctness assertion in this repo. So every new feature or bugfix gets a waste assertion alongside the behavior one, whenever any of these apply:

| If the change... | Assert |
|---|---|
| Subscribes to a store | The subscriber re-renders only on the slice it reads. Exact render count across N state changes it doesn't care about (usually 0 extra) |
| Adds a query / fetch / `invoke` | Exact call count for the whole flow. One album open = one album query. Also: no call fires twice with the same argument |
| Adds an effect that writes state its own deps read | It runs a bounded number of times when the repair can't succeed (the `AlbumDetail` backfill loop class) |
| Adds an interval / timer / listener | Exactly one exists after the path that arms it runs twice, and it's torn down on unmount |
| Adds input-driven fetching | N keystrokes fire fewer than N query rounds (debounced, not `useDeferredValue` - that defers rendering, not fetching) |
| Adds a sync / batch write | Second run over unchanged data writes nothing (`FakeDatabase.executeCount`), and reads it once (`selectCount`) |

Rules for these assertions:

- **Exact counts only.** `toHaveBeenCalled()` passes on 1 call and on 500. `expect(count).toBe(5)`, never `toBeGreaterThan(0)`.
- **Measure a span of time, not one tick.** Anything periodic gets fake timers advanced a fixed span, with the count compared against the rate. A doubled interval is invisible in a single tick.
- **Prove the probe can fail.** A waste test that would pass against the wasteful version is worse than none. Break the property deliberately once, confirm red, restore.

Harness: `src/test/perf.ts` (`trackRenders`, `invokeCount`, `invokeArgs`) and `FakeDatabase.executeCount` / `selectCount` / `queryLog` in `src/test/sqlite.ts`. Worked examples in `src/store/player.waste.test.ts`. Inventory + checklist: section 4.6 of `instructions/tests.md`.

### Regression tests are mandatory

Every entry in `.claude/rules/known-issues.md` is a bug that shipped once. When touching code near one, add the regression test if missing, and tick it in `instructions/tests.md`. New bug found → new `known-issues.md` entry **and** new test, same commit.

**Fix the class, not the instance.** Before fixing any bug, phrase its cause without naming the file, turn that into a grep ("who else calls this action", "what else inherits this rule", "what other queries hit this table"), run it, and fix every hit whose description is the same sentence. Then write that grep into the `known-issues.md` entry. Two bugs have shipped twice in this repo for want of this step. If you cannot phrase the grep, you have not identified the class yet.

**A user's bug report comes from the installed build, not from HEAD.** Check `git log -- <file>` and `git tag --contains <sha>` before reading code: the fix may exist on `development` and simply be unreleased, in which case the work is `/release`.

### Part of "done"

Change is not done until `pnpm test:run` and `cargo test` pass. Same standing as `pnpm tsc --noEmit` and updating `ARCHITECTURE.md`. Don't commit red. If a pre-existing test fails for unrelated reasons, say so explicitly rather than silently ignoring or deleting it.

---

## Architecture Rules

### Keep ARCHITECTURE.md current
Canonical map: every file, purpose, data flow, key invariants. Change that add/move/delete/repurpose file → update `ARCHITECTURE.md` same commit. New Tauri commands, new migrations, new architectural invariants belong there too. Part of "done".

### Rust scope follows reference-project precedent
No hard cap on Rust business logic anymore (former "Rust stays thin, TS-only business logic" rule retired 2026-07-14). Before adding non-trivial logic to `src-tauri/`, check `reference-projects/psysonic` (Tauri v2 + Rust, same category of app) for how it split the same concern — match its precedent (e.g. concurrency/semaphore patterns, connection handling) rather than defaulting to thin Rust or reinventing from scratch. Audio control, OS keychain access, network discovery primitives remain the clearest Rust-native cases regardless. See `.claude/rules/audio-playback.md`.

`discover_upnp_renderers` in `src-tauri/src/upnp.rs` does SSDP UDP multicast discovery — WebKit/JS can't send UDP multicast. Returns raw LOCATION URLs; SOAP control, renderer state management stay TypeScript (`src/lib/dlna.ts`, `src/store/playbackTarget.ts`).

`CoverState` in `src-tauri/src/lib.rs` registers a custom `cover://` URI scheme protocol (`register_asynchronous_uri_scheme_protocol`) for cover art + artist image caching, backed by an in-memory `HashMap<cache_key, (bytes, content_type)>` (capped, clear-on-overflow) plus an on-disk tier under `<app_data_dir>/cover-cache` (capped, oldest-mtime eviction). Registering a scheme handler and serving raw bytes is unavailable to the TypeScript/WebKit layer. Handler pure network primitive — URL construction, credential management, cache-key decisions all TypeScript (`src/lib/navidrome.ts`), which builds `cover://localhost/cover/<id>?size=<n>` and `cover://localhost/artist-image/<encoded>` URLs consumed directly by `<img src>`. No TCP listener involved (unlike the previous `tiny_http` loopback-server design), so the listener/thread-lifecycle risk class in `known-issues.md` does not apply here.

### Enrichment local-only — no file writes
Metadata enrichment (Last.fm tags, artist bio/stats/similar, MusicBrainz identity) writes SQLite only. Canon never modify user's music files. Sidecar file-write subsystem removed; `pending_edits` / `edit_history` tables and `servers.sidecar_*` columns inert legacy schema. File-write design TBD future version.

### Genre tree is DAG
Don't flatten single-parent. Don't merge `canon-tree.json` + `user-tree.json`. See `.claude/rules/genre-tree.md`.

---

## Status

**v0.6.x — active dev.** Schema v48, all workstreams shipped:

- Full library sync (incremental, artists table, tag issues scan)
- Scrobble queue + flush Navidrome (`useScrobbleFlush`)
- Local tag normalization: Last.fm + MusicBrainz genres → canon tree → `album_genres` / `album_unresolved_genres`
- Artist enrichment: bio, stats, similar artists persisted `artist_identity` (schema v20); on-open + background
- Tag issue detection + `TagIssuesView` w/ dismiss + sidebar badge
- Shuffle re-seeds repeat-all wrap
- Queue reorder via Now Playing context menu (move to start / play next / move to end). The drag-to-reorder side panel was removed with `QueuePanel` in `44bad32`; no HTML5 DnD on queue rows anymore.
- OS media keys (`navigator.mediaSession`, exposes MPRIS Linux)
- Radio Auto-DJ: canon tree ancestor scoring + Last.fm similar artists; 10-track lookahead
- Lyrics: LRClib fetch + SQLite cache + synced auto-scroll NowPlayingOverlay
- Settings: centered layout, unified "Metadata & Tags" section

**Not scope / TBD:** Writing tags back music files (removed, re-design pending), AcoustID fingerprinting, true sample-accurate gapless, streaming HTTP seek, package manager distribution, MusicBrainz submission, light theme.

---

## Detailed Rules (auto-loaded by path)

| File | Loaded when editing |
|---|---|
| `.claude/rules/coding-standards.md` | always |
| `.claude/rules/known-issues.md` | always |
| `.claude/rules/state-management.md` | always |
| `.claude/rules/audio-playback.md` | `src-tauri/**`, `src/store/player.ts` |
| `.claude/rules/tag-editing.md` | `src/db/**`, `src/components/AlbumDetail.tsx` |
| `.claude/rules/genre-tree.md` | `src/assets/**`, `scripts/**` |
| `.claude/rules/sync.md` | `src/lib/**`, `src/hooks/use*.ts` |
| `.claude/rules/server-auth.md` | `src/keychain.ts`, `src/hooks/useServer.ts`, `src/lib/navidrome.ts` |