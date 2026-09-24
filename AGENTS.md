# Canon

> Loaded into every agent session. Keep it brief: one line per rule, no examples, no backstory. Detail goes to `docs/`.

Desktop music player + tag manager for Navidrome. Tauri (Rust: audio, keychain, cover cache, UPnP) + React/TS, Zustand (playback), React Query (library), SQLite via `tauri-plugin-sql`, `rodio`+`symphonia`.

## Docs

`docs/ARCHITECTURE.md` file/data map, invariants, commands, migrations · `docs/tests.md` test plan · `docs/coding-standards.md` · `docs/git-standards.md` · `docs/known-issues/<area>.md` shipped bug classes + greps, read before touching that area · `docs/features/` per-feature docs.

## Commands

```bash
pnpm tauri dev | build
pnpm test:run | tsc --noEmit
cd src-tauri && cargo test | clippy | fmt
bash scripts/run-local-checks.sh   # all pre-commit checks
```

## Git

`development` only; `main` = releases via `/release`. Subject only (imperative, <=50 target, 72 cap, effect not internals). No body, no prefix, no trailers ever.

## Testing (TDD)

- Test first; bugfix test must fail on unfixed code. Unreproducible (needs WebKit/audio) → say so, no fake test.
- Always test: pure fns, store actions, DB/sync against in-memory SQLite (incl. prune), Rust pure fns. Components: behavior only. No snapshots. Mock boundaries only (`invoke`/`fetch`/DB).
- Waste assertions, exact counts only: re-renders per store slice, `invoke`/query call counts, timers/listeners armed once and torn down, debounce on input fetches, second sync over unchanged data writes nothing. Harness: `src/test/perf.ts`, `src/test/sqlite.ts`. Prove the probe can fail.
- New bug → `docs/known-issues/<area>.md` entry with a class-wide grep + regression test, same commit. Fix every grep hit.
- Bug reports come from the installed build: check `git tag --contains` before fixing.
- Done = `pnpm test:run`, `cargo test`, `pnpm tsc --noEmit` green + `docs/ARCHITECTURE.md` updated.

## Architecture

- Keep `docs/ARCHITECTURE.md` current, same commit.
- Rust scope: check `~/Projects/_ref/psysonic` precedent first. Audio, keychain, SSDP discovery, `cover://` stay Rust.
- Credentials only in keychain. Canon never writes music files; enrichment is SQLite-only.
- Genre tree is a DAG; never merge `canon-tree.json` with `user-tree.json`.

## Status

v0.6.x, schema v52. Not scope: writing tags to files, AcoustID, sample-accurate gapless, HTTP seek, package managers, MusicBrainz submission, light theme.
