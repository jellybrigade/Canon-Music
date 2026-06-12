import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { fetchLyrics } from "../lib/lrclib";
import { fetchLyricsBySongId } from "../lib/navidrome";
import { stripServerPrefix } from "../lib/ids";
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
    queryKey: ["lyrics", track?.id ?? null, overrideArtist, overrideTitle],
    enabled: !!track,
    queryFn: async (): Promise<{ plain: string | null; synced: string | null }> => {
      if (!track) return { plain: null, synced: null };

      // Manual search: skip cache, fetch LRCLib with override params (session-only, not persisted)
      if (overrideArtist && overrideTitle) {
        const result = await fetchLyrics({
          artist: overrideArtist,
          album: track.album ?? "",
          title: overrideTitle,
          durationSec: track.duration ?? null,
        }).catch(() => null);
        return { plain: result?.plain ?? null, synced: result?.synced ?? null };
      }

      const db = await getDb();
      type CacheRow = { plain: string | null; synced: string | null };
      const cached = await db.select<CacheRow[]>(
        "SELECT plain, synced FROM lyrics WHERE track_id = ?",
        [track.id]
      );
      if (cached.length > 0) {
        return { plain: cached[0]!.plain, synced: cached[0]!.synced };
      }

      // Try server-side lyrics (OpenSubsonic getLyricsBySongId) before falling back to LRClib
      if (serverWithCredential) {
        const { server, credential } = serverWithCredential;
        const navTrackId = stripServerPrefix(track.id, server.id);
        const serverLyrics = await fetchLyricsBySongId(server.url, server.username, credential, navTrackId);
        if (serverLyrics && (serverLyrics.plain || serverLyrics.synced)) {
          await db.execute(
            `INSERT OR REPLACE INTO lyrics (track_id, plain, synced, source, fetched_at)
             VALUES (?, ?, ?, 'navidrome', datetime('now'))`,
            [track.id, serverLyrics.plain, serverLyrics.synced]
          );
          return serverLyrics;
        }
      }

      if (!track.artist || !track.album) return { plain: null, synced: null };

      const result = await fetchLyrics({
        artist: track.artist,
        album: track.album,
        title: track.title,
        durationSec: track.duration ?? null,
      }).catch(() => null);

      const plain = result?.plain ?? null;
      const synced = result?.synced ?? null;

      await db.execute(
        `INSERT OR REPLACE INTO lyrics (track_id, plain, synced, source, fetched_at)
         VALUES (?, ?, ?, 'lrclib', datetime('now'))`,
        [track.id, plain, synced]
      );

      return { plain, synced };
    },
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });

  const refresh = useCallback(async () => {
    if (!track) return;
    const db = await getDb();
    await db.execute("DELETE FROM lyrics WHERE track_id = ?", [track.id]);
    await queryClient.invalidateQueries({ queryKey: ["lyrics", track.id] });
  }, [track, overrideArtist, overrideTitle, queryClient]);

  return {
    plain: query.data?.plain ?? null,
    synced: query.data?.synced ?? null,
    loading: query.isFetching,
    refresh,
  };
}
