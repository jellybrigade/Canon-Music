import { getStreamUrl } from "./navidrome";
import { stripServerPrefix } from "../utils/ids";
import type { Server } from "../types/server";
import type { NavidromeCredential } from "./navidrome";
import type { CurrentTrack } from "../store/player";

export function makeStreamUrlBuilder(
  server: Server,
  credential: NavidromeCredential,
): (track: CurrentTrack) => string {
  return (track) => {
    const navTrackId = stripServerPrefix(track.id, server.id);
    return getStreamUrl(server.url, server.username, credential, navTrackId);
  };
}
