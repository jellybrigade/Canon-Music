import { beforeAll, describe, expect, it } from "vitest";
import { ARTIST_TRACK_MATCH, artistTrackMatchParams } from "../features/playback/lib/nowPlayingQueries";
import { ARTIST_MATCH, similarArtistsMatch } from "../features/radio/lib/radio";
import { ftsDeleteForAlbumsSql, HEAL_FTS_COUNTS_SQL, UNINDEXED_ALBUMS_SQL } from "../features/sync/syncTracks";
import { TAG_ALBUMS_SQL, UNRESOLVED_TAG_COUNT_SQL } from "../features/tags/hooks/useTagMappings";
import { APPLY_TAG_MAPPINGS_SQL } from "../features/tags/lib/tagNormalize";
import { RECENTLY_RELEASED_SQL } from "../hooks/useRecentlyReleasedAlbums";
import { ownedByServer } from "../lib/sql";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { GENRE_ID_HOLDERS } from "./genreIdTables";
import { deleteTrackRowsSql, TRACK_ID_TABLES } from "./trackIdTables";

let db: FakeDatabase;

beforeAll(async () => {
  db = await createMigratedTestDb();
});

/** Every `detail` line of SQLite's plan for `sql`, joined, so a probe can name the index it expects. */
function planOf(sql: string, params: unknown[] = []): string {
  const rows = db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
  return rows.map((r) => r.detail).join("\n");
}

describe("query plans", () => {
  it("probe fails on a full scan", () => {
    expect(planOf("SELECT * FROM tracks WHERE title = 'x'")).toMatch(/^SCAN tracks/m);
  });

  it("probe fails on a full search index scan", () => {
    expect(planOf("DELETE FROM tracks_fts WHERE id IN ('a')")).toMatch(/VIRTUAL TABLE INDEX 0:$/m);
  });

  const searchIndex = TRACK_ID_TABLES.find((entry) => entry.table === "tracks_fts");
  it.each([
    ["a pruned track's search row", searchIndex ? deleteTrackRowsSql(searchIndex, "?, ?") : "", ["a", "b"]],
    [
      "a pruned album's search rows",
      searchIndex ? deleteTrackRowsSql(searchIndex, "SELECT id FROM tracks WHERE album_id IN (?)") : "",
      ["al"],
    ],
    ["the search rows of albums being reindexed", ftsDeleteForAlbumsSql("?, ?"), ["al", "al2"]],
    ["how many of a server's tracks are indexed", HEAL_FTS_COUNTS_SQL, ["s", "s"]],
    ["albums with an unindexed track", UNINDEXED_ALBUMS_SQL, ["s"]],
  ])("finds %s by row instead of scanning the search index", (_name, sql, params) => {
    const plan = planOf(sql, params);
    expect(plan).toMatch(/VIRTUAL TABLE INDEX 0:=/);
    expect(plan).not.toMatch(/VIRTUAL TABLE INDEX 0:$/m);
  });

  it("finds an artist by name in any case without scanning every artist", () => {
    const plan = planOf("SELECT name FROM artists WHERE server_id = 's' AND name = 'x' COLLATE NOCASE");
    expect(plan).toContain("idx_artists_server_name");
    expect(plan).not.toMatch(/^SCAN artists/m);
  });

  it.each([
    ["playlist_tracks", "track_id"],
    ["scrobble_queue", "track_id"],
    ["playlist_resume", "last_track_id"],
  ])("finds %s rows by track id when a server rewrites one", (table, column) => {
    expect(planOf(`UPDATE OR IGNORE ${table} SET ${column} = 'b' WHERE ${column} = 'a'`)).toMatch(
      /USING (COVERING )?INDEX/,
    );
  });

  it("finds a track's tags through the unique key, with no index of its own", () => {
    expect(planOf("SELECT raw_value FROM track_tags WHERE track_id = 'a'")).toContain("sqlite_autoindex_track_tags");
  });

  it("counts one server's tracks per album from the index alone", () => {
    const plan = planOf("SELECT album_id, COUNT(*) FROM tracks WHERE server_id = 's' GROUP BY album_id");
    expect(plan).toContain("COVERING INDEX idx_tracks_server_album");
  });

  it("lists every server holding tracks from the index alone", () => {
    expect(planOf("SELECT server_id FROM tracks UNION SELECT id FROM servers")).toContain(
      "COVERING INDEX idx_tracks_server_album",
    );
  });

  it("finds one server's tracks missing a genre through the server index", () => {
    const plan = planOf("SELECT id FROM tracks WHERE server_id = 's' AND (genre IS NULL OR genre = '')");
    expect(plan).toContain("idx_tracks_server_album");
  });

  it("finds an artist's tracks and collaborations without scanning the server's tracks", () => {
    const plan = planOf(`SELECT t.id FROM tracks t WHERE ${ARTIST_TRACK_MATCH}`, artistTrackMatchParams("s", "Burial"));
    expect(plan).not.toMatch(/^SEARCH tracks USING INDEX idx_tracks_server_album/m);
    expect(plan.match(/idx_tracks_artist_nocase \(artist>\? AND artist<\?\)/g)).toHaveLength(3);
    expect(plan).toContain("idx_tracks_artist_nocase (artist=? AND server_id=?)");
  });

  it.each([
    ["one artist", ARTIST_MATCH, ["Sting"]],
    ["similar artists", similarArtistsMatch(2), ["sting", "the police"]],
  ])("finds a radio pool of %s through the artist index", (_name, match, artists) => {
    const plan = planOf(`SELECT t.id FROM tracks t WHERE t.server_id = ? AND ${match}`, ["s", ...artists]);
    expect(plan).toContain("idx_tracks_artist_nocase");
    expect(plan).not.toMatch(/^SCAN t$/m);
  });

  it.each([
    ["loved_tracks", "track_id"],
    ["loved_albums", "album_id"],
    ["scrobble_history", "track_id"],
    ["scrobble_queue", "track_id"],
  ])("finds one server's %s rows by id range instead of scanning", (table, column) => {
    const owned = ownedByServer(column, "s");
    const plan = planOf(`SELECT ${column} FROM ${table} WHERE ${owned.sql}`, owned.params);
    expect(plan).toMatch(
      new RegExp(`^SEARCH ${table} USING (COVERING )?INDEX \\S+ \\(${column}>\\? AND ${column}<\\?\\)`, "m"),
    );
    expect(plan).not.toMatch(/^SCAN/m);
  });

  it("finds Recently Released from the newest years without sorting the whole library", () => {
    const plan = planOf(RECENTLY_RELEASED_SQL, ["s", 19, "s", 20]);
    expect(plan).not.toMatch(/^SCAN a$/m);
    expect(plan.match(/SEARCH a USING INDEX idx_albums_year/g)).toHaveLength(2);
  });

  it.each([
    ["applying mappings to an album", APPLY_TAG_MAPPINGS_SQL, ["s:a"]],
    ["counting unresolved tags", UNRESOLVED_TAG_COUNT_SQL, []],
  ])("finds a tag's decision by its spelling group when %s", (_, sql, params) => {
    const plan = planOf(sql, params);
    expect(plan).toContain("idx_tag_mappings_norm");
    expect(plan).not.toMatch(/SCAN tm$/m);
  });

  it.each([
    ["UPDATE track_tags SET canonical_id = NULL WHERE raw_value = 'x' AND kind = 'genre'", []],
    [TAG_ALBUMS_SQL, ["x", "genre", "s"]],
  ])("finds every row of one tag without scanning all tags: %#", (sql, params) => {
    const plan = planOf(sql, params);
    expect(plan).toContain("idx_track_tags_raw_kind");
    expect(plan).not.toMatch(/^SCAN tt?$|^SCAN track_tags$/m);
  });

  it.each(GENRE_ID_HOLDERS.filter((holder) => holder.jsonPath === null).map((holder) => [holder.table, holder.column]))(
    "finds %s rows by genre id when a genre is deleted or renamed",
    (table, column) => {
      expect(planOf(`DELETE FROM ${table} WHERE ${column} = 'a'`)).toMatch(/USING (COVERING )?INDEX/);
    },
  );
});
