import type { NavidromeCredential } from "../clients/navidromeUrls";
import { getStreamUrl } from "../clients/navidromeUrls";
import type { CurrentTrack } from "../features/playback/store/playerTypes";
import type { Server } from "../types/server";
import { stripServerPrefix } from "./ids";

export function makeStreamUrlBuilder(server: Server, credential: NavidromeCredential): (track: CurrentTrack) => string {
  return (track) => {
    const navTrackId = stripServerPrefix(track.id, server.id);
    return getStreamUrl(server.url, server.username, credential, navTrackId);
  };
}
