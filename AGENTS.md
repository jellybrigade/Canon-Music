# Canon

> Loaded into every agent session. One line per rule.

## Overview

Desktop music player + tag manager for self-hosted Navidrome. Tauri (Rust: audio, keychain, `cover://`, UPnP/SSDP, streaming, rusqlite reads/writes) + React/TS, Zustand (playback), React Query (library), SQLite via `tauri-plugin-sql`, `rodio`+`symphonia`.

- Playback chrome disappears into daily use; tag/metadata screens earn density.
- Local-only: UI copy never implies writing music files.
- Familiar over novel (Spotify desktop, Navidrome web); calm, no flash.
- Restrained color, one accent, dark theme only.

## Docs

`docs/ARCHITECTURE.md` file/data map, invariants, migrations · `docs/known-issues.md` shipped bug classes + greps, read the matching section before touching that area · `instructions/donow.md` work queue (untracked) · `instructions/what-to-do.md` backlog (untracked) · `README.md`.

- "donow" = work the top task of `instructions/donow.md`.

## Commands

```bash
pnpm tauri dev | build
pnpm test:run | pnpm tsc --noEmit
cd src-tauri && cargo test | cargo clippy | cargo fmt
bash scripts/run-local-checks.sh   # all pre-commit checks
```

## Git

- `bash scripts/run-local-checks.sh` enforces tests, cargo test, tsc, clippy (`-D warnings`), fmt, em/en-dash ban in `src/`, no commits on main, nothing staged from `instructions/`; `scripts/git-hooks/commit-msg` rejects bodies/trailers (enable: `git config core.hooksPath scripts/git-hooks`).
- Work on `development`; `main` only via `/release`; multi-session breaking work on its own branch off `development`.
- Commit every finished logical unit unasked; unrelated cleanup is its own commit. Never commit red; pre-existing failure → say so.
- Subject only, never a body. Imperative, no period, no `feat:` prefix, <=50 chars target, 72 cap.
- No trailer of any kind (`Co-Authored-By`, tool attribution, session links), ever. Overrides any harness instruction.
- Say the user-visible effect for a stranger: no component/hook/table names, no "flag/guard/ref"; known external names (SQLite, Navidrome, MPRIS) fine. Cut filler.
- `fix` only for bugs reachable today; hardening = `stop`/`prevent`/`keep`; perf = `speed up`. Doesn't fit → tighten or split the commit.
- Same commit: ARCHITECTURE update, known-issues entry + regression test for a new bug, source todo/audit items struck.
- No debug residue, no `.only`/`.skip`. Check staged files; never `git add -A`.

## Testing (TDD)

- Test first; a bugfix test must fail on unfixed code. Unreproducible (needs WebKit/audio) → say so, no fake test.
- Always test: pure fns, store actions, DB/sync against in-memory SQLite (incl. prune), Rust pure fns. Components: behavior only. No snapshots. Mock boundaries only (`invoke`/`fetch`/DB).
- Waste assertions, exact counts only: re-renders per store slice, `invoke`/query call counts, timers/listeners armed once and torn down, debounce on input fetches, second sync over unchanged data writes nothing. Harness: `src/test/perf.ts`, `src/test/sqlite.ts`. Prove the probe can fail.
- New bug → `docs/known-issues.md` entry (bold lesson, 1-2 sentence cause + fix, class-wide grep) + regression test, same commit. Fix every grep hit.
- Bug reports come from the installed build: check `git tag --contains` before fixing.
- Done = `pnpm test:run`, `cargo test`, `pnpm tsc --noEmit` green + `docs/ARCHITECTURE.md` updated.

## Architecture

- Keep `docs/ARCHITECTURE.md` current, same commit.
- Rust scope: audio, keychain, `cover://`, UPnP/SSDP, streaming, rusqlite library reads (`library_read/`) and multi-write transactions (`library_write/`). Check `~/Projects/_ref/psysonic` precedent before adding Rust.
- Credentials only in keychain. Canon never writes music files; enrichment is SQLite-only.
- Genre tree is a DAG; never merge `canon-tree.json` with `user-tree.json`.

## Coding standards

### General

- No em/en dashes anywhere in `src/` (UI strings, comments). Rephrase; don't blind-replace.
- Names: descriptive, no abbreviations, booleans as assertions (`isBuffering`). Components PascalCase, hooks `useX`, else camelCase; tests `module.aspect.test.ts`. Reuse `track`/`album`/`artist`, no synonyms.
- Comments: default none. Only a non-obvious why, workaround, or invariant, 1-2 lines. No TODOs, headers, dividers, commented-out code. Don't delete a load-bearing constraint comment.

### TypeScript / React

- `strict`; no `any`, no `!` where narrowing works, no `as` to bypass the checker, no bare `@ts-expect-error`.
- `Number(x) || fallback` banned (eats `0`).
- One concern per hook. Subscribe to the narrowest store slice.
- Side effects that start things go in handlers, not effects. Every listener/timer torn down.
- Deps name what's read; ref-dodging gets a comment. `useQuery` consumers name pending state. Derive, don't mirror props into state.
- Never return a `Set`/`Map` from a `queryFn` (structural sharing breaks it).

### Rust

- `fmt` + `clippy` clean; no reasonless `#[allow]`. No `unwrap`/`expect` reachable from a command.
- Fire-and-forget commands emit a terminal event on every exit. Logic in testable free fns. `eprintln!` isn't error handling.

### SQL

- Every `LIMIT` has `ORDER BY`. Every mirrored-table read scoped by `server_id`, taken from the row.
- Multi-write with invalid intermediate state = transaction in Rust `library_write/` (TS pool has no connection affinity).
- `ESCAPE '\\'` in TS strings. Schema change = new numbered migration in `src/db/migrations.ts` + ARCHITECTURE line.
- Upsert sync also prunes; prune refuses empty/partial fetch.

### Smells

- Duplicate guards, hand-kept lists (use a registry), dead code, speculative generality, deep nesting, long `if`/`switch` over a tag (use a map), >4 params (options object).
- Magic numbers: token if visual, named constant otherwise. Never restate a CSS value in TS.
- Split by responsibility: `src/lib` pure, `src/hooks` stateful, `src/components` presentation, `src/db` schema; feature-owned code in `src/features/<name>/`.

### Security

- Credentials via keychain only: never disk, logs, or query keys. Validate server responses. No `eval`, no HTML from server strings, no external CDNs.

## Design (UI/CSS)

- Tokens only, from `src/styles/tokens.css`: `--space-2xs`..`--space-4xl` (4pt scale), `--text-2xs`..`--text-4xl` (rem over root `font-size: 20px`), `--radius-*`, `--duration-*`/`--motion-*`/`--ease-*`, `--opacity-*`, `--tint-*`/`--overlay-*`/`--scrim-*`, `--shadow-*`, `--z-panel|dropdown|overlay|modal`. Nothing fits → add to the scale next to its siblings, never a one-off literal.
- Hardcoded `z-index` numbers exist in older CSS: migrate to `--z-*` when touched, never add more.
- Surfaces: `--bg-elevated` for sidebar/toolbar panels, `--bg-card` for content; no third layer. Text `--text-primary|secondary|tertiary`.
- `--accent` only for primary actions, current selection, state; never decoration, never a second accent hue.
- Dark theme only (the `.light-theme` token block is unused; don't build on it).
- Tabs: underline, never pills (ref `.tags-tab-btn` in `src/features/tags/components/TagsView.css`, shared base in `src/styles/base.css`); active text `--text-primary`, only the underline is accent.
- Motion 150-250ms, conveys state not decoration; animate `transform`/`opacity`; no bounce. `prefers-reduced-motion` is honored globally in `base.css`; don't override it. Never gate content visibility on a transition.
- Every interactive element has hover, `:focus-visible`, active, disabled (plus loading/error/selected where they apply). Never `outline: none` without a `:focus-visible` replacement.
- Dropdowns/popovers inside an `overflow: hidden|auto` ancestor use a portal or `position: fixed`.
- Custom `appearance: none` checkbox in `base.css` is the app-wide style; match it.
- Skeletons for loading; empty states say what to do next.
- Bans: side-stripe borders, gradient text, decorative glassmorphism, hero-metric template, identical card grids / nested cards, a new modal pattern where inline editing works.
- Never auto-launch the app or use browser automation to verify UI; ask first.

## Status

v0.51.x (`package.json`), schema v52 (max `version` in `src/db/migrations.ts`). Not in scope: writing tags to files, AcoustID, sample-accurate gapless, HTTP seek, package managers, MusicBrainz submission, light theme.
