import { useEffect, useRef } from "react";
import { usePlayerStore } from "../store/player";
import type { ServerWithCredential } from "./useServer";
import { savePlayQueue, getPlayQueue, getCoverArtUrl, getStreamUrl } from "../lib/navidrome";
import { getDb } from "../db";
import { stripServerPrefix } from "../utils/ids";

export function useQueueSync(serverWithCred: ServerWithCredential | null | undefined) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const queue = usePlayerStore((s) => s.queue);
  const restoreQueue = usePlayerStore((s) => s.restoreQueue);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore queue from server on first connect (only if nothing is already playing)
  useEffect(() => {
    if (!serverWithCred || isPlaying || currentTrack) return;

    const { server, credential } = serverWithCred;

    void (async () => {
      const db = await getDb();

      // "Restore queue on startup" is a single user-facing setting, so it has to gate the
      // server-side restore too. Only loadSettings honoured it, which meant turning the
      // setting off suppressed the local snapshot and then let the server put the queue
      // straight back.
      const settingRows = await db.select<{ value: string }[]>(
        "SELECT value FROM settings WHERE key = 'queue.restore_on_startup'",
        []
      );
      if (settingRows[0]?.value !== "true") return;

      const saved = await getPlayQueue(server.url, server.username, credential, server.alt_url ?? undefined);
      if (!saved || saved.trackIds.length === 0) return;

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

      // The "nothing is playing" check above ran before a network round trip and two DB reads.
      // loadSettings' own queue_state restore can land inside that window, and restoreQueue
      // would overwrite it. Whoever got there first wins.
      if (usePlayerStore.getState().currentTrack) return;

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

      // Seeds the queue only. Loading the track here would download and decode it at startup
      // for playback the user never asked for, and the pause that followed had to win a race
      // against the download thread appending to the sink.
      restoreQueue(trackObjs, streamUrlFn, startIndex >= 0 ? startIndex : 0);
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
    // Depends on the queue array itself, not its length: a reorder, or a removal paired with
    // an addition, changes the queue without changing how long it is, and keying on length
    // meant the server kept the stale order.
  }, [serverWithCred, currentTrack?.id, queue]);

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
