import { useEffect, useRef } from "react";
import { usePlayerStore } from "../store/player";
import type { ServerWithCredential } from "./useServer";
import { savePlayQueue, getPlayQueue, getCoverArtUrl, getStreamUrl } from "../lib/navidrome";
import { getDb } from "../db";
import { stripServerPrefix } from "../utils/ids";

export function useQueueSync(serverWithCred: ServerWithCredential | null | undefined) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const queue = usePlayerStore((s) => s.queue);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const restoredRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore queue from server on first connect (only if nothing is already playing)
  useEffect(() => {
    restoredRef.current = false;
    if (!serverWithCred || isPlaying || currentTrack) return;
    restoredRef.current = true;

    const { server, credential } = serverWithCred;

    void (async () => {
      const saved = await getPlayQueue(server.url, server.username, credential, server.alt_url ?? undefined);
      if (!saved || saved.trackIds.length === 0) return;

      const db = await getDb();
      type TrackMeta = { id: string; title: string; artist: string | null; duration: number | null; album_id: string | null; artwork_url: string | null; album_name: string | null };

      // Batch-fetch all tracks by native ID
      const placeholders = saved.trackIds.map(() => "?").join(",");
      const canonIds = saved.trackIds.map((nid) => `${server.id}:${nid}`);
      const rows = await db.select<TrackMeta[]>(
        `SELECT t.id, t.title, t.artist, t.duration, t.album_id,
                a.artwork_url, a.name AS album_name
         FROM tracks t LEFT JOIN albums a ON a.id = t.album_id
         WHERE t.id IN (${placeholders})`,
        canonIds
      );

      if (rows.length === 0) return;

      // Build an id→row map to preserve queue order
      const rowMap = new Map(rows.map((r) => [r.id, r]));
      const orderedTracks = canonIds
        .map((cid) => rowMap.get(cid))
        .filter((r): r is TrackMeta => r != null);

      if (orderedTracks.length === 0) return;

      const streamUrlFn = (t: { id: string }) =>
        getStreamUrl(server.url, server.username, credential, stripServerPrefix(t.id, server.id));

      const trackObjs = orderedTracks.map((r) => ({
        id: r.id,
        title: r.title,
        artist: r.artist,
        duration: r.duration,
        album: r.album_name ?? null,
        albumId: r.album_id,
        coverArtUrl: r.artwork_url
          ? getCoverArtUrl(server.url, server.username, credential, r.artwork_url, 64)
          : null,
        artworkRef: r.artwork_url,
      }));

      const currentCanonId = saved.currentId ? `${server.id}:${saved.currentId}` : null;
      const startIndex = currentCanonId
        ? trackObjs.findIndex((t) => t.id === currentCanonId)
        : 0;

      await playQueue(trackObjs, streamUrlFn, startIndex >= 0 ? startIndex : 0);

      // Pause immediately after loading, don't autoplay on restore
      usePlayerStore.getState().pause?.();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverWithCred?.server.id]);

  // Save queue to server (debounced 10s)
  useEffect(() => {
    if (!serverWithCred || !currentTrack || queue.length === 0) return;
    const { server, credential } = serverWithCred;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const nativeIds = queue
        .map((t) => {
          const prefix = `${server.id}:`;
          return t.id.startsWith(prefix) ? t.id.slice(prefix.length) : null;
        })
        .filter((id): id is string => id != null);

      const currentNativeId = currentTrack.id.startsWith(`${server.id}:`)
        ? currentTrack.id.slice(server.id.length + 1)
        : null;

      const { elapsed: el } = usePlayerStore.getState();
      void savePlayQueue(
        server.url,
        server.username,
        credential,
        nativeIds,
        currentNativeId,
        Math.round((el ?? 0) * 1000),
        server.alt_url ?? undefined
      );
    }, 10_000);

    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [serverWithCred, currentTrack?.id, queue.length]);

  // Save immediately on visibility change (tab loses focus) or page unload
  useEffect(() => {
    if (!serverWithCred) return;
    const { server, credential } = serverWithCred;

    function saveNow() {
      const { queue: q, currentTrack: ct, elapsed: el } = usePlayerStore.getState();
      if (!ct || q.length === 0) return;
      const prefix = `${server.id}:`;
      const nativeIds = q
        .map((t) => (t.id.startsWith(prefix) ? t.id.slice(prefix.length) : null))
        .filter((id): id is string => id != null);
      const currentNativeId = ct.id.startsWith(prefix) ? ct.id.slice(prefix.length) : null;
      void savePlayQueue(
        server.url,
        server.username,
        credential,
        nativeIds,
        currentNativeId,
        Math.round((el ?? 0) * 1000),
        server.alt_url ?? undefined
      );
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") saveNow();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", saveNow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", saveNow);
    };
  }, [serverWithCred?.server.id]);
}
