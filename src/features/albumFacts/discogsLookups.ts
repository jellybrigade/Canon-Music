import type PluginDatabase from "@tauri-apps/plugin-sql";
import { fetchDiscogsMainReleaseId, fetchDiscogsRelease, searchDiscogsReleases } from "../../clients/discogs";
import { fetchReleaseGroupDiscogsMasterId } from "../../clients/musicbrainz";
import { type LocalRelease, localReleaseKind } from "../releaseDates/lib/releaseMatch";
import {
  type DiscogsFacts,
  type DiscogsRelease,
  type DiscogsTarget,
  discogsFacts,
  isFittingRelease,
  pickDiscogsTarget,
} from "./lib/discogsMatch";

type Database = Pick<PluginDatabase, "select" | "execute">;

/** An album Discogs didn't know is asked about again after this long. */
export const DISCOGS_LOOKUP_RETRY_SECONDS = 7 * 24 * 60 * 60;

interface CandidateRow {
  id: string;
  server_id: string;
  name: string;
  artist: string;
  year: number | null;
  release_type: string | null;
  track_count: number;
  mb_release_group_id: string | null;
}

type Outcome =
  | { status: "found"; release: DiscogsRelease; facts: DiscogsFacts }
  | { status: "none" }
  | { status: "failed" };

export interface DiscogsLookupOptions {
  /** Read before each album: a long pass ends early when background lookups are switched off. */
  shouldStop: () => boolean;
  onFound: (album: { albumId: string; serverId: string }) => void;
}

// Albums MusicBrainz knows no label for come first: Discogs is what fills their label line.
function selectCandidates(db: Database, now: Date): Promise<CandidateRow[]> {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  return db.select<CandidateRow[]>(
    `SELECT a.id, a.server_id, a.name, a.artist, a.year, a.release_type, ai.mb_release_group_id,
            (SELECT COUNT(*) FROM tracks t WHERE t.album_id = a.id AND t.server_id = a.server_id) AS track_count
     FROM albums a
     LEFT JOIN album_identity ai ON ai.album_id = a.id
     LEFT JOIN album_discogs d ON d.album_id = a.id AND d.server_id = a.server_id
     WHERE a.artist IS NOT NULL AND lower(trim(a.artist)) != 'various artists'
       AND (d.album_id IS NULL
            OR d.looked_up_name IS NOT a.name OR d.looked_up_artist IS NOT a.artist OR d.looked_up_year IS NOT a.year
            OR d.status = 'failed'
            OR (d.status = 'none' AND d.checked_at <= ?))
     ORDER BY ai.label IS NOT NULL, a.year DESC, a.id`,
    [nowSeconds - DISCOGS_LOOKUP_RETRY_SECONDS],
  );
}

async function readTarget(target: DiscogsTarget): Promise<DiscogsRelease | null> {
  const releaseId = target.kind === "master" ? await fetchDiscogsMainReleaseId(target.id) : target.id;
  return releaseId === null ? null : fetchDiscogsRelease(releaseId);
}

/** The Discogs master MusicBrainz links the album to; `isUnread` when MusicBrainz didn't answer. */
async function linkedMaster(releaseGroupId: string | null): Promise<{ masterId: number | null; isUnread: boolean }> {
  if (releaseGroupId === null) return { masterId: null, isUnread: false };
  try {
    return { masterId: await fetchReleaseGroupDiscogsMasterId(releaseGroupId), isUnread: false };
  } catch (error) {
    console.warn("[discogs] MusicBrainz link unreadable:", releaseGroupId, error);
    return { masterId: null, isUnread: true };
  }
}

// MusicBrainz's link is trusted as is; a search hit must also fit the album's kind and track count.
async function lookUp(album: LocalRelease, releaseGroupId: string | null): Promise<Outcome> {
  const link = await linkedMaster(releaseGroupId);
  if (link.masterId !== null) {
    const release = await readTarget({ kind: "master", id: link.masterId });
    if (release !== null) return { status: "found", release, facts: discogsFacts(release) };
  }
  const target = pickDiscogsTarget(album, await searchDiscogsReleases(album.artist, album.name));
  const release = target === null ? null : await readTarget(target);
  if (release !== null && isFittingRelease(album, release)) {
    return { status: "found", release, facts: discogsFacts(release) };
  }
  // The link MusicBrainz couldn't read may name a release the search missed.
  return { status: link.isUnread ? "failed" : "none" };
}

async function writeLookup(db: Database, row: CandidateRow, outcome: Outcome, checkedAt: number): Promise<void> {
  const found = outcome.status === "found" ? outcome : null;
  await db.execute(
    `INSERT INTO album_discogs
       (album_id, server_id, discogs_release_id, label, catalog_number, country, styles_json, genres_json,
        looked_up_name, looked_up_artist, looked_up_year, status, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (album_id, server_id) DO UPDATE SET
       discogs_release_id = excluded.discogs_release_id, label = excluded.label,
       catalog_number = excluded.catalog_number, country = excluded.country,
       styles_json = excluded.styles_json, genres_json = excluded.genres_json,
       looked_up_name = excluded.looked_up_name, looked_up_artist = excluded.looked_up_artist,
       looked_up_year = excluded.looked_up_year, status = excluded.status, checked_at = excluded.checked_at`,
    [
      row.id,
      row.server_id,
      found?.release.id ?? null,
      found?.facts.label ?? null,
      found?.facts.catalogNumber ?? null,
      found?.facts.country ?? null,
      found === null ? null : JSON.stringify(found.facts.styles),
      found === null ? null : JSON.stringify(found.facts.genres),
      row.name,
      row.artist,
      row.year,
      outcome.status,
      checkedAt,
    ],
  );
}

/**
 * Looks every album up on Discogs (by MusicBrainz's link, else by search) and stores its label,
 * catalog number, country, styles and genres. A Discogs failure ends the pass: Discogs is either
 * down, rate limiting or refusing searches, and the rest are asked on the next pass.
 */
export async function runDiscogsLookups(
  db: Database,
  now: Date,
  { shouldStop, onFound }: DiscogsLookupOptions,
): Promise<void> {
  const checkedAt = Math.floor(now.getTime() / 1000);
  for (const row of await selectCandidates(db, now)) {
    if (shouldStop()) return;
    const kind = localReleaseKind(row.release_type, row.track_count);
    if (kind === null) continue;
    const album = { name: row.name, artist: row.artist, year: row.year ?? 0, kind, trackCount: row.track_count };
    let outcome: Outcome;
    try {
      outcome = await lookUp(album, row.mb_release_group_id);
    } catch (error) {
      console.warn("[discogs] lookup failed for:", row.name, error);
      await writeLookup(db, row, { status: "failed" }, checkedAt);
      return;
    }
    await writeLookup(db, row, outcome, checkedAt);
    if (outcome.status === "found") onFound({ albumId: row.id, serverId: row.server_id });
  }
}
