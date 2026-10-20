import type { NavidromeCredential } from "../clients/navidromeUrls";
import { getCoverArtUrl, getStreamUrl } from "../clients/navidromeUrls";
import type { CurrentTrack } from "../features/playback/store/playerTypes";
import type { Server } from "../types/server";
import { stripServerPrefix } from "./ids";
import { type ReplayGainColumns, replayGainFromRow } from "./replayGainRow";

/** Cover size the player bar and queue thumbnails request. */
export const PLAYER_COVER_SIZE = 64;

export type PlayableTrackRow = {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  album_id: string | null;
  album_name: string | null;
  artwork_url: string | null;
} & ReplayGainColumns;

export function makeStreamUrlBuilder(server: Server, credential: NavidromeCredential): (track: CurrentTrack) => string {
  return (track) => {
    const navTrackId = stripServerPrefix(track.id, server.id);
    return getStreamUrl(server.url, server.username, credential, navTrackId);
  };
}

export function currentTrackFromRow(
  row: PlayableTrackRow,
  server: Server,
  credential: NavidromeCredential,
): CurrentTrack {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    duration: row.duration,
    coverArtUrl: row.artwork_url
      ? getCoverArtUrl(server.url, server.username, credential, row.artwork_url, PLAYER_COVER_SIZE)
      : null,
    artworkRef: row.artwork_url,
    album: row.album_name,
    albumId: row.album_id,
    replayGain: replayGainFromRow(row),
  };
}
