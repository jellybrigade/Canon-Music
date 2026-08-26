import type { NavidromeAlbum, NavidromeCredential, NavidromeTrack } from "../lib/navidrome";
import type { Server } from "../types/server";

export const SRV = "srv-a";
export const OTHER = "srv-b";

export const CRED: NavidromeCredential = { type: "apikey", apiKey: "k" };

export function server(id = SRV, overrides: Partial<Server> = {}): Server {
  return {
    id,
    type: "navidrome",
    url: "http://music.local",
    alt_url: null,
    display_name: "Music",
    username: "user",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function album(id: string, overrides: Partial<NavidromeAlbum> = {}): NavidromeAlbum {
  return {
    id,
    name: `Album ${id}`,
    artist: "Artist One",
    artistId: "ar-1",
    coverArt: `co-${id}`,
    year: 2020,
    created: "2026-01-01T00:00:00Z",
    songCount: 2,
    playCount: 0,
    ...overrides,
  };
}

export function track(id: string, albumId: string, overrides: Partial<NavidromeTrack> = {}): NavidromeTrack {
  return {
    id,
    title: `Track ${id}`,
    artist: "Artist One",
    albumId,
    genre: "Rock",
    track: 1,
    duration: 200,
    ...overrides,
  };
}
