import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";
import { fetchAlbumInfo } from "../lib/lastfm";
import { useSetting } from "./useSetting";

export interface AlbumEnrichmentRow {
  album_bio: string | null;
  lastfm_url: string | null;
  album_enriched_at: number | null;
}

function isEnrichmentStale(row: AlbumEnrichmentRow | null, staleDays: number): boolean {
  if (!row || row.album_enriched_at === null) return true;
  return Date.now() - row.album_enriched_at * 1000 > staleDays * 24 * 60 * 60 * 1000;
}

const inFlight = new Map<string, Promise<void>>();

async function enrichAlbum(albumId: string, artist: string, album: string): Promise<void> {
  const info = await fetchAlbumInfo(artist, album);
  const db = await getDb();
  const enrichedAt = info.bio ? Math.floor(Date.now() / 1000) : null;
  await db.execute(
    `INSERT INTO album_identity (album_id, album_bio, lastfm_url, album_enriched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(album_id) DO UPDATE SET
       album_bio = excluded.album_bio,
       lastfm_url = COALESCE(excluded.lastfm_url, album_identity.lastfm_url),
       album_enriched_at = COALESCE(excluded.album_enriched_at, album_identity.album_enriched_at)`,
    [albumId, info.bio, info.url, enrichedAt]
  );
}

export function useEnrichAlbum(albumId: string, artist: string, albumName: string) {
  const queryClient = useQueryClient();
  const [staleDaysStr] = useSetting("tags.staleness_days", "30");
  const staleDays = Number(staleDaysStr) || 30;

  const [isRefreshing, setIsRefreshing] = useState(false);
  const ranRef = useRef(false);

  const query = useQuery({
    queryKey: QK.albumEnrichment(albumId),
    queryFn: async (): Promise<AlbumEnrichmentRow | null> => {
      if (!albumId) return null;
      const db = await getDb();
      const rows = await db.select<AlbumEnrichmentRow[]>(
        "SELECT album_bio, lastfm_url, album_enriched_at FROM album_identity WHERE album_id = ?",
        [albumId]
      );
      return rows[0] ?? null;
    },
    enabled: !!albumId,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (query.isLoading || !albumId || !artist || !albumName) return;
    if (!isEnrichmentStale(query.data ?? null, staleDays)) return;
    if (ranRef.current) return;
    ranRef.current = true;

    if (inFlight.has(albumId)) return;
    const promise = enrichAlbum(albumId, artist, albumName)
      .then(() => queryClient.invalidateQueries({ queryKey: QK.albumEnrichment(albumId) }))
      .catch(() => { /* silent */ })
      .finally(() => inFlight.delete(albumId));
    inFlight.set(albumId, promise);
  }, [query.isLoading, query.data, albumId, artist, albumName, staleDays, queryClient]);

  const refresh = useCallback(async () => {
    if (isRefreshing || !albumId) return;
    setIsRefreshing(true);
    ranRef.current = false;
    try {
      await enrichAlbum(albumId, artist, albumName);
      await queryClient.invalidateQueries({ queryKey: QK.albumEnrichment(albumId) });
    } catch {
      /* silent */
    } finally {
      setIsRefreshing(false);
    }
  }, [albumId, artist, albumName, isRefreshing, queryClient]);

  return { data: query.data ?? null, isLoading: query.isLoading, isRefreshing, refresh };
}
