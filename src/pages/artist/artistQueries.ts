import { useQuery } from "@tanstack/react-query";
import { QK } from "../../lib/queryKeys";
import { getDb } from "../../db";
import type { AlbumRow } from "../../types/library";
import type { Server } from "../../types/server";
import type { NavidromeCredential } from "../../clients/navidromeUrls";
import type { CurrentTrack } from "../../features/playback/store/playerTypes";
import { getCoverArtUrl } from "../../clients/navidromeUrls";
import { fetchArtistTopTracks, fetchArtistTopAlbums, fetchTrackAlbum, normalizeTrackTitle } from "../../clients/lastfm";
import type { LastfmTopTrack, LastfmTopAlbum } from "../../clients/lastfm";
import { REPLAY_GAIN_COLUMNS, replayGainFromRow, type ReplayGainColumns } from "../../lib/replayGainRow";

export const POPULAR_TRACKS_MAX = 10;

export interface TopTrack extends ReplayGainColumns {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  album_name: string | null;
  album_id: string | null;
  artwork_url: string | null;
  play_count: number | null;
  played_at: string | null;
  lastfmRank?: number;
  lastfmPlaycount?: number;
  lastfmCombined?: boolean;
}

export function useArtistTopTracks(artistName: string, serverId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: QK.artistTopTracks(artistName, serverId),
    enabled: options?.enabled,
    queryFn: async (): Promise<TopTrack[]> => {
      const db = await getDb();
      return db.select<TopTrack[]>(
        `SELECT t.id, t.title, t.artist, t.duration, a.name AS album_name,
                t.album_id, a.artwork_url, t.play_count, t.played_at, ${REPLAY_GAIN_COLUMNS}
         FROM tracks t
         LEFT JOIN albums a ON t.album_id = a.id
         WHERE t.server_id = ?
           AND (t.artist = ?
            OR t.artist IN (SELECT alias_name FROM artist_aliases WHERE canonical_name = ?))
         ORDER BY t.track_number, t.title`,
        [serverId, artistName, artistName]
      );
    },
  });
}

/** One row, purely as a radio seed for a similar-artist card. Kept separate from
 * useArtistTopTracks, which selects every track, to avoid one whole-table scan per card. */
export function useArtistSeedTrack(artistName: string, serverId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: QK.artistSeedTrack(artistName, serverId),
    enabled: options?.enabled,
    queryFn: async (): Promise<TopTrack | null> => {
      const db = await getDb();
      const rows = await db.select<TopTrack[]>(
        `SELECT t.id, t.title, t.artist, t.duration, a.name AS album_name,
                t.album_id, a.artwork_url, t.play_count, t.played_at, ${REPLAY_GAIN_COLUMNS}
         FROM tracks t
         LEFT JOIN albums a ON t.album_id = a.id
         WHERE t.server_id = ?
           AND (t.artist = ?
            OR t.artist IN (SELECT alias_name FROM artist_aliases WHERE canonical_name = ?))
         ORDER BY t.play_count DESC, t.track_number, t.title
         LIMIT 1`,
        [serverId, artistName, artistName]
      );
      return rows[0] ?? null;
    },
  });
}

export function useArtistGenres(artistName: string, serverId: string) {
  return useQuery({
    queryKey: QK.artistGenres(artistName, serverId),
    queryFn: async (): Promise<string[]> => {
      const db = await getDb();
      const rows = await db.select<{ name: string }[]>(
        `SELECT ag.name, COUNT(DISTINCT ag.album_id) AS n
         FROM album_genres ag
         JOIN albums a ON a.id = ag.album_id
         WHERE a.server_id = ?
           AND (a.artist = ? OR a.artist IN (SELECT alias_name FROM artist_aliases WHERE canonical_name = ?))
           AND ag.relation = 'direct'
           AND ag.canonical_id NOT LIKE 'raw:%'
         GROUP BY ag.canonical_id
         ORDER BY n DESC
         LIMIT 5`,
        [serverId, artistName, artistName]
      );
      return rows.map((r) => r.name);
    },
    enabled: !!artistName,
  });
}

export function useAppearsOnAlbums(artistName: string, serverId: string) {
  return useQuery({
    queryKey: QK.artistAppearsOn(artistName, serverId),
    queryFn: async (): Promise<AlbumRow[]> => {
      const db = await getDb();
      return db.select<AlbumRow[]>(
        `SELECT DISTINCT a.id, a.server_id, a.name, a.artist, a.year, a.artwork_url, a.release_type
         FROM tracks t
         JOIN albums a ON t.album_id = a.id
         WHERE t.server_id = ?
           AND (t.artist = ? OR t.artist IN (SELECT alias_name FROM artist_aliases WHERE canonical_name = ?))
           AND a.artist IS NOT NULL
           AND a.artist != ?
           AND a.artist NOT IN (SELECT alias_name FROM artist_aliases WHERE canonical_name = ?)
         ORDER BY a.year IS NULL, a.year DESC, a.name
         LIMIT 24`,
        [serverId, artistName, artistName, artistName, artistName]
      );
    },
    enabled: !!artistName,
  });
}

export function useLastfmTopAlbums(artistName: string) {
  return useQuery({
    queryKey: QK.lastfmArtistTopAlbums(artistName),
    queryFn: (): Promise<LastfmTopAlbum[]> => fetchArtistTopAlbums(artistName),
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });
}

export function useLastfmTopTracks(artistName: string) {
  return useQuery({
    queryKey: QK.lastfmArtistTopTracks(artistName),
    queryFn: (): Promise<LastfmTopTrack[]> => fetchArtistTopTracks(artistName),
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });
}

export function buildTrackObj(track: TopTrack, server: Server, credential: NavidromeCredential): CurrentTrack {
  const artworkRef = track.artwork_url ?? null;
  const coverArtUrl = artworkRef
    ? getCoverArtUrl(server.url, server.username, credential, artworkRef, 500)
    : null;
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    coverArtUrl,
    artworkRef,
    album: track.album_name ?? null,
    albumId: track.album_id ?? null,
    replayGain: replayGainFromRow(track),
  };
}

// Last.fm's per-title playcount can't tell apart local copies sharing a title (e.g.
// clipping.'s many "Intro" tracks); pick by Last.fm's representative album, else local plays,
// and mark the winner `lastfmCombined` since the count spans more than this one track.
async function matchLastfmTracks(
  tracks: TopTrack[],
  lastfmTracks: LastfmTopTrack[],
  artistName: string
): Promise<TopTrack[]> {
  const lastfmByTitle = new Map<string, { rank: number; playcount: number }>();
  lastfmTracks.forEach((t, i) => {
    const key = normalizeTrackTitle(t.name);
    if (!lastfmByTitle.has(key)) lastfmByTitle.set(key, { rank: i, playcount: t.playcount });
  });

  const groups = new Map<string, TopTrack[]>();
  for (const t of tracks) {
    const key = normalizeTrackTitle(t.title);
    const group = groups.get(key);
    if (group) group.push(t);
    else groups.set(key, [t]);
  }

  const result: TopTrack[] = tracks.map((t) => ({ ...t }));
  const byId = new Map(result.map((t) => [t.id, t]));

  // Every ambiguous group used to cost a `track.getInfo` call against Last.fm's shared
  // 250ms limiter, visibly delaying the Popular list; only lookup groups that can reach it.
  const ambiguous = [...groups.entries()]
    .filter(([key, group]) => group.length > 1 && lastfmByTitle.has(key))
    .sort(([a], [b]) => lastfmByTitle.get(b)!.playcount - lastfmByTitle.get(a)!.playcount);
  const lookupTitles = new Set(ambiguous.slice(0, POPULAR_TRACKS_MAX).map(([key]) => key));

  for (const [key, group] of groups) {
    const lfm = lastfmByTitle.get(key);
    if (!lfm) continue;

    const [first, ...rest] = group;
    if (!first) continue;

    if (rest.length === 0) {
      const winner = byId.get(first.id)!;
      winner.lastfmRank = lfm.rank;
      winner.lastfmPlaycount = lfm.playcount;
      continue;
    }

    let winner: TopTrack | undefined;
    const repAlbum = lookupTitles.has(key) ? await fetchTrackAlbum(artistName, first.title) : null;
    if (repAlbum) {
      const repNorm = normalizeTrackTitle(repAlbum);
      winner = group.find((t) => t.album_name && normalizeTrackTitle(t.album_name) === repNorm);
    }
    winner ??= [...group].sort((a, b) => (b.play_count ?? 0) - (a.play_count ?? 0))[0];
    if (!winner) continue;

    const winnerEnriched = byId.get(winner.id)!;
    winnerEnriched.lastfmRank = lfm.rank;
    winnerEnriched.lastfmPlaycount = lfm.playcount;
    winnerEnriched.lastfmCombined = true;
  }

  return result;
}

export function useMatchedTracks(
  artistName: string,
  tracks: TopTrack[] | undefined,
  lastfmTracks: LastfmTopTrack[] | undefined
) {
  return useQuery({
    queryKey: QK.lastfmTrackMatch(artistName, (tracks ?? []).map((t) => t.id)),
    queryFn: () => matchLastfmTracks(tracks ?? [], lastfmTracks ?? [], artistName),
    enabled: !!tracks && !!lastfmTracks,
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });
}

export function lastfmOnlyTracks(localTracks: TopTrack[], lastfmTracks: LastfmTopTrack[]): LastfmTopTrack[] {
  const localNorm = new Set(localTracks.map((t) => normalizeTrackTitle(t.title)));
  return lastfmTracks.filter((t) => !localNorm.has(normalizeTrackTitle(t.name))).slice(0, 10);
}
