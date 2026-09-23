import { buildAuthParams, type NavidromeCredential } from "./navidromeUrls";
import { apiPost, callSubsonicVoid } from "./navidromeTransport";
import type { NavidromeTrack } from "./navidrome";

export interface NavidromePlaylist {
  id: string;
  name: string;
  comment?: string;
  songCount: number;
  coverArt?: string;
}

export async function fetchPlaylists(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  altUrl?: string
): Promise<NavidromePlaylist[]> {
  const params = buildAuthParams(username, credential);
  const res = await apiPost(baseUrl, "getPlaylists", params, altUrl);
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
  playlistId: string,
  altUrl?: string
): Promise<NavidromeTrack[]> {
  const params = buildAuthParams(username, credential);
  params.set("id", playlistId);
  const res = await apiPost(baseUrl, "getPlaylist", params, altUrl);
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
  name: string,
  altUrl?: string
): Promise<NavidromePlaylist> {
  const params = buildAuthParams(username, credential);
  params.set("name", name);
  const res = await apiPost(baseUrl, "createPlaylist", params, altUrl);
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
  nativePlaylistId: string,
  altUrl?: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "deletePlaylist", { id: nativePlaylistId }, altUrl);
}

export function addTrackToNavidromePlaylist(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativePlaylistId: string,
  nativeTrackId: string,
  altUrl?: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "updatePlaylist", {
    playlistId: nativePlaylistId,
    songIdToAdd: nativeTrackId,
  }, altUrl);
}

export async function addTracksToNavidromePlaylist(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativePlaylistId: string,
  nativeTrackIds: string[],
  altUrl?: string
): Promise<void> {
  const params = buildAuthParams(username, credential);
  params.set("playlistId", nativePlaylistId);
  for (const id of nativeTrackIds) params.append("songIdToAdd", id);
  const res = await apiPost(baseUrl, "updatePlaylist", params, altUrl);
  if (!res.ok) throw new Error(`updatePlaylist returned ${res.status}`);
  const data = (await res.json()) as {
    "subsonic-response": { status: string; error?: { message: string } };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "updatePlaylist failed");
  }
}

export async function updateNavidromePlaylist(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativePlaylistId: string,
  name: string,
  comment?: string,
  altUrl?: string
): Promise<void> {
  const extra: Record<string, string> = { playlistId: nativePlaylistId, name };
  if (comment !== undefined) extra["comment"] = comment;
  return callSubsonicVoid(baseUrl, username, credential, "updatePlaylist", extra, altUrl);
}

export function removeTrackFromNavidromePlaylist(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativePlaylistId: string,
  songIndex: number,
  altUrl?: string
): Promise<void> {
  return callSubsonicVoid(baseUrl, username, credential, "updatePlaylist", {
    playlistId: nativePlaylistId,
    songIndexToRemove: String(songIndex),
  }, altUrl);
}

export async function replaceNavidromePlaylistTracks(
  baseUrl: string,
  username: string,
  credential: NavidromeCredential,
  nativePlaylistId: string,
  nativeTrackIds: string[],
  currentTrackCount: number,
  altUrl?: string
): Promise<void> {
  const params = buildAuthParams(username, credential);
  params.set("playlistId", nativePlaylistId);
  for (let i = 0; i < currentTrackCount; i++) params.append("songIndexToRemove", String(i));
  for (const id of nativeTrackIds) params.append("songIdToAdd", id);
  const res = await apiPost(baseUrl, "updatePlaylist", params, altUrl);
  if (!res.ok) throw new Error(`updatePlaylist returned ${res.status}`);
  const data = (await res.json()) as {
    "subsonic-response": { status: string; error?: { message: string } };
  };
  const response = data["subsonic-response"];
  if (response.status !== "ok") {
    throw new Error(response.error?.message ?? "updatePlaylist failed");
  }
}
