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
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

export function albumPath(albumId: string) {
  return `/album/${encodeURIComponent(albumId)}`;
}
export function artistPath(artistName: string) {
  return `/artist/${encodeURIComponent(artistName)}`;
}
export function playlistPath(playlistId: string) {
  return `/playlist/${encodeURIComponent(playlistId)}`;
}
