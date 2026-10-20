import { useCallback } from "react";
import { getCoverArtUrl } from "../clients/navidromeUrls";
import { usePlayerStore } from "../features/playback/store/player";
import type { CurrentTrack } from "../features/playback/store/playerTypes";
import { loadAlbumTracksForPlay } from "../lib/albumTracks";
import { replayGainFromRow } from "../lib/replayGainRow";
import { shuffleArray } from "../lib/shuffle";
import { makeStreamUrlBuilder } from "../lib/track";
import type { AlbumRow } from "../types/library";
import type { ServerWithCredential } from "./useServer";
import { useSetting } from "./useSetting";

/** Always appends the album's tracks to the end of the queue (no setting override). */
export function useAddAlbumToQueue(serverWithCred: ServerWithCredential) {
  const { server, credential } = serverWithCred;
  const addToQueue = usePlayerStore((s) => s.addToQueue);

  return useCallback(
    async (album: AlbumRow) => {
      const tracks = await loadAlbumTracksForPlay(server, credential, album);
      if (tracks.length === 0) return;
      const coverArtUrl = album.artwork_url
        ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url, 500)
        : null;
      const streamUrlFor = makeStreamUrlBuilder(server, credential);
      for (const t of tracks) {
        addToQueue(
          {
            id: t.id,
            title: t.title,
            artist: t.artist,
            duration: t.duration,
            coverArtUrl,
            artworkRef: album.artwork_url ?? null,
            album: album.name,
            albumId: album.id,
            replayGain: replayGainFromRow(t),
          },
          streamUrlFor,
        );
      }
    },
    [server, credential, addToQueue],
  );
}

// Undefined while the credential loads; playing then does nothing, as the play buttons are not shown yet.
export function usePlayAlbum(serverWithCred: ServerWithCredential | undefined) {
  const server = serverWithCred?.server;
  const credential = serverWithCred?.credential;
  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const [playAction] = useSetting("album.play_action", "replace");

  return useCallback(
    async (album: AlbumRow) => {
      if (!server || !credential) return;
      const tracks = await loadAlbumTracksForPlay(server, credential, album);
      if (tracks.length === 0) return;

      const coverArtUrl = album.artwork_url
        ? getCoverArtUrl(server.url, server.username, credential, album.artwork_url, 500)
        : null;

      const trackObjs: CurrentTrack[] = tracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        duration: t.duration,
        coverArtUrl,
        artworkRef: album.artwork_url ?? null,
        album: album.name,
        albumId: album.id,
        replayGain: replayGainFromRow(t),
      }));

      const streamUrlFor = makeStreamUrlBuilder(server, credential);

      if (playAction === "queue_last") {
        for (const t of trackObjs) addToQueue(t, streamUrlFor);
      } else if (playAction === "queue_next") {
        for (let i = trackObjs.length - 1; i >= 0; i--) playNext(trackObjs[i]!, streamUrlFor);
      } else if (playAction === "shuffle") {
        await playQueue(shuffleArray(trackObjs), streamUrlFor, 0);
      } else {
        await playQueue(trackObjs, streamUrlFor, 0);
      }
    },
    [server, credential, playQueue, addToQueue, playNext, playAction],
  );
}
