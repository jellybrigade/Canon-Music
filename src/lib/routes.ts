export const ROUTES = {
  HOME: "/home",
  NOW_PLAYING: "/nowplaying",
  LIBRARY: "/library",
  ALBUM: "/album/:albumId",
  ARTISTS: "/artists",
  ARTIST: "/artist/:artistName",
  GENRES: "/genres",
  YEARS: "/years",
  PLAYLISTS: "/playlists",
  PLAYLIST: "/playlist/:playlistId",
  TRACKS: "/tracks",
  TAGS: "/tags",
  UNIDENTIFIED: "/unidentified",
  SETTINGS: "/settings",
  SEARCH: "/search",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

export const ALBUM_TRACK_PARAM = "track";

// Named fields: both are plain string ids, so a positional pair swapped silently.
export type AlbumTrackTarget = { albumId: string; trackId: string };

export function albumPath(albumId: string, trackId?: string) {
  const path = `/album/${encodeURIComponent(albumId)}`;
  return trackId === undefined ? path : `${path}?${new URLSearchParams({ [ALBUM_TRACK_PARAM]: trackId })}`;
}
export function artistPath(artistName: string) {
  return `/artist/${encodeURIComponent(artistName)}`;
}
export function searchPath(query: string) {
  return `${ROUTES.SEARCH}?${new URLSearchParams({ q: query })}`;
}
export function playlistPath(playlistId: string) {
  return `/playlist/${encodeURIComponent(playlistId)}`;
}
