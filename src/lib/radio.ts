import { getDb } from "../db";
import { getCanonTree } from "./canonicalize";

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

export async function getRadioCandidates(
  seedTrackId: string,
  excludeIds: Set<string>,
  similarArtists: string[]
): Promise<RadioCandidate[]> {
  const db = await getDb();
  const tree = await getCanonTree();

  type TagRow = { canonical_id: string; kind: string };
  const seedTags = await db.select<TagRow[]>(
    "SELECT canonical_id, kind FROM track_tags WHERE track_id = ? AND canonical_id IS NOT NULL",
    [seedTrackId]
  );

  type ServerRow = { server_id: string };
  const serverRows = await db.select<ServerRow[]>(
    "SELECT server_id FROM tracks WHERE id = ?",
    [seedTrackId]
  );
  const serverId = serverRows[0]?.server_id ?? "";

  if (seedTags.length === 0) {
    // No canonical tags — return random tracks from same server
    type SimpleRow = { id: string; title: string; artist: string | null; duration: number | null; artwork_url: string | null; album_id: string | null; album_name: string | null };
    const fallback = await db.select<SimpleRow[]>(
      `SELECT t.id, t.title, t.artist, t.duration, a.artwork_url, t.album_id, a.name AS album_name
       FROM tracks t JOIN albums a ON t.album_id = a.id
       WHERE t.server_id = ? AND t.id != ?
       ORDER BY RANDOM() LIMIT 20`,
      [serverId, seedTrackId]
    );
    return fallback
      .filter((r) => !excludeIds.has(r.id))
      .map((r) => ({ id: r.id, title: r.title, artist: r.artist, duration: r.duration, artworkRef: r.artwork_url, albumId: r.album_id, albumName: r.album_name, score: 0.1 }));
  }

  // Build combined ancestor weight map from all seed tags
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

  type ScoredRow = {
    id: string;
    title: string;
    artist: string | null;
    duration: number | null;
    artwork_url: string | null;
    album_id: string | null;
    album_name: string | null;
    tree_score: number;
  };

  const rows = await db.select<ScoredRow[]>(
    `WITH seed_weights(canonical_id, weight) AS (
       VALUES ${cteParts}
     )
     SELECT t.id, t.title, t.artist, t.duration, a.artwork_url, t.album_id, a.name AS album_name,
            SUM(sw.weight * CASE tt.kind WHEN 'mood' THEN ${MOOD_WEIGHT} ELSE 1.0 END) AS tree_score
     FROM tracks t
     JOIN track_tags tt ON tt.track_id = t.id
     JOIN seed_weights sw ON sw.canonical_id = tt.canonical_id
     JOIN albums a ON t.album_id = a.id
     WHERE t.server_id = ? AND t.id != ?
     GROUP BY t.id
     ORDER BY tree_score DESC
     LIMIT ?`,
    [serverId, seedTrackId, CANDIDATE_LIMIT]
  );

  const similarSet = new Set(similarArtists.map((n) => n.toLowerCase()));
  const maxTree = rows.length > 0 ? Math.max(...rows.map((r) => r.tree_score)) : 1;

  return rows
    .filter((r) => !excludeIds.has(r.id))
    .map((r) => {
      const normalizedTree = maxTree > 0 ? r.tree_score / maxTree : 0;
      const lastfmBoost = r.artist && similarSet.has(r.artist.toLowerCase()) ? 1 : 0;
      return {
        id: r.id,
        title: r.title,
        artist: r.artist,
        duration: r.duration,
        artworkRef: r.artwork_url,
        albumId: r.album_id,
        albumName: r.album_name,
        score: 0.6 * normalizedTree + 0.4 * lastfmBoost,
      };
    })
    .sort((a, b) => b.score - a.score);
}
