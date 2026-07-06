/**
 * On-open artist enrichment from Last.fm.
 *
 * On mount, checks if the artist_identity row is stale (enriched_at older than
 * staleness_days, or missing). If stale, fetches artist.getInfo and persists:
 * bio, listeners, playcount, similar artists, top tags, image URL, enriched_at.
 *
 * MB columns (mb_artist_id, lastfm_artist_name, confirmed_at) are preserved.
 * Failures are silent, the hook never throws to the UI.
 *
 * Returns { data, isLoading, isRefreshing, error, refresh }.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";
import { fetchArtistInfo } from "../lib/lastfm";
import { fetchArtistReleaseGroupTitles, fetchWikidataImageByMbid, searchArtists } from "../lib/musicbrainz";
import { similarity } from "../lib/fuzzy-match";
import { getFanartApiKey, fetchFanartTvImageByMbid } from "../lib/fanart";
import { fetchTheAudioDbArtist, fetchWikipediaBio, fetchWikipediaBioByMbid } from "../lib/theaudiodb";
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

/**
 * When MB returns multiple artist candidates, score each against the user's
 * local album titles. The candidate whose release groups best overlap with
 * local albums (score ≥ 0.5, gap ≥ 0.15 to second place) is auto-confirmed
 * and its MBID is persisted with confirmed_at.
 */
async function disambiguateArtistByLocalAlbums(
  artistName: string,
  candidates: import("../lib/musicbrainz").MbArtistCandidate[],
): Promise<string | null> {
  const db = await getDb();
  const localRows = await db.select<{ name: string }[]>(
    `SELECT name FROM albums
     WHERE artist = ?
        OR artist IN (SELECT alias_name FROM artist_aliases WHERE canonical_name = ?)
     LIMIT 50`,
    [artistName, artistName]
  );
  const localAlbums = localRows.map((r) => r.name);
  if (localAlbums.length === 0) {
    // Not in the library, no album overlap to verify against. Use the closest
    // name match anyway (not persisted as confirmed) so portrait art still resolves
    // for "fans also like" style artists instead of silently giving up, but still
    // require a reasonable name match to avoid attaching an unrelated artist's identity.
    const ranked = candidates
      .map((c) => ({ id: c.id, sim: similarity(c.name, artistName) }))
      .sort((a, b) => b.sim - a.sim);
    const top = ranked[0];
    return top && top.sim >= 0.5 ? top.id : null;
  }

  // Pre-filter by name similarity; only probe top 3 to limit MB requests
  const ranked = candidates
    .map((c) => ({ candidate: c, nameSim: similarity(c.name, artistName) }))
    .filter((x) => x.nameSim >= 0.5)
    .sort((a, b) => b.nameSim - a.nameSim)
    .slice(0, 3);
  if (ranked.length === 0) return null;

  const scored = (await Promise.all(
    ranked.map(async ({ candidate }) => {
      try {
        const rgTitles = await fetchArtistReleaseGroupTitles(candidate.id);
        if (rgTitles.length === 0) return null;
        // Average best-match score for each local album against candidate's release groups
        let total = 0;
        for (const localName of localAlbums) {
          const best = Math.max(...rgTitles.map((t) => similarity(localName, t)));
          total += best;
        }
        return { id: candidate.id, score: total / localAlbums.length };
      } catch {
        return null;
      }
    })
  )).filter((s): s is { id: string; score: number } => s !== null);
  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const second = scored[1];
  if (best.score >= 0.5 && (!second || best.score - second.score >= 0.15)) {
    await db.execute(
      `INSERT INTO artist_identity (artist_name, mb_artist_id, confirmed_at)
       VALUES (?, ?, ?)
       ON CONFLICT(artist_name) DO UPDATE SET
         mb_artist_id = excluded.mb_artist_id,
         confirmed_at = excluded.confirmed_at`,
      [artistName, best.id, Math.floor(Date.now() / 1000)]
    );
    return best.id;
  }
  return null;
}

async function enrichArtist(
  artistName: string,
  lastfmName: string,
  mbArtistId: string | null,
  hasWikidataImage: boolean,
): Promise<void> {
  // Auto-resolve MBID when unconfirmed, so portrait can be fetched without manual Identify.
  // Only attempt when no MBID is set and no image is cached.
  // Single match → use directly. Multiple matches → score against local albums to pick best.
  let resolvedMbid = mbArtistId;
  if (!resolvedMbid && !hasWikidataImage) {
    try {
      const candidates = await searchArtists(artistName);
      if (candidates.length === 1) {
        resolvedMbid = candidates[0]!.id;
      } else if (candidates.length > 1) {
        resolvedMbid = await disambiguateArtistByLocalAlbums(artistName, candidates);
      }
    } catch {
      // silent, portrait stays absent if MB is unreachable
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

  // Bio + portrait fallbacks: TheAudioDB and Wikipedia fetched in parallel when Last.fm returns nothing
  let finalBio = info.bio;
  if (!finalBio) {
    const [adbResult, wikiBio] = await Promise.all([
      fetchTheAudioDbArtist(artistName).catch(() => null),
      // Prefer MBID-based Wikipedia lookup to avoid wrong-artist matches on ambiguous names (e.g. "Ye")
      resolvedMbid
        ? fetchWikipediaBioByMbid(resolvedMbid).catch(() => fetchWikipediaBio(artistName).catch(() => null))
        : fetchWikipediaBio(artistName).catch(() => null),
    ]);
    if (adbResult) {
      finalBio = adbResult.bio;
      if (!imageUrl && !hasWikidataImage && adbResult.thumbUrl) {
        imageUrl = adbResult.thumbUrl;
      }
    }
    if (!finalBio) finalBio = wikiBio;
  }

  const db = await getDb();
  // Only stamp enriched_at when Last.fm returned primary data, keeps the row retryable
  // when only a fallback bio (TheAudioDB/Wikipedia) was found, so stats/similar can still be fetched.
  const gotData = !!(info.bio || info.listeners || info.similar.length > 0);
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

export function useEnrichArtist(artistName: string, options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
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
    if (!enabled || query.isLoading || !artistName) return;
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
  }, [enabled, query.isLoading, query.data, artistName, staleDays, queryClient]);

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
