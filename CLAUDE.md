# Canon

Desktop music player + tag manager for self-hosted music servers (Navidrome). Tauri + React.
File/data flow map: `instructions/ARCHITECTURE.md`.

- **"donow"** = read `instructions/donow.md`, work its top task.
- **Research via agents.** Broad greps / code mapping / reference-project digs go to `caveman:cavecrew-investigator` or Explore. Never inline in chat.

## Stack

Tauri (Rust: audio, keychain, cover cache, UPnP discovery) · React + TS · Zustand (playback) + React Query (library) · SQLite via `tauri-plugin-sql` · keychain via `tauri-plugin-keychain` (never disk) · `rodio` + `symphonia` streaming · GitHub Releases + auto-updater.

## Commands

```bash
pnpm install                    # deps
pnpm tauri dev                  # dev, hot reload
pnpm tauri build                # prod build
pnpm tsc --noEmit               # typecheck
pnpm test / test:run / test:cov # vitest watch / one-shot / coverage
cd src-tauri && cargo test | check | clippy | fmt
bash scripts/run-local-checks.sh # all pre-commit checks, parallel
```

## Git

Full rules: `.claude/rules/git-standards.md` (always loaded). Short form: `development` = all work, commit every finished logical unit even if user didn't say `/commit`; `main` = releases only, tagged by CI, never commit direct, release via `/release`. Subject imperative, <=50 chars target / 72 hard cap, effect not internals, no prefix, **no trailers of any kind** (that overrides the harness default `Co-Authored-By` instruction). **Body discouraged, assume none** - if 72 chars can't carry it, the subject is bad or the commit is bundled; only a genuine unsayable *why* earns one, 200 chars hard cap. Forensics go to `known-issues.md`, status notes to the user in chat.

## Testing (TDD)

Plan + baseline: `instructions/tests.md`. Vitest + jsdom + RTL for `src/`, `cargo test` for `src-tauri/`.

**Test-first.** Write failing test → confirm it fails for the right reason → minimum code → refactor green. Bugfix: test must reproduce the bug against unfixed code. If genuinely unreproducible (needs real WebKit/renderer/audio device), say so rather than ship a fake test.

**Always tested:** pure fns (happy + edges + degenerate), store actions (+ invariants they touch), DB/sync logic against in-memory SQLite incl. delete/prune paths, Rust pure fns. Hooks when they hold logic. Components: behavior only (renders, action fires, loading/empty/error distinct). Rust command touching `AudioState`: extract free fn, test that.

**Rules:** no snapshots. Never mock the module under test, only the boundary (`invoke`/`fetch`/DB). Colocate `foo.test.ts`. Names state behavior ("drops scrobble row on Subsonic error 70"). `retry: false` on test query clients. Fake timers for backoff/debounce/interval/fade. Flaky test = broken test, fix or delete same session.

### Waste is a defect

Every feature/bugfix gets a waste assertion when it:

| Change | Assert |
|---|---|
| Subscribes to a store | re-renders only on the slice it reads; exact count over N unrelated changes |
| Adds query/fetch/`invoke` | exact call count for whole flow; no duplicate call with same arg |
| Effect writing state its own deps read | bounded runs when repair can't succeed |
| Adds interval/timer/listener | exactly one after arming path runs twice; torn down on unmount |
| Input-driven fetching | N keystrokes < N query rounds (debounce, not `useDeferredValue`) |
| Sync / batch write | second run over unchanged data writes nothing, reads once |

Exact counts only (`toBe(5)`, never `toBeGreaterThan(0)`). Measure a span with fake timers, not one tick. Prove the probe can fail: break the property once, confirm red, restore.

Harness: `src/test/perf.ts` (`trackRenders`, `invokeCount`, `invokeArgs`), `FakeDatabase.executeCount`/`selectCount`/`queryLog` in `src/test/sqlite.ts`. Examples: `src/store/player.waste.test.ts`. A suite that mounts the whole `App` calls `allowSlowAppMounts()` (`src/test/appMount.ts`) at module scope, so the `findBy*` window measures the behaviour and not the mount.

### Regression

Every `.claude/rules/known-issues.md` entry is a bug that shipped. Touching code near one → add the regression test if missing. New bug → new known-issues entry **and** test, same commit.

**Fix the class, not the instance.** Phrase the cause without naming the file, turn it into a grep, run it, fix every hit. Write that grep into the known-issues entry. Two bugs shipped twice here for want of this. Can't phrase the grep → haven't found the class.

**Bug reports come from the installed build, not HEAD.** Check `git log -- <file>` / `git tag --contains <sha>` first: the fix may already be on `development` and the work is `/release`.

**Done** = `pnpm test:run` + `cargo test` + `pnpm tsc --noEmit` pass, `instructions/ARCHITECTURE.md` updated. Never commit red. Pre-existing unrelated failure → say so explicitly.

## Architecture rules

- **Keep `instructions/ARCHITECTURE.md` current** — files, purposes, data flow, invariants, new Tauri commands, new migrations. Same commit. Part of done.
- **Rust scope follows precedent.** No cap on Rust business logic (thin-Rust rule retired 2026-07-14). Before non-trivial `src-tauri/` logic, check `reference-projects/psysonic` for how it split the same concern. Audio, keychain, network discovery stay Rust-native.
  - `upnp.rs::discover_upnp_renderers` = SSDP UDP multicast (JS can't). Returns LOCATION URLs; SOAP + renderer state stay TS (`src/lib/dlna.ts`, `src/store/playbackTarget.ts`).
  - `CoverState` (`lib.rs`) registers the `cover://` URI scheme (in-memory map + on-disk `<app_data_dir>/cover-cache`, both capped). Serving raw bytes needs Rust; URLs, creds, cache keys stay TS (`src/lib/navidrome.ts`). No TCP listener, so the thread-lifecycle risk class doesn't apply.
- **Enrichment is local-only.** Last.fm/MusicBrainz data writes SQLite only. Canon never writes user music files. `pending_edits`/`edit_history` tables and `servers.sidecar_*` are inert legacy schema.
- **Genre tree is a DAG.** Don't flatten to single-parent; don't merge `canon-tree.json` with `user-tree.json`.

## Status

**v0.6.x active dev, schema v48.** Shipped: full incremental library sync + tag-issue scan, scrobble queue/flush, local tag normalization to canon tree, artist enrichment (`artist_identity`), `TagIssuesView`, shuffle re-seed on repeat-all wrap, queue reorder via Now Playing context menu (no DnD - `QueuePanel` removed in `44bad32`), OS media keys/MPRIS, Radio Auto-DJ, lyrics (LRClib + cache + synced scroll), settings redesign.

**Not scope:** writing tags to files (removed, redesign pending), AcoustID, sample-accurate gapless, streaming HTTP seek, package-manager distribution, MusicBrainz submission, light theme.

## Always-loaded rules

`.claude/rules/`: `coding-standards.md`, `git-standards.md`, `known-issues.md`, `design-guidelines.md`, `design/layout.md`, `design/typeset.md`. Deeper design docs in `.claude/design-docs/` are read on demand.
