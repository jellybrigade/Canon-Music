/**
 * On-open artist enrichment from Last.fm.
 *
 * On mount, checks if the artist_identity row is stale (enriched_at older than
 * staleness_days, or missing). If stale, fetches artist.getInfo and persists:
 * bio, listeners, playcount, similar artists, top tags, image URL, enriched_at.
 *
 * MB columns (mb_artist_id, lastfm_artist_name, confirmed_at) are preserved.
 * Failures are silent — the hook never throws to the UI.
 *
 * Returns { data, isLoading, isRefreshing, error, refresh }.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";
import { fetchArtistInfo } from "../lib/lastfm";
import { fetchWikidataImageByMbid, searchArtists } from "../lib/musicbrainz";
import { getFanartApiKey, fetchFanartTvImageByMbid } from "../lib/fanart";
import { fetchTheAudioDbArtist, fetchWikipediaBio } from "../lib/theaudiodb";
import { useSetting } from "./useSetting";

export interface ArtistEnrichmentRow {
  artist_name: string;
  mb_artist_id: string | null;
  lastfm_artist_name: string | null;
  confirmed_at: number | null;
  bio: string | null;
  listeners: number | null;
  playcount: number | null;
  similar_json: string | null;   // JSON string[]
  top_tags_json: string | null;  // JSON string[]
  lastfm_image_url: string | null;
  wikidata_image_url: string | null;
  enriched_at: number | null;
}

function isEnrichmentStale(row: ArtistEnrichmentRow | null, staleDays: number): boolean {
  if (!row || row.enriched_at === null) return true;
  return Date.now() - row.enriched_at * 1000 > staleDays * 24 * 60 * 60 * 1000;
}

const inFlight = new Map<string, Promise<void>>();

async function enrichArtist(
  artistName: string,
  lastfmName: string,
  mbArtistId: string | null,
  hasWikidataImage: boolean,
): Promise<void> {
  // Auto-resolve MBID when unconfirmed, so portrait can be fetched without manual Identify.
  // Only attempt when no MBID is set and no image is cached. Single match = safe to use.
  let resolvedMbid = mbArtistId;
  if (!resolvedMbid && !hasWikidataImage) {
    try {
      const candidates = await searchArtists(artistName);
      if (candidates.length === 1) resolvedMbid = candidates[0]!.id;
    } catch {
      // silent — portrait stays absent if MB is unreachable
    }
  }

  const [info, wikidataImageUrl] = await Promise.all([
    fetchArtistInfo(lastfmName),
    resolvedMbid && !hasWikidataImage ? fetchWikidataImageByMbid(resolvedMbid) : Promise.resolve(null),
  ]);
  let imageUrl = wikidataImageUrl;
  if (!imageUrl && !hasWikidataImage && resolvedMbid) {
    const fanartKey = await getFanartApiKey();
    if (fanartKey) imageUrl = await fetchFanartTvImageByMbid(resolvedMbid, fanartKey);
  }

  // Bio + portrait fallbacks: TheAudioDB then Wikipedia when Last.fm returns nothing
  let finalBio = info.bio;
  if (!finalBio) {
    const adbResult = await fetchTheAudioDbArtist(artistName).catch(() => null);
    if (adbResult) {
      finalBio = adbResult.bio;
      if (!imageUrl && !hasWikidataImage && adbResult.thumbUrl) {
        imageUrl = adbResult.thumbUrl;
      }
    }
    if (!finalBio) {
      finalBio = await fetchWikipediaBio(artistName).catch(() => null);
    }
  }

  const db = await getDb();
  // Only mark as enriched when we actually got data — avoids locking out retries on API failure
  const gotData = !!(finalBio || info.listeners || info.similar.length > 0);
  const enrichedAt = gotData ? Math.floor(Date.now() / 1000) : null;

  await db.execute(
    `INSERT INTO artist_identity
       (artist_name, mb_artist_id, lastfm_artist_name, confirmed_at,
        bio, listeners, playcount, similar_json, top_tags_json, lastfm_image_url,
        wikidata_image_url, enriched_at)
     VALUES (?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(artist_name) DO UPDATE SET
       bio = excluded.bio,
       listeners = excluded.listeners,
       playcount = excluded.playcount,
       similar_json = excluded.similar_json,
       top_tags_json = excluded.top_tags_json,
       lastfm_image_url = excluded.lastfm_image_url,
       wikidata_image_url = COALESCE(excluded.wikidata_image_url, artist_identity.wikidata_image_url),
       enriched_at = COALESCE(excluded.enriched_at, artist_identity.enriched_at)`,
    [
      artistName,
      finalBio,
      info.listeners,
      info.playcount,
      info.similar.length > 0 ? JSON.stringify(info.similar) : null,
      info.topTags.length > 0 ? JSON.stringify(info.topTags) : null,
      info.imageUrl,
      imageUrl,
      enrichedAt,
    ]
  );
}

export function useEnrichArtist(artistName: string) {
  const queryClient = useQueryClient();
  const [staleDaysStr] = useSetting("tags.staleness_days", "30");
  const staleDays = Number(staleDaysStr) || 30;

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ranRef = useRef(false);

  const query = useQuery({
    queryKey: QK.artistEnrichment(artistName),
    queryFn: async (): Promise<ArtistEnrichmentRow | null> => {
      if (!artistName) return null;
      const db = await getDb();
      const rows = await db.select<ArtistEnrichmentRow[]>(
        "SELECT * FROM artist_identity WHERE artist_name = ?",
        [artistName]
      );
      return rows[0] ?? null;
    },
    enabled: !!artistName,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (query.isLoading || !artistName) return;
    if (!isEnrichmentStale(query.data ?? null, staleDays)) return;
    if (ranRef.current) return;
    ranRef.current = true;

    const lastfmName = query.data?.lastfm_artist_name ?? artistName;
    const mbArtistId = query.data?.mb_artist_id ?? null;
    const hasWikidataImage = !!(query.data?.wikidata_image_url);

    if (inFlight.has(artistName)) return;
    const promise = enrichArtist(artistName, lastfmName, mbArtistId, hasWikidataImage)
      .then(() => queryClient.invalidateQueries({ queryKey: QK.artistEnrichment(artistName) }))
      .catch(() => { /* silent */ })
      .finally(() => inFlight.delete(artistName));
    inFlight.set(artistName, promise);
  }, [query.isLoading, query.data, artistName, staleDays, queryClient]);

  const refresh = useCallback(async () => {
    if (isRefreshing || !artistName) return;
    setIsRefreshing(true);
    setError(null);
    ranRef.current = false;
    const lastfmName = query.data?.lastfm_artist_name ?? artistName;
    const mbArtistId = query.data?.mb_artist_id ?? null;
    const hasWikidataImage = !!(query.data?.wikidata_image_url);
    try {
      await enrichArtist(artistName, lastfmName, mbArtistId, hasWikidataImage);
      await queryClient.invalidateQueries({ queryKey: QK.artistEnrichment(artistName) });
    } catch (e) {
      console.error("[useEnrichArtist] refresh failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRefreshing(false);
    }
  }, [artistName, isRefreshing, query.data, queryClient]);

  return { data: query.data ?? null, isLoading: query.isLoading, isRefreshing, error, refresh };
}
