import { useQuery } from "@tanstack/react-query";
import type { LastfmTopTrack } from "../../clients/lastfm";
import { fetchTrackAlbum, normalizeTrackTitle } from "../../clients/lastfm";
import { getCoverArtUrl } from "../../clients/navidromeUrls";
import { getDb } from "../../db";
import { fetchEssentialAlbumOrder } from "../../features/enrichment/lib/essentialAlbums";
import { fetchPopularTrackRanking, type PopularTrackRanking } from "../../features/enrichment/lib/popularTracks";
import type { CurrentTrack } from "../../features/playback/store/playerTypes";
import { QK } from "../../lib/queryKeys";
import { REPLAY_GAIN_COLUMNS, type ReplayGainColumns, replayGainFromRow } from "../../lib/replayGainRow";
import type { AlbumRow } from "../../types/library";
import type { Server } from "../../types/server";

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
  popularRank?: number;
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
        [serverId, artistName, artistName],
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
         ORDER BY t.play_count DESC, t.track_number, t.title, t.id
         LIMIT 1`,
        [serverId, artistName, artistName],
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
        `SELECT MIN(ag.name) AS name, COUNT(DISTINCT ag.album_id) AS n
         FROM album_genres ag
         JOIN albums a ON a.id = ag.album_id
         WHERE a.server_id = ?
           AND (a.artist = ? OR a.artist IN (SELECT alias_name FROM artist_aliases WHERE canonical_name = ?))
           AND ag.relation = 'direct'
           AND ag.canonical_id NOT LIKE 'raw:%'
         GROUP BY ag.canonical_id
         ORDER BY n DESC, name, ag.canonical_id
         LIMIT 5`,
        [serverId, artistName, artistName],
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
         ORDER BY a.year IS NULL, a.year DESC, a.name, a.id
         LIMIT 24`,
        [serverId, artistName, artistName, artistName, artistName],
      );
    },
    enabled: !!artistName,
  });
}

/** Ids of `albums` most popular first, only those a source ranks; the rest keep their own order. */
export function useEssentialAlbumOrder({
  artistName,
  lastfmName,
  albums,
  enabled,
}: {
  artistName: string;
  lastfmName: string;
  albums: readonly AlbumRow[];
  enabled: boolean;
}) {
  const albumIds = albums.map((album) => album.id);
  return useQuery({
    queryKey: QK.artistEssentialAlbums(lastfmName, artistName, albumIds),
    enabled,
    queryFn: async (): Promise<string[]> => {
      const db = await getDb();
      const placeholders = albumIds.map(() => "?").join(", ");
      const identities = await db.select<{ album_id: string; mb_release_group_id: string }[]>(
        `SELECT album_id, mb_release_group_id FROM album_identity
         WHERE album_id IN (${placeholders}) AND mb_release_group_id IS NOT NULL`,
        albumIds,
      );
      const mbidByAlbum = new Map(identities.map((row) => [row.album_id, row.mb_release_group_id]));
      return fetchEssentialAlbumOrder({
        artistName,
        lastfmName,
        albums: albums.map((album) => ({
          id: album.id,
          name: album.name,
          releaseGroupMbid: mbidByAlbum.get(album.id) ?? null,
        })),
      });
    },
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });
}

export function usePopularTrackRanking(artistName: string, lastfmName: string) {
  return useQuery({
    queryKey: QK.artistPopularTracks(lastfmName, artistName),
    queryFn: (): Promise<PopularTrackRanking> => fetchPopularTrackRanking({ artistName, lastfmName }),
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });
}

export function buildTrackObj(track: TopTrack, server: Server): CurrentTrack {
  const artworkRef = track.artwork_url ?? null;
  const coverArtUrl = artworkRef ? getCoverArtUrl(server.id, artworkRef, 500) : null;
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

// A per-title ranking can't tell apart local copies sharing a title (e.g. clipping.'s many
// "Intro" tracks); pick by the source's album (Deezer names it, Last.fm is asked), else local
// plays, and mark a Last.fm winner `lastfmCombined` since its count spans more than this track.
export async function matchPopularTracks(
  tracks: TopTrack[],
  ranking: PopularTrackRanking,
  artistName: string,
): Promise<TopTrack[]> {
  const rankByTitle = new Map<string, { rank: number; playcount: number | null; albumTitle: string | null }>();
  ranking.tracks.forEach((t, i) => {
    const key = normalizeTrackTitle(t.title);
    if (!rankByTitle.has(key)) rankByTitle.set(key, { rank: i, playcount: t.playcount, albumTitle: t.albumTitle });
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
    .filter(([key, group]) => group.length > 1 && rankByTitle.has(key))
    .sort(([a], [b]) => rankByTitle.get(a)!.rank - rankByTitle.get(b)!.rank);
  const lookupTitles = new Set(ambiguous.slice(0, POPULAR_TRACKS_MAX).map(([key]) => key));

  for (const [key, group] of groups) {
    const ranked = rankByTitle.get(key);
    if (!ranked) continue;

    const [first, ...rest] = group;
    if (!first) continue;
    const playcount = ranked.playcount ?? undefined;

    if (rest.length === 0) {
      const winner = byId.get(first.id)!;
      winner.popularRank = ranked.rank;
      winner.lastfmPlaycount = playcount;
      continue;
    }

    let winner: TopTrack | undefined;
    const repAlbum =
      ranking.source === "deezer"
        ? ranked.albumTitle
        : lookupTitles.has(key)
          ? await fetchTrackAlbum(artistName, first.title)
          : null;
    if (repAlbum) {
      const repNorm = normalizeTrackTitle(repAlbum);
      winner = group.find((t) => t.album_name && normalizeTrackTitle(t.album_name) === repNorm);
    }
    winner ??= [...group].sort((a, b) => (b.play_count ?? 0) - (a.play_count ?? 0))[0];
    if (!winner) continue;

    const winnerEnriched = byId.get(winner.id)!;
    winnerEnriched.popularRank = ranked.rank;
    winnerEnriched.lastfmPlaycount = playcount;
    winnerEnriched.lastfmCombined = playcount !== undefined ? true : undefined;
  }

  return result;
}

export function useMatchedTracks(
  artistName: string,
  tracks: TopTrack[] | undefined,
  ranking: PopularTrackRanking | undefined,
) {
  return useQuery({
    queryKey: QK.popularTrackMatch(
      artistName,
      ranking?.source ?? null,
      (tracks ?? []).map((t) => t.id),
    ),
    queryFn: () => matchPopularTracks(tracks ?? [], ranking ?? { source: "deezer", tracks: [] }, artistName),
    enabled: !!tracks && !!ranking,
    staleTime: 7 * 24 * 60 * 60 * 1000,
  });
}

/** Last.fm's popular tracks this library lacks; Deezer's ranking lists none, it isn't Last.fm. */
export function lastfmOnlyTracks(localTracks: TopTrack[], ranking: PopularTrackRanking): LastfmTopTrack[] {
  if (ranking.source !== "lastfm") return [];
  const localNorm = new Set(localTracks.map((t) => normalizeTrackTitle(t.title)));
  return ranking.tracks
    .filter((t) => !localNorm.has(normalizeTrackTitle(t.title)))
    .slice(0, 10)
    .map((t) => ({ name: t.title, playcount: t.playcount ?? 0 }));
}
