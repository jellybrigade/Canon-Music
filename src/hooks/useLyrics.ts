import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { fetchLyrics } from "../lib/lrclib";
import { fetchLyricsBySongId, getStoredOpenSubsonicExtensions } from "../lib/navidrome";
import { fetchLyricsOvh } from "../lib/lyrics-ovh";
import { QK } from "../lib/query-keys";
import { stripServerPrefix } from "../utils/ids";
import type { ServerWithCredential } from "./useServer";
import type { CurrentTrack } from "../store/player";

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
      type CacheRow = { plain: string | null; synced: string | null };
      const cached = await db.select<CacheRow[]>(
        "SELECT plain, synced FROM lyrics WHERE track_id = ?",
        [track.id]
      );
      // A row with both columns null is an offset-only row left behind by `refresh`, which
      // clears the lyrics but keeps the timing the user dialled in. Treating its presence as a
      // cache hit would make the refresh it was written by return "no lyrics" forever.
      if (cached.length > 0 && (cached[0]!.plain || cached[0]!.synced)) {
        return { plain: cached[0]!.plain, synced: cached[0]!.synced };
      }

      // Try server-side lyrics (OpenSubsonic getLyricsBySongId) before falling back to LRClib
      if (serverWithCredential) {
        const { server, credential } = serverWithCredential;
        const extensions = await getStoredOpenSubsonicExtensions(server.id);
        const navTrackId = stripServerPrefix(track.id, server.id);
        const serverLyrics = extensions.includes("songLyrics")
          ? await fetchLyricsBySongId(server.url, server.username, credential, navTrackId, server.alt_url ?? undefined)
          : null;
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
      }).catch(() => null);

      let plain = lrclibResult?.plain ?? null;
      let synced = lrclibResult?.synced ?? null;
      let source = "lrclib";

      if (!plain && !synced) {
        const ovhPlain = await fetchLyricsOvh(track.artist, track.title).catch(() => null);
        if (ovhPlain) {
          plain = ovhPlain;
          source = "lyrics.ovh";
        }
      }

      await db.execute(
        `INSERT INTO lyrics (track_id, plain, synced, source, fetched_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(track_id) DO UPDATE SET
           plain = excluded.plain,
           synced = excluded.synced,
           source = excluded.source,
           fetched_at = excluded.fetched_at`,
        [track.id, plain, synced, source]
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
      "UPDATE lyrics SET plain = NULL, synced = NULL WHERE track_id = ?",
      [track.id]
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
       VALUES (?, NULL, NULL, 'manual', datetime('now'), ?)
       ON CONFLICT(track_id) DO UPDATE SET offset_ms = excluded.offset_ms`,
      [track.id, ms]
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
