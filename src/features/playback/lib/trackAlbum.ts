import type { AlbumRow } from "../../../types/library";
import type { CurrentTrack } from "../store/playerTypes";

// The server comes from the track's own id: the queue can hold another server's tracks.
export function albumRowOfTrack(track: CurrentTrack): AlbumRow | null {
  if (!track.albumId) return null;
  return {
    id: track.albumId,
    server_id: track.id.slice(0, track.id.indexOf(":")),
    name: track.album ?? "",
    artist: track.artist,
    year: null,
    artwork_url: track.artworkRef ?? null,
  };
}
