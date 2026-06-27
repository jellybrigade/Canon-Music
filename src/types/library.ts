export interface AlbumRow {
  id: string;
  server_id: string;
  name: string;
  artist: string | null;
  year: number | null;
  artwork_url: string | null;
  release_type?: string | null;
}

export type AlbumSort = "artist" | "alphabetical" | "year" | "recently_added";

export interface ArtistRow {
  name: string;
  album_count: number;
  artwork_url: string | null;
}

export interface TrackRow {
  id: string;
  title: string;
  artist: string | null;
  album_artist: string | null;
  album_id: string;
  genre: string | null;
  track_number: number | null;
  disc_number: number | null;
  year: number | null;
  duration: number | null;
  file_path: string | null;
  play_count: number | null;
  bit_rate: number | null;
  suffix: string | null;
  file_size: number | null;
  replay_gain_track_gain: number | null;
  replay_gain_track_peak: number | null;
  replay_gain_album_gain: number | null;
  replay_gain_album_peak: number | null;
}

export interface PlaylistTrackRow {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
  genre: string | null;
  year: number | null;
  track_number: number | null;
  position: number;
  artwork_url: string | null;
  album_name: string | null;
  album_id: string | null;
  bit_rate: number | null;
  suffix: string | null;
}
