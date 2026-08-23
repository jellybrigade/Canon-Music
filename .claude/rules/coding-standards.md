# Coding Standards

## Tabs: always underline, never pills

Ref impl: `src/components/TagsView.css` (`.tags-tab-btn`).

```css
.tab-btn {
  background: none;
  border: none;
  border-radius: 0;               /* explicit - kills browser default rounding */
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;            /* overlaps container's border-bottom */
  color: var(--text-secondary);
}
.tab-btn:hover { color: var(--text-primary); }
.tab-btn--active {
  color: var(--text-primary);     /* NOT accent - only the underline is accent */
  border-bottom-color: var(--accent);
}
```

Wrong: background/border-radius on the active tab; accent-colored text without an underline. Tab bar sits above the container's `border-bottom: 1px solid var(--border)`.

## No em or en dashes in `src/`

Never `—` (U+2014) or `–` (U+2013) anywhere under `src/`: UI strings, JSX text, code comments. Plain `-` only for real hyphenation.

Don't blind-replace with one character; rephrase per context:
- Sentence pause → comma, colon, or two sentences.
- Range (`10–20`, `Mon–Fri`) → "10 to 20", or plain `-` for compact version/port ranges.
- Comment bullet prefix → plain `-`.
- User-facing string → rephrase naturally. Highest priority, users see these.

## Naming

- Short, descriptive, no abbreviations. Loop counters (`i`, `j`) and the conventional
  `e`/`err` are the only single letters
- Intention-revealing: the reader infers why it exists, not only what it holds
- Nouns for types/components/tables, verbs for functions and store actions
- A name that has to be explained by a comment is the wrong name
- Booleans read as assertions: `isBuffering`, `hasPlayed`, `pauseRequestedDuringLoad` -
  not `loadFlag`, not `state2`
- Match the surrounding file's vocabulary. `track`/`album`/`artist` mean the mirror rows;
  don't introduce `song`, `record` or `release` as synonyms

## Comments

- **As few as possible. Default is none**
- Write one only when the code cannot carry it: a non-obvious *why*, a platform
  workaround, an ordering constraint, an invariant the next reader would break, a bug
  that would otherwise come back
- Never restate what the code does, never describe an obvious parameter or return
- No file/function header blocks summarising structure. The code is the summary
- One or two lines, not an essay. Deep rationale goes to `known-issues.md` or
  `instructions/ARCHITECTURE.md`, which are greppable; a comment is not
- No commented-out code. No `TODO`. Backlog lives in `instructions/what-to-do.md`
- No section dividers (`// --- helpers ---`)
- A comment recording a constraint (the migration-runner connection-affinity note, the
  WebKitGTK deferral in `ContextMenu`) is load-bearing. Don't delete one without
  replacing the mechanism it guards

## TypeScript

- `strict` is non-negotiable. Never weaken `tsconfig.json` to silence an error
- No `any`. Use `unknown` plus narrowing, or a real type
- No `!` non-null assertion where a guard clause or narrowing works
- No `as` cast to bypass the checker. Fix the type. Casting a DB row to a shape the
  query does not return is how a wrong `server_id` gets in
- No `@ts-expect-error` without a one-line reason and a way out
- Types colocated with first use; a shared type file only once a third consumer exists
- `Number(x) || fallback` is banned - it eats a legal `0` (see `known-issues.md`).
  Branch on `""`/`null` explicitly, then clamp

## React

- One concern per hook. A hook that fetches, subscribes and writes is three hooks
- Subscribe to the narrowest store slice the component reads. A component re-rendering
  on a slice it does not read is a defect with a waste test attached (see CLAUDE.md)
- Side effects that start something (playback, a network write, a timer) belong in a
  handler, not an effect. An effect firing off restored state cannot tell "resumed" from
  "just happened"
- Every effect that arms a listener, timer or interval tears it down. Exactly one after
  the arming path runs twice
- Deps arrays name what is read. Reading options through a ref to dodge re-registration
  is legitimate and gets a comment saying so
- A `useQuery` consumer names its pending state. `data ?? fallback` renders the fallback
  while loading too
- Derived values are derived, not mirrored into state. A `useState` restating a prop
  desyncs the moment the prop changes

## Rust (`src-tauri/`)

- `cargo fmt` and `cargo clippy` clean before commit. No `#[allow(...)]` without a reason
- No `unwrap()`/`expect()` on anything reachable from a command. Return `Result` and let
  the TS side name the failure
- Every fire-and-forget command emits a terminal event on **every** exit path, including
  its silent bail-outs. A command ending in `thread::spawn` has not done its work when it
  returns
- Business logic that a test can reach goes in a free function; commands touching shared
  state stay thin wrappers over it
- `eprintln!` is not error handling. Emit the event

## SQL / SQLite

- Every `LIMIT` has an `ORDER BY`. Without one the cap silently picks by rowid
- Every read of a mirrored table (`albums`, `tracks`, `artists`, `playlists`) is scoped
  by `server_id`, and any object built from a row takes `server_id` **from that row**,
  never from the currently selected server
- A run of writes whose intermediate state is not a startable state is a transaction.
  Wrap it, `ROLLBACK` on failure, rethrow the original error
- `ESCAPE '\'` in a TS string is `ESCAPE ''` and throws. Write `ESCAPE '\\'`
- Schema changes are a numbered migration block, never an in-place edit of an old one.
  New tables and columns get an `instructions/ARCHITECTURE.md` line in the same commit
- A sync that upserts also prunes, and the prune refuses an empty or partial fetch

## Code Smells

- **Long functions**: split when one function mixes responsibilities
- **Long parameter lists**: 3-4 max, then an options object
- **Duplicate logic**: two copies of a guard means the second one is already wrong. The
  Ctrl+K/Ctrl+F focus test shipped twice and only one copy was correct
- **Hand-kept lists** of "what is open" / "which routes need X": ask what writes the
  list. Replace the enumeration with a registry the members write to themselves
- **Dead code**: delete unused vars, params, exports, CSS classes. No tombstones, no
  `_unused` renames, no `// deprecated` placeholders, no zombie re-exports
- **Speculative generality**: build what is needed now
- **Deep indentation**: flatten with early returns and extraction
- **Magic numbers**: a design token if it is visual (see `design-guidelines.md`), a named
  constant otherwise. A geometry constant in TS restating a CSS value is banned outright -
  measure it or share one writer
- **Long `if`/`switch` chains** over a type tag: use a lookup map

## File Length

Split by responsibility when a file accumulates unrelated concerns, along the existing
seams: `src/lib` pure logic, `src/hooks` stateful logic, `src/components` presentation,
`src/store` playback state, `src/db` schema and queries. A pure function extracted out of
a component is testable, which is usually the real reason to split.

## Security

- Credentials only via `tauri-plugin-keychain`. Never disk, never localStorage, never a
  log line, never a query key
- Validate anything crossing the server boundary before it reaches the mirror. Subsonic
  responses are external input
- No `eval`, no `new Function`, no HTML assembled from server strings
- No external CDNs, fonts or trackers. Canon runs offline
- Canon never writes user music files
