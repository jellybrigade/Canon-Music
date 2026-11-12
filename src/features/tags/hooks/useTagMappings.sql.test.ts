import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { sqlNorm } from "../lib/canonicalize";
import { APPLY_TAG_MAPPINGS_SQL } from "../lib/tagNormalize";
import { TAG_ALBUMS_SQL, TAG_VOCAB_SQL, UNRESOLVED_TAG_COUNT_SQL } from "./useTagMappings";

let db: FakeDatabase;

beforeEach(async () => {
  db = await createMigratedTestDb();
});

function seedTracks(rows: { serverId: string; albumId: string; trackId: string }[]) {
  for (const { serverId, albumId, trackId } of rows) {
    db.raw
      .prepare("INSERT OR IGNORE INTO albums (id, server_id, server_type, name) VALUES (?, ?, 'navidrome', ?)")
      .run(albumId, serverId, albumId);
    db.raw
      .prepare("INSERT INTO tracks (id, server_id, server_type, title, album_id) VALUES (?, ?, 'navidrome', 'T', ?)")
      .run(trackId, serverId, albumId);
  }
}

function tag(trackId: string, rawValue: string, source: string) {
  db.raw
    .prepare("INSERT INTO track_tags (track_id, kind, raw_value, source) VALUES (?, 'genre', ?, ?)")
    .run(trackId, rawValue, source);
}

function mapping(rawValue: string, canonicalId: string, options: { source: string; locked?: number; norm: string }) {
  db.raw
    .prepare(
      "INSERT INTO tag_mappings (raw_value, kind, canonical_id, source, locked, norm_value) VALUES (?, 'genre', ?, ?, ?, ?)",
    )
    .run(rawValue, canonicalId, options.source, options.locked ?? 0, options.norm);
}

describe("tag vocabulary", () => {
  beforeEach(() => {
    db.raw.prepare("DELETE FROM tag_mappings").run();
  });

  it("shows the locked decision of a spelling group, whatever order its rows were written in", async () => {
    db.raw
      .prepare(
        "INSERT INTO tag_vocab_cache (norm_value, raw_value, kind, album_count) VALUES ('hip hop', 'Hip Hop', 'genre', 3)",
      )
      .run();
    mapping("Hip-Hop", "rap", { source: "auto", norm: "hip hop" });
    mapping("HIP_HOP", "rap", { source: "manual", norm: "hip hop" });
    mapping("hip hop", "hip-hop", { source: "manual", locked: 1, norm: "hip hop" });

    const rows = await db.select<{ canonical_id: string; mapping_source: string; locked: number }[]>(TAG_VOCAB_SQL);

    expect(rows).toEqual([expect.objectContaining({ canonical_id: "hip-hop", mapping_source: "manual", locked: 1 })]);
  });

  it("lists a decision with no albums left once per spelling group, by its preferred row", async () => {
    mapping("Shoegaze", "shoegaze", { source: "auto", norm: "shoegaze" });
    mapping("shoegaze", "dream-pop", { source: "manual", norm: "shoegaze" });

    const rows = await db.select<{ raw_value: string; canonical_id: string }[]>(TAG_VOCAB_SQL);

    expect(rows).toEqual([expect.objectContaining({ raw_value: "shoegaze", canonical_id: "dream-pop" })]);
  });
});

describe("albums for a tag", () => {
  it("counts each track once however many sources tagged it, ties broken by album, on one server only", async () => {
    seedTracks([
      { serverId: "s1", albumId: "s1:b", trackId: "s1:b1" },
      { serverId: "s1", albumId: "s1:b", trackId: "s1:b2" },
      { serverId: "s1", albumId: "s1:a", trackId: "s1:a1" },
      { serverId: "s1", albumId: "s1:a", trackId: "s1:a2" },
      { serverId: "s1", albumId: "s1:c", trackId: "s1:c1" },
      { serverId: "s2", albumId: "s2:z", trackId: "s2:z1" },
      { serverId: "s2", albumId: "s2:z", trackId: "s2:z2" },
      { serverId: "s2", albumId: "s2:z", trackId: "s2:z3" },
    ]);
    for (const trackId of ["s1:b1", "s1:b2", "s1:a1", "s1:a2", "s2:z1", "s2:z2", "s2:z3"])
      tag(trackId, "Jazz", "server");
    for (const source of ["lastfm", "musicbrainz", "discogs", "lastfm-track"]) tag("s1:c1", "Jazz", source);

    const rows = await db.select<{ album_id: string }[]>(TAG_ALBUMS_SQL, [sqlNorm("Jazz"), "genre", "s1"]);

    expect(rows.map((r) => r.album_id)).toEqual(["s1:a", "s1:b", "s1:c"]);
  });

  it("finds albums carrying any spelling of the tag the list row stands for", async () => {
    seedTracks([
      { serverId: "s1", albumId: "s1:a", trackId: "s1:a1" },
      { serverId: "s1", albumId: "s1:b", trackId: "s1:b1" },
    ]);
    tag("s1:a1", "Hip-Hop", "lastfm");
    tag("s1:b1", "hip hop", "server");

    const rows = await db.select<{ album_id: string }[]>(TAG_ALBUMS_SQL, [sqlNorm("Hip-Hop"), "genre", "s1"]);

    expect(rows.map((r) => r.album_id).sort()).toEqual(["s1:a", "s1:b"]);
  });
});

describe("applying mappings to an album's tags", () => {
  it("takes the manual decision for a spelling group over an automatic one", async () => {
    seedTracks([{ serverId: "s1", albumId: "s1:a", trackId: "s1:a1" }]);
    tag("s1:a1", "Post-Rock", "lastfm");
    mapping("post rock", "math-rock", { source: "auto", norm: "post rock" });
    mapping("POST_ROCK", "post-rock", { source: "manual", norm: "post rock" });

    await db.execute(APPLY_TAG_MAPPINGS_SQL, ["s1:a"]);

    const row = db.raw.prepare("SELECT canonical_id FROM track_tags").get() as { canonical_id: string };
    expect(row.canonical_id).toBe("post-rock");
  });
});

describe("unresolved tag count", () => {
  it("treats a tag as resolved when any spelling of it has a decision", async () => {
    seedTracks([{ serverId: "s1", albumId: "s1:a", trackId: "s1:a1" }]);
    tag("s1:a1", "Trip-Hop", "lastfm");
    tag("s1:a1", "Vaporwave", "lastfm");
    mapping("trip hop", "trip-hop", { source: "manual", norm: "trip hop" });

    const rows = await db.select<{ n: number }[]>(UNRESOLVED_TAG_COUNT_SQL);

    expect(rows[0]?.n).toBe(1);
  });
});
