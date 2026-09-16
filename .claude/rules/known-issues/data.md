---
description: Known data/state bugs already shipped once - full detail
globs:
  - "src/lib/**"
  - "src/db/**"
  - "src/hooks/**"
  - "src/store/**"
  - "src/app/**"
  - "src/components/**"
---

# Data / state

Bug classes that already shipped once. Heading = lesson. Greps kept, forensics in git.
Fixed unless marked OPEN.

- **Claim stamped on start, cleared only on success = stuck after first failure.** `useLibrarySync`: bounded backoff `[30s, 2min, 5min]`. `useEnrichAlbumTracks`: clear ref in `.catch`. Every terminal path decides the flag.
  ```
  grep -rn "Ref.current = " src/hooks --include='*.ts*' | grep -v '\.test\.'
  ```
- **Per-mount claim keyed by arg breaks on arg change within mount.** `useRef(false)` in unkeyed components (e.g. `AlbumDetail`) suppressed re-runs across cached-item navigation. Fix: ref holds id (`ranRef.current === albumId`).
  ```
  grep -rn "useRef(false)" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Parallel-array invariant enforced by one writer breaks under others.** `shuffleOrder.length === queue.length`; `normalizeShuffleOrder` repairs before splice sites.
- **Parallel-array invariant skipped by one writer = broken by that writer.** `removeFromQueue`/`removeManyFromQueue` indexed `shuffleOrder[position]` without normalizing; short restored order removed wrong track. Fix: normalize before index.
  ```
  grep -rn "shuffleOrder\[.*\]!" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **"Safe copy" helper must copy every path, including no-op.** `return [...order]` always, else reference equality kills re-render.
- **Restore path writing `currentTrack` without loading engine = unplayable.** `resume()` treats null `streamUrl` as error; server restore uses state-only `restoreQueue`.
- **Upsert-only sync diverges from source, feeds itself.** `syncLibrary` prunes rows absent from fetch, refuses empty/partial fetch.
- **Paging loop bounded only by server-controlled exit = unbounded.** `fetchAllAlbums` looped forever on `offset`-ignoring server. Fix: repeated first id throws, offset capped 500,000.
  ```
  grep -rn "while (true)\|while(true)" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Cache table inherits prune-exemption meant for user rows beside it.** `pruneAlbums` skipped `album_covers` (base64 cache) alongside genuinely-kept identity tables, stranding bytes forever. Exempt only if own content justifies it.
  ```
  grep -n "viaAlbums(\"\|DELETE FROM album" src/lib/sync.ts
  ```
- **Loop-body filter instead of SQL costs whole table per pass.** `useScrobbleFlush` selected all `scrobble_queue`, `continue`d past other-server rows forever. Fix: scope read + count on `track_id LIKE ? ESCAPE '\\'`.
  ```
  grep -rn "continue;" src/hooks src/lib --include='*.ts*' | grep -v '\.test\.'
  ```
- **Retry on rejected write assumes it never landed.** `useScrobble` re-queued on any rejection, double-scrobbled when only response was lost. Fix: timestamp once per play, retry re-reads row first.
  ```
  grep -rn "\.catch(" src/hooks --include='*.ts*' | grep -v '\.test\.' | grep -iE "retry|current = false|current = null"
  ```
- **Partial delete from ordered table needs renumber; membership-diff can't see holes.** Pruned tracks left `playlist_tracks.position` gaps invisible to membership checks; next removal deleted wrong track. Fix: `holedPlaylists` set feeds both gates.
  ```
  grep -rn "playlist_tracks" src --include='*.ts*' | grep -v '\.test\.' | grep -v "playlist_id = ?\|playlist_id IN\|INSERT"
  ```
- **Two failures suppressing same write need the same report.** Only listing-failure pushed `skippedStages`; per-playlist fetch failure blocked writes silently. Fix: push sits with the blocking flag.
  ```
  grep -n "skippedStages.push\|Blocked = true\|Incomplete = true" src/lib/sync.ts
  ```
- **Interval-only progress never lands on end; wrong-quantity gate never lands on start.** `onAlbumBatch` fired every 25th, nothing after loop; opening tick gated on upsert writes, missed track-only runs. Fix: one `reportProgress` gated on actual work queue.
  ```
  grep -rn "% BATCH_NOTIFY_INTERVAL\|% NOTIFY_INTERVAL\|Count % " src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Cache-forever value worthless if a second caller re-fetches it.** `useServerWithCredential` cached keychain forever; `syncLibrary` opened same entry itself, doubling D-Bus calls at launch. Fix: credential passed as param.
  ```
  grep -rn "keychain\.get\|invoke(\"get_credential\"" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **`retry: false` for permanent failures also kills self-healing ones.** Locked-but-not-yet-running secret store (autostart race) treated as permanent, stranding app since query cached forever. Fix: transient keyring failures told apart at source, 31s retry ladder, **Try again** backstop.
  ```
  grep -rn "retry: false" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Skip fast-path freezes columns only that path writes.** `tracks.play_count` froze while `albums.play_count` moved. New skip -> list what it solely writes.
- **Drain loop breaking on any error blocks on first permanent failure.** `useScrobbleFlush` drops error 70, still breaks 40/41/50; `flushing` flag prevents overlap.
- **Effect bailing on unfilled ref never runs.** Deps `[ref, key]` + early return on null `ref.current` = dead if target renders conditionally after error/skeleton. Fix: readiness as dep, or callback ref (`useMeasuredElement`).
  ```
  grep -rn -B1 "if (!el) return\|if (!container) return" src/components src/hooks --include='*.ts*' | grep -v '\.test\.' | grep "Ref\.current\|ref\.current"
  ```
- **Local-only query must not gate on network credential.** `CommandPalette` / Diagnostics count keyed `enabled` off `serverWithCredential?.server.id` despite no network use; hung on keychain failure. Gate only if `queryFn` needs the token.
  ```
  grep -rn "serverWithCred.*\.server\.id\|serverWithCredential?.server.id" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Repair effect invalidating its own trigger loops forever.** `AlbumDetail` marks album id attempted *before* repairing.
- **Re-keying collection to ids means re-keying every cursor/anchor/count/gate.** `TrackTableView` kept numeric shift-anchor + raw `.size` after `Set<string>` move.
  ```
  grep -rn "useRef<number" src --include='*.tsx' | grep -v '\.test\.'
  grep -rn "Ids\.size\s*[<>=]" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **"Is there a value" cache-hit test can't cache "there is none".** `useLyrics` treated null row as miss, re-ran every lookup for no-lyrics tracks forever. Fix: `"cleared"` sentinel marks completed empty lookup.
  ```
  grep -rn "if (cached\|if (rows\[0\]\|if (hit\|cached\.length > 0" src/hooks src/lib --include='*.ts*' | grep -v '\.test\.'
  ```
- **Inline `queryKey` = nothing else can invalidate it.** Album/artist detail routes' inline keys survived background `UPDATE`s stale for whole `staleTime`. Fix: shared nested `QK.*` constants.
  ```
  grep -rn "queryKey: \[" src --include='*.ts*' | grep -v '\.test\.' | grep -v "QK\."
  ```
- **Duplicated prefetch warms a key nobody reads.** Key/`queryFn`/`staleTime` must be byte-identical; shared in `now-playing-queries.ts`. **Repo-wide: `ESCAPE '\'` in TS string = `ESCAPE ''`, throws - write `ESCAPE '\\'`.**
- **A bare column under `GROUP BY`, and a `LIMIT` cut on a non-unique key, both pick arbitrarily.** `query_artists` took `artwork_url` bare from its per-artist group, so a tile's portrait changed after unrelated writes; `query_recent_genres`' fallback ordered by `album_count` alone, so the 18th/19th genre swapped between refreshes. Fix: `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY navidrome_created DESC, year DESC, id)` and a `name COLLATE NOCASE` tiebreaker. Ask of any aggregate: which row is this, and would two runs agree? **Found again in the branch beside it:** the first fix landed only on the fallback, which runs for a user with no scrobble history, while the branch that actually runs ordered by `MAX(last_played)` alone - and one played album contributes several genres, all tied on it, so ties were the normal case rather than an edge. Fix a tiebreak on every branch of the query, not the one the test reached, and prefer `MIN(name)` over a bare `name` even where the name looks functionally dependent on the group key (a genre rename re-normalizes albums incrementally, so two names share one `canonical_id` until the last album is reprocessed).
  ```
  grep -n "GROUP BY" src-tauri/src/*.rs | grep -v "COUNT(\|MIN(\|MAX(\|SUM("
  grep -rn "LIMIT" src-tauri/src/*.rs src --include='*.ts*' | grep -v '\.test\.' | grep -v "ORDER BY"
  ```
- **Cap check that runs before the write evicts for a write that adds nothing.** `cappedSet` compared `size >= maxEntries` without asking whether the key was already held, so the cover and artist caches dropped a live entry on every plain overwrite and ran permanently at one entry under their own workload. Fix: `!cache.has(key) &&` in front of the check. Insertion order, not LRU, is the documented semantics. **Found 3x:** `artColor.ts` and `artBlur.ts` hand-rolled the same pre-write check, reachable because neither dedups in-flight work, so two components mounting on one cover URL both miss and both write. Now enforced repo-wide by `src/lib/capped-cache-guard.test.ts`. The comparison tells the two spellings apart: a cap checked *before* the write is `>= MAX` and needs the `has` guard, one checked *after* a delete-then-set write is `> MAX` and is already safe.
  ```
  grep -rn "\.size >= \|\.size > " src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A computed number reaching a URL is a cache key; clamp it at the one writer.** `getCoverArtUrl` interpolated `size` raw, so `NaN`/fractional/negative values (`size * 2` at one call site) reached the URL. Rust falls back to 300 but caches under `{id}:{size}` with the bogus string, fragmenting the disk cache and every memo key built from the URL. Fix: `Number.isFinite(size) ? Math.max(1, Math.round(size)) : 300`.
  ```
  grep -rn "?size=\${\|params.set(\"size\"" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **`!` on an optional id ships the string "undefined" to the server, and caches it.** `HomeView`'s For-You tile was the one unguarded `!` of 30 `getCoverArtUrl` call sites: `encodeURIComponent(undefined)` requested a cover named `"undefined"`, cached forever under `"undefined:300"`, once per artless album. Enforced repo-wide by `src/lib/cover-art-guard.test.ts`, which sweeps the call sites rather than trusting the next one written. **A sweep owes its own reach a test:** the first version matched `!` only at the end of the argument (missing it inside a ternary or before `??`) and split arguments on bracket depth alone, so one comma inside a string, template or comment shifted every later argument and the cover id stopped being `args[3]` - blind in exactly the call nobody looked at.
  ```
  grep -rn "getCoverArtUrl(" src --include='*.tsx' | grep '!'
  ```
- **`LIMIT` without `ORDER BY` silently redefines results.** FTS ranks by weighted `bm25` in `MATERIALIZED` CTE before cap. Also: `useDeferredValue` defers rendering, not fetching.
- **External identifier != local one on exact compare.** Last.fm artist names: both sides `LOWER(TRIM(...))`, ownership unions `artist_aliases`.
- **Unscoped mirror depends entirely on its delete path.** `purgeServerData` runs before `servers` row delete. **Found 4x: grep any `server_id:` literal not from the source row.**
- **Globally-unique id lookup hides wrong-server rows.** `AlbumDetailRoute`'s `FROM albums WHERE id = ?` never wrong-row (ids unique) but could be right-row-wrong-server, painting foreign cover/stream URLs. Fix: WHERE + query key both carry `server_id`.
  ```
  grep -rln "serverWithCred\|ServerWithCredential" src --include='*.ts*' | grep -v '\.test\.' | xargs grep -n "FROM albums WHERE id\|FROM tracks WHERE id\|FROM artists WHERE\|FROM playlists WHERE id" | grep -v server_id
  ```
- **Artist name isn't an owner; name-keyed read returns every server's rows.** 8 unscoped `albums`/`tracks` artist-column reads leaked cross-server (wrong art, unplayable radio seeds). Enforced by `src/lib/server-scoping.test.ts`.
  ```
  python3 - <<'PY'
  import re, glob
  read = re.compile(r'`([^`]*\bSELECT\b[^`]*\b(?:FROM|JOIN)\s+(?:albums|tracks)\b[^`]*)`', re.S)
  for f in sorted(glob.glob('src/**/*.ts', recursive=True) + glob.glob('src/**/*.tsx', recursive=True)):
      if '.test.' in f: continue
      for m in read.finditer(open(f).read()):
          sql = m.group(1)
          if re.search(r'\b\w*\.?artist\s*(?:=\s*\?|IN\s*\(|LIKE\s*\?)', sql) and not re.search(r'\bserver_id\s*=\s*\?', sql):
              print(f, ' '.join(sql.split())[:90])
  PY
  ```
- **Guard holding only because of data shape isn't a guard.** 5 `LIKE ?` binds no `ESCAPE`, safe only while ids are UUIDs. Fix: `escapeLike` in `src/lib/sql.ts`, enforced by `src/lib/sql-escaping.test.ts`.
  ```
  grep -rn "LIKE ?" src --include='*.ts*' | grep -v '\.test\.' | grep -v ESCAPE
  ```
- **Secret written before owning row outlives the row.** Insert rolls back keychain write; removal deletes secret first, aborts loudly. `keychain.get` rejects on missing entry - null-check callers are dead code; query wants `retry: false`.
- **Cleanup treating "already gone" as failure = permanent mess.** Server removal aborted on keychain-delete rejection, stranding servers with already-lost secrets forever. Fix: `ignore_missing_entry` folds keyring `NoEntry` into `Ok`.
  ```
  grep -rn "keychain\.delete\|keychain\.get" src --include='*.ts*' | grep -v '\.test\.' | grep -v "catch"
  ```
- **"Just finished" test built from restore-shared state fires at startup too.** `useRadio` needs `hasPlayedRef` witness. Side-effect starts belong in handlers, not effects.
  ```
  grep -rn "playFromQueueIndex(\|playTrack(\|playQueue(\|\.resume()" src/hooks src/App.tsx | grep -v "\.test\."
  ```
- **A counter fed by every request of one burst counts one event many times.** The transport breaker treated each of N requests stalling together as separate evidence: the first opened it, and every other in-flight ladder then re-opened it, walking the 15s/60s/300s cooldown to its top in one burst and spending one `probe_server` per request. Shared module state has to ask whether the thing it is counting already happened; here the breaker being open *is* that answer, so a re-open inside its own cooldown is ignored. Ask of any counter behind a slow operation: how many callers are inside it right now?
  ```
  grep -rnE "^(let|const) \w+ = (0|new Map|new Set)" src/lib src/hooks --include='*.ts*' | grep -v '\.test\.'
  ```
- **Process-wide state for a per-server fact answers for servers it never saw.** The breaker was one global set of counters, so a stall against one Navidrome failed requests to a different one, and did it with a message naming an address that caller never asked about. Same shape as the `server_id` scoping rule one row up, applied to memory instead of SQL: state about a server is keyed by that server. Its self-healing path also needs an exemption, so `ping.view` always gets its ladder and Settings can re-test.
  ```
  grep -rnE "^(let|const) \w+(: [^=]+)? = " src/lib --include='*.ts*' | grep -v '\.test\.' | grep -vE "=>|function|\[\]|\bnew (RegExp|URL)\b"
  ```
- **A skip fast-path is only as good as a probe of the thing it skips.** `syncLibrary`'s `skipTracks` was keyed on `navidrome_created` + `songCount`, both album columns. Navidrome 0.64 rewrote ~87% of track ids and left every album row byte-identical, so the track pass was skipped for all 1512 albums and the mirror could never heal, on any number of syncs. Fix: three mirrored track ids drawn at random go through `songExists` before the album loop, and one Subsonic 70 disables the skip for the whole run. Only a 70 counts - a transport failure or a rejected credential says nothing about the id, and reading it as a miss turns every offline moment into a full pass. Ask of any skip gate: what evidence do I have about the rows I am *not* reading?
  ```
  grep -rn "skip\|unchanged" src/lib/sync.ts | grep -v '^\s*//'
  ```
- **A server-assigned id is a cache, not an identity.** Navidrome 0.64 re-encoded ~87% of its track ids without touching a file, so to Canon's prune every one of those tracks looked deleted and re-added: loved state, lyrics, waveforms, queued scrobbles and resume positions all died with the row, and no number of syncs brought them back. Fix: `planTrackIdRemap` (`src/lib/track-remap.ts`) pairs a mirrored row whose id the server stopped using with the fetched track holding the same `file_path`, and `remap_track_ids` (`library_write.rs`) carries every track-keyed row onto the new id in one transaction, before the upsert writes the new row and before the prune runs. Exact match on the path, since it is the server's own bytes; any ambiguity (no path, a path claimed twice on either side, a destination id the mirror already holds) means no evidence and the row goes to the prune. Store the natural key beside the assigned one, or the next id migration is a data loss.
  ```
  grep -rn "file_path" src/lib/sync.ts src/lib/track-remap.ts
  ```
- **A hand-kept list of the tables one id reaches is a list that goes stale.** The prune, the server purge and the remap each need "every table keyed by a track id", and three copies means the twelfth table is in one of them. Fix: `src/db/track-id-tables.ts` holds the list with per-table policy, `track-id-tables.test.ts` sweeps `migrations.ts` for any table it missed and pins the Rust copy against it (the remap runs in a transaction, so it cannot read the TS list). A registry the members are swept into beats an enumeration someone maintains.
  ```
  grep -rn "track_id\b" src/db/migrations.ts | grep -c "" && grep -n "TRACK_ID_TABLES" src/db/track-id-tables.ts src-tauri/src/library_write.rs
  ```
- **Watermark upstream identity, not only per-row timestamps.** Per-row mtimes cannot see a migration that rewrote the rows' keys, because the rows they sit on did not move. `servers.server_version` / `last_scan_at` / `song_count` (v49) come from `getScanStatus` at the top of every sync and any of the three moving forces a full track pass. Two halves that are easy to get wrong: `getScanStatus` is admin-only on some deployments, so a failure is "no evidence" and falls through to the probe rather than counting as "unchanged"; and the new watermark is stored only after a pass that completed, since storing it after an early break tells the next sync those albums were read and erases the evidence that they were not.
  ```
  grep -rn "getScanStatus\|last_scan_at\|server_version" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A 2xx body is not the type you asked for.** Subsonic rides its errors on HTTP 200 with `content-type: application/json`, so `audio_play`'s status check passed and `{"error":{"code":70}}` went into `Decoder::new`, which reported "This file could not be decoded" - blaming the file for a track id Navidrome 0.64 had rewritten. Every mirrored track in the library was unplayable and the message named the wrong cause. Fix: `stream_classify.rs::classify_stream_response` reads the head of the body first and names the real error; the prefetch cache and the gapless path run it too, or a poisoned cache entry walks straight past the live path's guard. Conservative by design: only a parsed envelope, an empty body or plainly-textual bytes are refused, since the decoder knows more containers than the classifier does. Any consumer of a binary body (stream, cover art, waveform source) owes the same check.
  **Found again in the guard written for it:** the cover proxy substitutes `image/jpeg` when the
  response carries no `Content-Type`, purely to have something to store beside the bytes, and then
  handed that substitute to `is_image_response` - which trusts any `image/` prefix before it looks
  at a byte. A header-less error body therefore walked into the memory *and* disk caches under
  `{id}:{size}`, the permanent breakage the guard exists to stop. A stand-in value must never be
  the evidence a check runs on: the guard now takes `Option<&str>` (absent means magic bytes or
  nothing) and refuses an `image/` claim over a body carrying `subsonic-response`.
  ```
  grep -rn "Decoder::new\|::load_from_memory\|image::load" src-tauri/src | grep -v '#\[cfg(test)\]'
  grep -rn "unwrap_or(\"image/\|unwrap_or(\"audio/\|unwrap_or(\"application/" src-tauri/src
  ```
- **A stand-in for a missing measurement must not be the value that binds the limit.** ReplayGain
  peak is optional in the tags, and `computeReplayGainLinear` substituted `1.0` for an absent one
  before clamping `linear` to `1.0 / peak` - so "no peak" meant a full-scale peak, the cap bound at
  unity gain, and every positive pre-amp or fallback gain was silently thrown away. Measured on the
  real mirror: 16,521 of 17,678 tracks carry no ReplayGain at all, so this was the normal path, not
  an edge - the pre-amp slider did nothing for 93% of the library while reading as applied. Fix: an
  absent or non-positive peak means there is nothing to clip against, so no cap is applied at all
  (`nokkvi/data/src/audio/normalization.rs:88` is the same shape). The same pass made the gain
  fallback symmetric: album mode already fell through to track gain, track mode dropped straight
  past an available album gain to the constant. Ask of any default filling in for absent evidence:
  is it neutral, or is it the extreme that decides the outcome?
  ```
  grep -rnE "Math\.(min|max)\([^)]*\?\?" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A rename escapes the prune, so every mirror keyed by the old id is orphaned forever.**
  `remap_track_ids` rewrites `tracks.id` instead of deleting the row, which is the whole point -
  but `tracks_fts` was left out of the carry on the grounds that the sync rebuilds it, and the
  rebuild deletes `WHERE id IN (SELECT id FROM tracks WHERE album_id IN (...))`, i.e. by the *new*
  ids. Nothing could reach the old id again: not the rebuild, not `pruneAlbums`, not
  `purgeServerData`, all of which subselect `tracks`. On a Navidrome 0.64 migration that is ~15k
  dead rows in a 17.6k-track library, and they are not merely stale - `useSearch` ranks and caps
  its pool at 2000 rows *before* joining `tracks`, so orphans take slots from real matches and a
  broad query returns a fraction of them. Fix: one writer, `rebuildTracksFts(db, albumIds,
  staleTrackIds)`, deleting by explicit old id as well as by album, called by the sync, the
  play-time repair and `syncAlbumTracks` alike. Ask of any id rewrite: which tables did I decide
  not to carry, and what deletes their old row now that the prune cannot see it?
  ```
  grep -rn "SET id = \|SET track_id = " src src-tauri/src | grep -v '\.test\.'
  ```
- **A flag meaning "the user asked for this" must not be spelled as state a fallback can flatten.**
  Settings' **Resync library** cleared the sync watermark and started a sync, inferring intent from
  the cleared columns - but `watermarkMoved` returns false outright when `getScanStatus` is
  unreadable, which it is on any deployment restricting it to admins. The only remaining gate was
  the 3-id probe, which passes whenever the sampled ids happen to resolve: exactly the state a user
  reaches for the button in. The button reported success and ran the same skipped sync. Fix:
  `syncLibrary(..., { forceTrackPass: true })`, an explicit parameter; the watermark clear stays,
  but only so an interrupted resync is repeated by the next sync. A request is a parameter, not a
  reading of the world.
  ```
  grep -rn "clearSyncWatermark\|forceTrackPass" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Per-statement conflict handling decides per statement, not per record.** The id remap ran
  `UPDATE OR IGNORE` over nine tables and let each decide the collision for itself, but `OR IGNORE`
  only declines where a uniqueness constraint exists: `scrobble_queue` (plain `track_id`) and
  `playlist_resume` (keyed by `playlist_id`) have none, so when the destination id already held a
  row, the user's queued scrobbles and resume position moved onto a track that kept its own id
  while `tracks` correctly refused. The test that named the case asserted on `tracks` alone and
  passed throughout. Fix: one `SELECT EXISTS` on the destination per track, before any table is
  touched. A record-level decision belongs above the statements, not inside each of them.
  ```
  grep -rn "OR IGNORE\|ON CONFLICT DO NOTHING" src-tauri/src src --include='*.rs' --include='*.ts' | grep -v '\.test\.'
  ```
- **Global state holding server-scoped ids outlives the server that issued them.** Removing a
  server purges every `server_id`-owned table, but `queue_state` and `radio_seed` are single
  global `settings` rows whose values are full track objects carrying `{serverId}:{nativeId}`
  ids. Deleting the server and re-adding it through the wizard mints a fresh UUID, so
  `loadSettings` restored a queue and a current track belonging to a server that no longer
  existed, and the first consumer to reach for a stream URL threw `id "<old>:..." missing
  expected server prefix "<new>:"` in the user's face on a freshly set-up install - with
  nothing playable and no way back. The purge could not fix it: the row is not scoped to one
  server, so on a two-server library blanket-deleting it would throw away the other server's
  queue. The reader is the only place that can decide, so `loadSettings` reads
  `SELECT id FROM servers` once (only when one of those two rows is non-empty) and drops the
  whole snapshot unless every id in it, `currentTrack` included - a partial restore leaves
  `queueIndex` and `shuffleOrder` pointing at the holes. A stranded seed also clears
  `radioActive`/`radioLabel`, decided after the loop because those are separate rows arriving
  in any order. Audited beside them: `display.album_suffix_excluded_ids` holds album ids too,
  but only ever `.includes()`-compares them, so a stranded id is inert. Ask of any global
  state: whose ids are in it, and what happens when that owner is deleted?
  ```
  grep -rn "INTO settings (key, value) VALUES ('" src --include='*.ts*' | grep -v '\.test\.' | grep -iE "queue|radio|ids|track|album"
  grep -rn "useSetting(\"" src --include='*.ts*' | grep -v '\.test\.' | grep -iE "ids|track|album|queue"
  grep -n "SELECT id FROM servers" src/store/player.ts
  ```
- **Rows whose owner row is gone are unreachable, not stale, and nothing sweeps them.**
  After a server was removed and re-added through the wizard, the live library still held
  6672 `tracks` rows, all 257 `loved_tracks` and a queued scrobble under the old server id,
  while that server's `albums`, `artists` and `playlists` were gone - the exact inverse of
  `purgeServerData`'s statement order, so the purge did not run to completion. It cannot
  self-heal: every read is scoped by `server_id`, every prune subselects the server's own
  albums, and a server with no `servers` row never triggers a sync, so the rows are
  permanently invisible *and* permanently undeletable. Orphans are not merely wasted bytes -
  `useSearch` caps its pool before joining `tracks`, so they take slots from real matches.
  Fix: `purgeStrandedServers` (`src/lib/sync.ts`), run once from `main.tsx` after the DB
  opens, diffs the `server_id`s in the mirrored tables against `servers` and purges each one
  left over. A delete path that has to finish is a delete path that needs a sweep behind it.
  ```
  grep -rn "purgeStrandedServers" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **An empty read and a broken button look the same to the user.** Every whole-album play
  path (`usePlayAlbum`, `useAddAlbumToQueue`, and two open-coded copies in `App.tsx`) read
  the album's tracks and did `if (tracks.length === 0) return;`. A sync that stopped at its
  consecutive-failure break leaves most albums with no track rows at all - 1248 of 1517 on
  the reported install - so clicking play did nothing, with no message, no error and no way
  to tell it from a dead control. The album page did say something, but what it said was to
  run a library sync, which is the thing that had already failed. Fix: one
  `loadAlbumTracks` (`src/lib/albumTracks.ts`) fetches the album on a miss, so opening or
  playing an album repairs it. Ask of any silent `return` on an empty list: what did the
  user just click, and how do they find out nothing happened?
  ```
  grep -rn "length === 0) return" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Statement sequence with invalid intermediate states is a transaction.** `runMigrations` wraps each block + version row in `BEGIN`/`COMMIT`, `ROLLBACK` rethrows original error.
- **One-direction version compare can't say "too new".** `LATEST_SCHEMA_VERSION` + `SchemaTooNewError` (`>`, not `>=`), `DatabaseErrorScreen`, no retry button.
- **Transaction real only if statements share a connection.** `tauri-plugin-sql` pools 10 connections, no affinity - TS `BEGIN` from a user gesture is silent no-op + deadlock. Multi-write mutations go `src-tauri/src/library_write.rs`; `src/db/migrations.ts` is the only legit TS `BEGIN`.
  ```
  grep -rn '"BEGIN"\|BEGIN TRANSACTION' src --include='*.ts*' | grep -v '\.test\.'
  ```
