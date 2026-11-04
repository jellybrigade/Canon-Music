import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../../clients/lastfm", () => ({ fetchAlbumTags: vi.fn(), fetchArtistGenreTags: vi.fn() }));
vi.mock("./canonicalize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./canonicalize")>();
  return { ...actual, getCanonTree: vi.fn() };
});

import { fetchAlbumTags, fetchArtistGenreTags } from "../../../clients/lastfm";
import { getDb } from "../../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { type CanonTree, getCanonTree, type TreeNode } from "./canonicalize";
import { normalizeAlbum } from "./tagNormalize";

const ALBUM_ID = "srv-a:alb";
const EARLIER = 1_700_000_000;

const shoegaze: TreeNode = {
  id: "shoegaze",
  name: "Shoegaze",
  type: "genre",
  canonical_key: "shoegaze",
  parents: [],
  sections: ["genres"],
};

const dreamPop: TreeNode = {
  id: "dream-pop",
  name: "Dream Pop",
  type: "genre",
  canonical_key: "dream pop",
  parents: [],
  sections: ["genres"],
};

function treeOf(nodes: TreeNode[]): CanonTree {
  const byKey = new Map(nodes.map((n) => [n.canonical_key, n]));
  return {
    nodes,
    byKey,
    byId: new Map(nodes.map((n) => [n.id, n])),
    nodesByKind: new Map([["genre", nodes]]),
    byKindAndKey: new Map([["genre", byKey]]),
  };
}

let db: FakeDatabase;

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  vi.mocked(getCanonTree).mockResolvedValue(treeOf([shoegaze, dreamPop]));
  db.raw
    .prepare(
      `INSERT INTO albums (id, server_id, server_type, name, artist, computed_at)
       VALUES (?, 'srv-a', 'navidrome', 'Souvlaki', 'Slowdive', ?)`,
    )
    .run(ALBUM_ID, EARLIER);
  db.raw
    .prepare(
      `INSERT INTO tracks (id, server_id, server_type, title, artist, album_id)
       VALUES ('srv-a:t1', 'srv-a', 'navidrome', 'Alison', 'Slowdive', ?)`,
    )
    .run(ALBUM_ID);
});

afterEach(() => {
  vi.clearAllMocks();
});

function albumGenreIds(): string[] {
  return (
    db.raw.prepare("SELECT canonical_id FROM album_genres WHERE album_id = ? ORDER BY canonical_id").all(ALBUM_ID) as {
      canonical_id: string;
    }[]
  ).map((r) => r.canonical_id);
}

describe("normalizeAlbum reads the album's stored identity", () => {
  beforeEach(() => {
    vi.mocked(fetchAlbumTags).mockResolvedValue({ genres: [], moods: [] });
    vi.mocked(fetchArtistGenreTags).mockResolvedValue([]);
    db.raw
      .prepare(
        `INSERT INTO album_identity (album_id, lastfm_artist_name, lastfm_album_name, combined_genres_json)
         VALUES (?, 'Slowdive (UK)', 'Souvlaki (Remastered)', ?)`,
      )
      .run(ALBUM_ID, JSON.stringify([{ name: "shoegaze", count: 3 }]));
  });

  it("keeps the MusicBrainz genres when the caller passes only the album", async () => {
    await normalizeAlbum(ALBUM_ID);

    expect(albumGenreIds()).toEqual(["shoegaze"]);
  });

  it("asks Last.fm under the confirmed Last.fm names", async () => {
    await normalizeAlbum(ALBUM_ID);

    expect(fetchAlbumTags).toHaveBeenCalledWith("Slowdive (UK)", "Souvlaki (Remastered)");
  });
});

describe("normalizeAlbum reads the album's Discogs styles", () => {
  beforeEach(() => {
    vi.mocked(fetchAlbumTags).mockResolvedValue({ genres: [], moods: [] });
    vi.mocked(fetchArtistGenreTags).mockResolvedValue([]);
  });

  function storeDiscogs({ serverId = "srv-a", name = "Souvlaki" }: { serverId?: string; name?: string } = {}): void {
    db.raw
      .prepare(
        `INSERT INTO album_discogs (album_id, server_id, styles_json, looked_up_name, looked_up_artist, status, checked_at)
         VALUES (?, ?, '["Shoegaze"]', ?, 'Slowdive', 'found', 1)`,
      )
      .run(ALBUM_ID, serverId, name);
  }

  it("files a found release's styles after the MusicBrainz genres", async () => {
    db.raw
      .prepare("INSERT INTO album_identity (album_id, combined_genres_json) VALUES (?, ?)")
      .run(ALBUM_ID, JSON.stringify([{ name: "dream pop", count: 1 }]));
    storeDiscogs();

    const result = await normalizeAlbum(ALBUM_ID);

    expect(result.genres.map((g) => [g.id, g.source])).toEqual([
      ["dream-pop", "musicbrainz"],
      ["shoegaze", "discogs"],
    ]);
    expect(albumGenreIds()).toEqual(["dream-pop", "shoegaze"]);
    expect(db.raw.prepare("SELECT track_id, raw_value FROM track_tags WHERE source = 'discogs'").all()).toEqual([
      { track_id: "srv-a:t1", raw_value: "Shoegaze" },
    ]);
  });

  it("asks no Last.fm artist tags when Discogs has styles", async () => {
    storeDiscogs();

    await normalizeAlbum(ALBUM_ID);

    expect(fetchArtistGenreTags).not.toHaveBeenCalled();
  });

  it("ignores a lookup stored under another server", async () => {
    storeDiscogs({ serverId: "srv-b" });

    await normalizeAlbum(ALBUM_ID);

    expect(albumGenreIds()).toEqual([]);
  });

  it("ignores a lookup made under the album's earlier name", async () => {
    storeDiscogs({ name: "Souvlaki (Demo)" });

    await normalizeAlbum(ALBUM_ID);

    expect(albumGenreIds()).toEqual([]);
  });
});
