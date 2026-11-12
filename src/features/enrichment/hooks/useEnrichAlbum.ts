import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDb } from "../../../db";
import { useSetting } from "../../../hooks/useSetting";
import { parseStalenessDays } from "../../../lib/numberSetting";
import { QK } from "../../../lib/queryKeys";
import { fetchAlbumBio } from "../lib/albumBio";
import { useAlbumIdentity } from "./useAlbumIdentity";

export interface AlbumEnrichmentRow {
  album_bio: string | null;
  lastfm_url: string | null;
  album_enriched_at: number | null;
  /** The MusicBrainz match the description was looked up under; Wikipedia is found through it. */
  album_bio_release_group_id: string | null;
}

function isEnrichmentStale(
  row: AlbumEnrichmentRow | null,
  { staleDays, releaseGroupMbid }: { staleDays: number; releaseGroupMbid: string | null },
): boolean {
  if (!row || row.album_enriched_at === null) return true;
  if (row.album_bio_release_group_id !== releaseGroupMbid) return true;
  return Date.now() - row.album_enriched_at * 1000 > staleDays * 24 * 60 * 60 * 1000;
}

const inFlight = new Map<string, Promise<void>>();

interface AlbumToEnrich {
  albumId: string;
  artist: string;
  album: string;
  releaseGroupMbid: string | null;
}

async function enrichAlbum({ albumId, artist, album, releaseGroupMbid }: AlbumToEnrich): Promise<void> {
  const info = await fetchAlbumBio({ artist, album, releaseGroupMbid });
  const db = await getDb();
  const enrichedAt = Math.floor(Date.now() / 1000);
  await db.execute(
    `INSERT INTO album_identity (album_id, album_bio, lastfm_url, album_enriched_at, album_bio_release_group_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(album_id) DO UPDATE SET
       album_bio = excluded.album_bio,
       lastfm_url = COALESCE(excluded.lastfm_url, album_identity.lastfm_url),
       album_enriched_at = excluded.album_enriched_at,
       album_bio_release_group_id = excluded.album_bio_release_group_id`,
    [albumId, info.bio, info.url, enrichedAt, releaseGroupMbid],
  );
}

export function useEnrichAlbum(albumId: string, artist: string, albumName: string) {
  const queryClient = useQueryClient();
  const [staleDaysStr, , isStaleDaysLoaded] = useSetting("tags.staleness_days", "30");
  const staleDays = parseStalenessDays(staleDaysStr);

  const identity = useAlbumIdentity(albumId);
  const releaseGroupMbid = identity.data?.mb_release_group_id ?? null;

  const [isRefreshing, setIsRefreshing] = useState(false);
  // The album and match last enriched on this mount; a new match is a new lookup.
  const ranForRef = useRef<string | null>(null);
  const runKey = `${albumId}\u0000${releaseGroupMbid ?? ""}`;

  const query = useQuery({
    queryKey: QK.albumEnrichment(albumId),
    queryFn: async (): Promise<AlbumEnrichmentRow | null> => {
      if (!albumId) return null;
      const db = await getDb();
      const rows = await db.select<AlbumEnrichmentRow[]>(
        "SELECT album_bio, lastfm_url, album_enriched_at, album_bio_release_group_id FROM album_identity WHERE album_id = ?",
        [albumId],
      );
      return rows[0] ?? null;
    },
    enabled: !!albumId,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!isStaleDaysLoaded || query.isLoading || identity.isPending || !albumId || !artist || !albumName) return;
    if (!isEnrichmentStale(query.data ?? null, { staleDays, releaseGroupMbid })) return;
    if (ranForRef.current === runKey) return;
    ranForRef.current = runKey;

    if (inFlight.has(albumId)) return;
    const promise = enrichAlbum({ albumId, artist, album: albumName, releaseGroupMbid })
      .then(() => queryClient.invalidateQueries({ queryKey: QK.albumEnrichment(albumId) }))
      .catch(() => {
        /* silent */
      })
      .finally(() => inFlight.delete(albumId));
    inFlight.set(albumId, promise);
  }, [
    query.isLoading,
    query.data,
    identity.isPending,
    releaseGroupMbid,
    runKey,
    albumId,
    artist,
    albumName,
    staleDays,
    isStaleDaysLoaded,
    queryClient,
  ]);

  const refresh = useCallback(async () => {
    if (isRefreshing || !albumId) return;
    setIsRefreshing(true);
    ranForRef.current = null;
    try {
      await enrichAlbum({ albumId, artist, album: albumName, releaseGroupMbid });
      await queryClient.invalidateQueries({ queryKey: QK.albumEnrichment(albumId) });
    } catch {
      /* silent */
    } finally {
      setIsRefreshing(false);
    }
  }, [albumId, artist, albumName, releaseGroupMbid, isRefreshing, queryClient]);

  return { data: query.data ?? null, isLoading: query.isLoading, isRefreshing, refresh };
}
