# Coding Standards

> Loaded into every agent session. Keep it brief: one line per rule, no examples. Detail goes to `known-issues/`.

## General

- No em/en dashes anywhere in `src/` (UI strings, comments). Rephrase; don't blind-replace.
- Names: descriptive, no abbreviations, booleans as assertions (`isBuffering`). Components PascalCase, hooks `useX`, else camelCase; tests `module.aspect.test.ts`. Reuse `track`/`album`/`artist`, no synonyms.
- Comments: default none. Only a non-obvious why, workaround, or invariant, 1-2 lines. No TODOs, headers, dividers, commented-out code. Don't delete a load-bearing constraint comment.
- Tabs: underline, never pills (ref `src/features/tags/components/TagsView.css` `.tags-tab-btn`); active text `--text-primary`, only underline is accent.

## TypeScript / React

- `strict`; no `any`, no `!` where narrowing works, no `as` to bypass the checker, no bare `@ts-expect-error`.
- `Number(x) || fallback` banned (eats `0`).
- One concern per hook. Subscribe to the narrowest store slice.
- Side effects that start things go in handlers, not effects. Every listener/timer torn down.
- Deps name what's read; ref-dodging gets a comment. `useQuery` consumers name pending state. Derive, don't mirror props into state.

## Rust

- `fmt` + `clippy` clean; no reasonless `#[allow]`. No `unwrap`/`expect` reachable from a command.
- Fire-and-forget commands emit a terminal event on every exit. Logic in testable free fns. `eprintln!` isn't error handling.

## SQL

- Every `LIMIT` has `ORDER BY`. Every mirrored-table read scoped by `server_id`, taken from the row.
- Multi-write with invalid intermediate state = transaction, in Rust `library_write/` (TS pool has no connection affinity).
- `ESCAPE '\\'` in TS strings. Schema changes = new numbered migration + ARCHITECTURE line.
- Upsert sync also prunes; prune refuses empty/partial fetch.

## Smells

- Duplicate guards, hand-kept lists (use a registry), dead code, speculative generality, deep nesting, long `if`/`switch` over a tag (use a map), >4 params (options object).
- Magic numbers: token if visual, named constant otherwise. Never restate a CSS value in TS.
- Split files by responsibility: `src/lib` pure, `src/hooks` stateful, `src/components` presentation, `src/db` schema; feature-owned code in `src/features/<name>/`.

## Security

- Credentials only via keychain: never disk, logs, or query keys. Validate server responses. No `eval`, no HTML from server strings, no external CDNs. Never write user music files.
