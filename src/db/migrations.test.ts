import { describe, expect, it, vi } from "vitest";
import { migrations, runMigrations, type MigrationDb } from "./migrations";
import { createTestDb, createMigratedTestDb, type FakeDatabase } from "../test/sqlite";

const LATEST = Math.max(...migrations.map((m) => m.version));

/** `type|name|sql` for every schema object, order-stable, for before/after comparison. */
function schemaSnapshot(db: FakeDatabase): string[] {
  return (
    db.raw
      .prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
      .all() as { type: string; name: string; sql: string | null }[]
  ).map((r) => `${r.type}|${r.name}|${r.sql ?? ""}`);
}

/** Tables the app declares, minus SQLite's own bookkeeping and FTS5's shadow tables. */
function userTables(db: FakeDatabase): string[] {
  return (
    db.raw
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'tracks_fts_%'
         ORDER BY name`
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
}

function columnsOf(db: FakeDatabase, table: string): string[] {
  return (db.raw.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

/**
 * Applies every block up to and including `version` and records it, mirroring the runner's own
 * split and duplicate-column swallow, so a partially-migrated db can be handed back to
 * `runMigrations` to finish the job.
 */
async function migrateThrough(db: FakeDatabase, version: number): Promise<void> {
  // Byte-identical to the runner's own DDL, so a resumed db's sqlite_master matches a fresh one.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY
    )
  `);
  for (const migration of migrations) {
    if (migration.version > version) break;
    for (const statement of migration.sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)) {
      try {
        await db.execute(statement);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!message.includes("duplicate column name")) throw e;
      }
    }
    await db.execute("INSERT INTO schema_migrations (version) VALUES (?)", [migration.version]);
  }
}

describe("migration declarations", () => {
  it("versions ascend strictly, with no duplicates and no gaps", () => {
    const versions = migrations.map((m) => m.version);
    expect(versions).toEqual(Array.from({ length: versions.length }, (_, i) => i + 1));
  });

  it("no block relies on a semicolon the naive split would cut in half", () => {
    // The runner splits on ";" with no SQL awareness, so a semicolon inside a string literal or a
    // trigger/view body would silently produce two invalid statements. An odd number of quotes in
    // a split fragment is exactly that: a literal that got cut. Nothing does it today.
    for (const migration of migrations) {
      const statements = migration.sql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const statement of statements) {
        const quotes = (statement.match(/'/g) ?? []).length;
        expect(quotes % 2, `v${migration.version}: ${statement.slice(0, 40)}`).toBe(0);
      }
      expect(migration.sql, `v${migration.version}`).not.toMatch(/CREATE\s+(TRIGGER|VIEW)/i);
    }
  });
});

describe("runMigrations", () => {
  it("takes a fresh database to the latest declared version", async () => {
    const db = createTestDb();
    await runMigrations(db);

    const recorded = (
      (await db.select<{ version: number }[]>("SELECT version FROM schema_migrations ORDER BY version"))
    ).map((r) => r.version);
    expect(recorded).toEqual(migrations.map((m) => m.version));
    expect(Math.max(...recorded)).toBe(LATEST);
  });

  it("issues the WAL pragma before anything else", async () => {
    // :memory: databases silently refuse WAL (journal_mode stays "memory"), so the value cannot be
    // read back here. Asserting the pragma is issued is the part that actually catches its removal;
    // see known-issues.md "Read-only rusqlite can't own WAL -shm" for what breaks downstream.
    const db = createTestDb();
    const execute = vi.spyOn(db, "execute");
    await runMigrations(db);
    expect(execute.mock.calls[0]?.[0]).toBe("PRAGMA journal_mode=WAL");
  });

  it("is a no-op on an already-migrated database", async () => {
    const db = await createMigratedTestDb();
    const before = schemaSnapshot(db);

    await runMigrations(db);

    // Only the pragma and the CREATE TABLE IF NOT EXISTS re-run; no migration statement does.
    expect(db.executeCount).toBe(2);
    expect(schemaSnapshot(db)).toEqual(before);
    const count = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM schema_migrations");
    expect(count[0]?.n).toBe(migrations.length);
  });

  it("migrates from an empty schema_migrations table", async () => {
    const db = createTestDb();
    await db.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)");
    await runMigrations(db);
    expect(userTables(db)).toContain("albums");
  });

  it("resumes from a partially migrated database without replaying earlier blocks", async () => {
    const partial = createTestDb();
    await migrateThrough(partial, 20);
    await runMigrations(partial);

    const baseline = await createMigratedTestDb();
    expect(schemaSnapshot(partial)).toEqual(schemaSnapshot(baseline));
  });

  it("reaches the same schema from every intermediate version", async () => {
    const baseline = schemaSnapshot(await createMigratedTestDb());
    for (const { version } of migrations) {
      const db = createTestDb();
      await migrateThrough(db, version);
      await runMigrations(db);
      expect(schemaSnapshot(db), `resumed from v${version}`).toEqual(baseline);
    }
  });

  it("carries seeded rows through a resume from before the tag-vocab backfill", async () => {
    // v27 normalizes tag_mappings.norm_value and backfills tag_vocab_cache from track_tags joined
    // to tracks. Resuming on an empty db exercises neither: the UPDATE touches nothing and the
    // GROUP BY yields no rows, so the block passes without proving anything.
    const db = createTestDb();
    await migrateThrough(db, 26);
    await db.execute(
      `INSERT INTO tracks (id, server_id, server_type, title, album_id)
       VALUES ('t1', 's1', 'navidrome', 'Song', 'a1')`
    );
    await db.execute(
      `INSERT INTO track_tags (track_id, kind, raw_value, source)
       VALUES ('t1', 'genre', 'Hip-Hop', 'lastfm')`
    );
    await db.execute(
      "INSERT INTO tag_mappings (raw_value, kind, canonical_id) VALUES ('Hip-Hop', 'genre', 'hip-hop')"
    );
    await runMigrations(db);

    const vocab = await db.select<{ norm_value: string; album_count: number }[]>(
      "SELECT norm_value, album_count FROM tag_vocab_cache"
    );
    expect(vocab).toHaveLength(1);
    expect(vocab[0]?.norm_value).toBe("hip hop");
    expect(vocab[0]?.album_count).toBe(1);
    const mappings = await db.select<{ norm_value: string }[]>(
      "SELECT norm_value FROM tag_mappings"
    );
    expect(mappings[0]?.norm_value).toBe("hip hop");
  });

  it("skips every block when the recorded version is ahead of the latest declared one", async () => {
    // A db written by a newer Canon build. The runner has no downgrade path and no guard: it
    // silently does nothing, leaving whatever schema was already there.
    const db = createTestDb();
    await db.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)");
    await db.execute("INSERT INTO schema_migrations (version) VALUES (999)");
    await runMigrations(db);

    expect(userTables(db)).toEqual(["schema_migrations"]);
  });

  it("fails loudly on a gapped schema_migrations rather than half-migrating", async () => {
    // Version bookkeeping is a high-water mark, not a set: recording v40 without having run v1 to
    // v39 makes the runner start at v41, whose ALTER hits a table that was never created. Loud is
    // the right outcome, so this pins it - a future "skip missing tables" fix would hide real damage.
    const db = createTestDb();
    await db.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)");
    await db.execute("INSERT INTO schema_migrations (version) VALUES (40)");

    await expect(runMigrations(db)).rejects.toThrow(/no such table/);
    expect(userTables(db)).not.toContain("albums");
  });

  it("swallows a duplicate ADD COLUMN so the column lands exactly once", async () => {
    // v22 and v23 both add tracks.play_count on purpose, to exercise this branch with real DDL.
    const db = await createMigratedTestDb();
    const playCounts = columnsOf(db, "tracks").filter((c) => c === "play_count");
    expect(playCounts).toHaveLength(1);
  });

  it("rethrows an Error that is not a duplicate column", async () => {
    const db = createTestDb();
    const broken: MigrationDb = {
      execute: (query, bindValues) => {
        if (query.startsWith("CREATE TABLE IF NOT EXISTS tracks"))
          return Promise.reject(new Error("no such table: nope"));
        return db.execute(query, bindValues);
      },
      select: (query, bindValues) => db.select(query, bindValues),
    };
    await expect(runMigrations(broken)).rejects.toThrow("no such table: nope");
  });

  it("rethrows a plain-string rejection that is not a duplicate column", async () => {
    // tauri-plugin-sql rejects with a string, not an Error; the harness only ever throws Errors,
    // so this is the only coverage the String(e) branch gets.
    const db = createTestDb();
    const broken: MigrationDb = {
      execute: (query, bindValues) => {
        if (query.startsWith("CREATE TABLE IF NOT EXISTS tracks"))
          return Promise.reject("no such table: nope");
        return db.execute(query, bindValues);
      },
      select: (query, bindValues) => db.select(query, bindValues),
    };
    await expect(runMigrations(broken)).rejects.toBe("no such table: nope");
  });

  it("swallows a plain-string duplicate column rejection", async () => {
    const db = createTestDb();
    const broken: MigrationDb = {
      execute: (query, bindValues) => {
        if (query.includes("ADD COLUMN played_at"))
          return Promise.reject("duplicate column name: played_at");
        return db.execute(query, bindValues);
      },
      select: (query, bindValues) => db.select(query, bindValues),
    };
    await expect(runMigrations(broken)).resolves.toBeUndefined();
  });
});

describe("post-migration schema", () => {
  it("declares exactly the expected tables", async () => {
    const db = await createMigratedTestDb();
    expect(userTables(db)).toEqual([
      "album_covers",
      "album_genre_exclusions",
      "album_genres",
      "album_identity",
      "album_unresolved_genres",
      "album_user_genres",
      "albums",
      "app_logs",
      "artist_aliases",
      "artist_covers",
      "artist_identity",
      "artists",
      "edit_history",
      "loved_albums",
      "loved_tracks",
      "lyrics",
      "pending_edits",
      "playlist_resume",
      "playlist_tracks",
      "playlists",
      "radio_signal_cache",
      "schema_migrations",
      "scrobble_history",
      "scrobble_queue",
      "servers",
      "settings",
      "tag_issues",
      "tag_mappings",
      "tag_vocab_cache",
      "track_tags",
      "tracks",
      "tracks_fts",
      "user_tree_changelog",
      "user_tree_nodes",
      "waveform_cache",
    ]);
  });

  it("drops the tables later migrations replaced", async () => {
    const db = await createMigratedTestDb();
    const tables = userTables(db);
    // v9 dropped genre_mappings; v25 and v35 rebuilt track_tags through a *_new temp table.
    expect(tables).not.toContain("genre_mappings");
    expect(tables).not.toContain("track_tags_new");
  });

  it("declares exactly the expected named indexes", async () => {
    const db = await createMigratedTestDb();
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name")
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(indexes).toEqual([
      "idx_album_genres_canonical",
      "idx_albums_artist",
      "idx_albums_artist_server_artwork",
      "idx_artist_aliases_canonical",
      "idx_tag_mappings_norm",
      "idx_track_tags_canonical",
      "idx_track_tags_track",
      "idx_tracks_album_id",
      "idx_tracks_artist",
      "idx_tracks_genre",
    ]);
  });

  it("keeps the artwork index partial", async () => {
    // Recreated without the WHERE clause it stops being the covering index the artist grids plan on.
    const db = await createMigratedTestDb();
    const row = db.raw
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_albums_artist_server_artwork'")
      .get() as { sql: string };
    expect(row.sql).toContain("WHERE artwork_url IS NOT NULL");
  });

  it("keeps tracks_fts a real FTS5 virtual table", async () => {
    const db = await createMigratedTestDb();
    const row = db.raw.prepare("SELECT sql FROM sqlite_master WHERE name = 'tracks_fts'").get() as {
      sql: string;
    };
    expect(row.sql).toContain("USING fts5");
  });

  it("keeps the columns that were added by later ALTER blocks", async () => {
    const db = await createMigratedTestDb();
    // These are the ones the duplicate-column swallow could hide the loss of: if the ALTER failed
    // for some other reason the migration still records its version and moves on.
    expect(columnsOf(db, "albums")).toEqual(
      expect.arrayContaining(["played_at", "accent_color", "release_type", "play_count"])
    );
    expect(columnsOf(db, "tracks")).toEqual(
      expect.arrayContaining([
        "play_count",
        "tags_enriched_at",
        "replay_gain_track_gain",
        "replay_gain_album_gain",
        "bit_rate",
        "suffix",
        "file_size",
      ])
    );
    expect(columnsOf(db, "artist_identity")).toEqual(
      expect.arrayContaining(["navidrome_image_url", "wikidata_image_url"])
    );
    expect(columnsOf(db, "album_identity")).toEqual(
      expect.arrayContaining(["album_bio", "lastfm_url", "album_enriched_at"])
    );
    expect(columnsOf(db, "playlists")).toEqual(
      expect.arrayContaining(["is_smart", "rules_json", "custom_cover_data"])
    );
    expect(columnsOf(db, "servers")).toEqual(expect.arrayContaining(["alt_url"]));
    expect(columnsOf(db, "tag_mappings")).toEqual(expect.arrayContaining(["norm_value"]));
    expect(columnsOf(db, "lyrics")).toEqual(expect.arrayContaining(["offset_ms"]));
  });
});

describe("schema constraints the code depends on", () => {
  it("keys playlist_tracks on (playlist_id, position)", async () => {
    // position doubles as the remote Subsonic index, which is why removals compact positions
    // through two negative-space passes: a straight renumber collides on this PK.
    // See known-issues.md "playlist_tracks.position doubles as remote Subsonic index".
    const db = await createMigratedTestDb();
    const pk = (db.raw.pragma("table_info(playlist_tracks)") as { name: string; pk: number }[])
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
    expect(pk).toEqual(["playlist_id", "position"]);
  });

  it("leaves track_id out of the playlist_tracks key, so a track can repeat in one playlist", async () => {
    const db = await createMigratedTestDb();
    await db.execute("INSERT INTO playlists (id, server_id, name) VALUES ('p1', 's1', 'P')");
    await db.execute(
      "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ('p1', 't1', 0), ('p1', 't1', 1)"
    );
    const rows = await db.select<{ position: number }[]>(
      "SELECT position FROM playlist_tracks WHERE playlist_id = 'p1' ORDER BY position"
    );
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
  });

  it("keys the composite tables the sync and tag paths upsert into", async () => {
    const db = await createMigratedTestDb();
    const pkOf = (table: string) =>
      (db.raw.pragma(`table_info(${table})`) as { name: string; pk: number }[])
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);

    expect(pkOf("albums")).toEqual(["id"]);
    expect(pkOf("tracks")).toEqual(["id"]);
    expect(pkOf("artists")).toEqual(["id"]);
    expect(pkOf("playlists")).toEqual(["id"]);
    expect(pkOf("album_identity")).toEqual(["album_id"]);
    expect(pkOf("artist_identity")).toEqual(["artist_name"]);
    expect(pkOf("album_genres")).toEqual(["album_id", "canonical_id"]);
    expect(pkOf("album_user_genres")).toEqual(["album_id", "canonical_id"]);
    expect(pkOf("album_genre_exclusions")).toEqual(["album_id", "canonical_id"]);
    expect(pkOf("album_unresolved_genres")).toEqual(["album_id", "raw_value", "kind"]);
    expect(pkOf("tag_mappings")).toEqual(["raw_value", "kind"]);
    expect(pkOf("tag_vocab_cache")).toEqual(["norm_value", "kind"]);
    expect(pkOf("playlist_resume")).toEqual(["playlist_id"]);
  });

  it("dedupes scrobble history but not the scrobble queue", async () => {
    const db = await createMigratedTestDb();
    await db.execute(
      "INSERT INTO scrobble_history (track_id, timestamp) VALUES ('t1', 1), ('t1', 2)"
    );
    await expect(
      db.execute("INSERT INTO scrobble_history (track_id, timestamp) VALUES ('t1', 1)")
    ).rejects.toThrow(/UNIQUE/);

    // The queue deliberately has no such constraint: the same track played twice is two scrobbles.
    await db.execute(
      `INSERT INTO scrobble_queue (track_id, title, artist, timestamp)
       VALUES ('t1', 'Song', 'A', 1), ('t1', 'Song', 'A', 1)`
    );
    const queued = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM scrobble_queue");
    expect(queued[0]?.n).toBe(2);
  });

  it("declares no foreign keys anywhere", async () => {
    // Deliberate: prune and purge paths delete in explicit dependency order instead. Asserted so
    // that adding one is a decision someone makes on purpose, with this test to update.
    const db = await createMigratedTestDb();
    for (const table of userTables(db)) {
      expect(db.raw.pragma(`foreign_key_list(${table})`), table).toEqual([]);
    }
  });

  it("constrains track_tags.source to the known provenance values", async () => {
    const db = await createMigratedTestDb();
    await db.execute(
      "INSERT INTO track_tags (track_id, kind, raw_value, source) VALUES ('t1', 'genre', 'jazz', 'lastfm-track')"
    );
    await expect(
      db.execute(
        "INSERT INTO track_tags (track_id, kind, raw_value, source) VALUES ('t1', 'genre', 'jazz', 'nonsense')"
      )
    ).rejects.toThrow(/CHECK/);
  });
});
