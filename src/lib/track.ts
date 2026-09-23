import { getStreamUrl } from "../clients/navidromeUrls";
import { stripServerPrefix } from "./ids";
import type { Server } from "../types/server";
import type { NavidromeCredential } from "../clients/navidromeUrls";
import type { CurrentTrack } from "../features/playback/store/playerTypes";

export function makeStreamUrlBuilder(
  server: Server,
  credential: NavidromeCredential,
): (track: CurrentTrack) => string {
  return (track) => {
    const navTrackId = stripServerPrefix(track.id, server.id);
    return getStreamUrl(server.url, server.username, credential, navTrackId);
  };
}
