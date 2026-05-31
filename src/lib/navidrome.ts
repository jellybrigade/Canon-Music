import { md5 } from "js-md5";

export interface NavidromeCredential {
  token: string;
  salt: string;
}

export interface NavidromeAlbum {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  coverArt?: string;
  year?: number;
  starred?: string;
  created?: string;
  songCount?: number;
}

function generateSalt(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeUrl(url: string): string {
  // Strip trailing slashes and accidental /rest suffix
  return url.replace(/\/+$/, "").replace(/\/rest$/, "");
}

function buildAuthParams(
  username: string,
  credential: NavidromeCredential
): URLSearchParams {
  const p = new URLSearchParams();
  p.set("u", username);
  p.set("t", credential.token);
  p.set("s", credential.salt);
  p.set("v", "1.16.1");
  p.set("c", "canon");
  p.set("f", "json");
  return p;
}

export function getCoverArtUrl(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  coverArtId: string,
  size = 300
): string {
  const params = buildAuthParams(username, credential);
  params.set("id", coverArtId);
  params.set("size", String(size));
  return `${normalizeUrl(baseUrl)}/rest/getCoverArt?${params.toString()}`;
}

export async function fetchAllAlbums(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential
): Promise<NavidromeAlbum[]> {
  const PAGE_SIZE = 500;
  const albums: NavidromeAlbum[] = [];
  let offset = 0;

  while (true) {
    const params = buildAuthParams(username, credential);
    params.set("type", "alphabeticalByName");
    params.set("size", String(PAGE_SIZE));
    params.set("offset", String(offset));

    const url = `${normalizeUrl(baseUrl)}/rest/getAlbumList2?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`getAlbumList2 returned ${res.status}`);

    const data = (await res.json()) as {
      "subsonic-response": {
        status: string;
        error?: { code: number; message: string };
        albumList2?: { album?: NavidromeAlbum[] };
      };
    };

    const response = data["subsonic-response"];
    if (response.status !== "ok") {
      throw new Error(response.error?.message ?? "Failed to fetch albums");
    }

    const page = response.albumList2?.album ?? [];
    albums.push(...page);

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return albums;
}

export async function fetchAlbumListByType(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  type: "recent" | "frequent" | "newest",
  size = 20
): Promise<NavidromeAlbum[]> {
  const params = buildAuthParams(username, credential);
  params.set("type", type);
  params.set("size", String(size));

  const url = `${normalizeUrl(baseUrl)}/rest/getAlbumList2?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`getAlbumList2 returned ${res.status}`);

  const data = (await res.json()) as {
    "subsonic-response": {
      status: string;
      error?: { code: number; message: string };
      albumList2?: { album?: NavidromeAlbum[] };
    };
  };

  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "Failed to fetch album list");
  }

  return response.albumList2?.album ?? [];
}

export interface NavidromeTrack {
  id: string;
  title: string;
  artist?: string;
  artistId?: string;
  albumId: string;
  genre?: string;
  track?: number;
  discNumber?: number;
  year?: number;
  duration?: number;
  coverArt?: string;
  starred?: string;
  path?: string;
}

export function getStreamUrl(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  trackId: string
): string {
  const params = buildAuthParams(username, credential);
  params.set("id", trackId);
  return `${normalizeUrl(baseUrl)}/rest/stream?${params.toString()}`;
}

export async function fetchAlbumTracks(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  albumId: string
): Promise<NavidromeTrack[]> {
  const params = buildAuthParams(username, credential);
  params.set("id", albumId);
  const url = `${normalizeUrl(baseUrl)}/rest/getAlbum?${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`getAlbum returned ${res.status}`);

  const data = (await res.json()) as {
    "subsonic-response": {
      status: string;
      error?: { code: number; message: string };
      album?: { song?: NavidromeTrack[] };
    };
  };

  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "Failed to fetch album tracks");
  }

  return response.album?.song ?? [];
}

export interface NavidromeStarred {
  song?: Array<{ id: string }>;
  album?: Array<{ id: string }>;
}

export async function fetchStarred2(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential
): Promise<NavidromeStarred> {
  const params = buildAuthParams(username, credential);
  const url = `${normalizeUrl(baseUrl)}/rest/getStarred2?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`getStarred2 returned ${res.status}`);
  const data = (await res.json()) as {
    "subsonic-response": {
      status: string;
      error?: { message: string };
      starred2?: NavidromeStarred;
    };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "getStarred2 failed");
  }
  return response.starred2 ?? {};
}

async function callSubsonicVoid(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  endpoint: string,
  extraParams: Record<string, string>
): Promise<void> {
  const params = buildAuthParams(username, credential);
  for (const [k, v] of Object.entries(extraParams)) params.set(k, v);
  const url = `${normalizeUrl(baseUrl)}/rest/${endpoint}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${endpoint} returned ${res.status}`);
  const data = (await res.json()) as {
    "subsonic-response": { status: string; error?: { message: string } };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? `${endpoint} failed`);
  }
}

export function starTrack(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeTrackId: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "star.view", { id: nativeTrackId });
}

export function unstarTrack(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeTrackId: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "unstar.view", { id: nativeTrackId });
}

export function starAlbum(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeAlbumId: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "star.view", { albumId: nativeAlbumId });
}

export function unstarAlbum(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeAlbumId: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "unstar.view", { albumId: nativeAlbumId });
}

export interface NavidromePlaylist {
  id: string;
  name: string;
  comment?: string;
  songCount: number;
}

export async function fetchPlaylists(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential
): Promise<NavidromePlaylist[]> {
  const params = buildAuthParams(username, credential);
  const url = `${normalizeUrl(baseUrl)}/rest/getPlaylists?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`getPlaylists returned ${res.status}`);
  const data = (await res.json()) as {
    "subsonic-response": {
      status: string;
      error?: { message: string };
      playlists?: { playlist?: NavidromePlaylist[] };
    };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "getPlaylists failed");
  }
  // Navidrome returns shared playlists twice (owner view + shared view); deduplicate by id.
  const raw = response.playlists?.playlist ?? [];
  const seen = new Set<string>();
  return raw.filter(pl => { if (seen.has(pl.id)) return false; seen.add(pl.id); return true; });
}

export async function fetchPlaylistTracks(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  playlistId: string
): Promise<NavidromeTrack[]> {
  const params = buildAuthParams(username, credential);
  params.set("id", playlistId);
  const url = `${normalizeUrl(baseUrl)}/rest/getPlaylist?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`getPlaylist returned ${res.status}`);
  const data = (await res.json()) as {
    "subsonic-response": {
      status: string;
      error?: { message: string };
      playlist?: { entry?: NavidromeTrack[] };
    };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "getPlaylist failed");
  }
  return response.playlist?.entry ?? [];
}

export async function createNavidromePlaylist(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  name: string
): Promise<NavidromePlaylist> {
  const params = buildAuthParams(username, credential);
  params.set("name", name);
  const url = `${normalizeUrl(baseUrl)}/rest/createPlaylist?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`createPlaylist returned ${res.status}`);
  const data = (await res.json()) as {
    "subsonic-response": {
      status: string;
      error?: { message: string };
      playlist?: NavidromePlaylist;
    };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "createPlaylist failed");
  }
  if (!response.playlist) throw new Error("createPlaylist returned no playlist");
  return response.playlist;
}

export function deleteNavidromePlaylist(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativePlaylistId: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "deletePlaylist", { id: nativePlaylistId });
}

export function addTrackToNavidromePlaylist(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativePlaylistId: string,
  nativeTrackId: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "updatePlaylist", {
    playlistId: nativePlaylistId,
    songIdToAdd: nativeTrackId,
  });
}

export function removeTrackFromNavidromePlaylist(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativePlaylistId: string,
  songIndex: number
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "updatePlaylist", {
    playlistId: nativePlaylistId,
    songIndexToRemove: String(songIndex),
  });
}

export function scrobbleTrack(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativeTrackId: string,
  timestampMs: number
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "scrobble.view", {
    id: nativeTrackId,
    time: String(timestampMs),
    submission: "true",
  });
}

export async function authenticate(
  baseUrl: string,
  username: string,
  password: string
): Promise<NavidromeCredential> {
  const salt = generateSalt();
  const token = md5(password + salt);
  const url = new URL(`${normalizeUrl(baseUrl)}/rest/ping.view`);
  url.searchParams.set("u", username);
  url.searchParams.set("t", token);
  url.searchParams.set("s", salt);
  url.searchParams.set("v", "1.16.1");
  url.searchParams.set("c", "canon");
  url.searchParams.set("f", "json");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Server returned ${res.status} — check URL (tried: ${url.origin}${url.pathname})`);
  }

  const data = (await res.json()) as {
    "subsonic-response": {
      status: string;
      error?: { code: number; message: string };
    };
  };

  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "Authentication failed");
  }

  return { token, salt };
}
