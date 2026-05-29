import { getDb } from "../db";
import { getCanonTree, canonicalKey, findCanonicalSync } from "./canonicalize";
import { bucketize } from "./tag-buckets";
import { fetchAlbumTags } from "./lastfm";

export interface NormalizedTag {
  id: string | null;
  name: string;
  source: "file" | "lastfm";
  confidence: number;
}

export interface NormalizedTags {
  genres: NormalizedTag[];
  descriptors: NormalizedTag[];
  scenes: NormalizedTag[];
  computed_at: number;
}

export const STALE_DAYS_DEFAULT = 30;
const CAPS = { genres: 6, descriptors: 6, scenes: 4 };

export async function readNormalizedTags(albumId: string): Promise<NormalizedTags | null> {
  const db = await getDb();
  type Row = { normalized_tags_json: string | null };
  const rows = await db.select<Row[]>(
    "SELECT normalized_tags_json FROM albums WHERE id = ?",
    [albumId]
  );
  const json = rows[0]?.normalized_tags_json;
  if (!json) return null;
  return JSON.parse(json) as NormalizedTags;
}

export function isStale(tags: NormalizedTags | null, staleDays = STALE_DAYS_DEFAULT): boolean {
  if (!tags) return true;
  return Date.now() - tags.computed_at * 1000 > staleDays * 24 * 60 * 60 * 1000;
}

const inFlightPromises = new Map<string, Promise<NormalizedTags>>();

export async function normalizeAlbum(albumId: string, artist: string, album: string): Promise<NormalizedTags> {
  const existing = inFlightPromises.get(albumId);
  if (existing) return existing;
  const promise = _doNormalizeAlbum(albumId, artist, album)
    .finally(() => inFlightPromises.delete(albumId));
  inFlightPromises.set(albumId, promise);
  return promise;
}

async function _doNormalizeAlbum(albumId: string, artist: string, album: string): Promise<NormalizedTags> {
  const db = await getDb();
  const tree = await getCanonTree();

  type TagRow = { raw_value: string };
  const fileTagRows = await db.select<TagRow[]>(
    `SELECT DISTINCT tt.raw_value
     FROM track_tags tt
     JOIN tracks t ON t.id = tt.track_id
     WHERE t.album_id = ? AND tt.kind = 'genre'`,
    [albumId]
  );

  // Manual mappings override auto tree-matching
  type MappingRow = { raw_value: string; canonical_id: string };
  const manualRows = await db.select<MappingRow[]>(
    "SELECT raw_value, canonical_id FROM tag_mappings WHERE kind = 'genre' AND source = 'manual'"
  );
  const manualMap = new Map(manualRows.map((r) => [canonicalKey(r.raw_value), r.canonical_id]));

  let lastfmRaw: string[] = [];
  try {
    const result = await fetchAlbumTags(artist, album);
    lastfmRaw = result.genres;
  } catch (e) {
    console.warn(`normalizeAlbum: Last.fm fetch failed for "${artist} — ${album}":`, e);
  }

  type RawEntry = { name: string; source: "file" | "lastfm" };
  const byKey = new Map<string, RawEntry>();
  for (const row of fileTagRows) {
    byKey.set(canonicalKey(row.raw_value), { name: row.raw_value, source: "file" });
  }
  for (const raw of lastfmRaw) {
    const k = canonicalKey(raw);
    if (!byKey.has(k)) byKey.set(k, { name: raw, source: "lastfm" });
  }

  const seenIds = new Set<string>();
  const mapped: NormalizedTag[] = [];
  const unmapped: NormalizedTag[] = [];

  for (const entry of byKey.values()) {
    const manualId = manualMap.get(canonicalKey(entry.name));
    const confidence = entry.source === "file" ? 1.0 : 0.8;

    if (manualId === "__ignored__") continue;

    if (manualId && manualId !== "__accepted__") {
      // Manual mapping overrides auto tree-matching
      const node = tree.byId.get(manualId);
      if (node && !seenIds.has(node.id)) {
        seenIds.add(node.id);
        mapped.push({ id: node.id, name: node.name, source: entry.source, confidence });
      }
    } else {
      const match = findCanonicalSync(entry.name, "genre", tree);
      if (match.node && !seenIds.has(match.node.id)) {
        seenIds.add(match.node.id);
        mapped.push({ id: match.node.id, name: match.node.name, source: entry.source, confidence });
      } else if (!match.node) {
        unmapped.push({ id: null, name: entry.name, source: entry.source, confidence });
      }
    }
  }

  const buckets = bucketize(mapped.map((t) => t.id!), tree);

  const mappedById = new Map<string, NormalizedTag>(mapped.map((t) => [t.id!, t]));

  function fromIds(ids: string[], cap: number): NormalizedTag[] {
    const file: NormalizedTag[] = [];
    const lastfm: NormalizedTag[] = [];
    for (const id of ids) {
      const tag = mappedById.get(id);
      if (!tag) continue;
      if (tag.source === "file") file.push(tag);
      else lastfm.push(tag);
    }
    return [...file, ...lastfm].slice(0, cap);
  }

  const genreTags = fromIds(buckets.genres, CAPS.genres);
  const unmappedFill = [...unmapped]
    .filter((t) => t.source === "file")
    .sort((a, b) => (a.source === b.source ? 0 : a.source === "file" ? -1 : 1))
    .slice(0, Math.max(0, CAPS.genres - genreTags.length));

  const normalizedTags: NormalizedTags = {
    genres: [...genreTags, ...unmappedFill],
    descriptors: fromIds(buckets.descriptors, CAPS.descriptors),
    scenes: fromIds(buckets.scenes, CAPS.scenes),
    computed_at: Math.floor(Date.now() / 1000),
  };

  await db.execute(
    "UPDATE albums SET normalized_tags_json = ?, computed_at = ? WHERE id = ?",
    [JSON.stringify(normalizedTags), normalizedTags.computed_at, albumId]
  );

  return normalizedTags;
}
