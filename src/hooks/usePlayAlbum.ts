import { useCallback } from "react";
import type { AlbumRow } from "../types/library";
import type { ServerWithCredential } from "./useServer";
import type { CurrentTrack } from "../features/playback/store/playerTypes";
import { usePlayerStore } from "../features/playback/store/player";
import { useSetting } from "./useSetting";
import { getCoverArtUrl, getStreamUrl } from "../clients/navidromeUrls";
import { stripServerPrefix } from "../lib/ids";
import { shuffleArray } from "../lib/shuffle";
import { loadAlbumTracksForPlay } from "../lib/albumTracks";

/** Always appends the album's tracks to the end of the queue (no setting override). */
export function useAddAlbumToQueue(serverWithCred: ServerWithCredential) {
  const { server, credential } = serverWithCred;
  const addToQueue = usePlayerStore(s => s.addToQueue);

  return useCallback(async (album: AlbumRow) => {
    const tracks = await loadAlbumTracksForPlay(server, credential, album);
    if (tracks.length === 0) return;
    const coverArtUrl = album.artwork_url
      ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url, 500)
      : null;
    const streamUrlFor = (track: CurrentTrack): string =>
      getStreamUrl(server.url, server.username, credential, stripServerPrefix(track.id, server.id));
    for (const t of tracks) {
      addToQueue(
        { id: t.id, title: t.title, artist: t.artist, duration: t.duration, coverArtUrl, artworkRef: album.artwork_url ?? null, album: album.name, albumId: album.id },
        streamUrlFor,
      );
    }
  }, [server, credential, addToQueue]);
}

export function usePlayAlbum(serverWithCred: ServerWithCredential) {
  const { server, credential } = serverWithCred;
  const playQueue = usePlayerStore(s => s.playQueue);
  const addToQueue = usePlayerStore(s => s.addToQueue);
  const playNext = usePlayerStore(s => s.playNext);
  const [playAction] = useSetting("album.play_action", "replace");

  return useCallback(async (album: AlbumRow) => {
    const tracks = await loadAlbumTracksForPlay(server, credential, album);
    if (tracks.length === 0) return;

    const coverArtUrl = album.artwork_url
      ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url, 500)
      : null;

    const trackObjs: CurrentTrack[] = tracks.map(t => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      duration: t.duration,
      coverArtUrl,
      artworkRef: album.artwork_url ?? null,
      album: album.name,
      albumId: album.id,
    }));

    const streamUrlFor = (track: CurrentTrack): string =>
      getStreamUrl(server.url, server.username, credential, stripServerPrefix(track.id, server.id));

    if (playAction === "queue_last") {
      for (const t of trackObjs) addToQueue(t, streamUrlFor);
    } else if (playAction === "queue_next") {
      for (let i = trackObjs.length - 1; i >= 0; i--) playNext(trackObjs[i]!, streamUrlFor);
    } else if (playAction === "shuffle") {
      await playQueue(shuffleArray(trackObjs), streamUrlFor, 0);
    } else {
      await playQueue(trackObjs, streamUrlFor, 0);
    }
  }, [server, credential, playQueue, addToQueue, playNext, playAction]);
}
