# Test Plan

This file is the baseline inventory: everything worth testing, ordered so that the highest-value coverage lands first. Goal is not 100% coverage, it is a trustworthy baseline so TDD is viable for new work.

**Status 2026-08-19:** harness exists and is green. `pnpm test:run` = 1204 tests / 59 files, acceptance 8/59 files = 14%. `cd src-tauri && cargo test` = 125 tests. See "Progress log" below for exactly what is covered and what the next gaps are.

**Acceptance coverage is thin.** The `/tests` skill targets roughly 1 in 5 test files mounting `App`/`AppShell` and driving it as a user; today it is 7 in 57. That is a reminder, not a gate: this skill's natural drift is to write unit tests only (it wrote zero acceptance files across its first several invocations), so while the ratio is low, prefer a section 4.5 scope over whatever "Suggested order of work" names next, unless a unit scope is genuinely more urgent. Section 4.5's bullets are currently all ticked - that means the hand-kept list ran out, not that the app shell is covered. Write the next acceptance bullet (see the skill's "Mix" section for where to source one) rather than treating the section as finished.

Working rule going forward: **every new feature or bugfix ships with a test.** Every entry below gets checked off as it lands.

---

## Progress log

### Landed 2026-08-03 (first pass)

Infra (section 0), most of the cheap pure functions (section 1), and most of the Rust pure functions (section 6).

TypeScript, `pnpm test:run` -> **135 passing**:

| File | Covers |
|---|---|
| `src/lib/shuffle.test.ts` | `shuffleArray` permutation / no-mutation / fresh array / degenerate n / no pinned position |
| `src/lib/boundedCache.test.ts` | `cappedSet` eviction, cap held over many inserts, re-write at cap, `maxEntries === 0` |
| `src/lib/rateLimiter.test.ts` | `makeRateLimiter` spacing + concurrent callers serializing, fake timers |
| `src/lib/asyncPool.test.ts` | `runPool` concurrency ceiling, parallel start, throwing item, progress calls, abort, empty input |
| `src/clients/lrclib.test.ts` | `parseLrc` 2 vs 3 digit fractions, minutes carry, sort, metadata/blank/malformed lines, CRLF |
| `src/features/enrichment/lib/fuzzyMatch.test.ts` | `normalizeForMatch`, `similarity`, `scoreReleaseGroup` (collab credit, containment boost, year nudge, confirmed MBID), `filterByTrackCount`, `rankCandidates` stability |
| `src/features/playlists/smartPlaylist.test.ts` | `parseSmartFilters` malformed/legacy/unknown-key repair, `buildSmartQuery` param-only (injection guard), LIKE escaping, limit clamp, ORDER-BY-with-every-LIMIT, plus every `SORT_OPTIONS` entry executed against the migrated in-memory DB |
| `src/lib/routes.test.ts` | `albumPath` / `artistPath` / `playlistPath` encode-decode round trip over awkward ids, slash / `#` / `?` containment, route uniqueness |
| `src/lib/ids.test.ts` | `stripServerPrefix` happy path, embedded colons, throws on absent / mid-string / other-server prefix |
| `src/lib/queryKeys.test.ts` | `QK` stability, no cross-factory collisions, partial keys really are prefixes, seed-track key kept out of the top-tracks key |
| `src/features/tags/lib/tagBuckets.test.ts` | `bucketize` per-section routing, unknown id dropped, missing section dropped, order preserved |

### Landed 2026-08-03 (second pass)

| File | Covers |
|---|---|
| `src/features/tags/lib/canonicalize.test.ts` | `canonicalKey`/`sqlNorm`/`rawGenreId` casing/punctuation/diacritics/`&`/empty; `getParentChain` single-parent walk, `maxDepth`, cycle termination, root, **first-parent-only on a multi-parent node**; `getAncestorIds` multi-parent union+dedup, cycle-safe, excludes self; `findCanonicalSync` full precedence (mapping > exact > cross-type > fuzzy > none), stale-mapping-id returns null node with `matchType: "mapping"`, short strings skip fuzzy, **all 7 r&b `RAW_ALIASES` variants**, **fallback rap/hip-hop alias only fires when no direct match** (gangsta rap must not become gangsta hip hop); `bustCanonTreeCache` forces a re-read (mocked `../db`); bundled `canon-tree.json` smoke load |
| `src/features/tags/lib/tagNormalize.test.ts` | `isYearLikeGenre` decade/year formats incl. apostrophe-position edge case (`'90s` true, `90's` false), non-year genre false; `isStale` null, boundary (strictly `>`, not `>=`), one-tick past boundary, future `computed_at`, custom `staleDays` |
| `src/clients/lastfm.test.ts` | `normalizeTrackTitle` bracket-suffix removal (incl. feat. inside brackets), dash-feat vs bare-feat vs `ft` (no dot) suffix stripping, non-feat dash suffix survives, alnum-collapse, empty string; `resolvePortraitUrl` wikidata > navidrome > lastfm precedence, `LASTFM_PLACEHOLDER` filtering, null enrichment, missing optional key. Note: "picks the largest available size" in the plan describes the unexported `pickImage` helper inside `fetchArtistInfo` (network-calling), not `resolvePortraitUrl` - out of scope here |

### Landed 2026-08-03 (third pass)

| File | Covers |
|---|---|
| `src/clients/musicbrainz.test.ts` | `combineGenres`: empty-both, one-side-empty passthrough, case-insensitive dedupe across RG/release with summed counts, release-group casing wins the dedupe, duplicate names merge within one side too, no whitespace trimming (a trailing-space variant stays a separate entry), descending sort incl. zero/negative counts |
| `src/features/enrichment/lib/albumIdentify.test.ts` | `stripTrailingBrackets`: parens/brackets, no-match -> `null`, whole-title-is-the-group -> `null` (not `""`), non-trailing group -> `null`, two trailing groups both stripped (lazy regex still reaches end-of-string, doesn't stop at the first closer), nested brackets, mismatched delimiters (`(...]`) still close the group when at the true end |
| `src/features/playback/lib/nowPlayingQueries.test.ts` | `primaryArtistOf`: null/undefined/empty, feat./ft./featuring (case-insensitive), **documents that `&` and `,` are NOT split** (tests.md's own wording overstated this - verified against source), no-match passthrough, cuts at first `feat.` of several, no whitespace trimming. Regression: prefetch/consumer key parity checked via source-text inspection (both `useNowPlayingPrefetch` and `NowPlayingView` import the same named exports from `nowPlayingQueries.ts`, and neither hardcodes its own `staleTime` literal) rather than mounting components - flagged as a deliberate approach choice, not a full component-render test |
| `src/lib/dbBatch.test.ts` | `executeBatched`: empty rows no-op, single-chunk path leaves `buildSql` called once with every row's placeholders, exact chunk-boundary split when `paramsPerRow` forces a small chunk size, `paramsPerRow` above the ceiling floors chunk size at 1 (no divide-by-zero hang). `executeIdChunks`: empty ids no-op, chunk boundary exactness at `SQLITE_MAX_VARIABLES + 1`, plain `IN` still works across multiple chunks. **Bugfix + regression**: `executeIdChunks` previously executed a `NOT IN` buildSql callback unchanged - each chunk deleted rows the other chunks meant to keep. Test reproduced the bug against the unfixed code first (asserted the promise rejected; it resolved instead), then `executeIdChunks` was fixed to inspect the first chunk's SQL for `NOT IN` and throw before any chunk executes |

Harness, reusable by everything below:

- `vitest.config.ts` - `environment: "node"` default, per-file `// @vitest-environment jsdom` opt-in, `include: src/**/*.test.{ts,tsx}`, v8 coverage.
- `src/test/setup.ts` - registers `@testing-library/jest-dom` matchers.
- `src/test/mocks/tauri.ts` - `invoke` with per-command handlers (`onInvoke`), broadcast `listen` + `emitTauriEvent`, `listenerCount`, `resetTauriMocks`. Wire with `vi.mock("@tauri-apps/api/core", async () => (await import(".../mocks/tauri")).coreModule)`.
- `src/test/sqlite.ts` - better-sqlite3 behind the same `execute`/`select` surface as tauri-plugin-sql, plus `migrateTestDb` / `createMigratedTestDb` running the real `src/db/migrations.ts` with the same split-on-";" the app uses. Tracks `executeCount` / `selectCount` / `queryLog` for "an idempotent sync writes nothing" and "this pass reads the library once" assertions.
- `src/test/perf.ts` - waste probes: `trackRenders(hook)` (exact render count for a store subscriber), `invokeCount(cmd)` / `invokeArgs(cmd)` over the Tauri mock's call log. See section 4.6.
- Scripts: `pnpm test`, `pnpm test:run`, `pnpm test:cov`. Devdeps: vitest, @vitest/coverage-v8, jsdom, @testing-library/{react,user-event,jest-dom}, better-sqlite3. `pnpm.onlyBuiltDependencies` had to list `better-sqlite3` + `esbuild` or the native module never builds.

Rust, `cargo test` -> **81 passing**, all in `#[cfg(test)] mod tests` at the bottom of the file under test, no production code touched:

- `upnp.rs` (20): `xml_text`, `find_control_url` (absolute / root-relative / path-relative), `resolve_base` (`URLBase` vs location-derived), `parse_response` (non-200, NOTIFY, missing LOCATION, USN fallback).
- `streaming.rs` (12): `finish()` -> `Ok(0)`, **`fail()` -> `UnexpectedEof` with the arrived bytes still served** (the truncated-stream regression), concurrent writer/blocking reader, `SeekFrom::End` off Content-Length, spill-file cleanup, writer dropped without finish -> `Interrupted`.
- `library_read.rs` (4): `order_by_clause` allowlist, unknown key named in the error, injection-shaped keys rejected.
- `lib.rs` (45): `sanitize_cache_key`, `percent_decode`, `xml_first_tag_text`, `friendly_keyring_error` (one per variant), disk cover cache round-trip + oldest-mtime eviction.

### Landed 2026-08-03 (fourth pass)

| File | Covers |
|---|---|
| `src/features/playback/store/player.test.ts` | Section 2 "Queue and shuffle invariants" only (transport intent / gapless / buffering / sleep-timer left unstarted). `shuffleOrder.length === queue.length` after `playQueue`, `addManyToQueue`, `playNextMany`, `removeFromQueue`, `removeManyFromQueue`, `moveQueueItem`, `clearQueue` individually plus a 200-iteration randomized-mutation-sequence property test that also exercises re-population after the queue empties. `playQueue([oneTrack])` under shuffle writes `[0]`. `normalizeShuffleOrder` (given a test-only `export`, was module-private): fresh-array identity on the fast path (regression - reverting to `return order` was confirmed to fail this test), repair path for short/out-of-range/duplicate/empty input. `moveQueueItem`: normalizes a stale short `shuffleOrder` before splicing (no crash, no length drift), no-ops on `from === to` (reference-equality check) and out-of-range indices. Queue trimming: `addManyToQueue`/`playNextMany` trim using the post-append/-splice length read back off the store, not a captured pre-mutation length - proven by picking a `queueIndex` high enough that the full overflow is droppable and asserting the exact resulting length, not just "under the cap" (a smaller `queueIndex` only partially trims by design - `trimQueueToCap` never drops anything ahead of what's already been played - and would have masked a stale-length regression). `isNextDisabled` exhaustive table over repeat mode x position x `radioOnQueueEnd`, incl. empty-queue (`length - 1 = -1`) and single-track boundaries, plus one assertion it ignores shuffle state entirely. Requires `// @vitest-environment jsdom` (`player.ts` registers a `window.addEventListener("beforeunload", ...)` at store-creation time) and fake timers (the 500ms debounced `persistQueueState` -> `getDb()` write is never advanced into, so no real Tauri SQL call fires). |

### Landed 2026-08-03 (fifth pass)

| File | Covers |
|---|---|
| `src/features/playback/store/player.test.ts` | Section 2 "Transport intent" (6/6). Pause-during-load: `pause()` fired while `activeTarget.load`'s promise is still pending (via a controllable deferred `onInvoke("audio_play", ...)`) leaves `isPlaying === false` once the load resolves, not overwritten by `playTrack`'s completion. `resume()` with `streamUrl === null` (restored-session shape): asserts it routes through `retryCurrent` -> `playTrack` (observable as `isLoading: true`) rather than the direct-resume branch setting `isPlaying: true` itself. `resume()` with no `currentTrack`: no timer count change, no new `invoke` call, `isPlaying` stays `false`. `stop()` clearing `pauseRequestedDuringLoad`: black-box via effect (module-level flag isn't directly readable) - pause a track mid-load, `stop()`, then play a second track through to completion and confirm it isn't born paused. `seek()`/`seekGen`: ticker tick captures `seekGen` before an in-flight `audio_get_pos` resolves (deferred promise again), `seek()` bumps the generation and sets `elapsed` itself, then the stale poll resolving must not overwrite it. Natural-end fallback: with the ticker already running from a real `playQueue`, `isPlaying` is set to `false` directly (isolating the guard from `pause()`'s own `stopElapsedTimer()` call) and a poll landing at `duration - 0.1` must not invoke `next()`/`audio_play` or move `queueIndex`. Extended the shared `resetStore()` helper to also reset `isPlaying`/`isLoading`/`isBuffering`/`error`/`streamUrl`/`castDevice`/`gapless`/`repeat`/`consumeMode`/`sleepTimerEndOfTrack` - the store is a module singleton and these leaked across test files' assumptions otherwise. Added a `deferred<T>()` helper for controlling `invoke` timing mid-await, reused across four of the six tests. |

### Landed 2026-08-03 (sixth pass)

| File | Covers |
|---|---|
| `src/features/playback/store/player.test.ts` | Section 2 "Gapless" (5/5), all against `known-issues.md`'s three gapless entries. `gaplessEnqueued` (bullet 1): id-scan relocation in `track-advanced` after `playNext` (insert before), `moveQueueItem` (both the non-shuffled queue-splice and shuffled shuffleOrder-splice code paths), `removeFromQueue` on the enqueued track itself (not-found branch - still shown as current, index parked forward per the documented "still what the user hears" behavior) and on an unrelated track before it (id-scan relocates by shifted position); plus the no-edit fast path and the `gaplessEnqueued === null` plain-recompute branch. `wrapOrder` (bullet 2, regression for the exact "every wrap re-opened on the same track" bug): adopted verbatim when its recorded length still matches the queue: `Math.random` pinned via `vi.spyOn` to hand-derive the exact enqueued track for the length-mismatch-during-lead-window case (removal shrinks the queue while staying wrapped, so `carried.length !== queue.length` forces the rebuild-anchored-on-the-enqueued-track branch); a 40-iteration statistical mirror of the **non-gapless** `next()` wrap path (its own copy of the anchor logic) asserting the wrap-opening track isn't always the same one; degenerate single-track wrap doesn't crash. `gapless-cancelled` (bullet 3): without it the natural-end fallback stays suppressed while `gaplessActive`; with it, `next(true)`'s fallback resumes firing (needed an extra 100ms fake-timer advance past the tick that calls `next()`, since `playTrack(..., nav=true)` defers the actual `audio_play` through a 100ms debounce `setTimeout`); a late spurious `track-advanced` after cancellation takes the plain-recompute branch, proving `gaplessEnqueued` was cleared too. Sleep timer (bullet 4): blocks the enqueue outright when armed before the 80% threshold; armed late (inside the lead window) still lets `track-advanced` advance queue state to the enqueued track before pausing on arrival (`audio_pause` invoked, `isPlaying: false`); never armed completes normally; `next(true)`'s own copy of the same guard (the historical duplication point per known-issues) covered directly, no event mocking needed. `canGapless` (bullet 5): `castDevice` set, `gapless` off, `repeat-one` (asserts it warms the *current* track's url via `audio_prefetch`, a structurally different branch, not just a false boolean), `consumeMode` without wrap (still warms `setNext`), `consumeMode` + wrapping + shuffled (neither `audio_enqueue_next` nor `setNext` - order isn't knowable yet), and a track with `duration: null` (gated upstream of `canGapless` entirely). **Found and fixed a real test-infra bug along the way** (not an app bug): `resetTauriMocks()` cleared the mock `listeners` map every `beforeEach`, but `usePlayerStore`'s `listen()` calls (`track-advanced`, `gapless-cancelled`, etc.) run exactly once at module import, not per test - every event-driven test after the first was silently a no-op until this was caught by the first tests in this repo to actually exercise those listeners. Fixed in `src/test/mocks/tauri.ts`: `resetTauriMocks()` no longer clears `listeners`, only `invokeHandlers`/mock call logs. |

### Landed 2026-08-04 (seventh pass)

Closes section 1 except `manual-mappings`. `pnpm test:run` 293 -> **327 tests / 21 files**. No Rust touched.

| File | Covers |
|---|---|
| `src/features/playback/store/player.test.ts` (appended) | `buildShuffleOrder(length, anchor)` anchor semantics, the last unchecked section-1 bullet. Given a plain `export` in `player.ts` (matching how `normalizeShuffleOrder` is exposed - this file has no `__testing` namespace convention). Permutation of `0..n-1` for every anchor over 50 runs each; `length === n` for n in {0,1,2,3,10,137}, which is the `shuffleOrder`/`queue` parallel-array invariant at its source; `[]` at n=0 and `[0]` at n=1 for anchor 0/-1/out-of-range; in-range anchor pinned to position 0 over 200 runs; exact `[1,0]`/`[0,1]` at n=2 (smallest case where the swap is observable). **Regression for known-issues "A hand-off decided ahead of time must carry what it decided"**: anchor `-1` over 1000 runs must reach *every* index at position 0 (asserted as full set equality, not "more than one"), which is what the repeat-all wrap depends on. Also: with anchor 0, position *1* is likewise unpinned over 1000 runs (the swap-to-front must not bias the tail); an out-of-range anchor (99 at n=5) silently degrades to unanchored rather than throwing - the third no-swap path, distinct from "anchor already at 0" and "anchor is -1"; fresh array per call, and mutating a returned array doesn't leak into the next call. **Not covered here** (call-site behavior, needs the store): the `:487` `track-advanced` fallback that coerces a `findIndex` miss to anchor `0` rather than passing `-1` through - the same `-1` means opposite things two lines apart there. The store-level "wrap doesn't reopen on the same track" assertions already exist in the sixth-pass gapless block. |
| `src/lib/track.test.ts` (new) | `makeStreamUrlBuilder`. Prefix strip -> bare Navidrome id; the builder is constructed without inspecting any id, so a bad server/track pairing throws at *call* time (`stripServerPrefix` throws) - covered for a foreign-server id and a bare unprefixed id; only the first colon is consumed (`"srv1:foo:bar"` -> `"foo:bar"`, proving `slice` not `split`); `"srv1:"` yields an empty `id` param rather than inventing one; url-significant characters (`+ & / space`) and unicode round-trip percent-encoded through `URLSearchParams`; md5 credential emits `t`/`s` and no `apiKey`, api-key credential the reverse; base-url normalization for trailing slashes and a `/rest` suffix (no `/rest/rest`); empty `server.id` degenerates to a bare `":"` prefix. **Module-state branch**: `_streamMaxBitrate` lives in `navidrome.ts`, so `maxBitRate` is absent at 0 and a `setStreamMaxBitrate(192)` *after* the builder was created still reaches it - the builder closes over the server, not over a cached URL. Reset in `beforeEach`/`afterEach`. Needs the tauri core mock only because `navidrome.ts` imports `invoke` at module scope; no DB, no timers. |
| `src/features/playback/hooks/useSeekBar.test.ts` (new) | `formatDuration`. The section-1 bullet "Track duration/format/display helpers, including null fields" was **mis-filed against `src/lib/track.ts`**, which contains no such helper; `formatDuration` in `useSeekBar.ts` is the repo's only one. Zero, sub-minute zero-padding, the 59/60/61 rollover boundary, unpadded minutes, minutes running past 59 rather than growing an hours field (`3600` -> `"60:00"`), fractional flooring (`59.9` -> `"0:59"`, not `"1:00"`). Two tests pin *unendorsed* current behavior with a comment saying so: a negative position emits `"-1:-1"` (JS `%` keeps the sign and `padStart(2)` no-ops on the 2-char `"-1"`) and `NaN` emits `"NaN:NaN"` rather than throwing - callers clamp upstream, which is why neither surfaces. Needs `// @vitest-environment jsdom`: importing `useSeekBar.ts` pulls in `player.ts`, which registers a `beforeunload` listener at store-creation time. |

### Landed 2026-08-04 (eighth pass, out of band)

Not a `/tests` pass - written alongside a user-reported bugfix (`b55da0b`), recorded here so the coverage is visible.

| File | Covers |
|---|---|
| `src/hooks/useDismissOnNavigate.test.ts` (new, named `useClearSearchOnNavigate.test.ts` until 2026-08-19) | The whole hook, and with it the first entry in the new section 4.5. First render is not navigation (no clear); a pathname change clears exactly once; a re-render at the same pathname does not re-clear; each further navigation clears again; the callback is read through a ref so a caller passing a fresh closure per render neither re-runs the effect nor fires the stale callback. Written test-first and confirmed red for the right reason (module did not exist) before the hook was written. **Regression for `known-issues.md` "State deciding which subtree renders, but absent from the URL"**: the search overlay renders instead of `<AppRoutes>` and is not URL-backed, so before this hook every navigation from the command palette landed behind it and read as a dead click. Does *not* cover the `AppShell` composition itself (which overlay wins, whether the palette's handlers are wired to it) - that is section 4.5's remaining, unchecked work. |

### Landed 2026-08-04 (manual-mappings pass)

Closes the last item in section 1. `pnpm test:run` 327 -> **367 tests / 24 files**. No Rust touched.

| File | Covers |
|---|---|
| `src/features/tags/lib/manualMappings.test.ts` (new) | `getManualGenreMappings`/`invalidateManualMappings` cache/inFlight/generation state machine. **Established `vi.doMock("../db", ...)` + `vi.resetModules()` + dynamic `import("./manualMappings")` per test** - reused, not new, `canonicalize.test.ts`'s `bustCanonTreeCache` block already does this (the "no `../db` mock pattern exists yet" note in this file's prior passes was wrong; corrected here). First-call db read w/ query shape, empty-table caches an empty (not null) Map, cache hit returns the exact same Map reference (`toBe`) to every caller - documents the shared-reference design risk as current behavior rather than fixing it, no caller mutates today. Concurrent callers before the first `select` resolves de-dupe into one db read (deferred promise, no fake timers needed) and both resolve to the same reference. `invalidateManualMappings()` forces a re-read. **Three known sharp edges, all locked in as current behavior, none fixed this pass:** (1) two `raw_value`s collapsing to one `canonicalKey` resolve last-row-wins per the SELECT's array order, asserted against the real r&b alias table via `canonicalKey` since the query has no `ORDER BY`; (2) invalidation arriving while a read is still in flight lets the stale result still resolve to its caller but skips caching it, and the very next call re-queries rather than serving the stale map; (3) a rejecting `db.select` leaves `inFlight` a permanently rejected promise - a second call rejects again with zero additional `select` calls, and the only recovery is an explicit `invalidateManualMappings()`. |

### Follow-ups this pass created

- [x] **`manualMappings.ts` split out of the seventh pass** - covered 2026-08-04, see `manualMappings.test.ts` in the progress log. All three sharp edges locked in as current, unfixed behavior (not repaired): rejected `inFlight` has no retry; warm-cache Map reference is shared, not copied; collision resolution is SELECT-order-dependent with no `ORDER BY`.
- [x] **`cargo fmt` not run.** Resolved 2026-08-08: the whole reformat landed as its own commit (`095f32f`) ahead of the library_read.rs pass. `cargo fmt --check` is clean, so it can go into the CI job.
- [ ] **`sanitize_cache_key` has no length cap** despite the docs implying bounded filenames; a 5000-char key yields a 5006-char filename and will hit `ENAMETOOLONG`. The test asserts current behavior and says which assertion to flip if a cap lands.
- [ ] **`ThreadSemaphore` no longer exists** - the `tiny_http` proxy it belonged to is gone, concurrency capping is now `Arc<tokio::sync::Semaphore>` on `CoverState` behind an `AppHandle`. Struck from section 6.
- [ ] **`parseLrc` ignores repeated timestamps on one line** (`[00:01.00][00:05.00]text` keeps the second bracket inside the text). Real LRC files use this. Test-first fix still owed.
- [x] **`executeIdChunks` still does not refuse `NOT IN`** - fixed 2026-08-03: throws before executing any chunk when `buildSql`'s output contains `NOT IN`. See `dbBatch.test.ts`.
- [x] Pre-existing, unrelated to tests: `src/pages/ArtistDetail.tsx` had 8 type errors at HEAD (`toTrackObj` arity, unused local) and `App.tsx` could not resolve `./assets/canon-logo-kit/canon-favicon.svg?url`. Resolved outside this file's work - `pnpm tsc --noEmit` is clean as of 2026-08-04.

### Landed 2026-08-04 (migrations pass)

**Refactor first:** `runMigrations` moved out of `src/db/index.ts` (where it was private and imported `@tauri-apps/plugin-sql` at module scope) into `src/db/migrations.ts` as an exported function over a `MigrationDb` interface. `src/test/sqlite.ts`'s `migrateTestDb` had been a hand-copied duplicate of it, so every migration test would have proven things about the harness, not the app. Both callers now share the one implementation.

| File | Covers |
|---|---|
| `src/db/migrations.test.ts` | **Declarations**: versions are exactly 1..N with no gap or duplicate; no block contains a semicolon inside a string literal or a `CREATE TRIGGER`/`VIEW` body (what the naive `split(";")` would cut in half). **Runner**: fresh db reaches the latest declared version (read off the array, so the v49/v20 doc drift can't recur); WAL pragma is the first statement issued; re-run on a migrated db is a true no-op (exactly 2 executes - pragma + `CREATE TABLE IF NOT EXISTS` - and a byte-identical `sqlite_master`); empty `schema_migrations` migrates fully; resume from every one of the 48 intermediate versions reaches the identical schema; v27's `tag_vocab_cache` backfill exercised with seeded `tracks`/`track_tags`/`tag_mappings` rows (on an empty db the `GROUP BY` yields nothing and the block proves nothing); a recorded version *ahead* of the latest silently skips everything; a **gapped** `schema_migrations` (v40 recorded, v1-v39 never run) throws `no such table` rather than half-migrating; duplicate-column swallow proven by v22/v23 both adding `tracks.play_count` (lands exactly once); non-duplicate errors rethrow in **both** shapes - `Error` and the plain-string rejection tauri-plugin-sql actually produces, which nothing else in the suite covers. **Schema**: exact 35-table list (excluding `sqlite_%` and the five `tracks_fts_%` shadow tables), `genre_mappings` (dropped v9) and `track_tags_new` absent, exact 10-index list, `idx_albums_artist_server_artwork` still partial, `tracks_fts` still `USING fts5`, every late-`ALTER` column present (the swallow would hide their loss). **Constraints**: `playlist_tracks` PK is `(playlist_id, position)` with `track_id` deliberately outside it (a track may repeat in one playlist); PKs of every composite table sync/tags upsert into; `scrobble_history` `UNIQUE(track_id, timestamp)` vs `scrobble_queue` intentionally having none; **zero foreign keys anywhere**, asserted so adding one is deliberate; `track_tags.source` CHECK rejects an unknown provenance |

Doc drift fixed in the same pass, all three found by writing these tests: `CLAUDE.md` said "Schema v20", `docs/ARCHITECTURE.md:26` said "v1-v11" (both are v48), and `ARCHITECTURE.md`'s table listed `genre_mappings` and `tag_inbox` as live tables - `genre_mappings` is dropped by v9 and `tag_inbox` was never created by any migration.

### Landed 2026-08-04 (player buffering / sleep timer / replay gain pass)

Closes the "Buffering / loading" and "Sleep timer, replay gain, settings" subsections of section 2, except the server-side half of the `loadSettings` bullet (split out, see below). `pnpm test:run` 367 -> **402 tests / 24 files**. No Rust touched.

Added a `vi.mock("../db", () => ({ getDb: vi.fn() }))` + per-test `mockDb({ select, execute })` helper to `player.test.ts` - the first `../db` boundary mock for this file, reused by every test below.

| File | Covers |
|---|---|
| `src/features/playback/store/player.test.ts` (extended) | **Buffering vs loading**: `isBuffering` stays true across the `audio_play` round trip and clears only on `audio-format`; `isLoading` clears at the round trip while `isBuffering` is still true (this is the actual "pause stays clickable" mechanism); the 30s buffer-deadline force-stops when position never leaves zero, does not fire once `audio-format` already cleared it, and switching tracks clears the old deadline rather than leaking a second timer; a successful `audio-error` retry re-arms `isBuffering`; an exhausted unretryable error clears both flags together. **Waveform prefetch**: not fired from `play()`/`playQueue()` itself, only from the ticker's first non-zero position tick; prefetches queue offsets 1 and 2; does not re-run on a second tick for the same track (the `waveformPreloadedFor` guard); skips a track whose waveform is already cached; no-ops when `player.show_waveform` is off. **Sleep timer**: numeric preset pauses and self-clears after N minutes; `"end-of-track"` sets the flag without ever arming a `setTimeout` (asserted via `vi.getTimerCount()`, not by driving a full day of 200ms ticks - that timed out the test); re-arming cancels the previous timer instead of stacking a second pause; `clearSleepTimer` cancels a pending numeric timer, resets both fields regardless of which mode was armed, and does not touch an unrelated in-flight gapless enqueue. **Replay gain**: `computeReplayGainLinear`'s three-way fallback (album -> track -> fallback-constant, album degrades to track rather than jumping straight to fallback), the peak-based clip ceiling, `"off"` forcing unity gain, pre-amp/fallback clamped to [-15, 15], persistence writes surviving a `db.execute` rejection without rolling back the in-memory value, and calling a setter with no current track not throwing. **`loadSettings` restore_on_startup, SQLite half only**: restores `queue_state` when the setting is `"true"` and no track is current; does not restore when `"false"`; does not clobber a track already playing if settings resolve late; malformed `queue_state` JSON is ignored; an empty saved queue is not restored; replay-gain settings restore clamped even from an out-of-range stored value; an invalid `replay_gain_mode` value is ignored, leaving the mode unchanged. |

**Scope split found while scoping, not folded in:** the checklist's `loadSettings` bullet also names "the server path" - that is not a second branch inside `loadSettings`, it is `src/features/playback/hooks/useQueueSync.ts`'s own `useEffect`, which reads the same `queue.restore_on_startup` setting independently and then restores from a Subsonic `getPlayQueue()` call instead of SQLite. No test file exists for that hook. Left unticked; see the follow-up below.

### Follow-ups this pass created

- [x] **`useQueueSync.ts` has no test coverage** - the server-side half of `loadSettings restore_on_startup` lives here (`src/features/playback/hooks/useQueueSync.ts:17-93`), not in `player.ts`. Landed 2026-08-11 as `src/features/playback/hooks/useQueueSync.test.ts`. Grepped for other `useEffect`s reading `queue.restore_on_startup`: only `player.ts`'s `loadSettings` (already covered) - this is not a repeated pattern elsewhere.

### Landed 2026-08-08 (sync.ts pass)

Closes the whole `src/features/sync/sync.ts` subsection of section 3 (14/14). `pnpm test:run` 402 -> **462 tests / 25 files**. No Rust touched.

Wiring, new for this file: one `vi.mock("../db", () => ({ getDb: async () => holder.db }))` covers `sync.ts`, `tagIssues.ts` and `tagNormalize.ts` at once (all three reach the DB through the same specifier), so `scanForIssues` and `rebuildTagVocabCache` run **real SQL against the real migrated schema** rather than being mocked away - whether they ran is itself asserted via `FakeDatabase.executeCount`. Only `./navidrome`'s six fetch functions and the keychain (through the existing Tauri `invoke` mock) are faked. No fake timers anywhere: `sync.ts` has no timer or backoff of its own, all of that lives inside `apiPost`, behind the mock.

| File | Covers |
|---|---|
| `src/features/sync/sync.test.ts` (new) | **`purgeServerData`** (DB-only, `asDb()` cast like `dbBatch.test.ts`): all 21 owned tables at zero; a second server's rows counted before/after and asserted at exactly half (not merely "non-zero"); the six deliberately-not-purged tables (`artist_identity`, `artist_aliases`, `artist_covers`, `radio_signal_cache`, `tag_mappings`, `user_tree_nodes`) still present - the executable form of the function's header comment; only its own `server.opensub_extensions.<id>` settings key deleted; **statement ordering** pinned per-table (the track-keyed deletes are subselects over `tracks`, so moving `DELETE FROM tracks` up would silently orphan all nine and no total-count assertion would catch it); a never-synced server id; an album-only library with zero tracks; a cross-owner `playlist_tracks` row. **Initial sync**: albums/tracks/artists/playlists written, `artists.album_count` derived by `GROUP BY`, `tracks_fts` populated, full `changed` shape; `track_tags` written only for tracks with a truthy genre; `release_type` precedence (`releaseTypes[0]` > `releaseType` > null, incl. `releaseTypes: []` falling through); `alt_url: null` passed as `undefined`; legacy typeless credential migrated to `{type:"md5"}`; corrupt credential JSON throws before any fetch; a rejecting extension-discovery call (deliberately not awaited) doesn't fail the sync. **Idempotence**: a second sync with unchanged fixtures issues `executeCount === 0` and all-false `changed` - which simultaneously proves the two whole-table sweeps stayed out; `sameValue` loose compares (INTEGER year vs API string year, stored NULL artist vs `""`); a genuinely changed column still rewrites; an album rename dirties FTS even though the skip heuristic blocked the track fetch; a non-artist change leaves `artists` alone. **Album prune** (regression for known-issues "A sync that only upserts diverges from its source"): a removed album deletes its tracks plus `loved_albums`/`album_genres`/`album_unresolved_genres`/`loved_tracks`/`lyrics`/`waveform_cache`/`tracks_fts`, while `album_identity`/`album_user_genres`/`scrobble_queue`/`scrobble_history` survive; an empty fetched list against a non-empty library prunes nothing; a rejecting `fetchAllAlbums` rejects before `getDb()` (`executeCount === 0`), which is the invariant the prune's safety rests on; another server's albums are never stale candidates; the artists rebuild is `server_id`-scoped; empty-artist albums excluded. **Per-album track prune**: stale tracks and derived rows removed; an empty fetched track list prunes nothing; the `NOT IN` ceiling asserted on **both sides** (`SQLITE_MAX_VARIABLES - 1` bails, `- 2` prunes); the stale-track SELECT never fires on a first sync but does on the second. **Skip heuristic**: exact-equality skip; one-short re-fetches; the three-sync wedge test (5 tracks -> server drops 1 -> prune -> third sync skips) which is the whole reason the prune exists; a NULL `navidrome_created` never skips; a server omitting `songCount` skips on `created` alone and therefore never notices a deletion. **Failure budget**: exactly 5 consecutive failures breaks (5 calls, not 10); exactly 4 does not; a success resets the run, so 6 scattered failures across 8 albums never trips it (the case a naive `failedAlbums >= 5` gets wrong); a failed album keeps its old tracks; progress callback shape; no callback at all. **Loved**: a starred id with **no local track row** round-trips to equality by the third sync with `executeCount === 0` (the orphan that used to rewrite both tables every 5-minute tick forever); a real change rewrites; an equal-sized disjoint set is detected via `some()`; another server's loved rows survive; a failed `getStarred2` pushes `"loved"` to `skippedStages` and leaves stored state alone. **Playlists**: `is_smart`/`rules_json`/`custom_cover_data` survive a refresh that renamed the playlist; only the playlist whose ordered ids moved gets its `DELETE FROM playlist_tracks` (asserted via an `execute` spy capturing the bound playlist id); positions rewritten contiguous `0..n-1` after a mid-list removal (`position` doubles as the remote Subsonic index); a removed playlist prunes `playlist_tracks` + `playlist_resume` + `playlists`; a failed listing reports `"playlists"` and writes nothing; **one** failed per-playlist track fetch blocks *every* playlist write (the anti-wipe guard); another server's playlists invisible; both stages failing yields `["loved", "playlists"]`. **`syncAlbumTracks`**: prefix stripped by length (so an album id containing its own colon survives), upsert-without-prune pinned as current behavior, replay-gain sub-fields stored individually and `play_count` defaulting to `0` rather than NULL. |

**Scope note:** the research pass flagged this as arguably two scopes (DB-only helpers vs. the orchestration behind the network mock). Kept as one colocated file with a shared fixture builder, since the mock stack is what dominates the setup cost and the two halves share it.

### Follow-ups this pass created

Four behaviors were pinned as current rather than fixed. None is a confirmed user-visible bug, all are one-line decisions someone should make deliberately:

- [ ] **`pruneAlbums` leaves `album_covers` behind** while `purgeServerData` deletes it. `album_covers` is a pure cache keyed by `album_id`, so a pruned album strands an unreachable row forever. (`album_genre_exclusions` is likewise not pruned, but that one is user-authored and defensible.)
- [ ] **The loved stage's `LIKE '<server_id>:%'` has no `ESCAPE` clause**, so a server id containing `_` would over-match a sibling id and delete its loved rows. Not live today (ids are UUIDs), but it is the same ownership-column family as known-issues' "A mirror not scoped by owner".
- [ ] **A per-playlist track-fetch failure sets `playlistWritesBlocked` but pushes nothing to `skippedStages`** - only `failedPlaylists` moves, so a caller branching on `skippedStages` sees a clean sync that silently wrote no playlists.
- [ ] **The progress callback never reports `done === total`** unless the album count lands on a multiple of 25, and `done` counts attempts rather than successes. The UI's bar cannot reach 100% on most libraries.

### Landed 2026-08-10 (useSearch pass)

First hook test in section 4, and the first `QueryClientProvider` wiring in the suite (no repo-wide `renderHookWithProviders` helper exists yet - this file hand-rolls a local `retry: false` client, which the next hook pass should lift out). `pnpm test:run` 579 -> **621 tests / 30 files**. No Rust touched.

Wiring: `getDb` mocked to a `createMigratedTestDb()`, so all three section queries run **real FTS5 + real bm25 against the real schema**. `tracks_fts` has no triggers (nothing in `migrations.ts` creates one), so the seed helpers write the FTS row explicitly, mirroring `sync.ts:504` including its COALESCE of NULL artist/genre to `''` and its copy of `albums.name` into the `album` column. No fake timers - nothing in this hook is time-based.

| File | Covers |
|---|---|
| `src/features/search/useSearch.test.ts` (new) | **Pool ranking / caps** (regression for known-issues "A `LIMIT` without `ORDER BY`"): 2100 filler rows with the exact-title match inserted **last**, so rowid order would drop it - it comes back first; a title hit outranks a genre-only hit; the SQL actually issued contains `WITH ranked AS MATERIALIZED`, the exact 5-weight `bm25(...)` call, and an `ORDER BY` before **every** `LIMIT` (a string assertion, because dropping `MATERIALIZED` does **not** throw on SQLite 3.53 - the inner `ORDER BY`/`LIMIT` blocks flattening anyway, so the executable form proves nothing); the three sections issue concurrently (peak in-flight 3). **`server_id`** (regression for known-issues "A mirror not scoped by owner"): another server's albums/tracks/artists excluded; an album row and a track row whose owner deliberately disagrees with the queried id return their **own** column, which is exactly what a `server_id: server.id` reconstruction would get wrong; a serverId-only change refetches the other library. **Row shape**: a track whose album is missing keeps `album_name`/`artwork_url` null via the LEFT JOIN and produces **no** album row via the inner JOIN; a null-artist track stays in `tracks` but never reaches `artists`; `album_count` is DISTINCT albums not tracks; many hits on one album collapse to one row; `artist_identity` images LEFT JOIN to null; replay-gain columns pass through unchanged incl. nulls. **Query parsing** (`toFtsQuery`, private - observed through results): multi-token is AND not OR; prefix match; `NOT` is a literal token, not an operator; punctuation-only query returns empty rather than failing. **Re-ranking** (`scoreMatch`, private): the four tiers ordered exact > starts-with > word-starts-with > substring (the substring row reaches the pool through the album column - a prefix index cannot find `halo` inside `Michalo`); artist weighted 0.6x and floored, so artist-starts-with (480) loses to title-word-start (600); a track matched only via genre is in the pool but scores 0 and never reaches the caller; an album matched only through a track title is dropped; alphabetical tiebreak for tracks/albums, `album_count`-descending for artists; case-insensitive both directions; null artist scores on title alone. **feat. collapsing**: dropped when the bare primary is present, kept when absent, all three separator spellings and case-insensitive prefix matching; the chained-credit branch pinned both ways - `FEAT_RE`'s non-greedy `(.+?)` cuts at the **first** separator, so `X feat. A feat. B` tests membership of `X`, never of `X feat. A`. **Query wiring**: no read at all for an empty/whitespace-only query, an undefined serverId, or an empty-string serverId (`selectCount === 0`); the key is the **trimmed** query, so `"love"` and `"  love  "` share one cache entry and one fetch; a remount inside the 10s stale window re-reads nothing; `keepPreviousData` holds the old rows with `isPlaceholderData` true across a gated in-flight query; a rejecting read surfaces as `isError`. |

**Two behaviors pinned as current, not endorsed** (both the same cause, both logged in donow.md): `toFtsQuery` normalizes the query (collapses interior whitespace, strips `"`) but `scoreMatch` compares the **raw** string, so `"love  song"` and `he"llo` match the index and are then filtered back out to zero results.

**Suite hygiene, same pass:** `migrations.test.ts`'s "reaches the same schema from every intermediate version" was already flaky at HEAD (5s default timeout, ~5.5s under full-suite worker contention - verified by stashing this pass's changes); the new file's extra load also tipped `sync.test.ts`'s "still prunes one variable below the ceiling". Both are legitimately slow by construction (48 migration runs; ~32k tracks) rather than hung, so both got an explicit `30_000` timeout.

### Follow-ups this pass created

- [ ] **No shared `renderHookWithProviders`** - section 4's own preamble asks for one and this file hand-rolled it instead. The second hook test that needs a QueryClient should lift it into `src/test/`.
- [x] **`nowPlayingQueries.test.ts` has no `ESCAPE` coverage** despite `nowPlayingQueries.ts:66-68` being the exact site named in known-issues' repo-wide `ESCAPE '\'` rule. The `useSearch` bullet's ESCAPE clause was mis-filed; the real gap is there. Closed 2026-08-12, see the progress-log entry for that date.
- [ ] **`scoreMatch` scores the raw query while `toFtsQuery` normalizes it** - a doubled interior space or a stray `"` produces zero results from a matching index. Fix shape: score against the same normalized token list the FTS expression is built from.

### Landed 2026-08-06 (waste pass)

New **section 4.6**, added after the user pointed out that the plan had no answer for "something attaches to something else and then re-renders five times a second". Correctness and cost are separate properties and this file only tracked the first. `pnpm test:run` 462 -> **466 tests / 26 files**.

| File | Covers |
|---|---|
| `src/test/perf.ts` (new) | `trackRenders(hook)` mounts a probe component and counts its runs (renders, not commits, not effects - that is what a subscriber costs the app). `invokeCount(cmd)` / `invokeArgs(cmd)` read the existing Tauri `invoke` mock's call log. |
| `src/test/sqlite.ts` | Added `selectCount` and `queryLog` (`{kind, sql}[]`) alongside the existing `executeCount`, both reset by `createMigratedTestDb`. A read-side counter is what "this pass reads the library once" needs, and the log distinguishes a second read of the same table from a different read that had to happen. |
| `src/features/playback/store/player.waste.test.ts` (new) | The elapsed ticker at 5Hz is the loudest churn source in the app, so all three probes point at it. Subscriber selecting `currentTrack` renders **zero** extra times across 1000ms of ticks while `elapsed` actually moves; subscriber selecting `elapsed` renders **exactly 5**; `resume()` twice while already playing leaves **exactly one** poll loop (`resume` arms `startElapsedTimer` without stopping it first, and MPRIS/media-key Play does not check whether playback is under way); a 30 track album queued issues **one** `audio_play`. |

Each probe was verified capable of failing, per the section's own rule: deleting `startElapsedTimer`'s `clearInterval` turns the interval test red at 15 polls/sec, and widening the probe's selector to `(s) => ({ t: s.currentTrack })` turns the render test red with React's update-depth error - which is the render-loop shape itself, caught by the probe rather than shipped.

Audit run while writing these: no selector in `src/` currently returns a fresh object or array, and no component subscribes to the store without a selector. The store side is clean today; section 4.6's grep-style test exists to keep it that way.

### Landed 2026-08-06 (navidrome transport)

`pnpm test:run` 466 -> **518 tests / 27 files**. Section 3's `navidrome.ts` block split in two; this pass took the transport half, where all three of its known-issues regressions live.

| File | Covers |
|---|---|
| `src/clients/navidrome.test.ts` (new, 52 tests) | `apiPost` driven through real callers (`fetchStarred2`, `fetchAlbumListByType`, `starTrack`, `setRating`, `scrobbleTrack`, `fetchAllAlbums`), since it is module-private. Request shape + `normalizeUrl` table (trailing slashes, `/rest` suffix, a base with a path). Timeout fires at exactly 12000ms and not at 11999, and the timer is cleared on success (`vi.getTimerCount()` back to 0). Backoff measured as a span: 400ms then 800ms, asserted at 399/400 and 799/800. Alt URL asserted as the full 6-entry alternating url list, not a count. Retriable statuses 429/502/503/504 retry; 400/401/404/500 come straight back; a 503 surviving all three attempts is *returned*, so the caller's own status check throws, not `apiPost`'s. Error naming: endpoint prefix always present, `"Load failed"` never the whole message, singular "1 attempt" for non-idempotent, last failure wins over first, non-`Error` throws stringified. Non-idempotent: scrobble gets 1 fetch where star gets 3; neither a *timed-out* nor an opaquely-rejected scrobble or `updatePlaylist` ever reaches the alt url, while an idempotent `star` still does. `SubsonicError`: code 70 vs 40/41/50, `code: 0` not collapsed to null, absent `error` object -> null code and a suffix-free message, non-200 gives a plain `Error` (so `instanceof SubsonicError` is false). `fetchAllAlbums`: empty library, missing `albumList2`/`album` keys, short page stops, exactly-500 forces another request, offsets walk 0/500/1000, and a page-2 failure (HTTP 500, error envelope, no-error envelope, transport rejection) throws rather than returning page 1. |

Harness note for the next fetch-touching test: `navidrome.ts` uses the **browser global `fetch`**, not `@tauri-apps/plugin-http` (only `musicbrainz.ts`, `fanart.ts`, `theaudiodb.ts`, `artBlur.ts`, `artColor.ts` use the plugin). So the mock is `vi.stubGlobal("fetch", vi.fn())`, plus the usual `vi.mock("@tauri-apps/api/core", ...)` because the module imports `invoke` at load. A `Response` body reads once, so any test whose call count is >1 must build a fresh `Response` per call via `mockImplementation`, not `mockResolvedValue`.

**Follow-ups this pass created (bugs found, not fixed - out of scope):**

1. ~~**A non-idempotent endpoint still double-sends to the alt url on a non-timeout rejection.**~~ Fixed 2026-08-21: `apiPost` now breaks out of the url loop on *any* rejection for a non-idempotent endpoint, since `fetch` cannot distinguish "never reached the server" from "applied, response lost" and both routes are the same Navidrome. The pin test is flipped and `updatePlaylist` gained its own case.
2. `authenticate`'s failure message reports `new URL(baseUrl).origin + "/rest/ping.view"`, so a server at `http://host/music` tells the user to check `http://host/rest/ping.view` - a URL that was never contacted. And an invalid `baseUrl` makes `new URL()` throw a `TypeError` that replaces the intended error.
3. `authenticate` / `authenticateWithApiKey` throw a plain `Error`, not a `SubsonicError`, on a `status: "failed"` envelope, so the login screen cannot tell code 40 (bad password) from any other refusal even though the machinery exists.
4. `fetchAllAlbums` has no page cap: a server that always returns exactly `PAGE_SIZE` loops forever.

### Landed 2026-08-08 (navidrome URL / credential construction)

`pnpm test:run` 518 -> **579 tests / 29 files**. Closes the `### src/clients/navidrome.ts` block; `library_read.rs` is now all that is left of section 3.

| File | Covers |
|---|---|
| `src/lib/navidromeUrls.test.ts` (new, 59 tests) | `buildAuthParams` through `getStreamUrl`: md5 vs apikey param sets, empty username emits `u=` rather than dropping the key, reserved-character encoding asserted on the **raw** string (`u=user+name%2Bx%26y`) not just the `.get()` round-trip, unicode, and the exact param order `u,t,s,v,c,f` (Rust concatenates this string into an upstream query, so order and `+`-vs-`%20` are observable). `normalizeUrl` table incl. the two anchor cases: `/restaurant` survives, `/rest/rest` loses only one segment. `getStreamUrl`: `maxBitRate` omitted at 0 / negative / `NaN` (reachable - `App.tsx` `parseInt`s the setting with no fallback), unrounded at 192.7, appended after `id`, read at call time not import time; empty id (reachable via `stripServerPrefix("srv1:")`), `#` encoded (not covered by `track.test.ts`). `getCoverArtUrl` **not ready**: full literal URL with default `size=300`, apikey variant, `size=0` emitted where `maxBitRate` would be omitted (the asymmetry is the assertion), no clamping, empty and reserved-character ids. `getCoverArtUrl` **ready**: exact `cover://localhost/cover/<id>?size=<n>`, `/` `?` `&` encoded so Rust's `strip_prefix("/cover/")` and `size` parse survive, `encodeURIComponent`'s unreserved set left alone (guards a swap to `encodeURI`), size interpolated raw so `-1`/`NaN` reach the string. `isCoverServerReady` one-way, and no `resetCoverServer` export. `getArtistImageUrl`: identity before ready, whole source URL collapsed into one path segment after, `&` encoded, already-percent-encoded sources double-encoded so Rust's single `percent_decode` round-trips, never a bare `%`. `updateCoverProxyConfig`: normalized `baseUrl` + flat `authParams` in the invoke args, `+`-encoded space, apikey variant, rejection propagated. `authenticate`: 16-char lowercase hex salt, zero-padded leading byte, `t === md5(password + s)` against the salt read off the request body, fixed-RNG token vectors, UTF-8 hashing of a unicode password, password never present in the body, fresh salt per call, `v`/`c`/`f` identical to `buildAuthParams`' (the literals are duplicated in source), and `ping.view` not `authenticate.view`. |

Harness note: this is a **second** test file for one source file, deliberately. `navidrome.test.ts` installs fake timers and a stubbed global `fetch` in a file-wide `beforeEach` to drive `apiPost`'s retry loop; the URL builders need neither, and they need `vi.resetModules()` + a fresh dynamic `import("./navidrome")` per test because `_coverServerReady` is one-way - a single test flipping it would decide every test after it. A top-level `vi.mock("@tauri-apps/api/core", ...)` survives `vi.resetModules()`, so the re-imported module still gets the mocked `invoke`. The fresh import also makes an intra-file `_streamMaxBitrate` leak impossible (Vitest already isolates it from `track.test.ts` per file).

**Follow-ups this pass created (bugs found, not fixed - out of scope):**

1. **The `cover://` ready branch is not scoped by owner** (`navidrome.ts:200-202`, `src-tauri/src/lib.rs:133,324,343`). `getCoverArtUrl` discards `baseUrl`/`username`/`credential` entirely once ready; the host is reconstructed in Rust from `CoverState`'s single global `proxy_config` slot, and the disk cache key is `{id}:{size}` with no server namespace. This is known-issues' "A mirror not scoped by owner", sharper form - internally consistent, wrong host, passes typecheck. Made worse by `_coverServerReady` being one-way: `App.tsx:270-284` swallows an `updateCoverProxyConfig` failure and skips `initCoverServer()`, but on a **server switch** the flag is already `true` from the previous server, so covers keep resolving against server A's base URL and credentials. A password rotation likewise changes no cover URL, so stale bytes survive re-auth under a `max-age=604800` header. Fix shape: a `resetCoverServer()` called before each `updateCoverProxyConfig`, plus a server id in both the URL path and the Rust cache key. Current behavior is pinned by a test explicitly labelled as documenting it, not endorsing it.
2. **`size` is unvalidated and, in the ready branch, interpolated unencoded** (`navidrome.ts:201`). `-1`, `NaN` and fractional sizes all produce URLs Rust silently coerces to 300 (`lib.rs:323`) while the JS string - and every React memo key and the Rust cache key derived from it - keeps the bogus value. Reachable: `TagsViewHelpers.tsx:42` passes a computed `size * 2`.
3. **`HomeView.tsx:670` is the only unguarded `getCoverArtUrl` call site**, using `album.artwork_url!`. Every other site guards on falsiness. If it is ever undefined, `encodeURIComponent(undefined)` requests a cover literally named `"undefined"`, which Rust then caches under `"undefined:300"` - a silent, persistently cached wrong answer instead of a visible failure.
4. `authenticate` duplicates `buildAuthParams`' `v`/`c`/`f` literals rather than calling it (`navidrome.ts:855` vs `:74-76`). Not wrong today; a protocol bump applied to one and not the other breaks login while leaving every other call working. Pinned by a test comparing the two param sets.

(Item 2 of the 2026-08-06 follow-up list - `authenticate`'s `new URL()` throwing on a scheme-less base - was re-confirmed this pass and remains unfixed.)

### Landed 2026-08-08 (library_read.rs pass)

Closes section 3. Refactor first: every `#[tauri::command]` body in `src-tauri/src/library_read.rs` was a closure using only `&Connection` (never `AppHandle`), so each was hoisted to a free `query_*(conn, ...)` fn per CLAUDE.md's "extract free fn, test that"; `open_read_conn` split into `open_read_conn_at(&Path)` + a one-line `AppHandle` wrapper. Behavior unchanged. `get_albums` keeps a deliberate double `order_by_clause` call (once before `with_conn`, once inside `query_albums`) so a rejected sort still never opens the database - commented at the call site.

Fixture is hand-written DDL in `mod tests` (~55 lines, post-ALTER shape, only the 12 tables these queries read), not a replay of `migrations.ts` - Rust cannot run the TS migrations, and this connection never sees the schema anyway. In-memory `rusqlite` for the query tests; a `ScratchDir` (copied from `lib.rs`/`streaming.rs`, still no `tempfile` dev-dep) for the two file-backed ones.

`cargo test` 81 -> **125**.

| File | Covers |
|---|---|
| `src-tauri/src/library_read.rs` (`mod tests`) | **`order_by_clause`** (added to the 4 existing): whitespace-only keys, homoglyph/dotless-i/full-width/NUL/zero-width lookalikes, and a structural property that no allowlisted fragment contains `;`/`--`/quote/`/*` (survives arms added later). **`open_read_conn_at`**: a missing db errors *and no file is created* (pins `SQLITE_OPEN_CREATE`'s deliberate omission), an existing WAL db opens and is writable (pins READ_WRITE, the known-issues fix). **`query_albums`**: 4x2 matrix of every sort against both the filtered and unfiltered branch (the `recently_added` fragment is not in the `SELECT DISTINCT` list - legal in SQLite, invisible until genre-filter + recently-added combine), unknown sort rejected before any SQL runs, each row's `server_id` read off its own column, alphabetical NOCASE, year DESC + name tiebreak, `COALESCE(navidrome_created, created_at)` fallback, genre filter over direct/ancestor/`raw:` rows, `DISTINCT` collapsing a two-genre match. **`query_artists`**: alias rows excluded, artwork correlated to the artist's own `server_id`, null-safe bare artist, enrichment joined by name, and the pinned-not-endorsed duplicate row per server. **`query_all_tracks`/`query_tracks`**: all 19 positional column indices with a distinct sentinel per column (a swap of two same-typed neighbours would otherwise typecheck), a NULL `album_id` failing the whole `get_all_tracks` call, both ORDER BYs, cross-server album id returning nothing. **`query_genres`**: `relation='direct'` only, `raw:` excluded, `COUNT(DISTINCT album_id)`. **`query_recent_genres`**: `LIMIT 10` window boundary at 11 albums, the `>= 5` threshold, the asymmetry that the HAVING subquery counts library-wide while the returned `album_count` is window-scoped, both fallback triggers (no history / history yields nothing), `LIMIT 18` at 19 qualifying genres. **`query_loved`**: three sets in one call, `DISTINCT`, NULL-`album_id` and dangling-track exclusions. **`query_playlists`**: per-row `server_id`, NULL `track_count`/`is_smart` reading as 0, Canon-owned columns returned. **`query_unmapped_tag_count`**: `album_count > 0` boundary at 0/1, kind matched as well as value, and a legacy NULL-`norm_value` mapping failing to mark its vocab entry mapped. |

Probes proven falsifiable: adding `SQLITE_OPEN_CREATE`, `LIMIT 10 -> 11`, and `LIMIT 18 -> 19` each turned exactly the intended test red, then were reverted.

**Not covered, deliberately:** pagination. tests.md said "paginates correctly", but no command in this file takes `limit`/`offset` - the honest equivalent is the LIMIT/HAVING boundary set above. `db_path` and the poisoned-mutex arm of `with_conn` stay untested (`AppHandle`-bound / needs a panicking thread, low value).

**Follow-ups this pass created (found, not fixed - out of scope):** all six are in `instructions/donow.md` with provenance. Headline: **zero of the 13 SQL statements in this file filter on `server_id`** - five are implicitly scoped because their ids carry a `${server_id}:` prefix, but `get_artists` is not (`artists.id` is a random hex and `ArtistRowDto` has no `server_id`), so one artist on two servers yields two indistinguishable rows; and the genre counts/thresholds aggregate across servers. Verified against pre-port git history: every one of these was equally unscoped in the JS original, so the rusqlite port introduced nothing. Same family as known-issues' "A mirror not scoped by owner", whose shipped remedy was `purgeServerData`, not read scoping - so this is a design call, not a hotfix, and the tests pin current behavior explicitly labelled as such.

### Landed 2026-08-10 (useLibrarySync pass, control flow half)

Second hook test in section 4. `pnpm test:run` 621 -> **652 tests / 31 files**. No Rust touched. The bullet's three clauses turned out to cover about a third of the file, so the scope was split in two on the code: this pass is control flow and lifecycle, the settle fan-out and the `partial` message strings stay unchecked above.

Wiring: boundary mocks only, no DB and **no `QueryClientProvider`** - this hook takes `queryClient` as an argument, so the `renderHookWithProviders` lift that `useSearch` asked for still has no second caller (leave it for `useTracks`/`useAlbums`). `./sync` is mocked to a **deferred** promise per call, pushed onto a `runs[]` array with its own `resolve`/`reject` and the `onAlbumBatch` callback it was handed - the guard, the `serverRef` settle handler and the interval are only observable while a run is deliberately held open. `./useSetting` is mocked rather than driven through the db, because it caches settings in a module-level `Map` with no exported reset. Fake timers throughout; `settle()` advances 1000ms to drain the staggered fan-out, which every interval assertion has to account for.

| File | Covers |
|---|---|
| `src/features/sync/useLibrarySync.test.ts` (new) | **In-flight guard**: three manual `runSync` calls during a run all return `false` and issue no second `syncLibrary`; the return-value contract (`true` for a started run, `false` for a refused one). **Claim semantics** (the comment at `useLibrarySync.ts:123-126`): a refused attempt leaves the server unstamped, so the settle handler starts the run that was lost; a completed run's server is not re-synced on an equal-but-new object; a **failed** run stays claimed, so with the interval off nothing retries it for the rest of the session (pinned as current, logged); the `finally -> syncIfNeeded -> runSync` cycle terminates at exactly one call on a permanently-rejecting sync. **Server switching**: A held open, switch to B, resolve A -> calls are `[a, b]` (the `serverRef` "which server is selected now" comment); switch to `undefined` mid-run starts nothing; A -> B -> A re-syncs A, because only the latest id is claimed; undefined mount arms nothing at all and one server arriving arms exactly one interval; removing the server tears the interval down and leaves the stale `done` status. **Interval**: ticks bypass the claim stamp (or auto-sync would die after the first run); a tick during an in-flight run is swallowed and the next one after settle is not (known-issues' `useScrobbleFlush` "can one pass outlast its interval"); armed/not-armed table over `"0" "-5" "" " " "abc" "5abc" "2.7"` via `vi.getTimerCount()`, pinning that `parseInt` leniency means the setting is unvalidated; `"2.7"` fires at 2 minutes to the millisecond; a setting arriving after first paint clears the old timer and restarts the countdown; a fresh-but-equal `server` object every 4 minutes re-arms the 5-minute interval forever so it **never fires**; exactly one interval across a remount; none after unmount. **Failure reporting**: `Error` message surfaced, `lastSyncedAt` left null, `console.error("Sync failed:", err)`; `String(err)` branch for a thrown string and a thrown object (`"[object Object]"`); the previous error cleared when the next run starts. |

Probe proven falsifiable: reverting `syncIfNeeded` to stamp-then-run turned exactly the two claim/switch regressions red, and nothing else.

**Follow-ups this pass created (found, not fixed - out of scope):** five, all in `instructions/donow.md` with provenance. Headline: **the 5-minute auto-sync may never fire in the real app** - `App.tsx:106` derives `server` from a react-query result, and effect B keys on the object identity, so any refetch inside the interval window restarts the countdown from zero.

### Landed 2026-08-11 (useServer pass)

`pnpm test:run` 763 -> **770 tests / 35 files**. No Rust touched.

| File | Covers |
|---|---|
| `src/hooks/useServer.test.ts` (new, 7 tests) | `useServerWithCredential`: `enabled: !!serverId` (idle fetchStatus when undefined); server-row-missing throw; the wrapped keychain-reject message (`Could not read the stored credential: <detail>`), distinguishing it from the dead `!credJson` branch per known-issues; **`retry: false` proves itself against an ambient client set to `retry: 3`** (probe verified red - flipping the hook's `retry: false` to `3` timed out 4 of 7 tests before being reverted); corrupt-JSON throw; legacy token/salt-with-no-type migration to `{type: "md5", ...}`; well-formed `apikey` payload round-trip. |

### Landed 2026-08-11 (radio.ts candidate scoring pass)

Closes the bullet split out of `useRadio` orchestration (which mocks `getRadioCandidates` away). `pnpm test:run` 731 -> **763 tests / 34 files**. No Rust touched. `scaleWeights` and `buildAncestorWeights` were promoted from module-private to exported (along with `MOOD_WEIGHT`/`CANDIDATE_LIMIT`) so the pure math is directly testable without a DB.

Wiring: `getCuratedCandidates`/`getRadioCandidates` go through the same `getDb()` specifier as `canonicalize.ts`'s `getCanonTree`, so one `vi.mock("../db", ...)` covers both and real SQL runs against the real migrated schema (`createMigratedTestDb`). `bustCanonTreeCache()` in `beforeEach` since the tree is a module singleton.

One report claim didn't survive a source read: `buildAncestorWeights`'s internal `Math.max(existing, w)` (radio.ts:92) is dead code within a single call - the `visited` set is populated *before* a node's weight is ever compared, so a node can only be set once per call regardless of path length. The real max-of-two-paths behavior lives one level up, where `getCuratedCandidates` merges multiple seed tags' independent `buildAncestorWeights` results (radio.ts:132-135) - tested there instead (`same-genre` describe block, "keeps the max weight...").

| File | Covers |
|---|---|
| `src/features/radio/lib/radio.test.ts` (new, 32 tests) | **Pure math**: `scaleWeights` at both scale extremes and clamped beyond `[0,1]`, weights sum to 1 at every scale; `buildAncestorWeights` self-weight seeding for an unknown/parentless node, weight halving per hop, the `maxDepth` cutoff (a node discovered *at* the depth limit is not itself expanded), cycle safety via `visited`. **`getCuratedCandidates`/curated & same-genre modes**: no-tags random fallback (score 0.1, excludeIds honored), `SAFE_ID` filter dropping every weighted id to `[]`, mood-vs-genre `MOOD_WEIGHT` scoring, `sqrt(tag_count)` damping (exact score assertion against the formula), the pre-exclusion `maxTree` normalization (excluding the top scorer shrinks what remains rather than re-normalizing), ancestor-chain propagation to a candidate tagged with the parent, the cross-tag max-merge described above, server scoping, `CANDIDATE_LIMIT` capping both the fallback and scored queries. **Every `RadioMode` branch**: seed-not-found short-circuit, `similar-artists` (empty-map skips the query entirely - `selectCount` pinned at seed-lookup-only, case-insensitive match, score-sorted, excludeIds), `same-artist` (null-artist short-circuit, case-insensitive equality, fixed score), `same-album` (no-album-id and album-exhausted fallbacks to curated, disc/track ordering with no score sort), `era` (no-year random fallback, decade-window distance scoring), `loved` (join-gated), `random` (server-scoped). |



Fifth hook test in section 4, the last of the recently-worked baseline hooks. `pnpm test:run` 705 -> **731 tests / 33 files**. No Rust touched.

Wiring: real migrated SQLite (`createMigratedTestDb`), since the restore path joins `tracks`/`albums` by canon id and reads `settings` directly - a boundary mock would have hidden the join. `../clients/navidrome` is mocked with `importActual` spread, only `getPlayQueue`/`savePlayQueue` replaced (the URL builders `getStreamUrl`/`getCoverArtUrl` stay real and pure). `usePlayerStore` is the real singleton, reset via `setState` in `beforeEach`/`afterEach` - this hook has no `useQuery`, so no `QueryClientProvider` wrapper is needed (unlike `useScrobbleFlush`).

Checked the follow-up note from the manual-mappings pass (this file, previously line 144): grepped for other `useEffect`s reading `queue.restore_on_startup` - only one other site exists, `player.ts`'s `loadSettings` (already covered in `player.test.ts:1207+`). The hook/store split is not repeated elsewhere for this setting.

| File | Covers |
|---|---|
| `src/features/playback/hooks/useQueueSync.test.ts` (new, 26 tests) | **Restore gating**: no `getPlayQueue` call when the setting row is missing, `"false"`, or any other value; none while already playing or a track is loaded. **Empty results**: no store write when the server has no saved queue, or when none of the saved track ids match a local row. **Regression** (known-issues "A restore path writing `currentTrack` without loading the engine is unplayable"): after a successful restore, `streamUrl` is `null` and `isPlaying` is `false` - pinning that this hook's own state-only `restoreQueue` call stays that way. **Start index**: falls back to 0 with no saved `currentId` and with a `currentId` matching nothing local; lands on the right index when it matches. **Race guard**: a `currentTrack` written mid-flight (simulating `loadSettings`' local restore landing during the network+DB round trip) is not clobbered by the pending server restore. **No double restore**: a rerender with a same-id server does not re-query. **Debounced save**: no timer with nothing playing or an empty queue; the exact `savePlayQueue` arg tuple (native ids, current native id, elapsed **rounded to ms**, alt_url); no send before 10s; a queue change resets the debounce window to one send of the final queue; cleared on unmount; foreign-server queue entries filtered out of the payload. **Immediate save**: fires on `visibilitychange` to `"hidden"` (not `"visible"`) and on `beforeunload`, independent of the debounce; no-ops with no current track; listeners removed on unmount. |

Probe proven falsifiable: replacing the mid-flight race guard (`if (usePlayerStore.getState().currentTrack) return;`) with `if (false) return;` turned exactly the race-guard test red, nothing else; reverted.

### Landed 2026-08-10 (useRadio orchestration pass)

Fourth hook test in section 4. `pnpm test:run` 685 -> **705 tests / 32 files**. No Rust touched.

Wiring: `getRadioCandidates` is mocked (scoring is its own scope, see the `src/features/radio/lib/radio.ts` bullet above), `../db` is a boundary mock returning the pick row keyed off the bound id so a test can tell *which* candidate won, `../clients/lastfm` returns empty. Two traps worth knowing: **`queue` is in the fill effect's deps, so a successful append re-arms the effect** - a mock returning the same non-empty list forever fills until the lookahead is satisfied, which silently inflated every call count on the first run. The `serveCandidates(...lists)` helper serves one list per fill then drains to `[]`, which is what makes "the Nth fill" a thing a test can name. Second: RTL auto-cleanup still does not run (no `globals: true`), so this file calls `cleanup()` in its own `afterEach` - same as `useScrobbleFlush.test.ts`, still logged in `donow.md`.

| File | Covers |
|---|---|
| `src/features/radio/hooks/useRadio.test.ts` (+20 tests, 22 total) | **Guards**: radio off and null `currentTrack` each query nothing; the `LOOKAHEAD_THRESHOLD` boundary both ways (`remaining === 10` does not fill, 9 does); the in-flight lock holds when a dep moves mid-fill; a thrown fill logs once and clears the lock so the next fill runs. **Exclusions**: queue members, ids scrobbled inside the window, and this session's own picks; the recent-play lookup's exact binds (`srv:%`, `now - 3600`, fake system time); the session memory cleared on a radio off/on edge. **Decay**: a just-played artist ranks below a lower-scoring fresh one; `same-artist` skips the penalty entirely (`UNCAPPED_MODES`); a pool where every candidate shares the just-played artist still appends (soft penalty, not a filter). **same-album**: takes `candidates[0]` in album order without consulting `Math.random`; and the known-issues witness copy - restored-at-startup state appends without starting playback, playback-then-stopped starts it. **Append position** (the bullet's real content): with the *real* `addToQueue`, `maxQueueSize: 3` and the queue on its last entry, the append trims the front and `playFromQueueIndex` is called with the post-trim index, not the pre-append length. **Waste**: toggling `isPlaying`/`isLoading` produces zero re-renders (the "subscribed rather than selected" half of the known-issues fix, which nothing pinned before). |

Probes proven falsifiable: four separate mutations of the hook (post-append length read replaced by the stale one; the decay block skipped; `hasPlayedRef` dropped from the same-album `wasAtEnd`; the `fillingRef` guard deleted) each turned exactly the intended test red and nothing else, then were reverted. The in-flight-lock test only became falsifiable after it awaited the re-armed effect past its own awaits before counting - the first version passed with the lock removed.

**Follow-ups this pass created (found, not fixed - out of scope):** four, all in `instructions/donow.md` with provenance. Headline: the fill re-queries candidates once per appended track, so topping a nearly-empty queue back up to the lookahead costs up to nine `getRadioCandidates` round trips.

### Landed 2026-08-10 (useScrobbleFlush pass)

Third hook test in section 4. `pnpm test:run` 652 -> **685 tests / 32 files**. No Rust touched. Both of this file's known-issues entries now have a named regression test.

Wiring: real migrated SQLite (`createMigratedTestDb`) because every assertion here is about what landed in which table in what order; queue rows are seeded with `db.raw` directly, since the producer (`useScrobble.ts`) is a separate scope. `../clients/navidrome` is mocked with `importActual` spread so **`SubsonicError` stays the real class** - the hook's permanent-error branch gates on `instanceof`, so a look-alike would test nothing. This hook calls `useQueryClient()`, so it needs a real `QueryClientProvider` (unlike `useLibrarySync`, which takes the client as an argument) - that is now two of three hook tests hand-rolling a client, so the `renderHookWithProviders` lift is overdue.

Two harness traps cost real time and are worth knowing before the next hook test:
- **RTL auto-cleanup does not run.** `vitest.config.ts` has no `globals: true`, so `@testing-library/react` cannot register a global `afterEach` and every test leaves its hook mounted. Invisible until this file dispatched a window event and got one flush per *earlier test in the file*. This file calls `cleanup()` explicitly; the other hook tests are still leaking, logged in `donow.md`.
- **React Query's `onlineManager` subscribes to the same `window "online"` event the hook uses**, so counting `addEventListener("online", ...)` calls counts its listener too. The three listener assertions fire the event and observe the effect instead of counting the bookkeeping.

| File | Covers |
|---|---|
| `src/features/playback/hooks/useScrobbleFlush.test.ts` (new, 33 tests) | **Drain**: every row sent once and the queue emptied; oldest-first (`ORDER BY timestamp`); the exact `scrobbleTrack` arg tuple, pinning **seconds in the table, milliseconds on the wire** (`* 1000`) and `alt_url` null coerced to `undefined`; a real `alt_url` passed through; a row for another server skipped **and left queued** (`startsWith(server.id + ":")`, which is why `stripServerPrefix`'s throw is unreachable here); a row whose track is gone from the library drains without throwing. **Play counts** (known-issues "A skip fast-path freezes every column only the skipped path writes"): `tracks.play_count` and `albums.play_count` asserted **separately** - asserting only the album column is what let the original bug hide; the write order pinned as `history, delete, track+1, album+1`, so the deliberate post-DELETE placement is a test failure to change, not a comment; a track with a NULL `album_id` still increments its own count; a dropped row increments nothing. **Errors** (known-issues "A drain loop that breaks on any error blocks on its first permanent failure"): code 70 drops the row and keeps sending, with history proving the dropped row was never actually scrobbled; `it.each([40, 41, 50])` stops at one call and keeps the whole backlog and invalidates nothing; `code: null` and an unenumerated code (30) both break rather than drop (the three-part `e.code !== null` condition); a plain `Error` (what `callSubsonicVoid` throws on `!res.ok`) breaks; a recoverably-failed row retried on the next tick; a mid-batch db failure swallowed to one `console.error` with the row still queued and no count moved. **In-flight guard**: a held `scrobbleTrack` promise survives three interval ticks at one call; an `online` event during a flush adds nothing; `online` flushes when idle. **Invalidation**: exactly 3 calls in exactly the `QK` key order; none when the queue was empty; none after unmount, while the in-flight row still completes its writes and the *next* row is skipped (the `cancelled` check sits at the loop top, not after the await). **Lifecycle/waste**: nothing armed without a server; immediate flush at mount, not at t+60s; one flush per tick; exactly one interval and one live listener across two re-arms with fresh object identities; teardown on unmount and on the server going away, then re-arm on its return; a tick over an already-drained queue reads once and writes nothing. |

Probes proven falsifiable: three separate mutations of the hook (code 70 no longer permanent; the `flushing` guard removed; `tracks.play_count` incremented by 0) each turned exactly the intended tests red and nothing else, then were reverted.

**Follow-ups this pass created (found, not fixed - out of scope):** two, both in `instructions/donow.md` with provenance. Headline: the RTL-cleanup gap above is repo-wide, not specific to this file.

### Landed 2026-08-11 (read-hook family pass: useTracks/useAlbums/useArtists/useGenres/useAllTracks)

`pnpm test:run` 770 -> **799 tests / 40 files**. No Rust touched. None of these five hooks use React Query - all were migrated to the "psysonic pattern" (plain `useEffect`/`useState` over a per-domain Zustand session store, `invoke("get_*")` against the rusqlite read path in `library_read.rs`, already unit-tested there). The plan bullet's "query key shape" doesn't apply literally; the equivalent surface is each store's cache key/`refreshTick` and its `bumpRefresh()`, which stands in for `queryClient.invalidateQueries`.

`useGenres.ts` turned out to hold two hooks sharing one store (`useGenres`, `useRecentGenres`) with real asymmetries: `useGenres` has no `error` state at all (a failed read is silently indistinguishable from "no genres yet" - flagged, not fixed, see follow-up below); `useRecentGenres` has no `enabled` gate and derives an extra `genres = data ?? []` memo, so `genres` reads `[]` during loading while `data` is still `undefined`.

All five files add `afterEach(cleanup)`, per the leak already logged from the `useScrobbleFlush` pass: without it, a hook mounted by an earlier test in the same file stays subscribed to the module-singleton session store and refires on a later test's `bumpRefresh()`, inflating that test's invoke count (caught here as 3-5x expected call counts before the fix).

| File | Covers |
|---|---|
| `src/hooks/useTracks.test.ts` (new, 6 tests) | Null `albumId` clears state without invoking. Switching albums clears `data` immediately, before the new fetch resolves (the loading-gap behavior). `isLoading` true synchronously on mount when `albumId` is non-null. A stale response is dropped when `albumId` changes again before the first invoke resolves (`cancelled` flag). Same `albumId` + tick bump still refetches (this store has no row cache, unlike the other four). Error sets `error`, leaves `data` undefined. |
| `src/hooks/useAlbums.test.ts` (new, 7 tests) | `enabled=false` skips the fetch and keeps stale data. Cache hit on `(sort, ids, tick)` skips a second invoke across remounts. Mount seeds `data` synchronously from the store cache, before any effect. Store-level: a 9th distinct cache key evicts the oldest; a write under a new tick drops every previously cached key at once. A failed read does not poison the cache (`bumpRefresh` still re-invokes). `AlbumRow.server_id` on a multi-server result is each row's own column, never reconstructed from one active server (known-issues "A mirror not scoped by owner", sharper form - confirmed not reproduced here since `get_albums` selects `a.server_id` off the row). |
| `src/hooks/useArtists.test.ts` (new, 5 tests) | `enabled=false` skips the fetch and keeps stale data. Cache hit skips a second invoke. `bumpRefresh()` is debounced 400ms at the store level (fake timers): three calls inside the window collapse to one tick increment. Fetched rows land in the store cache keyed by tick. Error path. |
| `src/hooks/useAllTracks.test.ts` (new, 4 tests) | `enabled=false` skips the fetch and keeps stale data. Cache hit skips a second invoke. Tick bump triggers a refetch (no debounce here, unlike `useArtists`). Error path. |
| `src/hooks/useGenres.test.ts` (new, 7 tests) | `useGenres`: no `error` state - a failed read just stops loading with `data` left `undefined`; cache hit skips a second invoke; `enabled=false` skips the fetch. `useRecentGenres`: always fetches on mount, no `enabled` gate; `genres` is `[]` while `data` is still `undefined` (loading), and becomes the resolved rows once loaded; both hooks share one `refreshTick`, so a single `bumpRefresh()` invalidates both caches together. |

**Follow-ups this pass created (found, not fixed - out of scope):** one, in `instructions/donow.md` - `useGenres`'s missing `error` state is the same "undefined vs. failure" ambiguity the other four hooks' own comments say they exist to avoid.

### Landed 2026-08-11 (overlay x navigation-source matrix, pulled forward from section 4.5)

`pnpm test:run` 799 -> **815 tests / 41 files**. No Rust touched. First component-render test in the repo (every prior test used `renderHook`, never `render()` of a tree) - confirmed `AppShell.renderContent`'s `searchOpen || searchQuery` branch is still the only piece of local, non-URL state that renders instead of the router (checked `commandPaletteOpen`/`feedbackOpen`/`pendingUpdate`/`remoteNotice` - all render as siblings alongside `AppRoutes`, not instead of it; `App.tsx`'s server-loading/wizard early returns gate before a route exists at all, so nothing to navigate away from). No scope split needed.

`src/app/AppShell.navigation.test.tsx` (new, 16 tests) mounts `AppShell` wired to the *real* `useAppNavigation` + `useClearSearchOnNavigate` inside a `MemoryRouter` - the same composition `App.tsx` uses - rather than unit-testing either hook alone, since the bug class is a composition bug. `AppRoutes`/`PlayerBar`/`CommandPalette`/`SearchResults`/`ScrobbleTracker` are mocked to keep the harness to what's actually under test. Covers: sidebar nav click, command palette (`onNavigate`/`onSelectAlbum`/`onSelectArtist`), player bar (`onNowPlaying`/`onSelectArtist`/`onSelectAlbumById` - the async lookup path), search results' own self-clearing handlers (regression: the original 2-call-site fix), `goBack` via Alt+ArrowLeft/ArrowRight and mouse thumb buttons 3/4, a negative case for plain `ArrowLeft` without Alt, and the documented edge case where re-selecting the *current* route leaves the overlay open (no pathname change, `useClearSearchOnNavigate` can't fire - this is why `SearchResults` still self-clears instead of relying purely on the hook). Verified the probe actually goes red: temporarily commented out `clearRef.current()` in `useClearSearchOnNavigate.ts`, reran, 11/16 failed, restored.

Harness gotcha worth knowing for the next component-render test: `AppShell`'s single `Suspense` boundary wraps `CommandPalette` and the lazy `SearchResults`/`AppRoutes` imports, so the very first render of the whole file paints the fallback (`null`) until each lazy import resolves - and `SearchResults` and `CommandPalette` are *separate* `lazy()` objects, so warming one doesn't warm the other. Fixed with a `beforeAll` that renders once with the overlay closed (warms `AppRoutes`/`CommandPalette`) and once with it open (warms `SearchResults`), each awaited via `waitFor`, before any real test runs synchronously.

### Landed 2026-08-12 (usePlaylistTracks pass: load effect + position compaction)

`pnpm test:run` 815 -> **844 tests / 42 files**. No Rust touched. Closes the section-3 bullet that was mis-filed under `navidrome.ts` (the compaction lives in the hook, not in the thin `songIndexToRemove` sender) and the regression-backlog **[baseline]** entry "`playlist_tracks.position` not compacted". Section 4's baseline hooks are now all green, so the summary checkbox is ticked.

`src/features/playlists/usePlaylistTracks.test.ts` (new, 29 tests). No `QueryClientProvider` - the hook is `useState`/`useEffect` + a zustand selector, its `useServer` import is `import type` and never enters the module graph. No fake timers: `playlistSessionStore` has no debounce. Real migrated in-memory DB via `createMigratedTestDb`, `removeTrackFromNavidromePlaylist` mocked at the boundary.

Load effect: null id returns `[]` with `selectCount === 0` (no DB touch at all); loading/`undefined` distinguishable from loaded/`[]`; `ORDER BY pt.position` against out-of-order inserts; full row-shape assertion incl. the `album_name`/`album_id` aliases; **LEFT JOIN regression** (a track with a NULL `album_id` and a track pointing at a pruned `albums` row both survive, with NULL album columns); the `JOIN tracks` is still inner, so a playlist row whose track was pruned is dropped - pinned as current behavior; `playlist_id` scoping against a same-position sibling playlist on another server; the `prevPlaylistIdRef` contract in both directions (switching playlists blanks to `undefined`, a refresh tick does *not*, and a round trip through `null` re-blanks); tick separation (`bumpPlaylistTracks` re-reads, `bumpPlaylists` does not, asserted by exact `selectCount`); failure keeps the previously loaded rows and clears `isLoading`; a load resolving after unmount writes no state.

`removeTrack`: server-first ordering (a rejected server call leaves `executeCount` unchanged, positions intact, `track_count` intact and **neither tick bumped**); stripped native id + raw 0-based index + `alt_url ?? undefined` passed to the server; `stripServerPrefix` throws before the network call on a foreign-server playlist id. Compaction: middle removal, last removal (both passes match zero rows), only-row removal, a pre-existing hole silently healed, and the **`position 0` case where the first shifted row lands on `-0`** - it is only correct because `0` was just deleted and SQLite's `-0` is integer `0`, so it gets its own test and a comment; any move to 1-based positions breaks it silently. 200-row playlist proves the two negative-space passes never collide with `PRIMARY KEY (playlist_id, position)`. **The regression that matters** asserts the *sequence of remote indexes* across two removals in one session is `[0, 0]`, not `[0, 1]` - the final table state alone cannot prove the remote index was right. Cross-server isolation for all four statements, `MAX(0, ...)` clamp, both ticks bumped exactly once, and the list re-rendering from the compacted table.

Probes proven able to fail: deleting both compaction `UPDATE`s -> 6 red; `LEFT JOIN` -> `JOIN` -> 1 red. Both restored.

Follow-ups this pass created (all also in `donow.md`): `removeTrack` has no transaction, so a throw between the two negative-space passes strands rows at negative positions; `track_count` decrements even when the DELETE matched nothing (pinned as current behavior); the inner `JOIN tracks` is the same bug shape the `LEFT JOIN albums` comment documents, one table over.

### Landed 2026-08-12 (TrackTableView pass: first section-5 component)

`pnpm test:run` 844 -> **882 tests / 43 files**. No Rust touched. Closes section 5's first "High value" bullet and the regression-backlog **[baseline]** entry "Selection stored as row indices". First component test in the repo outside `src/app/`.

`src/pages/TrackTableView.test.tsx` (new, 38 tests). `QueryClientProvider` only - the component imports nothing from react-router, navigation is delegated up through `onSelectAlbum`/`onSelectArtist`. `../db` mocked to a `createMigratedTestDb()` so `useGenreMappings` reads a real `tag_mappings`; `usePlayerStore.setState` swaps the six transport actions for spies (the store is module-level zustand, no provider). `useLoved` is mocked at the hook rather than at its db/network boundary, deliberately: the only loved behavior this bullet needs is that the heart does not also select or play the row. **Harness trap worth reusing:** `@tanstack/react-virtual`'s `calculateRange` returns `null` when the scroll element measures 0px and jsdom reports 0 for everything, so every row virtualizes away and selection assertions pass against an empty list - `offsetHeight`/`offsetWidth` are stubbed on `HTMLElement.prototype` in `beforeAll`. `localStorage.clear()` per test or the column config leaks between tests.

Covers: the four render branches and their precedence (`isLoading` beats `error`, `tracks === undefined` vs `[]` distinguished by the header count); default artist-ascending sort; all 8 clickable sort columns asc and desc plus the direction flip; nulls last in *both* directions; genre header is a `<span>` with no sort control; sort clears the selection. Selection: plain click plays and clears, ctrl-click selects without playing and toggles off, meta-click identical, shift ranges inclusively in both directions and unions rather than replaces, Escape clears, Enter plays from the row's own index, and unhandled keys (Arrow/Home/End/Space) move nothing. Across a refresh: reorder, prune, and identity-only change all keep the right *tracks* selected. Context menu (portaled, queried off `document`): single vs bulk at the `>= 2` boundary, bulk queue built in visible order, "Play Now" resolves the row's index by id, nav items hidden per callback and per null artist, "Clear selection". Plus corrupt-`localStorage` fallback and one column-toggle persistence round-trip.

**Three bugs found and fixed test-first** (all four failing tests confirmed red against the unfixed component first): (1) the shift-range anchor was still `useRef<number>` while the selection had already been re-keyed to ids, so a refresh re-pointed it - now `lastClickedIdRef` resolved through `sorted.findIndex` at use time; (2) a shift-click with no anchor fell through to the playback branch, so a first-interaction shift-click started a song instead of selecting; (3) `bulkTarget` gated on `selectedIds.size >= 2`, and pruned ids never leave the set, so a two-row selection that lost a row opened a bulk menu reading "Play 1 tracks" - the gate now counts selected rows present in `sorted`. New `known-issues.md` entry with a `**Generalizes:**` line and two greps; both greps run clean elsewhere in `src/`.

**Deliberate split, still unchecked:** virtualizer row-count bounds for a large library, column-picker breadth, and per-row render cost are one scope with `AlbumGrid`'s section-5 bullet (they share the `offsetHeight` stub and a virtualizer harness), not with selection semantics.

Follow-ups this pass created (all also in `donow.md`): the column-picker popup's outside-close listener is the unfixed shape of the WebKitGTK self-close class; `duration`/`bit_rate` render blank for a legitimate `0` while `year`/`play_count` render `0`; the error state's "Try again" button renders with no handler when `onRetry` is omitted; there is no arrow-key row navigation.

### Landed 2026-08-12 (AlbumGrid pass: second section-5 component, and the known-issues geometry instance closed)

`pnpm test:run` 898 -> **946 tests / 45 files**. No Rust touched. Closes section 5's `AlbumGrid` "High value" bullet, section 4.6's "AlbumGrid virtualizer renders a bounded number of rows" bullet, and the **open instance** flagged in `known-issues.md` under "A geometry constant in TS restating a CSS value drifts silently".

`src/components/AlbumGrid.test.tsx` (new, 48 tests). `QueryClientProvider` only. `../db` mocked to a `createMigratedTestDb()` (`useAlbumCoverMap` and `useFailedLookupAlbumIds` run for real against it); `useLoved` mocked at the hook as in `TrackTableView.test.tsx`; **`useSetting` mocked wholesale** to a map the file owns, because its module-level `settingCache` outlives a test's database and would carry `albums.pagination` from the pagination tests into everything after them.

**Harness traps, all new relative to the TrackTableView stubs and worth reusing for any grid:** jsdom has no `ResizeObserver` at all, and `AlbumGrid` constructs one directly to measure its own width, so without a stub the component throws on mount. `offsetWidth` must be stubbed as well as `offsetHeight` - at width 0 the grid silently collapses to a **1-column** layout and every row-chunking assertion tests the wrong shape (900px gives 4 columns, 203px cards, a 227px row pitch, all asserted explicitly so a constant change fails loudly with a number). jsdom has no `Element.scrollTo` and virtual-core calls it optionally (`?.`), so an unstubbed scroll assertion passes against a call that never happened. And the one that actually hid the bug: every scroll target is clamped by `getMaxScrollOffset()`, which virtual-core reads as `scrollHeight - clientHeight` off the real element - both 0 in jsdom, so **every** jump lands on 0 and a broken and a fixed implementation are indistinguishable. `scrollHeight` is stubbed as a getter deriving from the sizing div's inline height so the clamp still tracks real content. The virtualizer also re-applies a pending scroll on each render, so the jump helper clears the spy immediately before the click and then asserts exactly one call.

Covers: all four render branches and their precedence - **error beats loading here**, the opposite of `TrackTableView`, because a failed read leaves `isLoading` true and a skeleton would pulse over the failure forever; both "keeps rows on screen" halves (failed background refresh, refresh over existing rows); caller `emptyMessage` vs the default teaching one; retry present and absent. Row chunking at 1 / `cols` / `cols + 1`, the grid template, the re-measure path that only fires when albums arrive after an empty first render, and year-sort grouping (one header per year, `Unknown` for a null year, a year run longer than one row splitting under a single header). Virtualization: 10400 albums render exactly 7 row divs, the sizing surface covers every row plus padding, rows sit one pitch apart. Scrubber sections: hidden for no sort / `recently_added` / a single section / while paginated; artist vs alphabetical source; the album-name fallback for a null artist; lowercase uppercased and non-`[A-Z]` (digits *and* accented initials) bucketed to `#` without duplicating the section; **only `row.items[0]` seeds a label**, so a letter starting mid-row gets no button (pinned as current behavior); decade bucketing keeping the first year, `Unknown` passing through. Card interaction (click/Enter open, other keys inert, heart does not also open the album), the context menu's per-prop gating incl. the `playlists.length > 0` boundary, and pagination at exactly `PAGE_SIZE` vs past it.

**One bug found and fixed test-first** (four tests confirmed red against the unfixed component, each off by exactly 20px): `AlbumGrid` painted rows at `PADDING + virtualRow.start` and sized the surface at `getTotalSize() + PADDING * 2` while never telling `useVirtualizer` about the padding, so the virtualizer's coordinate space started 20px above the one rows were painted in and the A-Z scrubber's `scrollToIndex` parked its target row under the top edge. Fix: `paddingStart`/`paddingEnd` on the virtualizer, hand-added offsets dropped. **Fixed as a class:** the same shape was live in `ArtistGrid.tsx` (no scrubber today, so no visible symptom yet) and was fixed in the same commit; `SearchResults`/`PlaylistList` were checked and are correct - they declare their `scrollMargin` to the virtualizer. Sharper known-issues entry written under the geometry heading with a `**Generalizes:**` line and a two-part grep.

Follow-ups this pass created (all also in `donow.md`): `ArtistGrid` has no test file, so its copy of the fix is unpinned; the `cols === 0` guards in `rows`/`scrubberSections` are dead code behind `Math.max(1, ...)`; the scrubber indexes only the first album of each row, so a letter starting mid-row is unreachable from the index; `.album-grid`'s CSS `padding: 16px` and `minmax(190px)` restate `PADDING = 20` / `CARD_MIN = 190` at different values, but the class is dead in the virtualized path.

### Landed 2026-08-12 (ESCAPE regression pass: the last open [baseline] regression that was purely a test gap)

`pnpm test:run` 882 -> **898 tests / 44 files**. No Rust touched. Closes the regression-backlog **[baseline]** entry "`ESCAPE '\'` in a template literal" and the `useSearch` pass's mis-filed follow-up ("`nowPlayingQueries.test.ts` has no `ESCAPE` coverage"). No production code changed: the three clauses at `nowPlayingQueries.ts:66-68` are already correct, the gap was that nothing would notice if they stopped being.

`src/features/playback/lib/nowPlayingQueries.test.ts` (+7 tests in a new describe). `../db` mocked to a `createMigratedTestDb()`, `./lastfm` mocked wholesale; `fetchArtistTopTracks` resolves `[]` so the **fallback** branch runs, which uses the same `artistMatch` fragment as the intersected branch with one `select` and a deterministic `ORDER BY t.track_number, t.title`. Covers: `_` in the artist name is a literal, not a single-char wildcard (`A_C` must not pull `ABC feat. Other`); `%` likewise (`100%` must not pull `1000 feat. Other`); an artist name containing a backslash matches (the case a naive `replace(/[%_]/g, ...)` breaks, since `escapeLike` puts `\` in its own char class); a name *ending* in a backslash does not leave a dangling escape char; all three collaboration spellings match while `Burialist feat. Someone` and `Burial Mix` do not; empty artist name runs and matches only the empty-artist row rather than everything.

**One assumption corrected against the source:** the three patterns are asymmetric - `feat.%` and `ft.%` have no space before the wildcard, `featuring %` does. So `Burial feat.` (no guest) matches, `Burial featuring` misses, and `Burial featuring ` (trailing space, `%` matching empty) matches. Pinned as-is.

`src/lib/sqlEscaping.test.ts` (new, 9 tests). This is the class-level half, and the reason the entry is closed rather than half-closed: the broken spelling reads correctly in source, so only the *decoded* string is wrong. `decodeSingleQuoted` walks a JS single-quoted literal the way the parser would and is itself tested against both spellings, so the scanner cannot be regressed into a naive regex. Over every non-test `.ts`/`.tsx` in `src/`: every `ESCAPE '...'` literal decodes to exactly one character, and specifically to a backslash; a non-zero-sites assertion so the sweep cannot pass by matching nothing; a real better-sqlite3 assertion that `ESCAPE ''` throws at prepare time while `ESCAPE '\'` returns 1 (this is what makes the failure mode *total*, not input-dependent - one dropped backslash kills the About tab and its prefetch on every call). Plus a `LIKE ?`-without-`ESCAPE` sweep with an explicit exemption set (`features/radio/hooks/useRadio.ts`, `features/sync/sync.ts` - five sites, all binding `${server.id}:%` where ids are `crypto.randomUUID()`), and a reverse test asserting each exemption is still needed, so the list cannot rot into permission for a genuinely new offender.

Probe proven able to fail: rewriting the three clauses in `nowPlayingQueries.ts` to `ESCAPE '\'` turned 9 tests red across both files (the guard by decoding, the behavioral tests by SQLite refusing to prepare). Restored.

Follow-ups this pass created (both also in `donow.md`): `smartPlaylist.ts:84-93` carries its own inline copy of `escapeLike`'s regex, which is the shape known-issues calls "held separately they drifted"; and the five `LIKE ?` sites binding `${server.id}:%` are unescaped by luck (UUIDs), including two `DELETE`s that would over-delete if id generation ever changed.

**Not covered here (deliberate, separate scope):** the rest of `nowPlayingQueries.ts`'s behavior - the Last.fm intersection ordering and its 10-cap, the duplicate-title Map collapse, `fetchSuggestedTracksForNowPlaying`'s early return / `IN` placeholders / `random()` ordering, and `fetchArtistAlbums` entirely.

### Landed 2026-08-13 (ContextMenu pass: first section-5 "High value" item after TrackTableView/AlbumGrid)

`pnpm test:run` 946 -> **955 tests / 46 files**. No Rust touched, no production code changed. Closes `docs/tests.md`'s `ContextMenu` bullet.

`src/ui/ContextMenu.test.tsx` (new, 9 tests). Fake timers throughout; the menu is queried via `document.querySelector(".context-menu")` because `createPortal` mounts it on `document.body`, not inside RTL's `container` (one test pins that portal placement directly, since every other test depends on it). Covers: the WebKitGTK self-close regression (a `mousedown` fired in the same tick as mount does not close the menu, because the listener attach is deferred behind `setTimeout(0)`); a later outside mousedown, after `advanceTimersByTime(0)`, does close it; a mousedown *inside* the menu does not (containment check, not `stopPropagation`); the full `mousedown` **then** `click` sequence on an item fires the item handler and leaves the menu open; `Escape` closes while `Enter`/`ArrowDown` do not; scroll closes; the `onCloseRef` indirection means a re-render's newer `onClose` is the one called, not the one captured when the `[]`-dep effect attached; and unmount inside the deferred-attach window leaks no document listener.

**Three probes proven able to fail, each caught by exactly one test and nothing else:** attaching the listeners synchronously instead of via `setTimeout` (regression test red); calling the `onClose` prop instead of `onCloseRef.current` (stale-closure test red); deleting `clearTimeout(timer)` from the cleanup (leak test red).

**One test was wrong on the first attempt and is worth recording.** The unmount-leak case originally asserted `onClose` was not called after unmount + timer advance. That version passed with `clearTimeout` deleted, i.e. it could not fail: React nulls `menuRef.current` on unmount, so the leaked handler's `if (menuRef.current && ...)` guard swallows the call, and the leak is invisible from the callback side. It now spies on `document.addEventListener` and asserts no `mousedown`/`keydown`/`scroll` registration happens at all. **Generalizes to any component in this repo that pairs a deferred listener attach with a ref-null-on-unmount guard: asserting the callback did not fire tests the guard, not the teardown. Assert on the registration.**

**Not covered here (deliberate, out of scope for this pass):** `ContextMenuSubmenu` entirely (hover open/close, and the hardcoded 180px/220px `flipLeft`/`flipUp` thresholds - it has no outside-click logic of its own, so it is not part of the regression this bullet targets); `ContextMenu`'s viewport-clamping `useLayoutEffect` (jsdom reports a zero-size rect, so forcing the overflow branch needs `getBoundingClientRect` mocked - real logic with `Math.max(0, ...)` edges, worth its own pass).

Follow-up this pass created (in `donow.md`): `useClickOutside` solves the same problem as this component and has none of its hardening - no deferral, no capture. Latent rather than live, because all 7 consumers open on `onClick` and the hook is non-capture; the write-up explains why that distinction is what keeps it from reproducing.

### Landed 2026-08-13 (CommandPalette pass: the debounce regression, second section-5 item this day)

`pnpm test:run` 955 -> **972 tests / 47 files**. No Rust touched, no production code changed. Closes `docs/tests.md`'s `CommandPalette` bullet.

`src/components/CommandPalette.test.tsx` (new, 17 tests). Real `QueryClientProvider` over a real `createMigratedTestDb()`, so `useSearch`'s actual FTS5 pipeline runs and the query counts below are counts of real SQL. Fake timers throughout. `useSetting`/`useBoolSetting` mocked with a map (as in `AlbumGrid.test.tsx`) because `useAlbumDisplayName` reads four settings per render; `HTMLElement.prototype.scrollIntoView` stubbed in `beforeAll` because jsdom does not implement it and the focus effect throws on mount without it.

Covers: the empty-query nav grid renders its six commands and fires **zero** selects; the debounce boundary (no query at 149ms, exactly **3** selects - albums/tracks/artists - at 150ms); a five-keystroke burst at 50ms intervals settling to **3** selects total rather than 15; reopen clearing `deferred` as well as `raw`, so the previous session's rows do not paint for 150ms; async input focus on open; arrow clamping at both ends (`Math.min`/`Math.max`, not wrap); Enter activating the focused item and closing; Enter on zero results being a silent no-op that does **not** close; Escape closing without activating; activation on `mousedown` and specifically **not** on `click` (the handler `preventDefault`s so the input never blurs); backdrop mousedown closing while a mousedown inside the modal does not (target-identity check, not `stopPropagation`); the empty and error branches, with the error branch winning outright over the rows `placeholderData` is still holding; and album/track/artist selection each calling exactly one callback, the album carrying the **row's own** `server_id`.

**The debounce probe is proven able to fail.** Replacing the `setTimeout` in `CommandPalette.tsx` with a bare `setDeferred(trimmedRaw)` takes the pre-settle count from 0 to **15** - three selects per keystroke - failing both the burst test and the boundary test and nothing else. That is the shape `known-issues.md` records under the FTS `LIMIT` entry ("`useDeferredValue` defers rendering, not fetching; gating a `queryKey` with it still fires per keystroke"), so this bullet's regression obligation is discharged against a probe that actually moves.

**Two fixture traps worth recording.** (1) An album with no track on it is invisible to search at any query, because `runSearch` matches `tracks_fts` and reaches `albums` only by joining through `tracks` - the first draft seeded bare albums and three tests failed for that reason rather than for anything about the palette. `seedFindableAlbum` now attaches a filler track whose title and null artist score zero, so the album is the only row that scores. (2) `await act(async () => vi.advanceTimersByTime(150))` is not enough to settle the query: the fetch only *starts* inside that flush. `vi.advanceTimersByTimeAsync` plus a second zero-advance act is what lets a resolved - or rejected - select reach `data`/`isError`.

**Not covered here (deliberate):** the Ctrl/Cmd+K trigger, which lives in `App.tsx:245` and toggles `commandPaletteOpen`, not in this component - it belongs with the section 4.5 shell tests, not here; hover-to-focus (`onMouseEnter` setting `focusedIdx`) beyond what the mousedown tests touch; the `scrollIntoView` call itself, stubbed to a no-op.

Follow-ups this pass created (in `donow.md`): the Ctrl/Cmd+K toggle has no test anywhere; `activate`'s dep array lists `serverWithCredential`, which its body does not read.

### Landed 2026-08-15 (section 4.5: the second overlay-dismissal mechanism, picked because the acceptance ratio was 1/48 files = 2%)

`pnpm test:run` 972 -> **976 tests / 47 files**, acceptance still **1/47 = 2%** (this pass extended the one existing acceptance file rather than adding a second, so the ratio did not move). No Rust touched, no production code changed. Closes section 4.5's "Re-selecting the route already open" bullet.

`src/app/AppShell.navigation.test.tsx` (+4 tests, new second `describe`). Same harness as the existing block: real `useAppNavigation` + real `useClearSearchOnNavigate` under `MemoryRouter`, `AppRoutes`/`PlayerBar`/`CommandPalette`/`SearchResults` stubbed to one testid'd button per navigation callback, no timers, no DB.

Covers the split between the two dismissal mechanisms, each pinned against the case only it can handle: `SearchResults`' album and artist rows dismissing the overlay when that album's/artist's route is **already open** (identical pathname string, so `useClearSearchOnNavigate`'s ref guard short-circuits and only AppShell's per-call-site `clearSearch()` can fire); a command-palette selection, which has no `clearSearch()` of its own, dismissing purely via the hook on a pathname change; and the Library sidebar item clicked from `/album/*`, where `useAppNavigation` folds detail routes into their browse view so the item renders active yet the click is still a real pathname change - which is what makes the no-mechanism gap narrower than "the active sidebar item".

**Both probes proven able to fail, and the result is the point of the pass.** Deleting `clearSearch()` from AppShell's `onSelectAlbum` wrapper reds **exactly one** test - the new same-route one. The pre-existing `"search results' own onSelectAlbum handler still self-clears (regression: fixed once already)"` test stays **green**, because it runs from `/library` where the pathname changes and the hook masks the deletion. So before this pass the per-call-site `clearSearch()` could have been deleted with a fully green suite, which is precisely the "simplified away as redundant" outcome the bullet was written to prevent. Mirror probe: forcing `useClearSearchOnNavigate`'s guard to always bail reds 13 tests and leaves the two same-route tests green.

**Not covered here (deliberate, and it is the other half of this bullet's neighbourhood):** section 4.5's Ctrl+K / Ctrl+F focus-guard bullet cannot live in this file. The listener under test is in `App.tsx`, and this file's `Inner` harness reimplements `searchOpen`/`clearSearch` locally and installs no keydown listener at all. It needs either a new file mounting the real `App` (heavy boundary surface: `useServers`/`getDb`/`invoke`/`listen`/react-query/`checkForUpdate`/`fetchRemoteNotice`) or the handler extracted first. That is a separate scope, and it is a **bug reproduction**, not new coverage - see below.

Follow-ups this pass created (in `donow.md`): the same-route inert-click gap for the sidebar, command palette and player bar (no mechanism applies, and `AppShell.navigation.test.tsx:287` currently pins that as expected); `App.tsx`'s keydown handler has no focus guard at all, confirmed open.

### Landed 2026-08-15 (SmartPlaylistModal, and the backdrop-dismissal class behind it)

`pnpm test:run` 976 -> **1030 tests / 49 files**, acceptance still **1/49 = 2%**. Two production bugs fixed, both with a `known-issues.md` entry and a grep tell. Closes section 5's `SmartPlaylistModal` bullet.

`src/features/playlists/SmartPlaylistModal.test.tsx` (47 tests). The component is not what the bullet's wording describes: there is no rule list, it is a fixed-shape form over the 11 named fields of `SmartFilters`, and it imports neither `parseSmartFilters` nor `buildSmartQuery` - the callers do. So the round-trip proved here is `parseSmartFilters` output -> mount -> edit -> `onSave` argument still being a `buildSmartQuery` input that selects the same tracks, against the migrated in-memory DB. Also: initial-filters hydration, save disabled until the name is non-empty (the only validation), genre chip add/remove and include/exclude mode, numeric clamping at both ends of limit and year, the portal target, autofocus, and every dismissal path.

**Two bugs it caught, both real, both fixed here:**
1. `SmartPlaylistModal.tsx:100` clamped the limit with `Number(e.target.value) || 50`, so a typed `0` took the falsy branch to 50 and the `Math.max(1, ...)` beside it was dead code. Now branches on the empty string before coercing.
2. Every portal modal dismissed its backdrop on bare `onClick={onClose}` with a `stopPropagation` on the dialog. A drag that starts inside the dialog (selecting text in an input) and releases over the backdrop fires the click on their common ancestor and threw the half-filled form away. Fixed as a **class**, not an instance: `src/ui/useOverlayDismiss.ts` requires press *and* release to target the backdrop, and is spread onto all 5 sites (`SmartPlaylistModal`, `IdentifyDialog` x2, `ArtistMergeModal`, `TagDrawer`).

`src/ui/useOverlayDismiss.test.tsx` (7 tests). Press+release on the backdrop closes; drag out of the dialog does not; inside-only click does not; a rejected drag does not disarm the next legitimate backdrop click; a click with no press before it does not close; the memoized handlers call the *latest* `onClose` after a re-render (ref, not stale closure) and keep one identity across renders. **Probe proven able to fail:** dropping the press check from the hook reds exactly 3 of the 7.

Not covered: `IdentifyDialog`, `ArtistMergeModal` and `TagDrawer` still have no test file of their own - their dismissal is covered only through the shared hook, and their remaining behavior is untouched (section 5 "Medium" still lists them).

### Landed 2026-08-15 (section 4.5: the Ctrl+K / Ctrl+F / Escape focus guard - a bug fix, and the second acceptance file)

`pnpm test:run` 1030 -> **1043 tests / 51 files**, acceptance **2/51 = 4%** (first new acceptance file since the harness was built). Closes section 4.5's keyboard bullet. Production code changed: `App.tsx`, `useGlobalShortcuts.ts`, plus two new files.

**This was a bug, not a gap.** `App.tsx:243-264` registered a window keydown listener with no focus test of any kind, and both branches call `preventDefault()`, so Ctrl+K and Ctrl+F did not merely fire while the user was typing - they *ate* the keystroke. Per CLAUDE.md the reproduction came first: of the 7 tests in the new file, **3 were red against the unfixed handler** (Ctrl+F firing from the command palette's own input; Escape from an unrelated field wiping the search box; and the listener count going 2 -> 6 over four state changes, because the effect's deps were `[searchRaw, searchOpen, clearSearch]`). The other 4 pinned behavior that already worked and had to survive the fix.

`src/app/App.keyboard.test.tsx` (7 tests). **Mounts the real `App`** under a `retry: false` client and `MemoryRouter`, with a migrated in-memory DB holding one `servers` row (without it App renders the Wizard, not the shell). Boundaries mocked: Tauri `invoke`/`listen`, `getDb`, keychain, `checkForUpdate`, `fetchRemoteNotice`. Two non-boundary stubs, deliberate and noted in the file: `AppRoutes` and `PlayerBar`. `AppShell`, its search bar and `CommandPalette` are **real**, because the question the file asks is which of two real inputs owns a keystroke.

`src/features/search/useSearchShortcuts.ts` (new) holds the handler; `src/lib/keyboard.ts::isTextEntryTarget` (new) is the shared guard, now also used by `useGlobalShortcuts`, which had the only correct copy and kept it private. The guard is **per branch** - a blanket bail would cost Ctrl+K its close-the-palette half and strand the search overlay open on Escape. `src/lib/keyboard.test.ts` (6 tests) covers input/textarea/select/contenteditable/plain element/null target.

Also fixed in passing: `e.key === "k"` was case-sensitive, so CapsLock disabled the shortcut.

**Not covered here (deliberate):** the Escape branch reads `searchRaw || searchOpen` while `AppShell.renderContent` opens the overlay on `searchOpen || searchQuery` - not reachable through the current writers but one edit from an overlay Escape cannot dismiss; left in donow.md. Also untouched: modal/overlay stacking (the next 4.5 bullet), and `/album/:id` for a missing id.

### Landed 2026-08-17 (section 4.5: modal/overlay stacking - a bug fix, and the third acceptance file)

`pnpm test:run` 1043 -> **1054 tests / 52 files**, acceptance **3/52 = 6%**. Closes section 4.5's stacking bullet; the modal-chrome half of that bullet was split off unchecked (see below). Production code changed: `useSearchShortcuts.ts`, `App.tsx`. No Rust touched.

**This was a bug, not a gap.** `useSearchShortcuts.ts`'s Escape branch decided from `searchActive` plus a focus test and knew nothing about what was painted over the search overlay - despite the hook already receiving `commandPaletteOpen` and using it in the Ctrl+K branch ten lines above. The palette's Escape listener is on `window`, registered only while open, so it runs *after* the app-lifetime search listener; `FeedbackModal`'s is on `document`, so it runs *before*. Neither stops propagation, so one press closed the top layer **and** discarded the search query underneath it. Reproduction came first: **2 of the 10 tests were red against the unfixed hook**, and the 11th (the feedback modal) was added after and verified red by narrowing the guard to name only the palette, then restored. The remaining 8 pinned behavior that already worked and had to survive the fix.

Fix: an `overlayAbove` option (`commandPaletteOpen || feedbackOpen`) checked *before* the focus test, so the bottom layer stands down while anything covers it. Deliberately not "is the palette open" - the feedback modal is the second instance and the harder one (document phase), and naming only the palette would have left it broken. New `known-issues.md` entry: "An overlay's own Escape handler answers 'am I open', never 'am I on top'".

`src/app/App.overlayStacking.test.tsx` (11 tests). Same harness as `App.keyboard.test.tsx` (real `App`, `retry: false` client, `MemoryRouter`, migrated in-memory DB with one `servers` row; boundaries mocked, `AppRoutes`/`PlayerBar` stubbed, `AppShell`/search bar/`CommandPalette`/`FeedbackModal` real), plus a `@tauri-apps/api/app` `getVersion` mock the feedback modal needs. Covers: both overlays rendered at once with the route swapped out (asserted on its own, so a guard change making the palette unreachable from the overlay fails loudly rather than emptying the file); Escape from the palette input, from `body`, and from the search input *underneath* the palette - the last two were the red ones; the second Escape unwinding to the search layer; Escape with only the palette open; Escape from a stray field; the feedback modal over search; palette backdrop mousedown; a drag from `.cp-modal` releasing on `.cp-backdrop` **not** closing (regression for the backdrop-gesture known-issue); Ctrl+K toggling the palette shut without touching search.

Reaching the stack takes a blur - Ctrl+K bails from a text field and Ctrl+F focuses the search input - so the setup order is always Ctrl+F, blur, Ctrl+K. That awkwardness is current behavior and is noted in the file's header, not asserted as desirable.

**Not covered here (deliberate):** `Alt+ArrowLeft` history navigation dismisses the search overlay via `useClearSearchOnNavigate` but strands the command palette painted over the new route - real, out of this scope, in donow.md. Likewise a palette item resolving to the already-open pathname closes the palette but strands the search overlay (`useClearSearchOnNavigate` cannot fire without a pathname change, and the palette's four handlers, unlike `SearchResults`', do not call `clearSearch` themselves). Also unasserted: paint order itself (jsdom has no z-index), and `CommandPalette`'s own listener churn (its effect deps include a per-render `items` array, so it re-registers on every keystroke - donow.md).

### Landed 2026-08-17 (section 4.5: modal chrome and the open-modal registry - a bug fix, and the fifth acceptance file)

`pnpm test:run` 1062 -> **1088 tests / 55 files**, acceptance **5/55 = 9%**. Closes section 4.5's last unchecked bullet, so section 4.5 is now fully ticked. Production code changed: new `src/ui/useModalChrome.ts`, plus `SmartPlaylistModal.tsx`, `ArtistMergeModal.tsx`, `IdentifyDialog.tsx` (both exports) and `App.tsx`. No Rust touched.

**This was a bug, not a gap**, and the file itself had recorded the bullet as "not an acceptance scope" - which was half right. The three leaf modals having no Escape and no focus trap is a leaf concern; the *reason it could not be fixed at the leaf* is a composition one. `SearchResults` mounts `AlbumIdentifyDialog` inside the search overlay, and the overlay's Escape owner (`useSearchShortcuts`) stands down only for the two overlays `App.tsx` names by hand in `overlayAbove`. That list is written in a component that is an ancestor of the dialog's state by three levels and can never see it, so the previous fix for "an overlay's own Escape handler answers 'am I open', never 'am I on top'" was structurally unable to cover this instance. One press cleared the search and took the half-filled dialog with it. Reproduction came first: **2 of the 4 acceptance tests were red** against unfixed code, for the right reasons (the whole overlay gone rather than just the dialog; and Escape from a dialog field doing nothing at all, since `useSearchShortcuts:91` correctly bails for a non-search input and the dialog had no handler). The other 2 are positive controls, including "Escape still dismisses the overlay when no modal is open", which is what stops a fix that just widens `overlayAbove` to always-true.

Fix replaces the hand-written list with a module-level ordered **open-modal registry** in `useModalChrome`: every modal registers on mount, `useAnyModalOpen()` is read in `App.tsx` as `overlayAbove`'s third term, and only the *topmost registered* modal acts on Escape. Deliberately not `stopPropagation` - known-issues rejects that mechanism outright, and five existing `document`-phase handlers would break. Deliberately not lifting dialog state into `App.tsx` - that is a bigger change than the bug and leaves the next modal to reopen it. The registry is ordered rather than counted because the Escape branch needs to know *which* modal is on top, and registration is keyed to the mount rather than to the dialog node, so a re-render that swaps the element cannot briefly empty it.

`src/ui/useModalChrome.test.tsx` (20 tests). Escape: closes once; closes from a text field inside the modal (a deliberate product call - these are form fields, unlike `PlaylistDetail`/`TagTreeTab`'s rename inputs which own Escape to revert, which is why the hook scopes to the modal container instead of installing a window guard); stands down while `closable: false` (the save-in-flight gate, matching a Cancel button already disabled for the same reason) and re-arms when it flips back; topmost-only across a two-modal stack; hands Escape back to the layer beneath after the top one unmounts. Registry: open while mounted, closed after unmount, stays open while any of a stack remains, survives a dialog-node swap. Focus: moves in when nothing inside holds focus, leaves an `autoFocus`ed field alone, wraps Tab and Shift+Tab at the two ends, leaves interior Tab to the browser, skips `disabled` controls, restores to the opener on unmount, falls back to `document.body` when the opener was removed while the modal was open (the normal `IdentifyDialog` path - the opener is a `ContextMenu` item and the menu unmounts on select). Markup: `role="dialog"` + `aria-modal`. Waste: exactly one keydown listener added per mount and one removed on unmount; zero re-registrations across three prop changes, since `onClose`/`closable` are read through refs. **Probes verified**: deleting the topmost-identity check reds the two stacking tests, and adding `closable`/`onClose` to the listener effect's deps reds the re-registration test.

`src/app/App.modalInOverlay.test.tsx` (4 tests, new acceptance file). Same seven boundary mocks as `App.overlayStacking.test.tsx`, plus `@tauri-apps/plugin-opener` and `../clients/musicbrainz` (network boundary, stubbed to empty results). Two harness details that cost time and will cost it again: `SearchResults` windows each section with `useVirtualizer` and measures columns off `el.clientWidth` through a raw `ResizeObserver`, so jsdom renders **zero** album cards without the `AlbumGrid.test.tsx` layout stubs; and the FTS round trip has to be awaited inside `act`, not left to `waitFor`, or the result never commits. `tracks_fts` is seeded directly (production writes it from `sync.ts`), and the whole describe carries `{ timeout: 20000 }`. The path driven is the real one: Ctrl+F, type, right-click the album card, "Identify on MusicBrainz…".

`src/features/playlists/SmartPlaylistModal.test.tsx` had one test **deliberately rewritten**: "does nothing on Escape, and traps no focus" was pinning these three absences and predicted its own death ("when that lands, this test goes red and has to be rewritten deliberately"). Replaced by three tests asserting the modal is wired to the hook - Escape closes, the dialog is exposed under its own title, and the `autoFocus`ed Name field keeps focus.

**Not covered here (deliberate):** `TagDrawer`, `TagTreeTab`'s `NodeModal` and `FeedbackModal` are the same class and are not converted - `TagDrawer` and `FeedbackModal` have hand-rolled Escape handlers that predate the hook and none of the three has a trap, and `FeedbackModal` is additionally an **open instance of the already-fixed backdrop-gesture bug** (raw `onClick` + target identity, no `useOverlayDismiss`). All in donow.md. Also untouched: `UpdatePrompt`, which has no keyboard dismissal at all and arguably should not. `HomeView`'s second `SearchResults` mount site is not exercised; its search text is `homeSearchRaw`, which never feeds `searchActive`, so Escape there was inert before this change and is inert after it.

### Landed 2026-08-17 (section 4.5: the album route's blank page - a bug fix, and the fourth acceptance file)

`pnpm test:run` 1054 -> **1062 tests / 53 files**, acceptance **4/53 = 8%**. Closes section 4.5's route-level bullet, the last unchecked item there except the modal-chrome one (which the file itself records as not an acceptance scope). Production code changed: `AppRoutes.tsx` only. No Rust touched.

**This was a bug, not a gap.** `AlbumDetailRoute` read `data` alone off its `useQuery`, then `const album = fetchedAlbum ?? null; if (!album || !serverWithCred) return null;` - one bare `null` for *four* states: lookup pending, id genuinely absent from the mirror, query errored, and no server credential yet. `data` is `undefined` while pending and on error but `null` only after a successful empty read, so the distinction existed and `?? null` destroyed it. Reproduction came first: **4 of the 8 tests were red** against the unfixed route, all for the right reason (no missing copy, no loading copy anywhere in the DOM); the other 4 are positive controls that already passed and had to survive the fix. This is the un-fixed instance of a sentence already in `known-issues.md`: "Same route: `data ?? fallback` on `useQuery` renders the fallback while loading too - check `isPending` first."

Fix matches `PlaylistDetailRoute` exactly rather than inventing a fourth empty-state pattern: `if (!serverWithCred) return null` split out first, then a single `main.library` wrapper containing either `Loading album…` or `That album is no longer here. It may have been removed from the server.`, both as a bare `<p className="empty-state">`. `ArtistDetailRoute` was checked and is already correct for this class (it tests `isPending` at line 261) - deliberately untouched, since its right behavior is to *synthesize* a row, not to say "not here".

`src/app/App.albumRoute.test.tsx` (8 tests). Same harness as the other `App.*` acceptance files, with one difference that matters: **`AppRoutes` is NOT stubbed here** (it is the subject), so the mount signal is the assertion itself via `findBy*` rather than `findByTestId("route-content")`. `AlbumDetail` is stubbed to a div echoing `album.id` and `album.server_id`. Local `seedAlbum` helper (note `albums.server_type` is NOT NULL); no new `src/test/` helper added, matching what every prior acceptance file did. Covers: missing id shows the copy and no `AlbumDetail`; missing id keeps `main.library` so the chrome does not collapse; whitespace-only id `/album/%20` is missing rather than "no id"; a deferred lookup shows the loading copy and **not** the missing copy, then resolves to the album (this is the half that stops a fix from just rendering "not here" unconditionally); present id renders and never shows the missing copy; the row's own `server_id` is handed down, not the selected server's; an album with zero tracks is **not** reported missing; bare `/album/` redirects to `/home` via the `path="*"` catch-all rather than reaching the component.

**Not covered here (deliberate), all in donow.md:** the double-`decodeURIComponent` class (verified with a throwaway probe: react-router's `useParams` already decodes, so line 194's second decode throws `URIError` on an id containing `%` and silently mis-resolves one containing a literal `%20` - three routes share the cause, and it is a data-correctness bug rather than a rendering-state one); the album query being unscoped by `server_id`, so a foreign server's album still renders against the selected server's credential; `["album-by-id"]` living outside `QK` with nothing invalidating it; and `!serverWithCred` still returning a bare `null` in all three detail routes. None of these were pinned as expected behavior, since a test that codifies them would certify the bug.

### Landed 2026-08-17 (section 4.5: the credential gate on all three detail routes - a bug fix, and the sixth acceptance file)

`pnpm test:run` 1088 -> **1100 tests / 56 files**, acceptance **6/56 = 11%**. Production code changed: `AppRoutes.tsx` and `App.tsx`. No Rust touched.

**Section 4.5 had no unchecked bullets left, so this pass wrote one.** Sourced per the skill's "Mix" guidance from the closing sentence of known-issues' "A route that returns `null` for 'don't know yet' and for 'isn't there'", which named this as the open instance next door; it was also already sitting in donow.md. Picked over the "Suggested order of work" because the acceptance ratio was 5/55 = 9%.

**This was a bug, not a gap.** All three of `AlbumDetailRoute`, `ArtistDetailRoute` and `PlaylistDetailRoute` did a bare `return null` on a falsy `serverWithCred`. **12 of 12 tests were red** against the unfixed routes, for the right reason (sidebar chrome present, route region empty, none of the copy anywhere in the DOM).

**What reading the code changed about the fix.** The planned second state was "No server connected", and that state turned out to be unreachable: `App.tsx:548` renders the setup wizard when `servers` is empty, so the router only ever mounts with a server row present. A falsy `serverWithCred` at a route therefore means exactly *keychain read in flight* or *keychain read failed* - and since the query is `retry: false`, a failure is permanent, so the blank page was forever rather than transient. Two states, not three.

`credPending` is derived in `App.tsx` as `!!server && !serverWithCred && !credError` rather than taken from the query's `isPending`, because that query is `enabled: !!server?.id` and a disabled React Query (v5) reports `isPending: true` indefinitely - `isPending` cannot separate "running" from "nothing to run". Rendering is one shared `CredentialGate` component rather than the same two branches pasted into three routes, since the copy has to stay in step across them.

`src/app/App.credentialGate.test.tsx` (12 tests), table-driven over the three routes via `it.each`. Harness follows `App.albumRoute.test.tsx` (real `AppRoutes`, stubbed detail subtrees and `PlayerBar`), with a `deferKeychain()` gate holding the mocked `keychain.get` unresolved so the pending branch is observable - the analogue of that file's `deferAlbumLookup`. Note `artists.server_type` is NOT NULL when seeding. Covers, per route: connecting copy while gated and no error copy; `main.library` chrome preserved while connecting; error copy on a rejected read and no loading copy. Plus singly: handover to the route's own content once the credential resolves; the underlying keyring message reaching the user rather than being swallowed; the failure staying on screen instead of drifting back to a loading state. Probe verified by forcing `credPending = false` - **7 of 12 go red**.

**Found and not fixed (in donow.md):** `features/sync/sync.ts:265` read the same `canon.server.<id>/credential` keychain entry independently of `useServerWithCredential`, so a launch made two D-Bus round trips for one secret - which is what that hook's `staleTime: Infinity` comment exists to avoid. This is also why the "read is never retried" test asserts a settled screen state rather than an exact call count: the two callers passed identical arguments and this harness cannot tell them apart. **Fixed 2026-08-26** - `syncLibrary` now takes the credential as a parameter, so there is one reader (see section 4.6). Separately, `AppRoutes.tsx`'s `renderLibraryContent` is the same pending-vs-absent collapse in its *wrong-message* form - it renders "No server connected / Add your Navidrome server in Settings" while the credential is merely pending, so the library view accuses a configured user of having no server for the length of the keychain read. Left alone because changing that copy's trigger is a user-visible change outside this scope; `credPending` is now threaded and in place for it.

### Landed 2026-08-19 (section 4.5: the three detail routes double-decoding their URL param - a bug fix, and the eighth acceptance file)

`pnpm test:run` 1109 -> **1204 tests / 59 files**, acceptance **8/59 = 14%**. Production code changed: `src/app/AppRoutes.tsx` only (three `decodeURIComponent` calls deleted). No Rust touched.

**Section 4.5 had no unchecked bullets left again, so this pass wrote one**, sourced from the top of donow.md's `P1 - Routes: id decoding, server scoping, prerequisite states` group - which is where the 2026-08-17 album-route pass filed it after deliberately declining to pin it ("a test that codifies them would certify the bug", the note four entries below).

**This was a bug, not a gap: 19 of 40 tests red** against unfixed code, and the split is the finding. The five hostile ids/names failed on all three routes (15), plus the wrong-album, wrong-fallback-name and two app-shell-survives cases; all 21 benign rows were green *before* the fix. That 21/19 split is the entry's whole point - every character except `%` is idempotent under a second decode.

**The research report was wrong on its central claim and the probe caught it.** It reported react-router's `matchPath` as decoding the param; a standalone `matchPath` does not (it returns the raw segment, restoring only `%2F`). The decode happens on `location.pathname` inside a real Router, so the claim was right about `useParams` and wrong about the mechanism - and a unit test written off the report would have been built on a `matchPath` that behaves differently from the app. Verified with a throwaway `MemoryRouter` + `useParams` probe over 17 inputs before writing anything.

**One found-and-fixed vacuity worth remembering:** the two "the app shell survives" tests were first written as `expect(() => mountAt(...)).not.toThrow()` and **passed against the unfixed code**. React 19 reports an error thrown during render as an uncaught exception rather than rethrowing out of `render()`, so that assertion cannot see a render-body crash. Rewritten to assert the `player-bar` chrome outside the route is still present, which does go red.

`src/app/App.routeParamDecode.test.tsx` (40 tests, acceptance). Harness follows `App.albumRoute.test.tsx` - real `AppRoutes`, stubbed `AlbumDetail`/`ArtistDetail`/`PlaylistDetail` each echoing its identifying prop as a `data-` attribute, stubbed `PlayerBar`. Paths are built with the real `albumPath`/`artistPath`/`playlistPath` rather than hand-encoded, so the tests cover the producer/consumer pair. Playlists come over `onInvoke("get_playlists", ...)` (the rusqlite read path), and `usePlaylistSessionStore` is reset per test because its row cache is module-level and would answer the next test's lookup. Covers, per route: 12 ids/names (5 hostile, 7 benign) resolving to the seeded row; the album case where both `srv-a:al%20b` and `srv-a:al b` exist, so a double decode renders the *wrong* album rather than a miss; the artist fallback row being synthesized under the URL's name (the similar-artist-card path, nothing seeded); and the app shell surviving a render-body `URIError` on both routes that had one.

`src/lib/routes.router.test.tsx` (55 tests, unit). The other half of `routes.test.ts`, which asserts the round trip by hand-slicing the path and decoding it itself - a restatement of the builder, not a test of what a route receives, and it agreed with the broken routes on every input in its `AWKWARD` list. This file drives a real `MemoryRouter` and asserts the param arrives unchanged for 17 inputs across all three builders, then pins the decode budget explicitly: a param a second decode throws on, one it silently rewrites, the set it is a no-op for, and react-router's uppercase-`%2F`-becomes-`/` restoration, which is unfixable here and pinned as known behavior.

**Not covered here (deliberate), still in donow.md:** the album query being unscoped by `server_id` and its `["album-by-id"]` key living outside `QK` - same file, different cause, different seed (two servers), explicitly flagged by the research pass as a separate scope.

### Landed 2026-08-19 (section 4.5: the command palette stranded over the new route - a bug fix, and the seventh acceptance file)

`pnpm test:run` 1100 -> **1109 tests / 57 files**, acceptance **7/57 = 12%**. Production code changed: `src/hooks/useClearSearchOnNavigate.ts` -> `src/hooks/useDismissOnNavigate.ts` (renamed and generalized) and `App.tsx`. No Rust touched.

**Section 4.5 had no unchecked bullets left, so this pass wrote one**, sourced from the top of donow.md's `P1 - Overlay / modal / keyboard stacking` group. Picked over "Suggested order of work" because the acceptance ratio was 6/56 = 11%.

**The research pass split the scope and only half was taken.** What looked like one scope ("navigation must dismiss the overlay it did not originate") is two with a shared slogan: the palette has *no* dismissal mechanism at all (this pass), while `useDismissOnNavigate` being deaf to same-pathname navigation is a *documented deliberate* decision defended by a comment block in `AppShell.navigation.test.tsx:294-312`, its own hook tests, and known-issues line 115. Changing that needs a decision, not a test, so it stays in donow.md.

**This was a bug, not a gap.** **5 of 9 tests red** against unfixed code - the four window sources plus the both-overlays-stacked case - with the four controls green, so the file was never vacuous.

**Fix shape mattered more than the fix.** A sixth hand-written `setCommandPaletteOpen(false)` would have closed the four rows and left the class alive, which is what known-issues' "A stacking guard written as a hand-kept list" forbids. Instead the hook now takes one `dismiss` callback and `App.tsx` composes `clearSearch() + setCommandPaletteOpen(false)` into it, so a future overlay is added where its state already lives.

`src/app/App.paletteNavigation.test.tsx` (9 tests). Harness copied from `App.overlayStacking.test.tsx` (real `App`/`AppShell`/`CommandPalette`, stubbed `AppRoutes`/`PlayerBar`), plus a `LocationProbe` sibling inside the `MemoryRouter` - `AppRoutes` is stubbed so nothing else reports where the router actually is - and a parameterized `initialEntries`/`initialIndex` so history is navigable. Covers: the setup itself asserted standalone so a Ctrl+K guard change fails loudly instead of emptying the file; the four window sources each closing the palette and landing on the expected pathname; both overlays coming down on one navigation with the route restored; plain ArrowLeft (palette's own list key) leaving everything up; Alt+ArrowLeft clamped at history index 0 leaving the palette up, since react-router's memory history returns the same location and nothing actually moved; the palette's own Escape still working.

**Not covered here (deliberate):** the other ~20 navigation sources in the matrix. All are behind the palette's full-viewport `.cp-backdrop` and unreachable by a real mouse while it is open; jsdom has no hit testing, so writing those rows would assert a user path that does not exist. Whether WebKitGTK delivers `mouseup` for thumb buttons 3/4 at all, and whether it performs its own history navigation on them, is a claim in a comment (`useAppNavigation.ts:76-77`) that jsdom cannot check either way.

**Found and not fixed (in donow.md):** `useAppNavigation`'s Alt+Arrow `window` keydown listener calls `preventDefault()` with no `isTextEntryTarget` guard, which is the exact population known-issues' "A window-level shortcut that `preventDefault`s owes every branch its own focus guard" enumerates, and this hook is not in that entry's list of legitimate exemptions.

### Not started

Everything not ticked below. The largest untouched blocks, in the order section 8 recommends:

1. Section 1 is fully closed (`manual-mappings` landed 2026-08-04, using the existing `vi.doMock("../db")` + `vi.resetModules()` pattern from `canonicalize.test.ts`).
2. Rest of section 2: `playbackTarget.ts` (DLNA `setNext` fallback, `supportsSetNext`, transport-info failure threshold, `onError`) + session stores - queue/shuffle invariants, transport intent, gapless, buffering/loading, sleep timer/replay gain/settings all landed. `normalizeShuffleOrder` now has a test-only `export`; `buildShuffleOrder` is still module-private and needs one before its anchor semantics (line 131's item) can be covered directly.
3. Section 3 is closed (`library_read.rs` landed 2026-08-08).
4. All of sections 4, 5, 7. Section 4.5's first item (the overlay x navigation-source matrix) is worth pulling forward ahead of section 5: it is one test file, it is the only thing in this plan that can catch a composition bug, and the bug it exists for has already shipped twice.
5. Section 6 leftovers: `upnp_soap` fault mapping, `audio_seek` while paused, `pause_pending` vs `fade_gen`, non-200 `audio_play` - each needs logic factored out of a `#[tauri::command]` body first.

---

## Scope: baseline vs going forward

Two different bars, do not confuse them.

**Baseline (this file's job).** Prove the existing app works as intended. Breadth over depth: one or two tests per unit answering "does this do the thing at all, and does it hold its known invariants". Not every branch, not every edge case, not every component. Done when a full `pnpm test:run` failing tells you something real broke.

**Going forward (TDD).** New code gets written test-first, at whatever depth the feature warrants - every branch, every edge case. That depth is expected for *new* work only. Do not retrofit it onto old code.

Baseline is complete when these are green:

- [x] Section 0 - infra (fixtures + CI job still open, see progress log)
- [x] Section 1 - pure functions: shuffle (incl. `buildShuffleOrder` anchor semantics), lrclib, fuzzy-match, smartPlaylist, routes/ids, query-keys, tag-buckets, boundedCache, async-pool, rate-limiter, canonicalize, tag-normalize, lastfm, musicbrainz, album-identify, now-playing-queries, db-batch, track/`formatDuration`, `manual-mappings` all done
- [x] Section 2 - player store: queue/shuffle invariants, transport intent, gapless hand-off. Skip the rest for now.
- [x] Section 3 - migrations run clean, `sync.ts` idempotence + prune + local-column survival, `navidrome.ts` transport (2026-08-06) and URL/credential construction (2026-08-08), `library_read.rs` (2026-08-08). Skipped the rest deliberately.
- [x] Section 4 - only the hooks marked **[baseline]**. All green as of 2026-08-12 (`usePlaylistTracks` closed the last one). The unmarked hooks below stay inventory.
- [x] Section 4.5 - only the overlay x navigation-source matrix, marked **[baseline]**. Added 2026-08-04 after a composition bug shipped twice past a green suite; do not fold it back into section 5, the point of the split is that these tests mount the shell rather than a leaf.
- [~] Section 4.6 - waste. Harness + the player-ticker probes landed 2026-08-06. The rest is not baseline work: it applies going forward, one waste assertion per change that subscribes, fetches, or arms a timer.
- [~] Section 5 - only the "High value" list, and only smoke depth (renders, primary action works, empty/loading/error states are distinguishable). `TrackTableView` and `AlbumGrid` landed 2026-08-12, `ContextMenu` and `CommandPalette` 2026-08-13; the other six are open.
- [x] Section 6 - the pure Rust functions (81 tests). The four needing a refactor out of a `#[tauri::command]` body stay post-baseline.
- [ ] Regression backlog - the entries marked **[baseline]**. Rest as encountered.

Everything unmarked below is inventory, not a to-do list for this week.

---

## 0. Infrastructure (do this first, nothing else works without it)

- [x] Add `vitest` + `@vitest/coverage-v8` as devDeps. Vite is already the bundler, so config is shared and near-zero setup.
- [x] Add `jsdom` (or `happy-dom`) for DOM-touching tests.
- [x] Add `@testing-library/react` + `@testing-library/user-event` + `@testing-library/jest-dom` for component tests.
- [x] `vitest.config.ts` (or `test` block in `vite.config.ts`): `environment: "node"` by default, per-file `// @vitest-environment jsdom` opt-in, so pure-logic tests stay fast.
- [x] Scripts: `pnpm test` (watch), `pnpm test:run` (CI one-shot), `pnpm test:cov`.
- [x] Test file convention: colocated `*.test.ts` next to source. Decide and record it here once, never mix.
- [x] **Tauri mock layer** (`src/test/mocks/tauri.ts`): stub `@tauri-apps/api/core` `invoke`, `@tauri-apps/api/event` `listen`/`emit`, `@tauri-apps/plugin-sql`, `@tauri-apps/plugin-http` `fetch`. Almost nothing in `src/` is testable without this.
- [x] **In-memory SQLite harness**: a `better-sqlite3` (devDep) database that runs `src/db/migrations.ts` and exposes the same `execute`/`select` surface as `tauri-plugin-sql`'s `Database`. Unlocks the entire `src/features/sync/sync.ts`, `smartPlaylist.ts`, `dbBatch.ts`, hook-query layer.
- [ ] **Fixture set**: canned Subsonic JSON responses (`getAlbumList2`, `getAlbum`, `getStarred2`, `getPlaylists`, error envelopes incl. code 70/40/50), Last.fm responses, MusicBrainz responses, an LRC file, a small canon tree slice.
- [x] Rust: `cargo test` wiring for `src-tauri`. No test module exists yet.
- [ ] CI: GitHub Actions job running `pnpm tsc --noEmit`, `pnpm test:run`, `cargo test`, `cargo clippy`. Non-negotiable once tests exist.

---

## 1. Pure functions (highest value / lowest cost - do these next)

No mocks needed, fast, and several already have known bug history.

### `src/lib/shuffle.ts`
- [x] `shuffleArray` returns a permutation (same multiset), does not mutate input.
- [x] Anchor semantics: `buildShuffleOrder(n, anchor)` (lives in `src/features/playback/store/player.ts`, was module-private - now a plain `export`, matching how `normalizeShuffleOrder` is exposed) puts `anchor` at position 0; `-1` means no anchor. **Regression: the "no anchor" wrap bug** - `-1` must produce a genuinely random position 0 across many runs, never a fixed index.
- [x] Statistical smoke: over 1000 runs no index is pinned to position 0.
- [x] `n === 0` and `n === 1` degenerate cases.

### `src/features/tags/lib/canonicalize.ts`
- [x] `canonicalKey` / `sqlNorm` / `rawGenreId`: casing, punctuation, whitespace, unicode, ampersand vs "and", empty string.
- [x] `getParentChain` respects `maxDepth`, terminates on cycles (tree is a DAG - cycles must not hang).
- [x] `getAncestorIds` on a multi-parent node returns the union, deduped.
- [x] `findCanonicalSync`: exact > mapping > fuzzy > cross-type > none precedence, and each `MatchType` is actually reachable.
- [x] `bustCanonTreeCache` genuinely invalidates.

### `src/features/enrichment/lib/fuzzyMatch.ts`
- [x] `normalizeForMatch`: diacritics, punctuation, "The " prefix, feat./ft. handling.
- [x] `similarity` is symmetric, `1` for identical, `0` for disjoint, monotone on edits.
- [x] `scoreReleaseGroup` ranks the obvious right answer first on real-world-shaped cases (deluxe/remaster/live variants).
- [x] `filterByTrackCount` tolerance window, and does not filter to empty when nothing matches.
- [x] `rankCandidates` is a stable sort (ties keep input order).

### `src/features/playlists/smartPlaylist.ts`
- [x] `parseSmartFilters` on `null`, `""`, malformed JSON, unknown keys, out-of-range year/limit -> never throws, clamps to `YEAR_MIN`/`YEAR_MAX`/`LIMIT_MAX`.
- [x] `buildSmartQuery` parameterizes everything (no interpolated user strings - injection guard).
- [x] Every `SORT_OPTIONS` entry produces valid SQL against the in-memory DB.
- [x] Genre `include` vs `exclude` mode.
- [x] **Every query has an `ORDER BY` if it has a `LIMIT`** (see known-issues LIMIT-without-ORDER-BY entry).

### `src/features/tags/lib/tagNormalize.ts`
- [x] `isYearLikeGenre`: "1990s", "80s", "2013", "Nu Metal" (must be false), "90's".
- [x] `isStale` boundary at exactly `staleDays`, on `null`, on a future timestamp.

### `src/clients/lastfm.ts` (pure parts)
- [x] `normalizeTrackTitle`: remaster/live/feat./bracket suffix stripping.
- [x] `resolvePortraitUrl` returns `null` for `LASTFM_PLACEHOLDER`, picks the largest available size.

### `src/clients/lrclib.ts`
- [x] `parseLrc`: standard `[mm:ss.xx]`, 2-digit vs 3-digit ms, multiple timestamps on one line, metadata tags ignored, blank lines, malformed lines skipped not thrown, output sorted ascending.

### `src/clients/musicbrainz.ts`
- [x] `combineGenres` merges release-group + release counts, dedupes case-insensitively, sorts by count.

### `src/features/enrichment/lib/albumIdentify.ts`
- [x] `stripTrailingBrackets`: "(Deluxe Edition)", "[Remastered]", nested, none present -> `null`.

### `src/features/playback/lib/nowPlayingQueries.ts`
- [x] `primaryArtistOf`: "X feat. Y", "X ft. Y", "X & Y", "X, Y", null/empty.
- [x] **Regression: prefetch key parity.** Assert `useNowPlayingPrefetch` builds byte-identical `queryKey`s to `NowPlayingView`, and that both import the same `queryFn`, and prefetch `staleTime` <= consumer `staleTime`.

### `src/lib/routes.ts` + `src/lib/ids.ts`
- [x] `albumPath`/`artistPath`/`playlistPath` URL-encode slashes, `#`, `?`, unicode; round-trip through the route param decode.
- [x] `stripServerPrefix` with prefix absent, prefix appearing mid-string.

### `src/lib/boundedCache.ts` / `asyncPool.ts` / `rateLimiter.ts`
- [x] `cappedSet` evicts at `maxEntries`, keeps insertion recency, `maxEntries === 0`.
- [x] `runPool` respects concurrency ceiling (track max in-flight), preserves result order, one rejection does not sink the pool, empty input.
- [x] `makeRateLimiter` spaces calls by `intervalMs` under fake timers; concurrent callers serialize.

### `src/lib/dbBatch.ts`
- [x] `executeBatched` chunks under `SQLITE_MAX_VARIABLES`, chunk boundary exactness.
- [x] **`executeIdChunks` must refuse `NOT IN`** - the correctness bug documented in known-issues. Test that a `NOT IN` statement throws rather than chunking.

### `src/features/tags/lib/tagBuckets.ts`, `manualMappings.ts`, `track.ts`, `queryKeys.ts`
- [x] Bucket assignment for known/unknown tags (`bucketize`).
- [x] `QK` key factories are stable and collision-free across entity types.
- [x] Track duration/format/display helpers, including null fields. **This bullet was mis-filed:** `src/lib/track.ts` holds no duration/format helpers, only `makeStreamUrlBuilder`. Covered as written by testing (a) `makeStreamUrlBuilder` in `track.test.ts` and (b) the repo's only such helper, `formatDuration` in `src/features/playback/hooks/useSeekBar.ts`, in `useSeekBar.test.ts`.
- [x] `manualMappings.ts`: `getManualGenreMappings` cache/in-flight/generation races. Covered 2026-08-04, see `manualMappings.test.ts` in the progress log (manual-mappings pass).

---

## 2. Store logic (`src/features/playback/store/player.ts` - the single riskiest file)

Every one of these mirrors a real, documented, previously-shipped bug. This section is the core of the baseline.

### Queue and shuffle invariants
- [x] **`shuffleOrder.length === queue.length` after every mutation**: `playQueue`, `addToQueue`, `playNext`, `addManyToQueue`, `playNextMany`, `removeFromQueue`, `removeManyFromQueue`, `moveQueueItem`, `clearQueue`. Property test over random mutation sequences.
- [x] `playQueue([oneTrack])` under shuffle writes `[0]`, not `[]`.
- [x] `normalizeShuffleOrder` **returns a fresh array on the fast path** (identity check: result !== input).
- [x] `moveQueueItem` normalizes before splicing.
- [x] Queue trimming at `maxQueueSize` - callers must read length back off the store, not reuse a pre-append length.
- [x] `isNextDisabled` for each repeat mode x shuffle x position combination.

### Transport intent
- [x] Pause during load: `pause()` called inside `playTrack`'s await window leaves the engine paused, `isPlaying === false`.
- [x] `resume()` with `currentTrack` set but `streamUrl === null` (restored session) routes to `retryCurrent`, never sets `isPlaying` alone.
- [x] `resume()` with no `currentTrack` is a no-op (no phantom ticker).
- [x] `stop()` clears `pauseRequestedDuringLoad`.
- [x] `seek()` ignores a stale position poll from before the seek (`seekGen`).
- [x] Natural-end fallback advance requires `isPlaying`.

### Gapless
- [x] `gaplessEnqueued` records the track handed to the engine; `track-advanced` follows that track through queue edits (insert before it, reorder, remove).
- [x] Repeat-all wrap uses `gaplessEnqueued.wrapOrder`, and the same track does not open consecutive passes (statistical over N wraps).
- [x] `gapless-cancelled` event clears `gaplessActive`.
- [x] Sleep timer "end of track" blocks the enqueue, and pauses on arrival if armed late.
- [x] `canGapless` false for repeat-one / consume / shuffle edge cases.

### Buffering / loading
- [x] `isBuffering` spans request -> `audio-format` event, not the `invoke` round trip.
- [x] `isLoading` does not widen to cover buffering (pause stays clickable).
- [x] Waveform prefetch is gated on audible playback, not on request.

### Sleep timer, replay gain, settings
- [x] `setSleepTimer` presets and `clearSleepTimer`.
- [x] `loadSettings` restore honors `queue.restore_on_startup` - **SQLite path only**, covered 2026-08-04. The server path (`useQueueSync.ts`, the same setting also gating a Subsonic `getPlayQueue`/`savePlayQueue` restore, no existing test file) is a genuinely separate scope - different file, different harness - split out, still unchecked.
- [x] Replay gain mode/pre-amp/fallback persist and clamp.

### `src/features/playback/store/playbackTarget.ts`
- [ ] `DlnaTarget.setNext` falls back when `SetNextAVTransportURI` faults (the SOAP error must reach the `catch`).
- [ ] `supportsSetNext` records `false` on a faulting renderer.
- [ ] Three consecutive `GetTransportInfo` failures required before reporting error, not one.
- [ ] `onError` fires for a dead renderer.

### Session stores
- [ ] `trackListSessionStore` / `allTracksSessionStore` / `lovedSessionStore` / browse stores: `bumpRefresh` increments, scroll position round-trips, per-key isolation.
- [ ] `libraryFilters`: filter composition, reset, no filter leaks across views.
- [ ] `tags.ts` store state transitions.

---

## 3. Data layer

### `src/db/migrations.ts`
- [x] Fresh DB migrates 0 -> latest (v48, read off the array, never hardcoded) without error.
- [x] Migration is idempotent - running twice is a no-op.
- [x] Every intermediate version can migrate forward (loop: migrate to N, then to latest).
- [x] Post-migration schema assertion: expected tables, columns, indexes. WAL is asserted as *issued*, not as observed - `:memory:` databases silently refuse WAL.
- [x] Foreign keys / primary keys present where the code assumes them (`playlist_tracks (playlist_id, position)`). There are **zero** foreign keys in the schema, so the test pins that absence.

### `src/features/sync/sync.ts` (against the in-memory DB + fixtures)
- [x] Initial sync writes albums, tracks, artists, playlists.
- [x] Idempotent second sync with unchanged fixtures writes nothing (assert zero mutations).
- [x] **Prune**: album removed server-side is deleted locally, along with its tracks and derived rows.
- [x] **Prune refuses** an empty fetched list against a non-empty library.
- [x] **Prune refuses** when `fetchAllAlbums` threw (partial list must never prune).
- [x] `album_identity`, `album_user_genres`, scrobble tables survive a prune.
- [x] Per-album track prune removes tracks missing from a successfully fetched album, and never chunks a `NOT IN`.
- [x] Track-skip heuristic: `existingTrackCount === songCount` skips, and a server-side deletion does not wedge it into re-fetching forever.
- [x] **Playlist refresh upserts server-owned columns only** - `is_smart`, `rules_json`, `custom_cover_data` survive a refresh.
- [x] `playlist_tracks` rewritten only for playlists whose ordered ids changed.
- [x] Loved stage read scope matches write scope (change-detection can reach equality again).
- [x] Loved / playlist stage failures are non-fatal and report via `skippedStages`.
- [x] Album-track pass gives up after 5 consecutive failures.
- [x] `purgeServerData` removes every `server_id`-owned row, and leaves the other server's rows intact.

### `src/clients/navidrome.ts`

Split into two scopes once the code was in view: **transport** (`apiPost` and everything routed through it) landed 2026-08-06; **URL/credential construction** landed 2026-08-08 in a second file, `navidromeUrls.test.ts` (different harness: no fake timers, `vi.resetModules()` per test).

- [x] `apiPost` 12s timeout via `AbortController`, 3 attempts, exponential backoff, alt URL tried on every attempt (fake timers + mocked fetch).
- [x] Named error thrown, never a bare `Load failed`.
- [x] `SubsonicError` carries the code; code 70 vs 40/41/50 distinguishable.
- [x] HTTP 200 with a Subsonic error envelope is treated as an error. (True of `callSubsonicVoid` and the `fetch*` readers. `fetchTrackRating`, `getArtistImageFromServer`, `getPlayQueue`, `fetchLyricsBySongId` deliberately swallow it into a default - not covered here.)
- [x] `NON_IDEMPOTENT_ENDPOINTS` (scrobble) is not retried across routes in a way that double-sends.
- [x] `getCoverArtUrl` / `getArtistImageUrl` / `getStreamUrl` construction: size param, credential params, encoding, `maxBitRate`. Note `_coverServerReady` is one-way (`initCoverServer()` has no counterpart), so the "not ready" branch needs `vi.resetModules()` + dynamic import per test, and `_streamMaxBitrate` is module state shared with `track.test.ts`.
- [x] Auth token/salt generation (`js-md5`) matches the Subsonic spec for a known password+salt vector. `generateSalt` is private and uses `crypto.getRandomValues`, so either stub the RNG or assert `t === md5(password + s)` against the salt read off the request body.
- [x] Playlist position compaction after a removal (the second removal must delete the right remote index). Landed 2026-08-12 in `src/features/playlists/usePlaylistTracks.test.ts`, where the bullet itself said it belonged. **Mis-filed here:** `removeTrackFromNavidromePlaylist` is a thin `songIndexToRemove` sender; the compaction is `src/features/playlists/usePlaylistTracks.ts:61-97` and belongs in `usePlaylistTracks.test.ts` with `createMigratedTestDb`.
- [x] `fetchAllAlbums` throws on any failed page rather than returning short.

### `src-tauri/src/library_read.rs`
- [x] `order_by_clause` rejects unknown sort keys (SQL injection guard) - unit-testable, no DB. Also whitespace-only, unicode lookalikes, and a structural property over the fragments themselves.
- [x] Every query filters by `server_id` where it should. **Answer: none of the 13 do.** Five are implicitly scoped by a `${server_id}:` id prefix; `get_artists` and the genre aggregates are not. Unchanged from the pre-port JS. Tests pin current behavior and each DTO's `server_id` reading off its own row column; the divergence is logged in `donow.md`.
- [x] Integration: each `get_*` body extracted to a `query_*(&Connection, ...)` free fn and exercised against a fixture db. **Nothing in this file paginates** - no command takes `limit`/`offset`; covered the LIMIT/HAVING boundaries instead (`LIMIT 10`, `>= 5` twice, `LIMIT 18`).

---

## 4. Hooks (jsdom + React Query test wrapper)

Build one `renderHookWithProviders` helper first (QueryClient with `retry: false`, mocked db, mocked server).

- [x] **[baseline]** `useSearch` - FTS ranking: exact-title match survives the cap on a broad query; bm25 CTE is `MATERIALIZED`; ~~`ESCAPE '\\'`~~ (**struck: `useSearch.ts` contains no `LIKE`, no `ESCAPE` and no `useDeferredValue` - that clause belongs to `nowPlayingQueries.ts`, which is the site named in known-issues and still has no ESCAPE test; logged in donow.md**); results filtered by `server_id`; `SearchAlbum`/`SearchTrack` carry their own `server_id`. Landed 2026-08-10.
- [x] **[baseline]** `useLibrarySync` **control flow and lifecycle** - guard claimed by the run starting, not the attempt; server switch mid-sync re-syncs; interval 0 behavior; plus interval parsing/re-arming/teardown, undefined-server mount path, error status mapping, and the two known-issues regressions (interval tick during an in-flight run; `.finally()` re-entry cannot loop). Landed 2026-08-10.
- [ ] `useLibrarySync` **settle fan-out and progress debounce** (split out of the bullet above once the code was in view - it shares only the render harness): the 1500ms progress-bump debounce vs the undebounced `setSyncProgress`; the staggered 0/300/600/1000ms bumps and which of the six session stores move per `changed` flag; both playlist ticks moving together; the exact `partial` message strings and their pluralization. Needs the six real zustand stores baselined per test, and `useArtistBrowseSessionStore.bumpRefresh`'s own 400ms internal debounce is the trap (the t+300 bump does not move its tick until t+700).
- [x] **[baseline]** `useScrobbleFlush` - code 70 drops the row and continues; auth codes break the batch and keep the backlog; in-flight guard prevents overlapping flushes; `tracks.play_count` and `albums.play_count` increment after the queue DELETE. Landed 2026-08-10, plus the three triggers (mount / 60s interval / `online` event), the foreign-server skip, and the write-order assertion. **Not covered:** `useScrobble.ts`, the producer that fills the table.
- [x] **[baseline]** `useRadio` **orchestration** - queue length read back after each append (against the *real* `addToQueue`, so the trim actually happens); no duplicate appends (`fillingRef`, exclusion set, session memory); the lookahead boundary; the repetition decay; the same-album branch; both `wasAtEnd` sites. Landed 2026-08-10.
- [x] **[baseline]** `src/features/radio/lib/radio.ts` **candidate scoring** (split out of the `useRadio` bullet once the code was in view - the hook mocks `getRadioCandidates` away, and these need a real migrated db instead): canon-tree ancestor weights (`buildAncestorWeights`), `MOOD_WEIGHT`, the `sqrt(tag_count)` damping, `CANDIDATE_LIMIT` on every query site, the `SAFE_ID` filter, and the per-`RadioMode` branches with their fallbacks (incl. the no-tags random fallback). Needs `bustCanonTreeCache()` per test - `canonicalize.ts` caches the tree in a module singleton. Landed 2026-08-11.
- [ ] `useSimilarInLibrary` - `LOWER(TRIM(...))` matching; `artist_aliases` union; returns the caller's original strings.
- [ ] `useWakeLock` - cleanup during the pending `request()` releases the resolved sentinel; re-acquires after a `released` sentinel.
- [x] **[baseline]** `useQueueSync` - `restoreQueue` writes store state without loading the engine; honors `restore_on_startup`. Landed 2026-08-11.
- [x] **[baseline]** `useServer` - missing keychain entry surfaces the friendly message; `retry: false` on that query. Landed 2026-08-11.
- [ ] `useSetting` - read/write/default/type coercion round-trip.
- [x] **[baseline]** `useTracks` / `useAlbums` / `useArtists` / `useGenres` / `useAllTracks` - query key shape, `server_id` scoping, refresh-tick invalidation. Landed 2026-08-11.
- [ ] `useTagMappings`, `useUserTree`, `useGenreTree` - tree DAG not flattened, user tree not merged into canon tree.
- [ ] `useListeningStats` - counts, pending scrobbles not double-counted.
- [ ] `useLyrics` - cache hit path, miss path, LRC parse failure.
- [ ] `useNowPlayingPrefetch` - see prefetch parity test above.
- [ ] `useMediaSession` - artwork URL built from `artworkRef` at the hook's own size; metadata cleared on stop.
- [ ] `useGlobalShortcuts` - each binding, and no fire while an input/textarea has focus.
- [ ] `useScrollMemory`, `useAppNavigation` - back/forward history stack, scroll restore per route. **Known open bug: back sometimes lands on album view instead of prior view - write the failing test first.**
- [ ] `useClickOutside`, `useSidebarResize`, `useSeekBar` - pointer math, min/max clamping.
- [ ] `useCoverCache`, `useArtistImageCache` - cache key derivation, bounded size.
- [ ] `useAutoIdentifyAlbum`, `useNormalizeAlbum`, `useBackgroundNormalizer`, `useEnrich*` - **each must have an "already attempted" marker so a failing repair cannot loop** (the `AlbumDetail` backfill class of bug). One test per hook: a repair that cannot succeed runs exactly once.

---

## 4.5 Composition and the app shell

**Why this section exists.** Every other section in this file tests a *unit* - a function, a store action, a hook, a component. The search-overlay bug (`known-issues.md`, "State deciding which subtree renders, but absent from the URL") was invisible to all of them because every unit involved was individually correct: `openAlbum` navigated, `SearchResults` called it, `AppShell` rendered what it was told. The defect only existed in the *pairing* - a navigation source and an overlay that outlives it. A unit-shaped test plan cannot queue that bug, which is why it shipped, got half-fixed, and shipped again.

So: this section is about which subtree renders under which state, and about pairs rather than parts. Its tests mount `AppShell`/`App` (or a trimmed harness around `renderContent`), not a leaf.

- [x] `useDismissOnNavigate` (named `useClearSearchOnNavigate` until 2026-08-19) in isolation - first render is not navigation, a pathname change clears once, a same-pathname re-render does not, the callback is read through a ref. Landed 2026-08-04.
- [x] **[baseline]** **Overlay x navigation-source matrix.** Enumerate what can render instead of the router (`AppShell.renderContent`'s search overlay today; check for others before assuming it is the only one) and everything that can navigate (`useAppNavigation`'s `navigateTo`/`openAlbum`/`openArtist`/`openPlaylist`/`goBack`, `openAlbumById`, `CommandPalette`, `PlayerBar`, context menus, Alt+Arrow and thumb-button history). Assert that after each navigation source fires with the overlay open, the route's content is what renders. Table-driven: one row per (overlay, source) pair, so a new source added later fails until it is wired.
- [x] Re-selecting the route already open still dismisses the overlay. This is the case `useDismissOnNavigate` deliberately cannot catch (no pathname change) and the per-call-site `clearSearch()` in `SearchResults`' handlers exists for. Assert both mechanisms, or the per-call-site one gets "simplified" away as redundant. Landed 2026-08-15.
- [x] Modal/overlay stacking: the command palette opens over the search overlay, Escape closes the topmost only, and closing one does not strand the other. Landed 2026-08-17 as a **bug fix** - Escape collapsed both layers on one press. Split from the modal-chrome half below.
- [x] `SmartPlaylistModal`, `ArtistMergeModal` and `IdentifyDialog` have no Escape-to-close and no focus trap (recorded in review.md, which asks for one app-wide pass rather than a fourth pattern). Split out of the stacking bullet 2026-08-17: none of the three is mounted by `App`/`AppShell`, so this is a per-component behavior change plus a grep-and-fix, not an acceptance scope. The one instance reachable from an `App` harness is `SearchResults` rendering `AlbumIdentifyDialog` *inside* the search overlay - Escape there has no handler of its own, falls through to `useSearchShortcuts`, and unmounts the overlay with the half-filled dialog inside it. Landed 2026-08-17 as a **bug fix** and the fifth acceptance file - see the progress-log entry; the fix is a shared `useModalChrome` hook plus an open-modal registry read as `overlayAbove`'s third term, so the *next* modal is covered without editing `App.tsx`. `TagDrawer`, `TagTreeTab`'s `NodeModal` and `FeedbackModal` are the same class and are **not** converted - in donow.md.
- [x] `App.tsx`'s Ctrl+K / Ctrl+F window listeners do not fire while an input, textarea or contenteditable has focus. Landed 2026-08-15 as a **bug fix**, not new coverage: there was no guard at all. Escape got the same treatment. Handler extracted to `useSearchShortcuts`.
- [x] Route-level: all three detail routes render a real state while the **credential** round-trip is in flight, not a blank page. Written 2026-08-17 (the section's bullets had run out, so this one was sourced from the closing sentence of known-issues' "A route that returns `null` for 'don't know yet' and for 'isn't there'", which named it as the still-open instance next door). Landed the same day as a **bug fix**: `AppRoutes.tsx`'s album/artist/playlist routes each did a bare `return null` on a falsy `serverWithCred`, which covers the keychain read being in flight *and* having permanently failed (`retry: false`). Fixed with one shared `CredentialGate` and a `credPending` derived in `App.tsx` - not `isPending`, which cannot distinguish a disabled query from a running one. Note the "no server configured" case is **not** a route state: `App` renders the wizard on an empty `servers` table, so the router only mounts with a server row present.
- [x] Route-level: `/album/:id` for an id absent from the mirror renders a "not here" state, not `null`. Landed 2026-08-17 as a **bug fix** - `AlbumDetailRoute` returned `null` for pending, missing, errored and no-credential alike. Fixed to the `PlaylistDetailRoute` precedent (loading copy vs. missing copy, both inside the route's own `main.library`). `ArtistDetailRoute` was already fixed for this class and is untouched.
- [x] **The command palette is dismissed by navigation that did not originate inside it.** Written 2026-08-19 (the section's bullets had run out again, so this one was sourced per the skill's "Mix" guidance from the top of donow.md's `P1 - Overlay / modal / keyboard stacking` group). The search overlay got a mechanism in 2026-08-04 and the palette never did: its only dismissals were five hand-written `setCommandPaletteOpen(false)` calls inside the handlers it owns, which by construction cannot cover navigation that starts elsewhere. Landed the same day as a **bug fix**. Table-driven over the four `window`-level sources in `useAppNavigation` (Alt+ArrowLeft/Right, mouse thumb buttons 3/4) - deliberately only those four, because the palette's backdrop covers the viewport and jsdom's lack of hit testing would happily let a test click a sidebar a real user cannot reach. Includes the two no-op controls (plain ArrowLeft, and Alt+ArrowLeft clamped at history index 0) that must *not* dismiss.
- [x] **Route-level: an id or artist name survives the trip from `albumPath`/`artistPath`/`playlistPath` into the route that resolves it.** Written 2026-08-19 (section 4.5's bullets had run out for the third time; sourced per the skill's "Mix" guidance from the top of donow.md's `P1 - Routes` group, where the 2026-08-17 album-route pass filed it). Landed the same day as a **bug fix**: all three detail routes called `decodeURIComponent` on a param react-router had already decoded, so a value holding a literal `%` threw `URIError` - from the render body in the artist and playlist routes, taking the whole tree down - and one holding the text `%20`/`%41` silently addressed a different row. Covered at two levels because neither sees it alone: `App.routeParamDecode.test.tsx` drives the real routes, and `routes.router.test.tsx` pins the router contract that `routes.test.ts`'s hand-decoded round trip could not.

## 4.6 Waste (renders, fetches, work per second)

**Why this section exists.** Every other section asks "is the output right". None of them asks what it cost. An app that re-renders the whole player five times a second, fetches the same album on every keystroke, or runs two copies of the same interval produces byte-identical correct output and passes the entire suite above. This is the failure mode the user actually feels - a UI that stutters, a fan that spins up, a server hit four times for one screen - and it is the one class of defect this plan was structurally blind to before 2026-08-06.

Waste is testable the same way behavior is, and cheaply: mount a probe, run the clock a fixed span, compare an **exact** count. `toHaveBeenCalled()` is not a waste assertion - it passes on 1 call and on 500.

Harness: `src/test/perf.ts` (`trackRenders`, `invokeCount`, `invokeArgs`), plus `FakeDatabase.executeCount` / `selectCount` / `queryLog` in `src/test/sqlite.ts`. Worked examples: `src/features/playback/store/player.waste.test.ts`.

**Rule for every entry here: prove the probe can fail.** Break the property deliberately once (delete the `clearInterval`, widen the selector to return an object), confirm the test goes red, restore. A waste test that would also pass against the wasteful version is worse than no test, because it certifies the thing it cannot see.

### Landed 2026-08-06
- [x] Ticker churn: a subscriber selecting `currentTrack` renders zero extra times across a second of 5Hz `elapsed` writes; a subscriber selecting `elapsed` renders exactly 5. Probe verified against an object-returning selector (fails with React's update-depth error, which is the render-loop shape itself).
- [x] One interval per player: `resume()` called twice while already playing (reachable via MPRIS/media-key Play, which does not check whether playback is under way) leaves exactly one poll loop. Verified red at 15 polls/sec with `startElapsedTimer`'s `clearInterval` removed.
- [x] Queue cost: a 30 track album queued issues exactly one `audio_play`.

### Landed 2026-08-26
- [x] One credential read per launch: `syncLibrary` issues zero `get_credential` invokes, because it is handed the credential `useServerWithCredential` already cached. Probe verified red against the unfixed version, which threw `No credentials found for server srv-a` at the keychain read the test no longer mocks.

### Store subscriptions
- [ ] No selector in `src/` returns a fresh object or array (`(s) => ({...})`, `(s) => [s.a, s.b]`) without `useShallow`. Grep-style test over the source tree - the ticker makes this an instant 5Hz render loop, not a mild inefficiency.
- [ ] `NowPlayingView` holds ~20 separate subscriptions; assert the whole component renders once per `elapsed` tick, not once per subscription, and zero times for a `queue` mutation it does not display.
- [ ] `PlayerBar` / `useSeekBar`: the seek bar is allowed to re-render at 5Hz. Assert nothing else in the shell does - especially `AlbumGrid` and the sidebar.
- [ ] Action selectors (`(s) => s.play` etc.) are stable across state changes, so a component that only pulls actions never re-renders at all.

### Fetching
- [ ] One album detail open = one `useTracks` round, one cover request. Assert exact `selectCount` per open, and that reopening within `staleTime` issues zero.
- [ ] `CommandPalette` / `useSearch`: N keystrokes fire fewer than N query rounds (debounced). `useDeferredValue` defers rendering, not fetching - a test that only counts renders will pass while the network still gets one round per keystroke, so count queries here, not renders.
- [ ] `useNowPlayingPrefetch`: the prefetch and the consumer share one cache entry, so opening the tab after a prefetch fires zero additional requests. Today's test asserts key parity by source inspection; this is the behavioral form.
- [ ] Cover art: the same album id rendered N times on a grid resolves one `cover://` request, not N (`invokeArgs` for duplicate ids).
- [ ] `useRadio`: appending lookahead tracks does not re-query candidates once per append.
- [ ] No query fires while its view is unmounted (background enrichment excepted, which should be explicitly scheduled rather than incidental).

### Work per unit of time
- [ ] Every hook that arms an interval or a listener (`useScrobbleFlush`, `useLibrarySync`, `useWakeLock`, `useMediaSession`, `useGlobalShortcuts`) tears it down on unmount, and a remount leaves exactly one armed. Table-driven over the hook list.
- [ ] `useLibrarySync`'s 5-minute tick over an unchanged library issues zero writes (`executeCount === 0`) - already true via `sync.test.ts`'s idempotence assertions, restated here as the standing property.
- [ ] Repair effects (`useAutoIdentifyAlbum`, `useNormalizeAlbum`, `useBackgroundNormalizer`, `useEnrich*`, `AlbumDetail`'s bitrate backfill) run a bounded number of times when the repair cannot succeed. Section 4 lists this per hook; the count is the assertion.
- [ ] Waveform preload starts only once audio is audible, and never twice for one track (`waveformInFlight`).

### Rendering cost
- [x] `AlbumGrid` virtualizer renders a bounded number of rows for a 10k album library, not all of them. Covered 2026-08-12 in `AlbumGrid.test.tsx` (10400 albums, exactly 7 row divs).
- [ ] `TrackTableView` selection change re-renders the changed rows only, not the whole table.

## 5. Components (React Testing Library)

Behavior only, not snapshots. Prioritize the ones with real logic.

### High value
- [x] `TrackTableView` - **selection keyed by stable id, not row index**: reorder/refresh the list, assert the same tracks stay selected. Sort by each column. Range click with shift. ~~Keyboard nav~~ (**struck: there is no arrow-key navigation, only `Enter` on a focused row - covered, and the absence is pinned by a test asserting Arrow/Home/End/Space do nothing; logged in donow.md as a feature gap, not a test gap**). Landed 2026-08-12. **Not covered (deliberate split, see below):** virtualizer row-count bounds, column-picker persistence beyond one round-trip, per-row render cost.
- [x] `AlbumGrid` - virtualizer, scrubber jump lands on the right row (the `PADDING + virtualRow.start` offset bug, **found live and fixed**), empty state. Landed 2026-08-12. **Not covered:** per-card render cost, the unidentified badge's `mb.auto_identify` gate, `AlbumIdentifyDialog` open path.
- [x] `ContextMenu` - opens on left click and **stays open** (the WebKitGTK self-close regression); closes on outside mousedown; item selection is not eaten; keyboard escape. Landed 2026-08-13, plus scroll-closes, the `onCloseRef` stale-closure guard, and unmount listener teardown. **Not covered:** `ContextMenuSubmenu` hover/flip logic, viewport-clamp effect.
- [x] `CommandPalette` - **debounced**, not `useDeferredValue`: N keystrokes must not fire N query rounds. Result navigation, enter-to-open. Landed 2026-08-13, plus the 149/150ms boundary, arrow clamping, the reopen reset, backdrop vs modal mousedown, and the error/empty branches. **Not covered:** the Ctrl/Cmd+K trigger itself (it lives in `App.tsx`, not the component), submenu-free hover-to-focus styling, `scrollIntoView` call sites.
- [x] `SmartPlaylistModal` - rule building round-trips through `parseSmartFilters`/`buildSmartQuery`; invalid input disables save. Landed 2026-08-15, **two live bugs found and fixed** (falsy-zero limit, backdrop drag-release dismissal - the latter fixed as a class across all 5 portal modals via `useOverlayDismiss`). **Not covered:** the genre list's `useGenres` loading state, save-failure UI (there is none - logged in donow.md).
- [ ] `AlbumGenreEditor` - add/remove genre, unresolved genre path, optimistic update rollback on failure.
- [ ] `PlayerBar` / `PlayerProgress` - transport button disabled states, seek drag, buffering indicator visible while `isBuffering`.
- [ ] `NowPlayingView` - tab switching, lyrics auto-scroll to the active line, About tab renders top tracks for a "feat." artist.
- [ ] `ErrorBoundary` - catches a throwing child, renders fallback, reset works.
- [ ] `setup/Wizard` + `settings/ServerTab` - **keychain rollback on failed insert**; **removal aborts if keychain delete fails** and surfaces the error.

### Medium
- [ ] `AlbumDetail`, `ArtistDetail`, `PlaylistDetail` - loading vs empty vs loaded (assert `isPending` is checked before any `?? fallback`), track play, context menu actions.
- [ ] `TagsView` + tabs (`TagReviewTab`, `TagDecidedTab`, `TagTreeTab`, `TitleCleanupTab`) - dismiss, bulk actions, badge count.
- [ ] `SearchResults`, `FilterSidebar`, `GenreView`, `YearsView`, `HomeView`, `PlaylistList`, `ArtistGrid`, `UnidentifiedView`.
- [ ] `IdentifyDialog`, `ArtistMergeModal`, `FeedbackModal`, `UpdatePrompt`, `TourCard`, `RemoteNoticeBanner`.
- [ ] `CanonCombobox`, `CanonIcon`, `RadioChip`, `StartRadioSubmenu`, `WaveformBars`, `AlbumArt`, `ArtBackdrop`, `TagDrawer`, `SettingRow`.

### Cross-cutting component checks (one test file, applied broadly)
- [ ] Every interactive control has hover/focus/active/disabled states and is keyboard reachable.
- [ ] No `—` / `–` anywhere in `src/` (lint-style test over the source tree - cheap and catches the coding-standards rule).
- [ ] Tabs use underline style, never pills (grep-style assertion over CSS).
- [ ] **No partial opt-out of `base.css`'s `input, button` base rule.** A CSS rule that sets both `background: none|transparent` and `border: none` must also set `box-shadow`, or it inherits the base rule's drop shadow onto a transparent element and renders as a glassy pill (`known-issues.md`, "A partial opt-out of a global base rule"). Grep-style test over `src/**/*.css`, skipping `:hover`/`:focus`/`:active`/`:disabled` selectors, which layer onto a base rule that has already answered the question. **Blocked on the fix, not the other way round:** the heuristic reports 37 live violations today, so writing the test first means committing red or pinning broken output. Do the review.md item "Bare-button styling" first, then land this test in the same commit so it cannot regrow. The exact script is in the `known-issues.md` entry.

---

## 6. Rust (`cargo test`)

Pure functions first - these need no Tauri app handle.

- [x] `upnp::xml_text`, `find_control_url`, `resolve_base`, `parse_response` - well-formed, missing tag, relative vs absolute base URL, malformed SSDP response.
- [x] `lib::sanitize_cache_key` - path traversal (`../`), null bytes, unicode, length cap.
- [x] `lib::percent_decode` - `%20`, `%2F`, invalid `%ZZ`, trailing `%`.
- [x] `lib::xml_first_tag_text`.
- [x] `library_read::order_by_clause` - allowlist, unknown key rejected.
- [x] `lib::friendly_keyring_error` maps each `keyring::Error` variant.
- [x] Disk cache: `disk_cache_read`/`write` round-trip in a `tempdir`; `evict_disk_cache_if_needed` evicts oldest-mtime and respects the cap.
- ~~`ThreadSemaphore`~~ - gone with the `tiny_http` proxy; the cap is now `Arc<tokio::sync::Semaphore>` on `CoverState`, upstream code behind an `AppHandle`. Nothing Canon-owned left to test.
- [x] Streaming buffer (`streaming.rs`) - `finish()` yields `Ok(0)`, **`fail()` yields `UnexpectedEof`** (the truncated-stream bug), reader gets the bytes that did arrive before the error, concurrent read/write.
- [ ] `upnp_soap` - HTTP 500 with a SOAP fault returns `Err` carrying `errorCode`/`errorDescription`; non-500 unchanged.
- [ ] `audio_seek` while paused does not re-arm `play_start`.
- [ ] `pause_pending` survives a `fade_gen` bump from `audio_seek`/`audio_volume` (the phantom-play bug) - testable if the fade logic is factored out of the command.
- [ ] Non-200 response status from `audio_play` is an error before the body reaches the decoder.

> Several of these need small refactors to be testable (extract fade/generation logic out of `#[tauri::command]` bodies into free functions). That refactor is part of the work, not a blocker.

---

## 7. Integration / end-to-end (later, lower priority)

- [ ] Full sync against a fixture Subsonic server (mock HTTP layer) into an in-memory DB, asserting final table contents.
- [ ] Play a fake track end-to-end: `playQueue` -> mocked engine events -> scrobble queued -> flushed -> play counts incremented.
- [ ] Add a server -> sync -> browse -> play -> remove server -> library is empty.
- [ ] Tauri WebDriver / `tauri-driver` smoke test for app launch. Realistically last, given the WebKitGTK issues.

---

## Regression-test backlog

Every entry in `docs/known-issues.md` is a bug that shipped. Each one deserves a test that fails against the pre-fix code, eventually. **[baseline]** marks the ones worth writing now: silent data corruption, or a fix that is easy to undo without noticing. The rest go in as encountered.

- [ ] **[baseline]** `shuffleOrder` / `queue` length divergence
- [ ] **[baseline]** `normalizeShuffleOrder` returning its input
- [ ] **[baseline]** Shuffle wrap anchoring (same track opening every pass)
- [ ] **[baseline]** Pause during load discarded
- [ ] **[baseline]** Restored queue unplayable
- [ ] **[baseline]** Gapless hand-off record following queue edits
- [ ] **[baseline]** Sync with no deletion path
- [ ] **[baseline]** Playlist DELETE-then-INSERT destroying local columns
- [ ] **[baseline]** Keychain entry orphaned / outliving its row
- [~] **[baseline]** Unscoped reads + `server_id` stamped from the selection - covered for `SearchAlbum`/`SearchTrack` (2026-08-10: a row whose owner disagrees with the queried server id proves the value is read off the row, not reconstructed); the `AlbumRow` call sites are still untested
- [x] **[baseline]** `playlist_tracks.position` not compacted - covered 2026-08-12 by asserting the *sequence* of `songIndexToRemove` values across two removals in one session (`[0, 0]`, not `[0, 1]`), plus the `-0` path, a 200-row PK-collision fixture, and cross-playlist isolation
- [ ] **[baseline]** Scrobble queue head-of-line blocking on error 70
- [x] **[baseline]** Selection stored as row indices - covered 2026-08-12, and the fix turned out to be half-applied: the *selection* was already `Set<string>` but the shift-range *anchor* was still an index, so a refresh re-pointed it. Fixed + new known-issues entry ("Converting the collection to ids while leaving the cursor into it an index fixes half the bug")
- [x] **[baseline]** `ESCAPE '\'` in a template literal - covered 2026-08-12 at both levels: the behavioral half in `nowPlayingQueries.test.ts` (artist names containing `_`, `%`, a backslash, a trailing backslash, against real SQLite), and the class-level half in `sqlEscaping.test.ts`, which decodes every `ESCAPE '...'` literal in `src/` the way the JS parser would and requires exactly one character. Probe verified red by rewriting the three clauses to the broken spelling (9 failures)
- [x] **[baseline]** `LIMIT` without `ORDER BY` - covered for `buildSmartQuery`, and for `useSearch`'s bm25 CTE as of 2026-08-10 (2100-row pool, exact match inserted last so a rowid-ordered cap drops it; plus a SQL-string assertion, since removing `MATERIALIZED` does not throw on SQLite 3.53)
- [ ] Waveform extraction in-flight guard (concurrent same-track extraction)
- [ ] Shared `fade_gen` cancelling pause intent
- [ ] Gapless bypassing the sleep timer
- [ ] `gapless-cancelled` on every bail-out path
- [ ] `isBuffering` vs `isLoading`
- [x] Truncated stream reported as clean EOF (`streaming.rs` `fail()` tests)
- [ ] SOAP 500 mapped to success
- [ ] Carousel scroll stride vs CSS gap
- [ ] Loved-stage read/write scope asymmetry
- [ ] Track `play_count` frozen by the skip heuristic
- [ ] Repair effect looping forever
- [ ] Prefetch key / `queryFn` / `staleTime` mismatch
- [ ] External identifier compared exactly against a local one
- [ ] `?? fallback` rendering during `isPending`
- [ ] `useDeferredValue` used as a debounce

---

## Suggested order of work

1. Section 0 (infra) - one session.
2. Section 1 (pure functions) - fast wins, builds confidence in the harness.
3. Section 2 (player store) - the riskiest code, and where the regression list concentrates.
4. Section 3 (migrations + sync) - needs the SQLite harness from section 0.
5. Section 6 (Rust pure fns) - independent, can be done in parallel.
6. Section 4 (hooks), then 5 (components).
7. Section 7 (integration) only once the layers below are green.

After step 3, the baseline is real enough to switch to TDD for all new work. Sections 4-7 can then land opportunistically: when a bug is found in an untested area, the test comes first.
