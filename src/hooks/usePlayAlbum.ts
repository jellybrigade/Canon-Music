import { useCallback } from "react";
import { getDb } from "../db";
import type { AlbumRow } from "./useAlbums";
import type { ServerWithCredential } from "./useServer";
import type { CurrentTrack } from "../store/player";
import { usePlayerStore } from "../store/player";
import { useSetting } from "./useSetting";
import { getCoverArtUrl, getStreamUrl } from "../lib/navidrome";
import { stripServerPrefix } from "../lib/ids";

interface MinTrack {
  id: string;
  title: string;
  artist: string | null;
  duration: number | null;
}

export function usePlayAlbum(serverWithCred: ServerWithCredential) {
  const { server, credential } = serverWithCred;
  const playQueue = usePlayerStore(s => s.playQueue);
  const addToQueue = usePlayerStore(s => s.addToQueue);
  const playNext = usePlayerStore(s => s.playNext);
  const [playAction] = useSetting("album.play_action", "replace");

  return useCallback(async (album: AlbumRow) => {
    const db = await getDb();
    const tracks = await db.select<MinTrack[]>(
      `SELECT id, title, artist, duration
       FROM tracks WHERE album_id = ?
       ORDER BY disc_number, track_number`,
      [album.id]
    );
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
      const shuffled = [...trackObjs].sort(() => Math.random() - 0.5);
      await playQueue(shuffled, streamUrlFor, 0);
    } else {
      await playQueue(trackObjs, streamUrlFor, 0);
    }
  }, [server, credential, playQueue, addToQueue, playNext, playAction]);
}
