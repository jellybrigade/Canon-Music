import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../../../db";
import { fetchLyrics } from "../../../clients/lrclib";
import { fetchLyricsBySongId, getStoredOpenSubsonicExtensions } from "../../../clients/navidrome";
import { fetchLyricsOvh } from "../../../clients/lyricsOvh";
import { QK } from "../../../lib/queryKeys";
import { stripServerPrefix } from "../../../lib/ids";
import type { ServerWithCredential } from "../../../hooks/useServer";
import type { CurrentTrack } from "../store/playerTypes";

// Distinguishes "asked every source, found nothing" from "row exists only for offset_ms";
// both lyric columns are NOT NULL so the distinction must live in a value.
const NO_LOOKUP_SOURCE = "cleared";

export interface LyricsOverride {
  artist: string;
  title: string;
}

interface LyricsResult {
  plain: string | null;
  synced: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  offsetMs: number;
  setOffsetMs: (ms: number) => Promise<void>;
}

export function useLyrics(
  track: CurrentTrack | null,
  override?: LyricsOverride | null,
  serverWithCredential?: ServerWithCredential | null,
): LyricsResult {
  const queryClient = useQueryClient();
  const overrideArtist = override?.artist ?? null;
  const overrideTitle = override?.title ?? null;

  const query = useQuery({
    queryKey: QK.lyrics(track?.id ?? null, overrideArtist, overrideTitle),
    enabled: !!track,
    queryFn: async (): Promise<{ plain: string | null; synced: string | null }> => {
      if (!track) return { plain: null, synced: null };

      const db = await getDb();

      // Manual search: persist override result so it survives remounts
      if (overrideArtist && overrideTitle) {
        const result = await fetchLyrics({
          artist: overrideArtist,
          album: track.album ?? "",
          title: overrideTitle,
          durationSec: track.duration ?? null,
        }).catch(() => null);
        const plain = result?.plain ?? null;
        const synced = result?.synced ?? null;
        if (plain || synced) {
          await db.execute(
            `INSERT INTO lyrics (track_id, plain, synced, source, fetched_at)
             VALUES (?, ?, ?, 'lrclib', datetime('now'))
             ON CONFLICT(track_id) DO UPDATE SET
               plain = excluded.plain,
               synced = excluded.synced,
               source = excluded.source,
               fetched_at = excluded.fetched_at`,
            [track.id, plain, synced]
          );
        }
        return { plain, synced };
      }
      type CacheRow = { plain: string | null; synced: string | null; source: string };
      const cached = await db.select<CacheRow[]>(
        "SELECT plain, synced, source FROM lyrics WHERE track_id = ?",
        [track.id]
      );
      // A completed lookup that found nothing is still a cache hit, otherwise every open of
      // the tab re-asks three services for tracks that will never have lyrics.
      const hit = cached[0];
      if (hit && (hit.plain || hit.synced || hit.source !== NO_LOOKUP_SOURCE)) {
        return { plain: hit.plain, synced: hit.synced };
      }

      // A null extension list means the probe hasn't answered yet (not asked, not declined);
      // the write below must not record a completed lookup in that case.
      let everySourceAnswered = true;
      if (serverWithCredential) {
        const { server, credential } = serverWithCredential;
        const extensions = await getStoredOpenSubsonicExtensions(server.id);
        if (extensions === null) everySourceAnswered = false;
        const navTrackId = stripServerPrefix(track.id, server.id);
        const serverLyrics = extensions?.includes("songLyrics")
          ? await fetchLyricsBySongId(server.url, server.username, credential, navTrackId, server.alt_url ?? undefined)
              .catch(() => undefined)
          : null;
        if (serverLyrics === undefined) everySourceAnswered = false;
        if (serverLyrics && (serverLyrics.plain || serverLyrics.synced)) {
          await db.execute(
            `INSERT INTO lyrics (track_id, plain, synced, source, fetched_at)
             VALUES (?, ?, ?, 'navidrome', datetime('now'))
             ON CONFLICT(track_id) DO UPDATE SET
               plain = excluded.plain,
               synced = excluded.synced,
               source = excluded.source,
               fetched_at = excluded.fetched_at`,
            [track.id, serverLyrics.plain, serverLyrics.synced]
          );
          return serverLyrics;
        }
      }

      if (!track.artist || !track.album) return { plain: null, synced: null };

      const lrclibResult = await fetchLyrics({
        artist: track.artist,
        album: track.album,
        title: track.title,
        durationSec: track.duration ?? null,
      }).catch(() => undefined);
      if (lrclibResult === undefined) everySourceAnswered = false;

      let plain = lrclibResult?.plain ?? null;
      let synced = lrclibResult?.synced ?? null;
      let source = "lrclib";

      if (!plain && !synced) {
        const ovhPlain = await fetchLyricsOvh(track.artist, track.title).catch(() => undefined);
        if (ovhPlain === undefined) everySourceAnswered = false;
        if (ovhPlain) {
          plain = ovhPlain;
          source = "lyrics.ovh";
        }
      }

      // Only a lookup that every source answered may record "found nothing" as final; a source
      // that was offline or failed has not said the track has no lyrics.
      const storedSource = plain || synced || everySourceAnswered ? source : NO_LOOKUP_SOURCE;
      await db.execute(
        `INSERT INTO lyrics (track_id, plain, synced, source, fetched_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(track_id) DO UPDATE SET
           plain = excluded.plain,
           synced = excluded.synced,
           source = excluded.source,
           fetched_at = excluded.fetched_at`,
        [track.id, plain, synced, storedSource]
      );

      return { plain, synced };
    },
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });

  const refresh = useCallback(async () => {
    if (!track) return;
    const db = await getDb();
    // Clears the lyrics without dropping the row: `offset_ms` is the user's own work, and a
    // DELETE threw it away every time they re-fetched a badly-timed set of lyrics, which is
    // exactly when they had already spent effort lining it up.
    await db.execute(
      "UPDATE lyrics SET plain = NULL, synced = NULL, source = ? WHERE track_id = ?",
      [NO_LOOKUP_SOURCE, track.id]
    );
    await queryClient.invalidateQueries({ queryKey: QK.lyricsTrack(track.id) });
  }, [track, queryClient]);

  const [offsetMs, setOffsetMsState] = useState(0);

  useEffect(() => {
    if (!track) { setOffsetMsState(0); return; }
    let cancelled = false;
    getDb()
      .then((db) => db.select<{ offset_ms: number }[]>("SELECT offset_ms FROM lyrics WHERE track_id = ?", [track.id]))
      .then((rows) => { if (!cancelled) setOffsetMsState(rows[0]?.offset_ms ?? 0); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [track?.id]);

  const setOffsetMs = useCallback(async (ms: number) => {
    if (!track) return;
    setOffsetMsState(ms);
    const db = await getDb();
    await db.execute(
      `INSERT INTO lyrics (track_id, plain, synced, source, fetched_at, offset_ms)
       VALUES (?, NULL, NULL, ?, datetime('now'), ?)
       ON CONFLICT(track_id) DO UPDATE SET offset_ms = excluded.offset_ms`,
      [track.id, NO_LOOKUP_SOURCE, ms]
    );
  }, [track?.id]);

  return {
    plain: query.data?.plain ?? null,
    synced: query.data?.synced ?? null,
    loading: query.isFetching,
    refresh,
    offsetMs,
    setOffsetMs,
  };
}
