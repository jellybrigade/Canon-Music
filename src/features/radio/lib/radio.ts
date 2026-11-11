import { getDb } from "../../../db";
import { selectRandomSample } from "../../../db/randomSample";
import type { RadioMode } from "../../playback/store/playerTypes";
import { getCanonTree } from "../../tags/lib/canonicalize";
import { creditedArtistKeys } from "./artistCredit";

export interface RadioCandidate {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  artworkRef: string | null;
  albumId: string | null;
  albumName: string | null;
  score: number;
}

export const MOOD_WEIGHT = 0.4;
// A seed track tagged with fewer genres than this also seeds on its album's genres, at this weight:
// LCD Soundsystem's "45:33 (intro)" carries only Electronic, which alone seeds on all of it.
const THIN_SEED_GENRE_COUNT = 2;
export const ALBUM_GENRE_WEIGHT = 0.75;
const SEED_TAG_WEIGHT: Partial<Record<string, number>> = { mood: MOOD_WEIGHT, album: ALBUM_GENRE_WEIGHT };
export const CANDIDATE_LIMIT = 200;

export function scaleWeights(scale: number): { tagW: number; trackCfW: number; artistCfW: number } {
  const s = Math.max(0, Math.min(1, scale));
  return {
    tagW: 0.6 - 0.4 * s,
    trackCfW: 0.25 + 0.2 * s,
    artistCfW: 0.15 + 0.2 * s,
  };
}

interface SeedInfo {
  serverId: string;
  artist: string | null;
  year: number | null;
  albumId: string | null;
}

interface CandidateParams {
  seedTrackId: string;
  mode: RadioMode;
  excludeIds: Set<string>;
  artistSimilarity: Map<string, number>;
  trackSimilarity: Map<string, number>;
  similarityScale?: number;
}

// Common SELECT projection reused by simple-query modes
const TRACK_PROJECTION = `
  t.id, t.title, t.artist, t.duration,
  a.artwork_url, t.album_id, a.name AS album_name
`;

const TRACKS_WITH_ALBUM = "tracks t JOIN albums a ON t.album_id = a.id";

/** Artist equality through the NOCASE artist index; `lower()` would scan the server's tracks. */
export const ARTIST_MATCH = "t.artist = ? COLLATE NOCASE";

export function similarArtistsMatch(count: number): string {
  return `t.artist COLLATE NOCASE IN (${Array.from({ length: count }, () => "?").join(", ")})`;
}

type TrackRow = {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  artwork_url: string | null;
  album_id: string | null;
  album_name: string | null;
};

type DbHandle = Awaited<ReturnType<typeof getDb>>;

function sampleSeedPool<T extends TrackRow>(
  db: DbHandle,
  seedTrackId: string,
  pool: { serverId: string; from?: string; where?: string; params?: unknown[]; columns?: string },
): Promise<T[]> {
  return selectRandomSample<T>(db, {
    columns: `${TRACK_PROJECTION}${pool.columns ?? ""}`,
    from: pool.from ?? TRACKS_WITH_ALBUM,
    where: `t.server_id = ? AND t.id != ?${pool.where ? ` AND ${pool.where}` : ""}`,
    params: [pool.serverId, seedTrackId, ...(pool.params ?? [])],
    orderBy: "t.id",
    limit: CANDIDATE_LIMIT,
  });
}

function bestMatch(keys: string[], scoreOf: (key: string) => number | undefined): number {
  return Math.max(0, ...keys.map((key) => scoreOf(key) ?? 0));
}

function rowToCandidate(r: TrackRow, score: number): RadioCandidate {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    duration: r.duration,
    artworkRef: r.artwork_url,
    albumId: r.album_id,
    albumName: r.album_name,
    score,
  };
}

type AncestorNode = { id: string; parents: string[] };

function subtreeSizer(byId: Map<string, AncestorNode>): (id: string) => number {
  const children = new Map<string, string[]>();
  for (const node of byId.values()) {
    for (const parentId of node.parents) {
      const list = children.get(parentId);
      if (list) list.push(node.id);
      else children.set(parentId, [node.id]);
    }
  }
  return (id) => {
    const seen = new Set([id]);
    const stack = [id];
    for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
      for (const childId of children.get(current) ?? []) {
        if (seen.has(childId)) continue;
        seen.add(childId);
        stack.push(childId);
      }
    }
    return seen.size;
  };
}

/**
 * Halves per hop, then scales each ancestor by the narrowest direct parent's span over its own,
 * so a root like rock sitting directly above hardcore punk counts for little beside punk rock.
 */
export function buildAncestorWeights(
  nodeId: string,
  byId: Map<string, AncestorNode>,
  maxDepth = 4,
): Map<string, number> {
  const weights = new Map<string, number>([[nodeId, 1.0]]);
  const found: Array<{ id: string; depth: number }> = [];
  const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
  const visited = new Set<string>([nodeId]);
  for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
    if (item.depth >= maxDepth) continue;
    const node = byId.get(item.id);
    if (!node) continue;
    for (const parentId of node.parents) {
      if (visited.has(parentId)) continue;
      visited.add(parentId);
      const ancestor = { id: parentId, depth: item.depth + 1 };
      found.push(ancestor);
      queue.push(ancestor);
    }
  }
  if (found.length === 0) return weights;

  const subtreeSize = subtreeSizer(byId);
  const sizes = new Map(found.map(({ id }) => [id, subtreeSize(id)]));
  const directParentSizes = found.filter(({ depth }) => depth === 1).map(({ id }) => sizes.get(id) ?? 1);
  const nearestFamilySize = Math.min(...directParentSizes);
  for (const { id, depth } of found) {
    const breadth = Math.min(1, nearestFamilySize / (sizes.get(id) ?? 1));
    weights.set(id, breadth / 2 ** depth);
  }
  return weights;
}

async function getCuratedCandidates(
  seedTrackId: string,
  seed: SeedInfo,
  excludeIds: Set<string>,
  artistSimilarity: Map<string, number>,
  trackSimilarity: Map<string, number>,
  scale = 0.5,
): Promise<RadioCandidate[]> {
  const db = await getDb();
  const tree = await getCanonTree();

  type TagRow = { canonical_id: string; kind: string };
  const trackTags = await db.select<TagRow[]>(
    "SELECT DISTINCT canonical_id, kind FROM track_tags WHERE track_id = ? AND canonical_id IS NOT NULL",
    [seedTrackId],
  );
  const trackGenreCount = trackTags.filter((tag) => tag.kind === "genre").length;
  const albumTags =
    seed.albumId && trackGenreCount < THIN_SEED_GENRE_COUNT
      ? await db.select<TagRow[]>(
          `SELECT canonical_id, 'album' AS kind FROM album_genres
           WHERE album_id = ? AND relation = 'direct' AND canonical_id NOT LIKE 'raw:%'
           ORDER BY canonical_id`,
          [seed.albumId],
        )
      : [];
  const seedTags = [...trackTags, ...albumTags];

  if (seedTags.length === 0) {
    const fallback = await sampleSeedPool(db, seedTrackId, { serverId: seed.serverId });
    return fallback.filter((r) => !excludeIds.has(r.id)).map((r) => rowToCandidate(r, 0.1));
  }

  const combinedWeights = new Map<string, number>();
  for (const tag of seedTags) {
    const baseWeight = SEED_TAG_WEIGHT[tag.kind] ?? 1.0;
    const aw = buildAncestorWeights(tag.canonical_id, tree.byId);
    for (const [nodeId, w] of aw) {
      const existing = combinedWeights.get(nodeId) ?? 0;
      combinedWeights.set(nodeId, Math.max(existing, w * baseWeight));
    }
  }

  if (combinedWeights.size === 0) return [];

  const weightRows = Array.from(combinedWeights.entries());
  const weightValues = weightRows.map(() => "(?, ?)").join(", ");

  // tag_count is every genre the candidate carries, matched or not, so a track tagged Jazz among
  // ten other genres scores below a pure jazz track instead of level with it.
  type ScoredRow = TrackRow & { sum_score: number; tag_count: number };

  const rows = await db.select<ScoredRow[]>(
    `WITH seed_weights(canonical_id, weight) AS (
       VALUES ${weightValues}
     )
     SELECT ${TRACK_PROJECTION},
            SUM(sw.weight * CASE tt.kind WHEN 'mood' THEN ${MOOD_WEIGHT} ELSE 1.0 END) AS sum_score,
            (SELECT COUNT(DISTINCT all_tags.canonical_id) FROM track_tags all_tags
             WHERE all_tags.track_id = t.id AND all_tags.canonical_id IS NOT NULL) AS tag_count
     FROM tracks t
     -- One row per source and spelling is stored; each tag counts once.
     JOIN (SELECT DISTINCT track_id, canonical_id, kind FROM track_tags) tt ON tt.track_id = t.id
     JOIN seed_weights sw ON sw.canonical_id = tt.canonical_id
     JOIN albums a ON t.album_id = a.id
     WHERE t.server_id = ? AND t.id != ?
     GROUP BY t.id
     -- sum^2 / count orders like sum / sqrt(count) without SQRT(), so the cap keeps the damped best.
     ORDER BY sum_score * sum_score / tag_count DESC, t.id
     LIMIT ?`,
    [...weightRows.flat(), seed.serverId, seedTrackId, CANDIDATE_LIMIT],
  );

  // Dampen by sqrt(tag_count) in JS, not SQL, since target SQLite builds may lack SQRT().
  const scored = rows.map((r) => ({ r, d: r.sum_score / Math.sqrt(r.tag_count) }));
  const maxTree = scored.length > 0 ? Math.max(...scored.map((s) => s.d)) : 1;

  const { tagW, trackCfW, artistCfW } = scaleWeights(scale);
  return scored
    .filter(({ r }) => !excludeIds.has(r.id))
    .map(({ r, d }) => {
      const normalizedTree = maxTree > 0 ? d / maxTree : 0;
      const artistKeys = creditedArtistKeys(r.artist);
      const title = r.title.toLowerCase();
      const artistCf = bestMatch(artistKeys, (key) => artistSimilarity.get(key));
      const trackCf = bestMatch(artistKeys, (key) => trackSimilarity.get(`${key}|||${title}`));
      const score = tagW * normalizedTree + trackCfW * trackCf + artistCfW * artistCf;
      return rowToCandidate(r, score);
    })
    .sort((a, b) => b.score - a.score);
}

export async function getRadioCandidates({
  seedTrackId,
  mode,
  excludeIds,
  artistSimilarity,
  trackSimilarity,
  similarityScale = 0.5,
}: CandidateParams): Promise<RadioCandidate[]> {
  const db = await getDb();

  type SeedRow = { server_id: string; artist: string | null; year: number | null; album_id: string | null };
  const seedRows = await db.select<SeedRow[]>("SELECT server_id, artist, year, album_id FROM tracks WHERE id = ?", [
    seedTrackId,
  ]);
  const seedRow = seedRows[0];
  if (!seedRow) return [];

  const seed: SeedInfo = {
    serverId: seedRow.server_id,
    artist: seedRow.artist,
    year: seedRow.year,
    albumId: seedRow.album_id,
  };

  switch (mode) {
    case "curated":
      return getCuratedCandidates(seedTrackId, seed, excludeIds, artistSimilarity, trackSimilarity, similarityScale);

    case "same-genre":
      return getCuratedCandidates(seedTrackId, seed, excludeIds, new Map(), new Map(), similarityScale);

    case "similar-artists": {
      if (artistSimilarity.size === 0) return [];
      const similarArtistNames = Array.from(artistSimilarity.keys());
      const rows = await sampleSeedPool(db, seedTrackId, {
        serverId: seed.serverId,
        where: similarArtistsMatch(similarArtistNames.length),
        params: similarArtistNames,
      });
      return rows
        .filter((r) => !excludeIds.has(r.id))
        .map((r) => {
          return rowToCandidate(
            r,
            bestMatch(creditedArtistKeys(r.artist), (key) => artistSimilarity.get(key)),
          );
        })
        .sort((a, b) => b.score - a.score);
    }

    case "same-artist": {
      if (!seed.artist) return [];
      const rows = await sampleSeedPool(db, seedTrackId, {
        serverId: seed.serverId,
        where: ARTIST_MATCH,
        params: [seed.artist],
      });
      return rows.filter((r) => !excludeIds.has(r.id)).map((r) => rowToCandidate(r, 1.0));
    }

    case "same-album": {
      if (!seed.albumId)
        return getCuratedCandidates(seedTrackId, seed, excludeIds, new Map(), new Map(), similarityScale);
      const rows = await db.select<TrackRow[]>(
        `SELECT ${TRACK_PROJECTION}
         FROM tracks t JOIN albums a ON t.album_id = a.id
         WHERE t.album_id = ? AND t.id != ?
         ORDER BY t.disc_number, t.track_number`,
        [seed.albumId, seedTrackId],
      );
      const filtered = rows.filter((r) => !excludeIds.has(r.id)).map((r) => rowToCandidate(r, 1.0));
      // Fall back to curated when album exhausted
      if (filtered.length === 0)
        return getCuratedCandidates(seedTrackId, seed, excludeIds, new Map(), new Map(), similarityScale);
      return filtered;
    }

    case "era": {
      if (seed.year === null) {
        const rows = await sampleSeedPool(db, seedTrackId, { serverId: seed.serverId });
        return rows.filter((r) => !excludeIds.has(r.id)).map((r) => rowToCandidate(r, 1.0));
      }
      const decadeStart = Math.floor(seed.year / 10) * 10;
      const decadeEnd = decadeStart + 9;
      type EraRow = TrackRow & { year: number | null };
      const rows = await sampleSeedPool<EraRow>(db, seedTrackId, {
        serverId: seed.serverId,
        columns: ", t.year",
        where: "t.year BETWEEN ? AND ?",
        params: [decadeStart, decadeEnd],
      });
      return rows
        .filter((r) => !excludeIds.has(r.id))
        .map((r) => {
          const dist = r.year !== null ? Math.abs(r.year - seed.year!) : 5;
          return rowToCandidate(r, Math.max(0, 1 - dist / 10));
        })
        .sort((a, b) => b.score - a.score);
    }

    case "loved": {
      const rows = await sampleSeedPool(db, seedTrackId, {
        serverId: seed.serverId,
        from: `${TRACKS_WITH_ALBUM} JOIN loved_tracks lt ON lt.track_id = t.id`,
      });
      return rows.filter((r) => !excludeIds.has(r.id)).map((r) => rowToCandidate(r, 1.0));
    }

    case "random": {
      const rows = await sampleSeedPool(db, seedTrackId, { serverId: seed.serverId });
      return rows.filter((r) => !excludeIds.has(r.id)).map((r) => rowToCandidate(r, 1.0));
    }
  }
}
