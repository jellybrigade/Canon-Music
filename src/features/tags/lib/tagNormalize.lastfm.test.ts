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
  vi.mocked(getCanonTree).mockResolvedValue(treeOf([shoegaze]));
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
  db.raw
    .prepare(
      "INSERT INTO track_tags (track_id, kind, raw_value, source) VALUES ('srv-a:t1', 'genre', 'shoegaze', 'lastfm')",
    )
    .run();
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

function storedComputedAt(): number | null {
  return (db.raw.prepare("SELECT computed_at FROM albums WHERE id = ?").get(ALBUM_ID) as { computed_at: number | null })
    .computed_at;
}

describe("normalizeAlbum when Last.fm doesn't answer", () => {
  it("keeps the album's earlier Last.fm genres and leaves it due for another try", async () => {
    vi.mocked(fetchAlbumTags).mockRejectedValue(new Error("Last.fm album.getTopTags returned 503"));

    const result = await normalizeAlbum(ALBUM_ID, "Slowdive", "Souvlaki");

    expect(albumGenreIds()).toEqual(["shoegaze"]);
    expect(storedComputedAt()).toBe(EARLIER);
    expect(result.computed_at).toBe(EARLIER);
    expect(fetchArtistGenreTags).not.toHaveBeenCalled();
  });

  it("stamps the album when Last.fm answers with no tags", async () => {
    vi.mocked(fetchAlbumTags).mockResolvedValue({ genres: [], moods: [] });
    vi.mocked(fetchArtistGenreTags).mockResolvedValue([]);

    await normalizeAlbum(ALBUM_ID, "Slowdive", "Souvlaki");

    expect(storedComputedAt()).toBeGreaterThan(EARLIER);
  });

  it("leaves the album due when the artist tag fallback fails", async () => {
    db.raw.prepare("DELETE FROM track_tags").run();
    vi.mocked(fetchAlbumTags).mockResolvedValue({ genres: [], moods: [] });
    vi.mocked(fetchArtistGenreTags).mockRejectedValue(new Error("Last.fm artist.getTopTags returned 503"));

    await normalizeAlbum(ALBUM_ID, "Slowdive", "Souvlaki");

    expect(storedComputedAt()).toBe(EARLIER);
  });
});
