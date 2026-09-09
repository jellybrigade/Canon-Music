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
- "Load failed" ~25s = systemd-resolved, not Canon.

## Build / release pipeline - `known-issues/build.md`

- Test-only devDependency breaks the release build.
- `commit-msg` runs before git's own message cleanup.
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
- Guard keyed on one error type != the broad condition.

## Test / harness - `known-issues/testing.md`

- Time it before theorising.
- Large fake-time advance = one iteration per live tick.
- Boundary test pays fixture cost per boundary unit.
- Accessible-name query = whole-tree scan, 150-300ms/call.
- Shared mock `Response` breaks on double body read.
- Fixed sleep pays ceiling every run; per-case rebuild pays per case.
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
- Transaction real only if statements share a connection.

## UI - `known-issues/ui.md`

- Window-level `preventDefault` shortcut needs per-branch focus guard.
- Overlay's own Escape answers "am I open", not "am I on top".
- Hand-kept stacking list only covers what its author saw.
- Backdrop `click` dismiss fires on a gesture that only ended there.
- `Number(x) || fallback` deletes a legal zero.
- Non-URL render state must be dismissed by navigation intent, not pathname change.
- Dismissal at same priority as its navigation can't land first.
- `null` for "don't know yet" and "isn't there" paints the same blank page.
- Prerequisite gate is a state machine too; confident-wrong beats blank-wrong, but both are wrong.
- Decoding an already-decoded value = no-op or crash.
- Partial opt-out of global base rule keeps properties it forgot. **OPEN, 37 instances.**
- Overlay sized to its container breaks when the container's shape varies.
- TS geometry constant restating CSS value drifts silently.
- Layout constant applied by hand is invisible to library computing offsets.
