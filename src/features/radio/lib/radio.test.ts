/**
 * Coverage for `radio.ts`'s candidate scoring: the pure weighting math (`scaleWeights`,
 * `buildAncestorWeights`) needs no DB at all; `getCuratedCandidates` and every `RadioMode`
 * branch of `getRadioCandidates` run real SQL against the real migrated schema via
 * `createMigratedTestDb`, since the bound genre weights, the sqrt(tag_count) damping and the
 * CANDIDATE_LIMIT are all properties of the query, not of a mock.
 *
 * `useRadio.test.ts` mocks this module out entirely and covers orchestration (guards,
 * exclusion sets, session memory) - a deliberately separate scope, see its header comment.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { bustCanonTreeCache } from "../../tags/lib/canonicalize";

const holder: { db: FakeDatabase | null } = { db: null };
vi.mock("../../../db", () => ({ getDb: async () => holder.db }));

import { buildAncestorWeights, CANDIDATE_LIMIT, getRadioCandidates, MOOD_WEIGHT, scaleWeights } from "./radio";

const SRV = "srv-a";
const OTHER = "srv-b";

async function insertAlbum(db: FakeDatabase, id: string, serverId = SRV): Promise<void> {
  await db.execute("INSERT INTO albums (id, server_id, server_type, name) VALUES (?, ?, 'navidrome', ?)", [
    id,
    serverId,
    `Album ${id}`,
  ]);
}

async function insertTrack(
  db: FakeDatabase,
  opts: {
    id: string;
    serverId?: string;
    albumId: string;
    artist?: string | null;
    year?: number | null;
    discNumber?: number;
    trackNumber?: number;
  },
): Promise<void> {
  await db.execute(
    `INSERT INTO tracks (id, server_id, server_type, title, artist, album_id, year, disc_number, track_number)
     VALUES (?, ?, 'navidrome', ?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      opts.serverId ?? SRV,
      `Title ${opts.id}`,
      opts.artist ?? null,
      opts.albumId,
      opts.year ?? null,
      opts.discNumber ?? 1,
      opts.trackNumber ?? 1,
    ],
  );
}

async function insertTag(
  db: FakeDatabase,
  trackId: string,
  canonicalId: string,
  kind: "genre" | "mood" = "genre",
): Promise<void> {
  await db.execute(
    "INSERT INTO track_tags (track_id, kind, raw_value, canonical_id, source) VALUES (?, ?, ?, ?, 'server')",
    [trackId, kind, canonicalId, canonicalId],
  );
}

async function insertTreeNode(db: FakeDatabase, id: string, parents: string[] = []): Promise<void> {
  await db.execute(
    "INSERT INTO user_tree_nodes (id, name, type, canonical_key, parent_ids) VALUES (?, ?, 'genre', ?, ?)",
    [id, id, id, JSON.stringify(parents)],
  );
}

describe("scaleWeights", () => {
  it("returns the tag-heavy end of the scale at 0", () => {
    expect(scaleWeights(0)).toEqual({ tagW: 0.6, trackCfW: 0.25, artistCfW: 0.15 });
  });

  it("returns the CF-heavy end of the scale at 1", () => {
    const { tagW, trackCfW, artistCfW } = scaleWeights(1);
    expect(tagW).toBeCloseTo(0.2, 10);
    expect(trackCfW).toBeCloseTo(0.45, 10);
    expect(artistCfW).toBeCloseTo(0.35, 10);
  });

  it("clamps a negative scale to 0", () => {
    expect(scaleWeights(-5)).toEqual(scaleWeights(0));
  });

  it("clamps a scale above 1 to 1", () => {
    expect(scaleWeights(5)).toEqual(scaleWeights(1));
  });

  it("always sums to 1", () => {
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      const { tagW, trackCfW, artistCfW } = scaleWeights(s);
      expect(tagW + trackCfW + artistCfW).toBeCloseTo(1, 10);
    }
  });
});

describe("buildAncestorWeights", () => {
  it("seeds the node itself at weight 1 even when absent from byId", () => {
    const weights = buildAncestorWeights("ghost", new Map());
    expect(weights).toEqual(new Map([["ghost", 1.0]]));
  });

  it("returns only the self weight for a node with no parents", () => {
    const byId = new Map([["a", { id: "a", parents: [] }]]);
    expect(buildAncestorWeights("a", byId)).toEqual(new Map([["a", 1.0]]));
  });

  it("halves the weight per hop, scaled by how much broader each ancestor is than the nearest parent", () => {
    const byId = new Map([
      ["c", { id: "c", parents: ["b"] }],
      ["b", { id: "b", parents: ["a"] }],
      ["a", { id: "a", parents: [] }],
    ]);
    const weights = buildAncestorWeights("c", byId);
    expect(weights.get("c")).toBe(1.0);
    expect(weights.get("b")).toBeCloseTo(0.5, 10);
    // b spans {b, c}, a spans {a, b, c}
    expect(weights.get("a")).toBeCloseTo(0.25 * (2 / 3), 10);
  });

  it("weights a broad direct parent by its breadth against the seed's narrowest parent", () => {
    // hardcore -> punk, hardcore -> rock, punk -> rock; rock also holds 8 unrelated genres.
    const byId = new Map<string, { id: string; parents: string[] }>([
      ["hardcore", { id: "hardcore", parents: ["punk", "rock"] }],
      ["punk", { id: "punk", parents: ["rock"] }],
      ["rock", { id: "rock", parents: [] }],
    ]);
    for (let i = 0; i < 8; i++) byId.set(`rock-${i}`, { id: `rock-${i}`, parents: ["rock"] });
    const weights = buildAncestorWeights("hardcore", byId);
    expect(weights.get("punk")).toBeCloseTo(0.5, 10);
    // punk spans 2 genres, rock spans 11
    expect(weights.get("rock")).toBeCloseTo(0.5 * (2 / 11), 10);
  });

  it("stops adding ancestors past maxDepth", () => {
    // f(0) -> e(1) -> d(2) -> c(3) -> b(4) -> a(5). A node discovered at depth 4 (b) is not
    // itself expanded (item.depth >= maxDepth), so its parent (a, depth 5) is never added.
    const byId = new Map([
      ["f", { id: "f", parents: ["e"] }],
      ["e", { id: "e", parents: ["d"] }],
      ["d", { id: "d", parents: ["c"] }],
      ["c", { id: "c", parents: ["b"] }],
      ["b", { id: "b", parents: ["a"] }],
      ["a", { id: "a", parents: [] }],
    ]);
    const weights = buildAncestorWeights("f", byId, 4);
    expect(weights.has("b")).toBe(true);
    expect(weights.has("a")).toBe(false);
  });

  it("does not loop forever on a cycle", () => {
    const byId = new Map([
      ["a", { id: "a", parents: ["b"] }],
      ["b", { id: "b", parents: ["a"] }],
    ]);
    const weights = buildAncestorWeights("a", byId);
    expect(weights.get("a")).toBe(1.0);
    expect(weights.get("b")).toBeCloseTo(0.5, 10);
    expect(weights.size).toBe(2);
  });
});

describe("getRadioCandidates", () => {
  beforeEach(async () => {
    holder.db = await createMigratedTestDb();
    bustCanonTreeCache();
  });

  it("returns [] when the seed track does not exist", async () => {
    const result = await getRadioCandidates({
      seedTrackId: "missing",
      mode: "random",
      excludeIds: new Set(),
      artistSimilarity: new Map(),
      trackSimilarity: new Map(),
    });
    expect(result).toEqual([]);
  });

  describe("curated / same-genre (tag scoring)", () => {
    it("falls back to a random same-server pick, scored 0.1, when the seed has no canonical tags", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTrack(db, { id: "seed", albumId: "alb" });
      await insertTrack(db, { id: "cand", albumId: "alb" });
      await insertTrack(db, { id: "other-server", serverId: OTHER, albumId: "alb" });
      await insertAlbum(db, "alb2", OTHER);
      await insertTrack(db, { id: "other-server-2", serverId: OTHER, albumId: "alb2" });

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "curated",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });

      expect(result.map((r) => r.id)).toEqual(["cand"]);
      expect(result[0]!.score).toBe(0.1);
    });

    it("excludes ids from the no-tags random fallback", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTrack(db, { id: "seed", albumId: "alb" });
      await insertTrack(db, { id: "cand", albumId: "alb" });

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "curated",
        excludeIds: new Set(["cand"]),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });
      expect(result).toEqual([]);
    });

    it("matches genre ids holding any character, bound rather than written into the query", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTrack(db, { id: "seed", albumId: "alb" });
      await insertTrack(db, { id: "rnb", albumId: "alb" });
      await insertTrack(db, { id: "quoted", albumId: "alb" });
      await insertTag(db, "seed", "r&b");
      await insertTag(db, "rnb", "r&b");
      await insertTag(db, "seed", "bad'id;drop table tracks;--");
      await insertTag(db, "quoted", "bad'id;drop table tracks;--");

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "same-genre",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });
      expect(result.map((r) => r.id).sort()).toEqual(["quoted", "rnb"]);
    });

    it("scores a genre-tagged candidate above an equally-weighted mood-tagged one", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTreeNode(db, "tag-x");
      await insertTrack(db, { id: "seed", albumId: "alb" });
      await insertTag(db, "seed", "tag-x", "genre");

      await insertTrack(db, { id: "genre-cand", albumId: "alb" });
      await insertTag(db, "genre-cand", "tag-x", "genre");

      await insertTrack(db, { id: "mood-cand", albumId: "alb" });
      await insertTag(db, "mood-cand", "tag-x", "mood");

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "same-genre",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });

      const ids = result.map((r) => r.id);
      expect(ids.indexOf("genre-cand")).toBeLessThan(ids.indexOf("mood-cand"));
      expect(result.find((r) => r.id === "mood-cand")!.score).toBeCloseTo(
        result.find((r) => r.id === "genre-cand")!.score * MOOD_WEIGHT,
        6,
      );
    });

    it("applies sqrt(tag_count) damping so two matched tags do not double the score", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTreeNode(db, "x");
      await insertTreeNode(db, "y");
      await insertTrack(db, { id: "seed", albumId: "alb" });
      await insertTag(db, "seed", "x");
      await insertTag(db, "seed", "y");

      await insertTrack(db, { id: "double", albumId: "alb" });
      await insertTag(db, "double", "x");
      await insertTag(db, "double", "y");

      await insertTrack(db, { id: "single", albumId: "alb" });
      await insertTag(db, "single", "x");

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "same-genre", // zeroes trackCf/artistCf so score is pure tagW * normalizedTree
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });

      const double = result.find((r) => r.id === "double")!;
      const single = result.find((r) => r.id === "single")!;
      // d(double) = 2/sqrt(2) ~= 1.4142, d(single) = 1/sqrt(1) = 1, maxTree = d(double)
      // tagW at default scale 0.5 = 0.4
      expect(double.score).toBeCloseTo(0.4 * 1, 6);
      expect(single.score).toBeCloseTo(0.4 * (1 / Math.sqrt(2)), 6);
    });

    it("damps by every genre a candidate carries, so unmatched genres cost it score", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTreeNode(db, "jazz");
      await insertTrack(db, { id: "seed", albumId: "alb" });
      await insertTag(db, "seed", "jazz");

      await insertTrack(db, { id: "pure", albumId: "alb" });
      await insertTag(db, "pure", "jazz");

      await insertTrack(db, { id: "broad", albumId: "alb" });
      for (const genre of ["jazz", "black-metal", "drill", "shoegaze", "trance"]) await insertTag(db, "broad", genre);

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "same-genre",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });

      expect(result.map((r) => r.id)).toEqual(["pure", "broad"]);
      expect(result[1]!.score).toBeCloseTo(0.4 * (1 / Math.sqrt(5)), 6);
    });

    it("keeps a focused match past the candidate cap that broadly tagged matches would fill", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTreeNode(db, "x");
      await insertTreeNode(db, "y");
      await insertTrack(db, { id: "seed", albumId: "alb" });
      await insertTag(db, "seed", "x");
      await insertTag(db, "seed", "y");
      for (let i = 0; i < CANDIDATE_LIMIT; i++) {
        await insertTrack(db, { id: `broad${i}`, albumId: "alb" });
        for (const genre of ["x", "y", "u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"]) {
          await insertTag(db, `broad${i}`, genre);
        }
      }
      await insertTrack(db, { id: "focused", albumId: "alb" });
      await insertTag(db, "focused", "x");

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "same-genre",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });

      expect(result[0]!.id).toBe("focused");
    });

    it("counts a tag once however many sources and spellings carry it", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTreeNode(db, "x");
      await insertTrack(db, { id: "seed", albumId: "alb" });
      await insertTag(db, "seed", "x");

      await insertTrack(db, { id: "widely-tagged", albumId: "alb" });
      for (const [rawValue, source] of [
        ["x", "server"],
        ["x", "lastfm"],
        ["X ", "lastfm"],
        ["x", "musicbrainz"],
      ]) {
        await db.execute(
          "INSERT INTO track_tags (track_id, kind, raw_value, canonical_id, source) VALUES ('widely-tagged', 'genre', ?, 'x', ?)",
          [rawValue, source],
        );
      }

      await insertTrack(db, { id: "single", albumId: "alb" });
      await insertTag(db, "single", "x");

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "same-genre",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });

      expect(result).toHaveLength(2);
      for (const candidate of result) expect(candidate.score).toBeCloseTo(0.4, 6);
    });

    it("normalizes against the pre-exclusion max, so excluding the top scorer shrinks what remains", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTreeNode(db, "x");
      await insertTreeNode(db, "y");
      await insertTrack(db, { id: "seed", albumId: "alb" });
      await insertTag(db, "seed", "x");
      await insertTag(db, "seed", "y");

      await insertTrack(db, { id: "top", albumId: "alb" });
      await insertTag(db, "top", "x");
      await insertTag(db, "top", "y");

      await insertTrack(db, { id: "rest", albumId: "alb" });
      await insertTag(db, "rest", "x");

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "same-genre",
        excludeIds: new Set(["top"]),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });

      expect(result.map((r) => r.id)).toEqual(["rest"]);
      // maxTree stayed pinned to "top"'s d (2/sqrt(2)) even though "top" was filtered out,
      // so "rest" normalizes to 1/sqrt(2) rather than 1.
      expect(result[0]!.score).toBeCloseTo(0.4 * (1 / Math.sqrt(2)), 6);
    });

    it("propagates ancestor weight through a parent chain to a candidate tagged with the ancestor", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTreeNode(db, "parent");
      await insertTreeNode(db, "child", ["parent"]);
      await insertTrack(db, { id: "seed", albumId: "alb" });
      await insertTag(db, "seed", "child");

      await insertTrack(db, { id: "cand", albumId: "alb" });
      await insertTag(db, "cand", "parent");

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "same-genre",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });

      expect(result.map((r) => r.id)).toEqual(["cand"]);
      // single candidate: normalizedTree = 1 regardless of the 0.5 ancestor weight (it's the
      // only score in the set), so this pins reachability, not the exact weight value.
      expect(result[0]!.score).toBeCloseTo(0.4, 6);
    });

    it("keeps the max weight when two seed tags' ancestor chains both reach the same node", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTreeNode(db, "target");
      await insertTreeNode(db, "child", ["target"]); // child -> target is 1 hop, weight 0.5
      await insertTrack(db, { id: "seed", albumId: "alb" });
      // Seed tagged with "target" directly (self weight 1.0) AND "child" (whose ancestor
      // weights would contribute only 0.5 to "target"). A last-write-wins merge instead of
      // Math.max would silently downgrade "target" to 0.5.
      await insertTag(db, "seed", "target");
      await insertTag(db, "seed", "child");

      await insertTrack(db, { id: "via-target", albumId: "alb" });
      await insertTag(db, "via-target", "target");
      await insertTrack(db, { id: "via-child", albumId: "alb" });
      await insertTag(db, "via-child", "child");

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "same-genre",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });

      const viaTarget = result.find((r) => r.id === "via-target")!;
      const viaChild = result.find((r) => r.id === "via-child")!;
      expect(viaTarget.score).toBeCloseTo(viaChild.score, 6);
    });

    it("ranks every punk-family track above a track tagged only with rock, a broad direct parent", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTreeNode(db, "t-rock");
      await insertTreeNode(db, "t-punk", ["t-rock"]);
      await insertTreeNode(db, "t-hardcore", ["t-punk", "t-rock"]);
      for (let i = 0; i < 30; i++) await insertTreeNode(db, `t-rock-${i}`, ["t-rock"]);
      await insertTrack(db, { id: "seed", albumId: "alb", artist: "Hardcore A" });
      await insertTag(db, "seed", "t-hardcore");
      for (const { id, artist } of [
        { id: "hc-1", artist: "Hardcore A" },
        { id: "hc-2", artist: "Hardcore B" },
      ]) {
        await insertTrack(db, { id, albumId: "alb", artist });
        await insertTag(db, id, "t-hardcore");
      }
      for (let i = 0; i < 6; i++) {
        await insertTrack(db, { id: `punk-${i}`, albumId: "alb", artist: `Punk ${i}` });
        await insertTag(db, `punk-${i}`, "t-punk");
      }
      for (let i = 0; i < 20; i++) {
        await insertTrack(db, { id: `rock-${i}`, albumId: "alb", artist: `Rock ${i}` });
        await insertTag(db, `rock-${i}`, "t-rock");
      }

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "same-genre",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });

      const scoreOf = (id: string) => result.find((r) => r.id === id)?.score ?? Number.NaN;
      const weakestPunk = Math.min(...Array.from({ length: 6 }, (_, i) => scoreOf(`punk-${i}`)));
      const strongestRock = Math.max(...Array.from({ length: 20 }, (_, i) => scoreOf(`rock-${i}`)));
      expect(strongestRock).toBeLessThan(weakestPunk);
      expect(strongestRock).toBeLessThan(scoreOf("hc-1") / 10);
    });

    it("scopes candidates to the seed's server", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTreeNode(db, "x");
      await insertTrack(db, { id: "seed", albumId: "alb" });
      await insertTag(db, "seed", "x");

      await insertTrack(db, { id: "same-server", albumId: "alb" });
      await insertTag(db, "same-server", "x");

      await insertAlbum(db, "alb2", OTHER);
      await insertTrack(db, { id: "other-server", serverId: OTHER, albumId: "alb2" });
      await insertTag(db, "other-server", "x");

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "same-genre",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });
      expect(result.map((r) => r.id)).toEqual(["same-server"]);
    });

    it("caps both the no-tags fallback and the scored query at CANDIDATE_LIMIT", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTrack(db, { id: "seed", albumId: "alb" });
      for (let i = 0; i < CANDIDATE_LIMIT + 25; i++) {
        await insertTrack(db, { id: `t${i}`, albumId: "alb" });
      }
      const fallback = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "curated",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });
      expect(fallback.length).toBe(CANDIDATE_LIMIT);

      await insertTreeNode(db, "x");
      await insertTag(db, "seed", "x");
      for (let i = 0; i < CANDIDATE_LIMIT + 25; i++) {
        await insertTag(db, `t${i}`, "x");
      }
      const scored = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "curated",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });
      expect(scored.length).toBe(CANDIDATE_LIMIT);
    });
  });

  describe("similar-artists", () => {
    it("returns [] without issuing the artist query when artistSimilarity is empty", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTrack(db, { id: "seed", albumId: "alb", artist: "Seed Artist" });
      const before = db.selectCount;

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "similar-artists",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });
      expect(result).toEqual([]);
      // +1, not +2: the seed-row lookup always runs, but the mode-specific artist query
      // is skipped entirely on the empty-map short-circuit.
      expect(db.selectCount).toBe(before + 1);
    });

    it("matches by lower-cased artist name, scores by similarity, sorts descending, respects excludeIds", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTrack(db, { id: "seed", albumId: "alb", artist: "Seed" });
      await insertTrack(db, { id: "low", albumId: "alb", artist: "ARTIST LOW" });
      await insertTrack(db, { id: "high", albumId: "alb", artist: "artist high" });
      await insertTrack(db, { id: "excluded", albumId: "alb", artist: "artist high" });
      await insertTrack(db, { id: "unrelated", albumId: "alb", artist: "Nobody" });

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "similar-artists",
        excludeIds: new Set(["excluded"]),
        artistSimilarity: new Map([
          ["artist low", 0.2],
          ["artist high", 0.9],
        ]),
        trackSimilarity: new Map(),
      });

      expect(result.map((r) => r.id)).toEqual(["high", "low"]);
      expect(result[0]!.score).toBe(0.9);
      expect(result[1]!.score).toBe(0.2);
    });
  });

  describe("same-artist", () => {
    it("returns [] when the seed has no artist", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTrack(db, { id: "seed", albumId: "alb", artist: null });
      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "same-artist",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });
      expect(result).toEqual([]);
    });

    it("matches by case-insensitive artist equality, fixed score 1.0, excludeIds honored", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTrack(db, { id: "seed", albumId: "alb", artist: "The Band" });
      await insertTrack(db, { id: "match", albumId: "alb", artist: "the band" });
      await insertTrack(db, { id: "excluded", albumId: "alb", artist: "THE BAND" });
      await insertTrack(db, { id: "other", albumId: "alb", artist: "Other Band" });

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "same-artist",
        excludeIds: new Set(["excluded"]),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });
      expect(result.map((r) => r.id)).toEqual(["match"]);
      expect(result[0]!.score).toBe(1.0);
    });
  });

  describe("same-album", () => {
    it("falls back to curated tag scoring when the seed has no album", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTreeNode(db, "x");
      // seed's album_id is left null by omission below via a direct track insert
      await db.execute(
        "INSERT INTO tracks (id, server_id, server_type, title, artist, album_id) VALUES ('seed', ?, 'navidrome', 'Seed', NULL, NULL)",
        [SRV],
      );
      await insertTag(db, "seed", "x");
      await insertTrack(db, { id: "cand", albumId: "alb" });
      await insertTag(db, "cand", "x");

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "same-album",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });
      expect(result.map((r) => r.id)).toEqual(["cand"]);
    });

    it("orders album tracks by disc then track number, fixed score 1.0, not by any score sort", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTrack(db, { id: "seed", albumId: "alb", discNumber: 1, trackNumber: 1 });
      await insertTrack(db, { id: "t3", albumId: "alb", discNumber: 1, trackNumber: 3 });
      await insertTrack(db, { id: "t2-d2", albumId: "alb", discNumber: 2, trackNumber: 1 });
      await insertTrack(db, { id: "t2", albumId: "alb", discNumber: 1, trackNumber: 2 });

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "same-album",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });
      expect(result.map((r) => r.id)).toEqual(["t2", "t3", "t2-d2"]);
      expect(result.every((r) => r.score === 1.0)).toBe(true);
    });

    it("falls back to curated when every other album track is excluded", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTreeNode(db, "x");
      await insertTrack(db, { id: "seed", albumId: "alb" });
      await insertTag(db, "seed", "x");
      await insertTrack(db, { id: "sibling", albumId: "alb" });

      await insertAlbum(db, "alb2");
      await insertTrack(db, { id: "cand", albumId: "alb2" });
      await insertTag(db, "cand", "x");

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "same-album",
        excludeIds: new Set(["sibling"]),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });
      expect(result.map((r) => r.id)).toEqual(["cand"]);
    });
  });

  describe("era", () => {
    it("falls back to random when the seed has no year, fixed score 1.0", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTrack(db, { id: "seed", albumId: "alb", year: null });
      await insertTrack(db, { id: "cand", albumId: "alb", year: 1999 });

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "era",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });
      expect(result.map((r) => r.id)).toEqual(["cand"]);
      expect(result[0]!.score).toBe(1.0);
    });

    it("scores within the decade by distance from the seed year, excludes outside the decade", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTrack(db, { id: "seed", albumId: "alb", year: 1995 });
      await insertTrack(db, { id: "same-year", albumId: "alb", year: 1995 });
      await insertTrack(db, { id: "five-off", albumId: "alb", year: 1990 });
      await insertTrack(db, { id: "next-decade", albumId: "alb", year: 2000 });

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "era",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });

      const ids = result.map((r) => r.id);
      expect(ids).toContain("same-year");
      expect(ids).toContain("five-off");
      expect(ids).not.toContain("next-decade"); // 2000 is outside [1990,1999]
      expect(result.find((r) => r.id === "same-year")!.score).toBe(1.0);
      expect(result.find((r) => r.id === "five-off")!.score).toBeCloseTo(0.5, 10);
    });
  });

  describe("loved", () => {
    it("returns only tracks in loved_tracks, fixed score 1.0", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTrack(db, { id: "seed", albumId: "alb" });
      await insertTrack(db, { id: "loved", albumId: "alb" });
      await insertTrack(db, { id: "not-loved", albumId: "alb" });
      await db.execute("INSERT INTO loved_tracks (track_id) VALUES ('loved')");

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "loved",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });
      expect(result.map((r) => r.id)).toEqual(["loved"]);
      expect(result[0]!.score).toBe(1.0);
    });
  });

  it.each([
    ["curated", "no tags"],
    ["similar-artists", "artists"],
    ["same-artist", "artist"],
    ["era", "no year"],
    ["era", "decade"],
    ["loved", "loved"],
    ["random", "library"],
  ] as const)("draws the %s pool (%s) from a counted window, not a sort by RANDOM()", async (mode, pool) => {
    const db = holder.db!;
    await insertAlbum(db, "alb");
    const year = pool === "no year" ? null : 1995;
    await insertTrack(db, { id: "seed", albumId: "alb", artist: "Sting", year });
    for (let i = 0; i < 5; i++) await insertTrack(db, { id: `c${i}`, albumId: "alb", artist: "STING", year: 1991 });
    await db.execute("INSERT INTO loved_tracks (track_id) SELECT id FROM tracks WHERE id != 'seed'");
    db.queryLog.length = 0;

    const result = await getRadioCandidates({
      seedTrackId: "seed",
      mode,
      excludeIds: new Set(),
      artistSimilarity: new Map([["sting", 1]]),
      trackSimilarity: new Map(),
    });
    expect(result.map((r) => r.id).sort()).toEqual(["c0", "c1", "c2", "c3", "c4"]);
    expect(db.queryLog.filter((q) => /RANDOM\(\)/i.test(q.sql))).toEqual([]);
  });

  it("caps a random pool at CANDIDATE_LIMIT distinct tracks however the window falls", async () => {
    const db = holder.db!;
    await insertAlbum(db, "alb");
    await insertTrack(db, { id: "seed", albumId: "alb" });
    for (let i = 0; i < CANDIDATE_LIMIT + 25; i++) await insertTrack(db, { id: `t${i}`, albumId: "alb" });
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "random",
        excludeIds: new Set(),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });
      expect(new Set(result.map((r) => r.id)).size).toBe(CANDIDATE_LIMIT);
    } finally {
      random.mockRestore();
    }
  });

  describe("random", () => {
    it("excludes the seed and excludeIds, scopes to the server, fixed score 1.0", async () => {
      const db = holder.db!;
      await insertAlbum(db, "alb");
      await insertTrack(db, { id: "seed", albumId: "alb" });
      await insertTrack(db, { id: "cand", albumId: "alb" });
      await insertTrack(db, { id: "excluded", albumId: "alb" });
      await insertAlbum(db, "alb2", OTHER);
      await insertTrack(db, { id: "other-server", serverId: OTHER, albumId: "alb2" });

      const result = await getRadioCandidates({
        seedTrackId: "seed",
        mode: "random",
        excludeIds: new Set(["excluded"]),
        artistSimilarity: new Map(),
        trackSimilarity: new Map(),
      });
      expect(result.map((r) => r.id)).toEqual(["cand"]);
      expect(result[0]!.score).toBe(1.0);
    });
  });
});
