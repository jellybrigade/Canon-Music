import type Database from "@tauri-apps/plugin-sql";
import { fetchDeezerAlbum, fetchDeezerDiscography, searchDeezerAlbums } from "../../clients/deezer";
import { fetchItunesArtistAlbums, searchItunesArtists } from "../../clients/itunesCatalog";
import { reissueSql } from "../../lib/reissue";
import { currentLookupSql, ownReleaseDateSql } from "../../lib/releaseLookupSql";
import type { ItunesAlbum } from "./lib/itunesAlbums";
import {
  type DiscographyEntry,
  decideRelease,
  type Edition,
  isMatchingRelease,
  isSameArtist,
  type LocalRelease,
  localReleaseKind,
  type ReleaseDecision,
} from "./lib/releaseMatch";

/** An album a source didn't know is asked about again after this long. */
export const RELEASE_LOOKUP_RETRY_SECONDS = 7 * 24 * 60 * 60;
// This year's and last year's albums: the only ones Recently Released can show near the top.
const LOOKUP_YEARS_BACK = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

interface CandidateRow {
  id: string;
  server_id: string;
  name: string;
  artist: string;
  year: number;
  release_type: string | null;
  track_count: number;
}

type LookupStatus = "found" | "none" | "failed";
type SourceName = "deezer" | "itunes";

interface LookupSource {
  name: SourceName;
  /** SQL over the album aliased `a` that must also hold before this source is asked. */
  onlyWhen: string;
  lookUp: (album: LocalRelease, latestAllowed: string) => Promise<ReleaseDecision>;
}

// iTunes costs several slow requests per album, so it is asked only about what Deezer said it doesn't know.
const AFTER_DEEZER_FOUND_NOTHING = `EXISTS (SELECT 1 FROM album_release_lookups deezer
  WHERE ${currentLookupSql("deezer", "a")} AND deezer.source = 'deezer' AND deezer.status = 'none')`;

function selectCandidates(db: Database, source: LookupSource, now: Date): Promise<CandidateRow[]> {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  return db.select<CandidateRow[]>(
    `SELECT a.id, a.server_id, a.name, a.artist, a.year, a.release_type,
            (SELECT COUNT(*) FROM tracks t WHERE t.album_id = a.id AND t.server_id = a.server_id) AS track_count
     FROM albums a
     LEFT JOIN album_identity ai ON ai.album_id = a.id
     LEFT JOIN album_release_lookups l ON l.album_id = a.id AND l.server_id = a.server_id AND l.source = ?
     WHERE a.year >= ? AND a.artist IS NOT NULL AND lower(trim(a.artist)) != 'various artists'
       AND ${ownReleaseDateSql("a", "ai")} IS NULL
       AND NOT ${reissueSql("a", "ai")}
       AND ${source.onlyWhen}
       AND (l.album_id IS NULL
            OR l.looked_up_name IS NOT a.name OR l.looked_up_artist IS NOT a.artist OR l.looked_up_year IS NOT a.year
            OR l.status = 'failed'
            OR (l.status = 'none' AND l.checked_at <= ?))
     ORDER BY a.year DESC, a.id`,
    [source.name, now.getUTCFullYear() - LOOKUP_YEARS_BACK, nowSeconds - RELEASE_LOOKUP_RETRY_SECONDS],
  );
}

async function lookUpDeezer(
  album: LocalRelease,
  discographies: Map<number, DiscographyEntry[]>,
  latestAllowed: string,
): Promise<ReleaseDecision> {
  const hits = await searchDeezerAlbums(album.artist, album.name);
  const editions: Edition[] = [];
  for (const hit of hits.filter((candidate) => isMatchingRelease(album, candidate))) {
    const edition = await fetchDeezerAlbum(hit.id);
    if (edition !== null) editions.push(edition);
  }
  const artistIds = new Set(
    hits.filter((hit) => isSameArtist(album.artist, hit.artistName)).map((hit) => hit.artistId),
  );
  const discography: DiscographyEntry[] = [];
  for (const artistId of artistIds) {
    let entries = discographies.get(artistId);
    if (entries === undefined) {
      entries = await fetchDeezerDiscography(artistId);
      discographies.set(artistId, entries);
    }
    discography.push(...entries);
  }
  return decideRelease(album, editions, discography, latestAllowed);
}

function deezerSource(): LookupSource {
  const discographies = new Map<number, DiscographyEntry[]>();
  return {
    name: "deezer",
    onlyWhen: "1",
    lookUp: (album, latestAllowed) => lookUpDeezer(album, discographies, latestAllowed),
  };
}

// Searching iTunes for the album misses it (live: the PISS album), so it goes through the artist.
async function itunesReleases(artist: string, catalogs: Map<string, ItunesAlbum[]>): Promise<ItunesAlbum[]> {
  const cached = catalogs.get(artist);
  if (cached !== undefined) return cached;
  const releases: ItunesAlbum[] = [];
  for (const found of await searchItunesArtists(artist)) {
    if (isSameArtist(artist, found.name)) releases.push(...(await fetchItunesArtistAlbums(found.id)));
  }
  catalogs.set(artist, releases);
  return releases;
}

function itunesSource(): LookupSource {
  const catalogs = new Map<string, ItunesAlbum[]>();
  return {
    name: "itunes",
    onlyWhen: AFTER_DEEZER_FOUND_NOTHING,
    lookUp: async (album, latestAllowed) => {
      const releases = await itunesReleases(album.artist, catalogs);
      const editions = releases
        .filter((release) => isMatchingRelease(album, release))
        .map(({ releaseDate, recordType }) => ({ releaseDate, recordType, label: null }));
      return decideRelease(album, editions, releases, latestAllowed);
    },
  };
}

async function writeLookup(
  db: Database,
  source: SourceName,
  row: CandidateRow,
  status: LookupStatus,
  decision: ReleaseDecision | null,
  checkedAt: number,
): Promise<void> {
  await db.execute(
    `INSERT INTO album_release_lookups
       (album_id, server_id, source, release_date, label, record_type, is_reissue,
        looked_up_name, looked_up_artist, looked_up_year, status, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (album_id, server_id, source) DO UPDATE SET
       release_date = excluded.release_date, label = excluded.label, record_type = excluded.record_type,
       is_reissue = excluded.is_reissue, looked_up_name = excluded.looked_up_name,
       looked_up_artist = excluded.looked_up_artist, looked_up_year = excluded.looked_up_year,
       status = excluded.status, checked_at = excluded.checked_at`,
    [
      row.id,
      row.server_id,
      source,
      decision?.releaseDate ?? null,
      decision?.label ?? null,
      decision?.recordType ?? null,
      decision?.isReissue === true ? 1 : 0,
      row.name,
      row.artist,
      row.year,
      status,
      checkedAt,
    ],
  );
}

async function runSource(db: Database, source: LookupSource, now: Date): Promise<{ changed: boolean }> {
  const checkedAt = Math.floor(now.getTime() / 1000);
  const latestAllowed = new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
  let changed = false;
  for (const row of await selectCandidates(db, source, now)) {
    const kind = localReleaseKind(row.release_type, row.track_count);
    if (kind === null) continue;
    const album = { name: row.name, artist: row.artist, year: row.year, kind, trackCount: row.track_count };
    try {
      const decision = await source.lookUp(album, latestAllowed);
      await writeLookup(db, source.name, row, decision.releaseDate === null ? "none" : "found", decision, checkedAt);
      if (decision.releaseDate !== null || decision.isReissue) changed = true;
    } catch (error) {
      // A source that didn't answer has not said there is no date: retried on the next pass.
      console.warn(`[release dates] ${source.name} lookup failed for:`, row.name, error);
      await writeLookup(db, source.name, row, "failed", null, checkedAt);
    }
  }
  return { changed };
}

/**
 * Looks up the release date of every recent album that has only a year, on Deezer, then on
 * iTunes for what Deezer didn't know, and stores what it found. Resolves `changed` when Recently
 * Released may now order or filter differently.
 */
export async function runReleaseDateLookups(db: Database, now: Date): Promise<{ changed: boolean }> {
  let changed = false;
  for (const source of [deezerSource(), itunesSource()]) {
    if ((await runSource(db, source, now)).changed) changed = true;
  }
  return { changed };
}
