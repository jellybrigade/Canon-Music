import { beforeAll, describe, expect, it } from "vitest";
import { ARTIST_TRACK_MATCH, artistTrackMatchParams } from "../features/playback/lib/nowPlayingQueries";
import { RECENTLY_RELEASED_SQL } from "../hooks/useRecentlyReleasedAlbums";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { GENRE_ID_HOLDERS } from "./genreIdTables";

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

  it("finds Recently Released from the newest years without sorting the whole library", () => {
    const plan = planOf(RECENTLY_RELEASED_SQL, [19, 20]);
    expect(plan).not.toMatch(/^SCAN a$/m);
    expect(plan.match(/SEARCH a USING INDEX idx_albums_year/g)).toHaveLength(2);
  });

  it.each(GENRE_ID_HOLDERS.filter((holder) => holder.jsonPath === null).map((holder) => [holder.table, holder.column]))(
    "finds %s rows by genre id when a genre is deleted or renamed",
    (table, column) => {
      expect(planOf(`DELETE FROM ${table} WHERE ${column} = 'a'`)).toMatch(/USING (COVERING )?INDEX/);
    },
  );
});
