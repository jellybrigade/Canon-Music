import { getDb } from "../db";
import { getCanonTree, canonicalKey, rawGenreId, findCanonicalSync, getAncestorIds } from "./canonicalize";
import { bucketize } from "./tag-buckets";
import { fetchAlbumTags, fetchArtistGenreTags } from "./lastfm";
import { getMinFolksonomyCount } from "./musicbrainz";
import type { MbGenre } from "./musicbrainz";

export type TagSource = "file" | "lastfm" | "lastfm-track" | "manual" | "musicbrainz" | "musicbrainz-folksonomy";

export async function rebuildTagVocabCache(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM tag_vocab_cache");
  await db.execute(`
    INSERT INTO tag_vocab_cache (norm_value, raw_value, kind, album_count, sources)
    SELECT
      LOWER(REPLACE(REPLACE(TRIM(tt.raw_value), '-', ' '), '_', ' ')),
      tt.raw_value,
      tt.kind,
      COUNT(DISTINCT tr.album_id),
      GROUP_CONCAT(DISTINCT CASE WHEN tt.source = 'server' THEN 'file' ELSE tt.source END)
    FROM track_tags tt
    JOIN tracks tr ON tr.id = tt.track_id
    GROUP BY LOWER(REPLACE(REPLACE(TRIM(tt.raw_value), '-', ' '), '_', ' ')), tt.kind
  `);
}

export interface NormalizedTag {
  id: string | null;
  name: string;
  source: TagSource;
  confidence: number;
}

export interface NormalizedTags {
  genres: NormalizedTag[];
  descriptors: NormalizedTag[];
  scenes: NormalizedTag[];
  computed_at: number;
}

const STALE_DAYS_DEFAULT = 30;
const CAPS = { genres: 6, descriptors: 6, scenes: 4 };

const YEAR_LIKE_RE = /^\d{4}s?$|^\d{2}s$|^'\d{2}s$/i;
export function isYearLikeGenre(s: string): boolean {
  return YEAR_LIKE_RE.test(s.trim());
}

export async function getSkipYearGenres(): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = 'tags.skip_year_genres'"
  );
  return rows[0] ? rows[0].value === "true" : true;
}

export async function readNormalizedTags(albumId: string): Promise<NormalizedTags | null> {
  const db = await getDb();
  type Row = { normalized_tags_json: string | null };
  const rows = await db.select<Row[]>(
    "SELECT normalized_tags_json FROM albums WHERE id = ?",
    [albumId]
  );
  const json = rows[0]?.normalized_tags_json;
  if (!json) return null;
  // If album_genres is empty, the filter pipeline is broken — force re-normalization.
  type CountRow = { n: number };
  const countRows = await db.select<CountRow[]>(
    "SELECT COUNT(*) AS n FROM album_genres WHERE album_id = ?",
    [albumId]
  );
  if ((countRows[0]?.n ?? 0) === 0) return null;
  return JSON.parse(json) as NormalizedTags;
}

export function isStale(tags: NormalizedTags | null, staleDays = STALE_DAYS_DEFAULT): boolean {
  if (!tags) return true;
  return Date.now() - tags.computed_at * 1000 > staleDays * 24 * 60 * 60 * 1000;
}

const inFlightPromises = new Map<string, Promise<NormalizedTags>>();

export async function normalizeAlbum(
  albumId: string,
  artist: string,
  album: string,
  identity?: { lastfmArtistName?: string | null; lastfmAlbumName?: string | null; combinedMbGenres?: MbGenre[] | null; combinedMbTags?: MbGenre[] | null }
): Promise<NormalizedTags> {
  const existing = inFlightPromises.get(albumId);
  if (existing) return existing;
  const promise = _doNormalizeAlbum(albumId, artist, album, identity)
    .finally(() => inFlightPromises.delete(albumId));
  inFlightPromises.set(albumId, promise);
  return promise;
}

async function _doNormalizeAlbum(
  albumId: string,
  artist: string,
  album: string,
  identity?: { lastfmArtistName?: string | null; lastfmAlbumName?: string | null; combinedMbGenres?: MbGenre[] | null; combinedMbTags?: MbGenre[] | null }
): Promise<NormalizedTags> {
  const db = await getDb();
  const tree = await getCanonTree();
  const skipYearGenres = await getSkipYearGenres();

  type TagRow = { raw_value: string };
  const fileTagRows = await db.select<TagRow[]>(
    `SELECT DISTINCT tt.raw_value
     FROM track_tags tt
     JOIN tracks t ON t.id = tt.track_id
     WHERE t.album_id = ? AND tt.kind = 'genre' AND tt.source != 'lastfm-track'`,
    [albumId]
  );

  // Manual mappings override auto tree-matching
  type MappingRow = { raw_value: string; canonical_id: string };
  const manualRows = await db.select<MappingRow[]>(
    "SELECT raw_value, canonical_id FROM tag_mappings WHERE kind = 'genre' AND source = 'manual'"
  );
  const manualMap = new Map(manualRows.map((r) => [canonicalKey(r.raw_value), r.canonical_id]));

  // Use confirmed identity strings for Last.fm lookup if available
  const lfmArtist = identity?.lastfmArtistName ?? artist;
  const lfmAlbum = identity?.lastfmAlbumName ?? album;

  let lastfmRaw: string[] = [];
  try {
    const result = await fetchAlbumTags(lfmArtist, lfmAlbum);
    lastfmRaw = result.genres;
    if (lastfmRaw.length === 0) {
      const stripped = lfmAlbum.replace(/\s*[\(\[].*?[\)\]]\s*$/, "").trim();
      if (stripped && stripped !== lfmAlbum) {
        const retry = await fetchAlbumTags(lfmArtist, stripped);
        lastfmRaw = retry.genres;
      }
    }
  } catch (e) {
    console.warn(`normalizeAlbum: Last.fm fetch failed for "${lfmArtist} — ${lfmAlbum}":`, e);
  }

  const mbRaw: string[] = [];
  if (identity?.combinedMbGenres?.length) {
    for (const g of identity.combinedMbGenres) {
      mbRaw.push(g.name);
    }
  }

  const minFolksonomy = await getMinFolksonomyCount();
  const mbFolkRaw: string[] = [];
  if (identity?.combinedMbTags?.length) {
    for (const t of identity.combinedMbTags) {
      if (t.count >= minFolksonomy) mbFolkRaw.push(t.name);
    }
  }

  // Artist tags as last resort: only when no file tags AND no album/MB tags exist
  if (fileTagRows.length === 0 && lastfmRaw.length === 0 && mbRaw.length === 0 && mbFolkRaw.length === 0) {
    try {
      const artistTags = await fetchArtistGenreTags(lfmArtist);
      lastfmRaw.push(...artistTags);
    } catch (e) {
      console.warn(`normalizeAlbum: artist tag fallback failed for "${lfmArtist}":`, e);
    }
  }

  type TrackIdRow = { id: string };
  const albumTracks = await db.select<TrackIdRow[]>(
    "SELECT id FROM tracks WHERE album_id = ?",
    [albumId]
  );

  // Consensus promotion: per-track Last.fm genres that appear on ≥50% of the album's
  // tracks are promoted into the album genre pipeline with lastfm-level confidence.
  // Genres below the threshold are kept radio-only (track_tags only, not album_genres).
  const TRACK_GENRE_ALBUM_CONSENSUS = 0.5;
  type ConsensusRow = { canonical_id: string; track_count: number };
  const totalTrackCount = albumTracks.length;
  const consensusPromoted: string[] = []; // canonical_ids to inject
  if (totalTrackCount > 0) {
    const consensusRows = await db.select<ConsensusRow[]>(
      `SELECT tt.canonical_id, COUNT(DISTINCT tt.track_id) AS track_count
       FROM track_tags tt
       WHERE tt.track_id IN (SELECT id FROM tracks WHERE album_id = ?)
         AND tt.kind = 'genre'
         AND tt.source = 'lastfm-track'
         AND tt.canonical_id IS NOT NULL
       GROUP BY tt.canonical_id
       HAVING COUNT(DISTINCT tt.track_id) >= ?`,
      [albumId, Math.ceil(totalTrackCount * TRACK_GENRE_ALBUM_CONSENSUS)]
    );
    for (const row of consensusRows) {
      consensusPromoted.push(row.canonical_id);
    }
  }

  type RawEntry = { name: string; source: TagSource };
  const byKey = new Map<string, RawEntry>();
  for (const row of fileTagRows) {
    if (skipYearGenres && isYearLikeGenre(row.raw_value)) continue;
    byKey.set(canonicalKey(row.raw_value), { name: row.raw_value, source: "file" });
  }
  for (const raw of lastfmRaw) {
    if (skipYearGenres && isYearLikeGenre(raw)) continue;
    const k = canonicalKey(raw);
    if (!byKey.has(k)) byKey.set(k, { name: raw, source: "lastfm" });
  }
  for (const raw of mbRaw) {
    if (skipYearGenres && isYearLikeGenre(raw)) continue;
    const k = canonicalKey(raw);
    if (!byKey.has(k)) byKey.set(k, { name: raw, source: "musicbrainz" });
  }
  for (const raw of mbFolkRaw) {
    if (skipYearGenres && isYearLikeGenre(raw)) continue;
    const k = canonicalKey(raw);
    if (!byKey.has(k)) byKey.set(k, { name: raw, source: "musicbrainz-folksonomy" });
  }
  // Inject consensus-promoted per-track genres (≥50% of tracks share them) at lastfm confidence.
  for (const canonId of consensusPromoted) {
    const node = tree.byId.get(canonId);
    if (!node) continue;
    const k = canonicalKey(node.name);
    if (!byKey.has(k)) byKey.set(k, { name: node.name, source: "lastfm" });
  }

  // Write lastfm-sourced tags to track_tags so the vocab query can count them.
  // File tags get written during sync; lastfm tags must be written here or they
  // appear as orphaned in Cleanup even though normalization applies them.
  if (albumTracks.length > 0) {
    for (const entry of byKey.values()) {
      if (entry.source === "file") continue;
      for (const track of albumTracks) {
        await db.execute(
          `INSERT OR IGNORE INTO track_tags (track_id, kind, raw_value, source) VALUES (?, 'genre', ?, ?)`,
          [track.id, entry.name, entry.source]
        );
      }
    }
    // Apply any pre-existing tag_mappings to the newly inserted lastfm/musicbrainz rows
    await db.execute(
      `UPDATE track_tags
       SET canonical_id = (
         SELECT tm.canonical_id FROM tag_mappings tm
         WHERE LOWER(REPLACE(REPLACE(TRIM(tm.raw_value), '-', ' '), '_', ' '))
             = LOWER(REPLACE(REPLACE(TRIM(track_tags.raw_value), '-', ' '), '_', ' '))
           AND tm.kind = track_tags.kind
           AND tm.canonical_id NOT IN ('__accepted__', '__ignored__')
         LIMIT 1
       )
       WHERE source IN ('lastfm', 'lastfm-track', 'musicbrainz', 'musicbrainz-folksonomy')
         AND canonical_id IS NULL
         AND track_id IN (SELECT id FROM tracks WHERE album_id = ?)`,
      [albumId]
    );
  }

  type ExclusionRow = { canonical_id: string };
  const exclusionRows = await db.select<ExclusionRow[]>(
    "SELECT canonical_id FROM album_genre_exclusions WHERE album_id = ?",
    [albumId]
  );
  const excludedIds = new Set(exclusionRows.map((r) => r.canonical_id));

  const seenIds = new Set<string>();
  const mapped: NormalizedTag[] = [];
  const unmapped: NormalizedTag[] = [];

  // User-entered genres take highest priority — injected first so seenIds blocks duplicates
  type UserGenreRow = { canonical_id: string; name: string };
  const userGenreRows = await db.select<UserGenreRow[]>(
    "SELECT canonical_id, name FROM album_user_genres WHERE album_id = ?",
    [albumId]
  );
  for (const row of userGenreRows) {
    const node = tree.byId.get(row.canonical_id);
    if (!node || seenIds.has(node.id)) continue;
    seenIds.add(node.id);
    mapped.push({ id: node.id, name: node.name, source: "manual", confidence: 1.0 });
  }

  for (const entry of byKey.values()) {
    const manualId = manualMap.get(canonicalKey(entry.name));
    const confidence =
      entry.source === "file" ? 1.0
      : entry.source === "lastfm" ? 0.8
      : entry.source === "musicbrainz" ? 0.7
      : 0.6;

    if (manualId === "__ignored__") continue;

    if (manualId && manualId !== "__accepted__") {
      // Manual mapping overrides auto tree-matching
      const node = tree.byId.get(manualId);
      if (node && !seenIds.has(node.id) && !excludedIds.has(node.id)) {
        seenIds.add(node.id);
        mapped.push({ id: node.id, name: node.name, source: entry.source, confidence });
      }
    } else {
      const match = findCanonicalSync(entry.name, "genre", tree);
      if (match.node && !seenIds.has(match.node.id) && !excludedIds.has(match.node.id)) {
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
    const manual: NormalizedTag[] = [];
    const file: NormalizedTag[] = [];
    const lastfm: NormalizedTag[] = [];
    const mb: NormalizedTag[] = [];
    const folk: NormalizedTag[] = [];
    for (const id of ids) {
      const tag = mappedById.get(id);
      if (!tag) continue;
      if (tag.source === "manual") manual.push(tag);
      else if (tag.source === "file") file.push(tag);
      else if (tag.source === "musicbrainz") mb.push(tag);
      else if (tag.source === "musicbrainz-folksonomy") folk.push(tag);
      else lastfm.push(tag);
    }
    return [...manual, ...file, ...lastfm, ...mb, ...folk].slice(0, cap);
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

  // --- Write album_genres (leaf + full DAG ancestors) and album_unresolved_genres ---

  // Build the resolved rows: direct leaves first
  type AlbumGenreRow = { canonical_id: string; relation: "direct" | "ancestor"; section: string | null; name: string };
  const genreRows: AlbumGenreRow[] = [];
  const seenGenreIds = new Set<string>();

  for (const tag of mapped) {
    if (!tag.id) continue;
    const node = tree.byId.get(tag.id);
    if (!node) continue;

    if (!seenGenreIds.has(tag.id)) {
      seenGenreIds.add(tag.id);
      genreRows.push({ canonical_id: tag.id, relation: "direct", section: node.section ?? null, name: node.name });
    }

    for (const ancestorId of getAncestorIds(node, tree.byId)) {
      if (seenGenreIds.has(ancestorId)) continue;
      seenGenreIds.add(ancestorId);
      const ancestor = tree.byId.get(ancestorId);
      if (!ancestor) continue;
      genreRows.push({ canonical_id: ancestorId, relation: "ancestor", section: ancestor.section ?? null, name: ancestor.name });
    }
  }

  // Unmapped raw tags get a synthetic raw: id so they're filterable
  for (const tag of unmapped) {
    const syntheticId = rawGenreId(tag.name);
    if (!seenGenreIds.has(syntheticId)) {
      seenGenreIds.add(syntheticId);
      genreRows.push({ canonical_id: syntheticId, relation: "direct", section: null, name: tag.name });
    }
  }

  // Atomically replace album_genres and album_unresolved_genres for this album
  await db.execute("DELETE FROM album_genres WHERE album_id = ?", [albumId]);
  for (const row of genreRows.filter((r) => !excludedIds.has(r.canonical_id))) {
    await db.execute(
      "INSERT INTO album_genres (album_id, canonical_id, relation, section, name) VALUES (?, ?, ?, ?, ?)",
      [albumId, row.canonical_id, row.relation, row.section, row.name]
    );
  }

  await db.execute("DELETE FROM album_unresolved_genres WHERE album_id = ?", [albumId]);
  for (const tag of unmapped) {
    await db.execute(
      "INSERT OR IGNORE INTO album_unresolved_genres (album_id, raw_value, kind, source) VALUES (?, ?, 'genre', ?)",
      [albumId, tag.name, tag.source]
    );
  }

  // --- End album_genres write ---

  await db.execute(
    "UPDATE albums SET normalized_tags_json = ?, computed_at = ? WHERE id = ?",
    [JSON.stringify(normalizedTags), normalizedTags.computed_at, albumId]
  );

  return normalizedTags;
}
