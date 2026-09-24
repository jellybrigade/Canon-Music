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
  grep -rn "Ref.current = " src/hooks src/ui src/features --include='*.ts*' | grep -v '\.test\.'
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
  grep -n "viaAlbums(\"\|DELETE FROM album" src/features/sync/syncPrune.ts
  ```
- **Loop-body filter instead of SQL costs whole table per pass.** `useScrobbleFlush` selected all `scrobble_queue`, `continue`d past other-server rows forever. Fix: scope read + count on `track_id LIKE ? ESCAPE '\\'`.
  ```
  grep -rn "continue;" src/hooks src/ui src/lib src/clients src/features --include='*.ts*' | grep -v '\.test\.'
  ```
- **Retry on rejected write assumes it never landed.** `useScrobble` re-queued on any rejection, double-scrobbled when only response was lost. Fix: timestamp once per play, retry re-reads row first.
  ```
  grep -rn "\.catch(" src/hooks src/ui src/features --include='*.ts*' | grep -v '\.test\.' | grep -iE "retry|current = false|current = null"
  ```
- **Partial delete from ordered table needs renumber; membership-diff can't see holes.** Pruned tracks left `playlist_tracks.position` gaps invisible to membership checks; next removal deleted wrong track. Fix: `holedPlaylists` set feeds both gates.
  ```
  grep -rn "playlist_tracks" src --include='*.ts*' | grep -v '\.test\.' | grep -v "playlist_id = ?\|playlist_id IN\|INSERT"
  ```
- **Two failures suppressing same write need the same report.** Only listing-failure pushed `skippedStages`; per-playlist fetch failure blocked writes silently. Fix: push sits with the blocking flag.
  ```
  grep -n "skippedStages.push\|Blocked = true\|Incomplete = true" src/features/sync/sync.ts src/features/sync/syncLoved.ts src/features/sync/syncPlaylists.ts
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
  grep -rn -B1 "if (!el) return\|if (!container) return" src/components src/pages src/ui src/hooks src/features --include='*.ts*' | grep -v '\.test\.' | grep "Ref\.current\|ref\.current"
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
  grep -rn "if (cached\|if (rows\[0\]\|if (hit\|cached\.length > 0" src/hooks src/ui src/lib src/clients src/features --include='*.ts*' | grep -v '\.test\.'
  ```
- **Inline `queryKey` = nothing else can invalidate it.** Album/artist detail routes' inline keys survived background `UPDATE`s stale for whole `staleTime`. Fix: shared nested `QK.*` constants.
  ```
  grep -rn "queryKey: \[" src --include='*.ts*' | grep -v '\.test\.' | grep -v "QK\."
  ```
- **Duplicated prefetch warms a key nobody reads.** Key/`queryFn`/`staleTime` must be byte-identical; shared in `nowPlayingQueries.ts`. **Repo-wide: `ESCAPE '\'` in TS string = `ESCAPE ''`, throws - write `ESCAPE '\\'`.**
- **A bare column under `GROUP BY`, and a `LIMIT` cut on a non-unique key, both pick arbitrarily.** `query_artists` took `artwork_url` bare from its group; `query_recent_genres` cut a `LIMIT` across ties, and the first fix covered only the branch the test reached. Fix: `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ..., id)`, a `name COLLATE NOCASE` tiebreak on every branch, `MIN(name)` over a bare `name`. Ask of any aggregate: which row is this, and would two runs agree?
  ```
  grep -rn "GROUP BY" src-tauri/src --include='*.rs' | grep -v "COUNT(\|MIN(\|MAX(\|SUM("
  grep -rn "LIMIT" src-tauri/src src --include='*.rs' --include='*.ts*' | grep -v '\.test\.' | grep -v "ORDER BY"
  ```
- **Cap check that runs before the write evicts for a write that adds nothing.** `cappedSet` compared `size >= maxEntries` without asking whether the key was held, evicting on every overwrite; `artColor.ts`/`artBlur.ts` hand-rolled the same. **Found 3x.** Fix: `!cache.has(key) &&`, enforced by `src/lib/cappedCacheGuard.test.ts`. A pre-write `>= MAX` needs the guard; a post-write `> MAX` after delete-then-set is safe.
  ```
  grep -rn "\.size >= \|\.size > " src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A computed number reaching a URL is a cache key; clamp it at the one writer.** `getCoverArtUrl` interpolated `size` raw, so `NaN`/fractional/negative values (`size * 2` at one call site) reached the URL. Rust falls back to 300 but caches under `{id}:{size}` with the bogus string, fragmenting the disk cache and every memo key built from the URL. Fix: `Number.isFinite(size) ? Math.max(1, Math.round(size)) : 300`.
  ```
  grep -rn "?size=\${\|params.set(\"size\"" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **`!` on an optional id ships the string "undefined" to the server, and caches it.** One `getCoverArtUrl` call site's `!` requested a cover named `"undefined"`, cached forever under `"undefined:300"`. Enforced by `src/lib/coverArtGuard.test.ts`, which sweeps the call sites. **A sweep owes its own reach a test:** the first version missed `!` inside a ternary or before `??`, and mis-split arguments on commas inside strings.
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
- **Artist name isn't an owner; name-keyed read returns every server's rows.** 8 unscoped `albums`/`tracks` artist-column reads leaked cross-server (wrong art, unplayable radio seeds). Enforced by `src/lib/serverScoping.test.ts`.
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
- **Guard holding only because of data shape isn't a guard.** 5 `LIKE ?` binds no `ESCAPE`, safe only while ids are UUIDs. Fix: `escapeLike` in `src/lib/sql.ts`, enforced by `src/lib/sqlEscaping.test.ts`.
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
  grep -rn "playFromQueueIndex(\|playTrack(\|playQueue(\|\.resume()" src/hooks src/ui src/App.tsx src/features | grep -v "\.test\."
  ```
- **A counter fed by every request of one burst counts one event many times.** N requests stalling together each re-opened the transport breaker, walking its cooldown to the top in one burst and probing once per request. Fix: a re-open inside the breaker's own cooldown is ignored. Ask of any counter behind a slow operation: how many callers are inside it right now?
  ```
  grep -rnE "^(let|const) \w+ = (0|new Map|new Set)" src/lib src/clients src/hooks src/ui src/features --include='*.ts*' | grep -v '\.test\.'
  ```
- **A refusal from a circuit breaker is not evidence about the record it was raised on.** The album pass counted the breaker's instant refusals as album failures and quit at `CONSECUTIVE_FAILURE_LIMIT`, so every partial sync reported "5 albums" whatever the server did. Fix: `apiPost` throws `TransportStalledError`; the album pass stops on it uncounted, the playlist stage skips its write without counting. Ask of any per-record failure counter behind a shared gate: did this record fail, or was it never tried?
  ```
  grep -rn "Failures++\|failed\w*++" src/lib src/clients src/hooks src/ui src/features --include='*.ts*' | grep -v '\.test\.'
  grep -rn "transportStallNotice\|TransportStalledError" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Process-wide state for a per-server fact answers for servers it never saw.** The breaker was one global set of counters, so a stall against one Navidrome failed requests to a different one, and did it with a message naming an address that caller never asked about. Same shape as the `server_id` scoping rule one row up, applied to memory instead of SQL: state about a server is keyed by that server. Its self-healing path also needs an exemption, so `ping.view` always gets its ladder and Settings can re-test.
  ```
  grep -rnE "^(let|const) \w+(: [^=]+)? = " src/lib src/clients src/features --include='*.ts*' | grep -v '\.test\.' | grep -vE "=>|function|\[\]|\bnew (RegExp|URL)\b"
  ```
- **A skip fast-path is only as good as a probe of the thing it skips.** `skipTracks` was keyed on album columns; Navidrome 0.64 rewrote ~87% of track ids and left albums untouched, so the track pass never ran. Fix: three random mirrored track ids go through `songExists` first, and one Subsonic 70 disables the skip for the run. Only a 70 counts, never a transport or credential failure. Ask of any skip gate: what evidence do I have about the rows I am not reading?
  ```
  grep -rn "skip\|unchanged" src/features/sync/sync.ts src/features/sync/syncWatermark.ts | grep -v '^\s*//'
  ```
- **A server-assigned id is a cache, not an identity.** Navidrome 0.64 re-encoded track ids, so the prune saw every track deleted and re-added: loved state, lyrics, waveforms, queued scrobbles and resume positions died with the rows. Fix: `planTrackIdRemap` (`src/features/sync/trackRemap.ts`) pairs rows by exact `file_path`, `remap_track_ids` (`library_write/track_remap.rs`) carries every track-keyed row in one transaction before upsert and prune; any ambiguity goes to the prune. Store the natural key beside the assigned one.
  ```
  grep -rn "file_path" src/features/sync/syncTracks.ts src/features/sync/trackRemap.ts
  ```
- **A hand-kept list of the tables one id reaches is a list that goes stale.** The prune, the server purge and the remap each need "every table keyed by a track id", and three copies means the twelfth table is in one of them. Fix: `src/db/trackIdTables.ts` holds the list with per-table policy, `trackIdTables.test.ts` sweeps `migrations.ts` for any table it missed and pins the Rust copy against it (the remap runs in a transaction, so it cannot read the TS list). A registry the members are swept into beats an enumeration someone maintains. **Found again** for genre tree ids: a rename carry per scrape as a hand-written migration; now `src/db/genreIdTables.ts`, swept the same way.
  ```
  grep -rn "track_id\b" src/db/migrations.ts | grep -c "" && grep -n "TRACK_ID_TABLES" src/db/trackIdTables.ts src-tauri/src/library_write/track_remap.rs
  ```
- **Watermark upstream identity, not only per-row timestamps.** Per-row mtimes cannot see a migration that rewrote the rows' keys. `servers.server_version` / `last_scan_at` / `song_count` (v49) come from `getScanStatus` each sync, and any of them moving forces a full track pass. A `getScanStatus` failure (admin-only on some servers) is no evidence and falls through to the probe; the watermark is stored only after a completed pass.
  ```
  grep -rn "getScanStatus\|last_scan_at\|server_version" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Progress recorded only when a pass completes means a pass that keeps failing never completes.** Watermark stored only after a clean pass plus a flaky transport = every auto-sync restarted a full ~1500-request pass and never finished. Fix: `albums.tracks_read_scan` (v51) stamps each album with the identity it was read under, early break included; an identity-forced pass skips stamped albums (not an explicit resync, not a failed probe). Ask of any all-or-nothing marker in front of long work: what does a run that gets 90% of the way leave the next run?
  ```
  grep -rn "Incomplete &&\|!.*Incomplete\b" src/lib src/clients src/hooks src/ui src/features --include='*.ts*' | grep -v '\.test\.'
  grep -rn "tracks_read_scan" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A 2xx body is not the type you asked for.** Subsonic errors ride HTTP 200 JSON, so `{"error":{"code":70}}` reached `Decoder::new` and the file got blamed. Fix: `stream_classify.rs::classify_stream_response` reads the body head first, on live, prefetch and gapless paths, refusing only an envelope, empty or textual body. The cover proxy's substituted `image/jpeg` was trusted as evidence; `is_image_response` now takes `Option<&str>`. **Found 3x.** A header is a claim: check the body on every path.
  ```
  grep -rn "Decoder::new\|::load_from_memory\|image::load" src-tauri/src | grep -v '#\[cfg(test)\]'
  grep -rn "unwrap_or(\"image/\|unwrap_or(\"audio/\|unwrap_or(\"application/" src-tauri/src
  ```
- **A stand-in for a missing measurement must not be the value that binds the limit.** `computeReplayGainLinear` substituted peak `1.0` for an absent one, so the `1.0 / peak` cap bound at unity and the pre-amp did nothing for 93% of the library. Fix: an absent or non-positive peak applies no cap; gain fallback made symmetric (track mode falls through to album gain). Ask of any default filling in for absent evidence: is it neutral, or the extreme that decides the outcome?
  ```
  grep -rnE "Math\.(min|max)\([^)]*\?\?" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A rename escapes the prune, so every mirror keyed by the old id is orphaned forever.** `remap_track_ids` left `tracks_fts` to the rebuild, which deletes by the new ids, orphaning ~15k rows that took slots in `useSearch`'s capped pool and that no prune or purge could reach. Fix: one writer, `rebuildTracksFts(db, albumIds, staleTrackIds)`, deleting by old id as well. Ask of any id rewrite: which tables did I not carry, and what deletes their old row now?
  ```
  grep -rn "SET id = \|SET track_id = " src src-tauri/src | grep -v '\.test\.'
  ```
- **A flag meaning "the user asked for this" must not be spelled as state a fallback can flatten.** **Resync library** inferred intent from a cleared watermark, which `watermarkMoved` flattens when `getScanStatus` is unreadable, so it ran the same skipped sync and reported success. Fix: explicit `syncLibrary(..., { forceTrackPass: true })`; the clear stays only so an interrupted resync is repeated. A request is a parameter, not a reading of the world.
  ```
  grep -rn "clearSyncWatermark\|forceTrackPass" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **Per-statement conflict handling decides per statement, not per record.** The id remap's `UPDATE OR IGNORE` declines only where a unique constraint exists, so `scrobble_queue` and `playlist_resume` rows moved onto a destination that `tracks` had refused. Fix: one `SELECT EXISTS` on the destination per track before any table is touched. A record-level decision belongs above the statements, not inside each.
  ```
  grep -rn "OR IGNORE\|ON CONFLICT DO NOTHING" src-tauri/src src --include='*.rs' --include='*.ts' | grep -v '\.test\.'
  ```
- **Global state holding server-scoped ids outlives the server that issued them.** `queue_state` and `radio_seed` are global `settings` rows holding `{serverId}:{nativeId}` ids, so after a server was removed and re-added the restored queue threw `missing expected server prefix`. The purge can't fix it without deleting other servers' queues. Fix: `loadSettings` checks every id against `SELECT id FROM servers` and drops the whole snapshot if any is stranded; a stranded seed clears `radioActive`/`radioLabel`. Ask of any global state: whose ids are in it, and what happens when that owner is deleted?
  ```
  grep -rn "INTO settings (key, value) VALUES ('" src --include='*.ts*' | grep -v '\.test\.' | grep -iE "queue|radio|ids|track|album"
  grep -rn "useSetting(\"" src --include='*.ts*' | grep -v '\.test\.' | grep -iE "ids|track|album|queue"
  grep -n "SELECT id FROM servers" src/features/playback/store/playerSettings.ts
  ```
- **Rows whose owner row is gone are unreachable, not stale, and nothing sweeps them.** An unfinished `purgeServerData` left tracks, loved rows and scrobbles under a deleted server id. Every read is `server_id`-scoped and no sync runs for a missing server, so they were invisible and undeletable, and crowded search's capped pool. Fix: `purgeStrandedServers` (`src/features/sync/syncPrune.ts`), run once from `main.tsx`, purges any mirrored `server_id` absent from `servers`. A delete path that has to finish needs a sweep behind it.
  ```
  grep -rn "purgeStrandedServers" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **An empty read and a broken button look the same to the user.** Every album play path did `if (tracks.length === 0) return;`, so albums a failed sync left trackless were a dead button. Fix: `loadAlbumTracks` (`src/lib/albumTracks.ts`) fetches on a miss; play paths use `loadAlbumTracksForPlay`, which reports a failed fetch and a server-empty album. **Found again:** callers `void`ed the now-rejecting promise. Ask of a silent empty `return` or a `void`ed promise: how does the user learn nothing happened?
  ```
  grep -rn "length === 0) return" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A fixed edit distance is a bigger share of a short key, and file order is not a tiebreak.** `findCanonical`/`findCanonicalSync` allowed distance 2 for any 5+ char key (`J-Rock` -> `Rock`) and broke ties by `canon-tree.json` order. Fix: one shared `findFuzzy`, allowance `floor(min(key.length, candidate.length) / 5)` capped at 2, ties by node id. Known limit: same-length neighbours (`art rock`/`alt rock`) still match. Ask of any fuzzy threshold: what share of the shorter string may it destroy, and who decides a tie?
  ```
  grep -rn "levenshtein(\|similarity(" src --include='*.ts*' | grep -v '\.test\.'
  ```
- **A lookup miss skipped with `continue` deletes the user's own data without a word.** Deleting a custom genre left `album_user_genres` naming the dead id and `normalizeAlbum` `continue`d past it: the genre vanished from its albums with no trace in Review or Cleanup. Fix: the delete clears every table holding the `canonical_id`; `resolveGenreTags` sends a missing node to unmapped (duplicate or excluded ids stay silent, that drop is the user's). Ask of any `continue` after a lookup: skipped on purpose, or did its target disappear?
  ```
  grep -rn "byId.get(" src --include='*.ts*' -A1 | grep -v '\.test\.' | grep "continue\|if (node &&"
  python3 -c "import re;s=open('src/db/migrations.ts').read();print(sorted({m.group(1) for m in re.finditer(r'CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([^;]*?)\);',s,re.S) if 'canonical_id' in m.group(2)}))"; grep -n "canonical_id = ?" src-tauri/src/library_write/user_tree.rs
  ```
- **Statement sequence with invalid intermediate states is a transaction.** `runMigrations` wraps each block + version row in `BEGIN`/`COMMIT`, `ROLLBACK` rethrows original error.
- **One-direction version compare can't say "too new".** `LATEST_SCHEMA_VERSION` + `SchemaTooNewError` (`>`, not `>=`), `DatabaseErrorScreen`, no retry button.
- **Transaction real only if statements share a connection.** `tauri-plugin-sql` pools 10 connections, no affinity - TS `BEGIN` from a user gesture is silent no-op + deadlock. Multi-write mutations go `src-tauri/src/library_write/`; `src/db/migrations.ts` is the only legit TS `BEGIN`.
  ```
  grep -rn '"BEGIN"\|BEGIN TRANSACTION' src --include='*.ts*' | grep -v '\.test\.'
  ```
