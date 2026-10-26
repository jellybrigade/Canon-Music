import { type SortDirection, type SortValue, sortRows } from "../../lib/trackSort";
import type { PlaylistTrackRow } from "../../types/library";

const VALUE_OF = {
  title: (track) => track.title,
  artist: (track) => track.artist,
  genre: (track) => track.genre,
  album: (track) => track.album_name,
  year: (track) => track.year,
  format: (track) => track.suffix,
  bitrate: (track) => track.bit_rate,
  duration: (track) => track.duration,
} satisfies Record<string, (track: PlaylistTrackRow) => SortValue>;

export type PlaylistSortField = keyof typeof VALUE_OF;

// Names its playlist: the detail view stays mounted across playlists, and a sort picked on
// one must not reorder the next.
export interface PlaylistSort {
  playlistId: string;
  field: PlaylistSortField;
  direction: SortDirection;
}

export function activePlaylistSort(sort: PlaylistSort | null, playlistId: string): PlaylistSort | null {
  return sort?.playlistId === playlistId ? sort : null;
}

// A third click on the same column goes back to the playlist's own order.
export function nextPlaylistSort(
  current: PlaylistSort | null,
  playlistId: string,
  field: PlaylistSortField,
): PlaylistSort | null {
  const active = activePlaylistSort(current, playlistId);
  if (active?.field !== field) return { playlistId, field, direction: "asc" };
  return active.direction === "asc" ? { playlistId, field, direction: "desc" } : null;
}

export function sortPlaylistTracks(tracks: PlaylistTrackRow[], sort: PlaylistSort | null): PlaylistTrackRow[] {
  return sort ? sortRows(tracks, VALUE_OF[sort.field], sort.direction) : tracks;
}
