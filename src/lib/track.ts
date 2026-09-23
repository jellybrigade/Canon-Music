import { getStreamUrl } from "../clients/navidrome";
import { stripServerPrefix } from "./ids";
import type { Server } from "../types/server";
import type { NavidromeCredential } from "../clients/navidrome";
import type { CurrentTrack } from "../features/playback/store/player";

export function makeStreamUrlBuilder(
  server: Server,
  credential: NavidromeCredential,
): (track: CurrentTrack) => string {
  return (track) => {
    const navTrackId = stripServerPrefix(track.id, server.id);
    return getStreamUrl(server.url, server.username, credential, navTrackId);
  };
}
