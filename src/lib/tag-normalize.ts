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

const STALE_DAYS = 30;
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

export function isStale(tags: NormalizedTags | null): boolean {
  if (!tags) return true;
  return Date.now() - tags.computed_at * 1000 > STALE_DAYS * 24 * 60 * 60 * 1000;
}

export async function normalizeAlbum(albumId: string, artist: string, album: string): Promise<NormalizedTags> {
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
    const match = findCanonicalSync(entry.name, "genre", tree);
    const confidence = entry.source === "file" ? 1.0 : 0.8;
    if (match.node && !seenIds.has(match.node.id)) {
      seenIds.add(match.node.id);
      mapped.push({ id: match.node.id, name: match.node.name, source: entry.source, confidence });
    } else if (!match.node) {
      unmapped.push({ id: null, name: entry.name, source: entry.source, confidence });
    }
  }

  const buckets = bucketize(mapped.map((t) => t.id!));

  function fromIds(ids: string[], cap: number): NormalizedTag[] {
    const file: NormalizedTag[] = [];
    const lastfm: NormalizedTag[] = [];
    for (const id of ids) {
      const tag = mapped.find((t) => t.id === id);
      if (!tag) continue;
      if (tag.source === "file") file.push(tag);
      else lastfm.push(tag);
    }
    return [...file, ...lastfm].slice(0, cap);
  }

  const genreTags = fromIds(buckets.genres, CAPS.genres);
  const unmappedSorted = [...unmapped].sort((a, b) => {
    if (a.source === b.source) return 0;
    return a.source === "file" ? -1 : 1;
  });
  const unmappedFill = unmappedSorted.slice(0, Math.max(0, CAPS.genres - genreTags.length));

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
