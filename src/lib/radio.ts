import { getDb } from "../db";
import { getCanonTree } from "./canonicalize";
import type { RadioMode } from "../store/player";

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

const MOOD_WEIGHT = 0.4;
const CANDIDATE_LIMIT = 200;

function scaleWeights(scale: number): { tagW: number; trackCfW: number; artistCfW: number } {
  const s = Math.max(0, Math.min(1, scale));
  return {
    tagW:      0.60 - 0.40 * s,
    trackCfW:  0.25 + 0.20 * s,
    artistCfW: 0.15 + 0.20 * s,
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

type TrackRow = {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  artwork_url: string | null;
  album_id: string | null;
  album_name: string | null;
};

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

function buildAncestorWeights(
  nodeId: string,
  byId: Map<string, { id: string; parents: string[] }>,
  maxDepth = 4
): Map<string, number> {
  const weights = new Map<string, number>();
  weights.set(nodeId, 1.0);
  const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
  const visited = new Set<string>([nodeId]);
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.depth >= maxDepth) continue;
    const node = byId.get(item.id);
    if (!node) continue;
    for (const parentId of node.parents) {
      if (visited.has(parentId)) continue;
      visited.add(parentId);
      const w = 1 / Math.pow(2, item.depth + 1);
      const existing = weights.get(parentId) ?? 0;
      weights.set(parentId, Math.max(existing, w));
      queue.push({ id: parentId, depth: item.depth + 1 });
    }
  }
  return weights;
}

async function getCuratedCandidates(
  seedTrackId: string,
  seed: SeedInfo,
  excludeIds: Set<string>,
  artistSimilarity: Map<string, number>,
  trackSimilarity: Map<string, number>,
  scale = 0.5
): Promise<RadioCandidate[]> {
  const db = await getDb();
  const tree = await getCanonTree();

  type TagRow = { canonical_id: string; kind: string };
  const seedTags = await db.select<TagRow[]>(
    "SELECT canonical_id, kind FROM track_tags WHERE track_id = ? AND canonical_id IS NOT NULL",
    [seedTrackId]
  );

  if (seedTags.length === 0) {
    // No canonical tags — random from same server
    const fallback = await db.select<TrackRow[]>(
      `SELECT ${TRACK_PROJECTION}
       FROM tracks t JOIN albums a ON t.album_id = a.id
       WHERE t.server_id = ? AND t.id != ?
       ORDER BY RANDOM() LIMIT 20`,
      [seed.serverId, seedTrackId]
    );
    return fallback.filter((r) => !excludeIds.has(r.id)).map((r) => rowToCandidate(r, 0.1));
  }

  const combinedWeights = new Map<string, number>();
  for (const tag of seedTags) {
    const baseWeight = tag.kind === "mood" ? MOOD_WEIGHT : 1.0;
    const aw = buildAncestorWeights(tag.canonical_id, tree.byId);
    for (const [nodeId, w] of aw) {
      const existing = combinedWeights.get(nodeId) ?? 0;
      combinedWeights.set(nodeId, Math.max(existing, w * baseWeight));
    }
  }

  if (combinedWeights.size === 0) return [];

  const SAFE_ID = /^[a-zA-Z0-9_\- :.]+$/;
  const cteParts = Array.from(combinedWeights.entries())
    .filter(([id]) => SAFE_ID.test(id))
    .map(([id, w]) => `('${id.replace(/'/g, "''")}', ${w.toFixed(6)})`)
    .join(", ");

  if (!cteParts) return [];

  // sum_score + tag_count kept separate so raw tag-count can't inflate score —
  // heavily-tagged (usually mainstream) tracks otherwise dominate purely by tag volume.
  type ScoredRow = TrackRow & { sum_score: number; tag_count: number };

  const rows = await db.select<ScoredRow[]>(
    `WITH seed_weights(canonical_id, weight) AS (
       VALUES ${cteParts}
     )
     SELECT ${TRACK_PROJECTION},
            SUM(sw.weight * CASE tt.kind WHEN 'mood' THEN ${MOOD_WEIGHT} ELSE 1.0 END) AS sum_score,
            COUNT(DISTINCT tt.canonical_id) AS tag_count
     FROM tracks t
     JOIN track_tags tt ON tt.track_id = t.id
     JOIN seed_weights sw ON sw.canonical_id = tt.canonical_id
     JOIN albums a ON t.album_id = a.id
     WHERE t.server_id = ? AND t.id != ?
     GROUP BY t.id
     ORDER BY sum_score DESC
     LIMIT ?`,
    [seed.serverId, seedTrackId, CANDIDATE_LIMIT]
  );

  // Dampen by sqrt(tag_count): rewards genuine multi-tag match without letting
  // tag-count alone (proxy for how thoroughly an artist got tagged) dominate.
  const dampenedScore = (r: ScoredRow) => r.sum_score / Math.sqrt(r.tag_count);
  const maxTree = rows.length > 0 ? Math.max(...rows.map(dampenedScore)) : 1;

  const { tagW, trackCfW, artistCfW } = scaleWeights(scale);
  return rows
    .filter((r) => !excludeIds.has(r.id))
    .map((r) => {
      const normalizedTree = maxTree > 0 ? dampenedScore(r) / maxTree : 0;
      const artistKey = (r.artist ?? "").toLowerCase();
      const trackKey = `${artistKey}|||${r.title.toLowerCase()}`;
      const artistCf = artistSimilarity.get(artistKey) ?? 0;
      const trackCf = trackSimilarity.get(trackKey) ?? 0;
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
  const seedRows = await db.select<SeedRow[]>(
    "SELECT server_id, artist, year, album_id FROM tracks WHERE id = ?",
    [seedTrackId]
  );
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
      const placeholders = similarArtistNames.map(() => "?").join(", ");
      const rows = await db.select<TrackRow[]>(
        `SELECT ${TRACK_PROJECTION}
         FROM tracks t JOIN albums a ON t.album_id = a.id
         WHERE t.server_id = ? AND t.id != ?
           AND lower(t.artist) IN (${placeholders})
         ORDER BY RANDOM() LIMIT ?`,
        [seed.serverId, seedTrackId, ...similarArtistNames, CANDIDATE_LIMIT]
      );
      return rows
        .filter((r) => !excludeIds.has(r.id))
        .map((r) => {
          const artistKey = (r.artist ?? "").toLowerCase();
          return rowToCandidate(r, artistSimilarity.get(artistKey) ?? 0);
        })
        .sort((a, b) => b.score - a.score);
    }

    case "same-artist": {
      if (!seed.artist) return [];
      const rows = await db.select<TrackRow[]>(
        `SELECT ${TRACK_PROJECTION}
         FROM tracks t JOIN albums a ON t.album_id = a.id
         WHERE t.server_id = ? AND t.id != ? AND lower(t.artist) = lower(?)
         ORDER BY RANDOM() LIMIT ?`,
        [seed.serverId, seedTrackId, seed.artist, CANDIDATE_LIMIT]
      );
      return rows.filter((r) => !excludeIds.has(r.id)).map((r) => rowToCandidate(r, 1.0));
    }

    case "same-album": {
      if (!seed.albumId) return getCuratedCandidates(seedTrackId, seed, excludeIds, new Map(), new Map(), similarityScale);
      const rows = await db.select<TrackRow[]>(
        `SELECT ${TRACK_PROJECTION}
         FROM tracks t JOIN albums a ON t.album_id = a.id
         WHERE t.album_id = ? AND t.id != ?
         ORDER BY t.disc_number, t.track_number`,
        [seed.albumId, seedTrackId]
      );
      const filtered = rows.filter((r) => !excludeIds.has(r.id)).map((r) => rowToCandidate(r, 1.0));
      // Fall back to curated when album exhausted
      if (filtered.length === 0) return getCuratedCandidates(seedTrackId, seed, excludeIds, new Map(), new Map(), similarityScale);
      return filtered;
    }

    case "era": {
      if (seed.year === null) {
        // No year — fall back to random
        const rows = await db.select<TrackRow[]>(
          `SELECT ${TRACK_PROJECTION}
           FROM tracks t JOIN albums a ON t.album_id = a.id
           WHERE t.server_id = ? AND t.id != ?
           ORDER BY RANDOM() LIMIT ?`,
          [seed.serverId, seedTrackId, CANDIDATE_LIMIT]
        );
        return rows.filter((r) => !excludeIds.has(r.id)).map((r) => rowToCandidate(r, 1.0));
      }
      const decadeStart = Math.floor(seed.year / 10) * 10;
      const decadeEnd = decadeStart + 9;
      type EraRow = TrackRow & { year: number | null };
      const rows = await db.select<EraRow[]>(
        `SELECT ${TRACK_PROJECTION}, t.year
         FROM tracks t JOIN albums a ON t.album_id = a.id
         WHERE t.server_id = ? AND t.id != ?
           AND t.year BETWEEN ? AND ?
         ORDER BY RANDOM() LIMIT ?`,
        [seed.serverId, seedTrackId, decadeStart, decadeEnd, CANDIDATE_LIMIT]
      );
      return rows
        .filter((r) => !excludeIds.has(r.id))
        .map((r) => {
          const dist = r.year !== null ? Math.abs(r.year - seed.year!) : 5;
          return rowToCandidate(r, Math.max(0, 1 - dist / 10));
        })
        .sort((a, b) => b.score - a.score);
    }

    case "loved": {
      const rows = await db.select<TrackRow[]>(
        `SELECT ${TRACK_PROJECTION}
         FROM tracks t
         JOIN albums a ON t.album_id = a.id
         JOIN loved_tracks lt ON lt.track_id = t.id
         WHERE t.server_id = ? AND t.id != ?
         ORDER BY RANDOM() LIMIT ?`,
        [seed.serverId, seedTrackId, CANDIDATE_LIMIT]
      );
      return rows.filter((r) => !excludeIds.has(r.id)).map((r) => rowToCandidate(r, 1.0));
    }

    case "random": {
      const rows = await db.select<TrackRow[]>(
        `SELECT ${TRACK_PROJECTION}
         FROM tracks t JOIN albums a ON t.album_id = a.id
         WHERE t.server_id = ? AND t.id != ?
         ORDER BY RANDOM() LIMIT ?`,
        [seed.serverId, seedTrackId, CANDIDATE_LIMIT]
      );
      return rows.filter((r) => !excludeIds.has(r.id)).map((r) => rowToCandidate(r, 1.0));
    }
  }
}
