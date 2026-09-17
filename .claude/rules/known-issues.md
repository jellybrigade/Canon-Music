# Known Issues & Platform Gotchas

Bug classes that already shipped once. Full entries, greps and forensics live in
`.claude/rules/known-issues/<area>.md`, glob-scoped so they load automatically when
you touch matching code. This index is always loaded; lesson headings only.
Fixed unless marked OPEN.

## Platform (Linux / WebKitGTK / audio) - `known-issues/platform.md`

- Left-click popup self-closes.
- Freeze/thaw compositor crash.
- ALSA underrun under load.
- Read-only rusqlite can't own WAL `-shm`.
- Unbounded thread-per-request -> SIGKILL.
- Webview honours PAC, Rust does not; a dead PAC stalls only half of Canon.
- WebKit's `err.stack` carries no message line, so logging the stack alone loses the error.
- "Load failed" ~25s = systemd-resolved, not Canon.
- Two HTTP stacks also means two certificate stores.
- "Something answered" is not "the right thing answered".
- A diagnosis collected and used only for the message text is not a decision.

## Build / release pipeline - `known-issues/build.md`

- Test-only devDependency breaks the release build.
- `commit-msg` runs before git's own message cleanup.
- Message-shape hook must exempt the release merge commit.
- Green release page != complete release.

## Async / lifecycle - `known-issues/async.md`

- Caller-id temp file is single-writer only if TS enforces it.
- Handler resuming post-await: check intent, not state.
- Shared cancel token cancels intent, not effect.
- Fast path around central action skips its guards.
- Pause branch owes elapsed ticker the same stop.
- Fire-and-forget command owes event on every exit.
- Pre-scheduled work must carry its decision.
- `await invoke()` loading flag = IPC round trip, not work.
- Timeout cleared on first-phase settle doesn't bound the rest.
- "Stream ended" vs "stream stopped" = different signals.
- Un-abortable promise: cleanup can't reach handlers it didn't create yet.
- Resource acquired via await must escape its own cleanup.
- Router-owned callback in a deps array re-arms the listener it is named in.
- Module-scoped promise memo assigned only on the success side stays poisoned.
- Guard keyed on one error type != the broad condition.
- A result from the previous key is still visible to the commit that switches the key.
- A mounted flag cleared only in cleanup is false for good under StrictMode.
- A one-shot report of live state is wrong from the moment the state moves.
- An endpoint's idempotency can live in a parameter, not in its name.

## Test / harness - `known-issues/testing.md`

- Library `afterEach` hooks only self-register under `globals: true`.
- Time it before theorising.
- Large fake-time advance = one iteration per live tick.
- Boundary test pays fixture cost per boundary unit.
- Accessible-name query = whole-tree scan, 150-300ms/call.
- Shared mock `Response` breaks on double body read.
- Fixed sleep pays ceiling every run; per-case rebuild pays per case.
- A timeout ceiling set against an idle machine is measured against a busy one.
- A real sleep inside a real debounce window is a race, not a wait.
- Self-registered listener state update isn't flushed by `act`.

## Data / state - `known-issues/data.md`

- Claim stamped on start, cleared only on success = stuck after first failure.
- Per-mount claim keyed by arg breaks on arg change within mount.
- Parallel-array invariant enforced by one writer breaks under others.
- Parallel-array invariant skipped by one writer = broken by that writer.
- "Safe copy" helper must copy every path, including no-op.
- Restore path writing `currentTrack` without loading engine = unplayable.
- Upsert-only sync diverges from source, feeds itself.
- Paging loop bounded only by server-controlled exit = unbounded.
- Cache table inherits prune-exemption meant for user rows beside it.
- Loop-body filter instead of SQL costs whole table per pass.
- Retry on rejected write assumes it never landed.
- Partial delete from ordered table needs renumber; membership-diff can't see holes.
- Two failures suppressing same write need the same report.
- Interval-only progress never lands on end; wrong-quantity gate never lands on start.
- Cache-forever value worthless if a second caller re-fetches it.
- `retry: false` for permanent failures also kills self-healing ones.
- Skip fast-path freezes columns only that path writes.
- Drain loop breaking on any error blocks on first permanent failure.
- Effect bailing on unfilled ref never runs.
- Local-only query must not gate on network credential.
- Repair effect invalidating its own trigger loops forever.
- Re-keying collection to ids means re-keying every cursor/anchor/count/gate.
- "Is there a value" cache-hit test can't cache "there is none".
- Inline `queryKey` = nothing else can invalidate it.
- Duplicated prefetch warms a key nobody reads.
- Bare column under `GROUP BY`, and a `LIMIT` cut on a non-unique key, both pick arbitrarily.
- Cap check that runs before the write evicts for a write that adds nothing.
- A computed number reaching a URL is a cache key; clamp it at the one writer.
- `!` on an optional id ships the string "undefined" to the server, and caches it.
- `LIMIT` without `ORDER BY` silently redefines results.
- External identifier != local one on exact compare.
- Unscoped mirror depends entirely on its delete path.
- Globally-unique id lookup hides wrong-server rows.
- Artist name isn't an owner; name-keyed read returns every server's rows.
- Guard holding only because of data shape isn't a guard.
- Secret written before owning row outlives the row.
- Cleanup treating "already gone" as failure = permanent mess.
- "Just finished" test built from restore-shared state fires at startup too.
- Statement sequence with invalid intermediate states is a transaction.
- One-direction version compare can't say "too new".
- A counter fed by every request of one burst counts one event many times.
- A refusal from a circuit breaker is not evidence about the record it was raised on.
- Process-wide state for a per-server fact answers for servers it never saw.
- A skip fast-path is only as good as a probe of the thing it skips.
- A server-assigned id is a cache, not an identity.
- A hand-kept list of the tables one id reaches is a list that goes stale.
- Watermark upstream identity, not only per-row timestamps.
- Progress recorded only when a pass completes means a pass that keeps failing never completes.
- A 2xx body is not the type you asked for.
- Transaction real only if statements share a connection.
- A stand-in for a missing measurement must not be the value that binds the limit.
- A rename escapes the prune, so every mirror keyed by the old id is orphaned forever.
- A flag meaning "the user asked for this" must not be spelled as state a fallback can flatten.
- Per-statement conflict handling decides per statement, not per record.
- Global state holding server-scoped ids outlives the server that issued them.
- Rows whose owner row is gone are unreachable, not stale, and nothing sweeps them.
- An empty read and a broken button look the same to the user.
- A fixed edit distance is a bigger share of a short key, and file order is not a tiebreak.

## UI - `known-issues/ui.md`

- Window-level `preventDefault` shortcut needs per-branch focus guard.
- Overlay's own Escape answers "am I open", not "am I on top".
- Hand-kept stacking list only covers what its author saw.
- Backdrop `click` dismiss fires on a gesture that only ended there.
- `Number(x) || fallback` deletes a legal zero.
- Non-URL render state must be dismissed by navigation intent, not pathname change.
- Dismissal at same priority as its navigation can't land first.
- Navigating to the page already showing pushes a duplicate history entry.
- `location.key === "default"` stops marking the first entry once that entry is replaced.
- Router value copied into `useState` never resyncs while the route stays mounted.
- `null` for "don't know yet" and "isn't there" paints the same blank page.
- Prerequisite gate is a state machine too; confident-wrong beats blank-wrong, but both are wrong.
- An error path that builds its own value can fail before delivering the message.
- Decoding an already-decoded value = no-op or crash.
- Partial opt-out of global base rule keeps properties it forgot. **OPEN, 37 instances.**
- Hit-area halo grown toward a neighbour steals its clicks.
- Overlay sized to its container breaks when the container's shape varies.
- A grid cell that can render `null` hands its column to the next sibling.
- TS geometry constant restating CSS value drifts silently.
- Layout constant applied by hand is invisible to library computing offsets.
