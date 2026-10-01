// On open, refreshes a stale artist_identity row from Last.fm artist.getInfo, preserving
// MB columns. Failures are silent.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../../../db";
import { QK } from "../../../lib/queryKeys";
import { fetchArtistInfo } from "../../../clients/lastfm";
import { fetchArtistReleaseGroupTitles, fetchWikidataImageByMbid, searchArtists } from "../../../clients/musicbrainz";
import { similarity } from "../lib/fuzzyMatch";
import {
  ARTIST_AUTO_SELECT_SETTING,
  DEFAULT_ARTIST_AUTO_SELECT_SCORE,
  parseArtistAutoSelectScore,
  pickConfidentArtist,
} from "../lib/artistAutoSelect";
import { getFanartApiKey, fetchFanartTvImageByMbid } from "../../../clients/fanart";
import { fetchTheAudioDbArtist, fetchWikipediaBio, fetchWikipediaBioByMbid } from "../../../clients/theaudiodb";
import { getArtistImageFromServer } from "../../../clients/navidrome";
import { stripServerPrefix } from "../../../lib/ids";
import type { ServerWithCredential } from "../../../hooks/useServer";
import { useSetting } from "../../../hooks/useSetting";
import { useArtistBrowseSessionStore } from "../../../store/artistBrowseSessionStore";

/** Probes a URL via Image() (sidesteps CORS, unlike fetch) so a server-scraped
 * portrait that 404s (no image on file) never reaches the cache/UI as a broken image. */
function probeImageLoads(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/** Looks up the artist's native (unprefixed) id on the given server, for the
 * getArtistInfo2 portrait fallback. Returns null if the artist isn't synced locally. */
async function findNativeArtistId(artistName: string, serverId: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ id: string }[]>(
    `SELECT id FROM artists WHERE server_id = ? AND name = ?
     UNION
     SELECT a.id FROM artists a
     JOIN artist_aliases al ON al.canonical_name = a.name
     WHERE a.server_id = ? AND al.alias_name = ?
     LIMIT 1`,
    [serverId, artistName, serverId, artistName]
  );
  const row = rows[0];
  return row ? stripServerPrefix(row.id, serverId) : null;
}

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
  navidrome_image_url: string | null;
  enriched_at: number | null;
}

function isEnrichmentStale(row: ArtistEnrichmentRow | null, staleDays: number): boolean {
  if (!row || row.enriched_at === null) return true;
  return Date.now() - row.enriched_at * 1000 > staleDays * 24 * 60 * 60 * 1000;
}

const inFlight = new Map<string, Promise<void>>();

// Session-scoped so an in-library artist with no confident match costs one search per launch.
const identifyAttempted = new Set<string>();

export function __resetIdentifyAttempts(): void {
  identifyAttempted.clear();
}

// Bounds chains fanning out per rendered artist card; uncapped, quick browsing
// stacks unbounded concurrent chains with no cancellation and crashes the app.
const MAX_CONCURRENT_ENRICH = 3;
const MAX_QUEUED_ENRICH = 24;
let activeEnrichCount = 0;
const enrichQueue: Array<() => void> = [];

function acquireEnrichSlot(): Promise<void> | null {
  if (activeEnrichCount < MAX_CONCURRENT_ENRICH) {
    activeEnrichCount++;
    return Promise.resolve();
  }
  if (enrichQueue.length >= MAX_QUEUED_ENRICH) return null;
  return new Promise((resolve) => {
    enrichQueue.push(() => {
      activeEnrichCount++;
      resolve();
    });
  });
}

function releaseEnrichSlot(): void {
  activeEnrichCount--;
  const next = enrichQueue.shift();
  if (next) next();
}

/** Scores MB artist candidates against local album titles; auto-confirms the best (score >= 0.5, gap >= 0.15). */
async function disambiguateArtistByLocalAlbums(
  artistName: string,
  candidates: import("../../../clients/musicbrainz").MbArtistCandidate[],
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
  if (localAlbums.length === 0) return null;

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

interface EnrichArtistOptions {
  artistName: string;
  lastfmName: string;
  mbArtistId: string | null;
  hasWikidataImage: boolean;
  serverWithCredential: ServerWithCredential | null;
  minAutoSelectScore: number;
}

async function enrichArtist({
  artistName,
  lastfmName,
  mbArtistId,
  hasWikidataImage,
  serverWithCredential,
  minAutoSelectScore,
}: EnrichArtistOptions): Promise<{ isIdentityLookupIncomplete: boolean }> {
  // Auto-resolve MBID when unconfirmed, so portrait can be fetched without manual Identify.
  // A confident MusicBrainz score wins outright; otherwise local album overlap decides.
  let resolvedMbid = mbArtistId;
  // A failed source has not said there is no portrait, so the run must stay retryable.
  let isPortraitLookupIncomplete = false;
  const markIncomplete = (): null => {
    isPortraitLookupIncomplete = true;
    return null;
  };
  let isIdentityLookupIncomplete = false;
  if (!resolvedMbid) {
    try {
      const candidates = await searchArtists(artistName);
      const confident = pickConfidentArtist(candidates, minAutoSelectScore);
      if (confident) {
        resolvedMbid = confident.id;
      } else if (candidates.length > 0) {
        resolvedMbid = await disambiguateArtistByLocalAlbums(artistName, candidates);
      }
    } catch {
      markIncomplete();
      isIdentityLookupIncomplete = true;
    }
  }

  const [info, wikidataImageUrl] = await Promise.all([
    fetchArtistInfo(lastfmName),
    resolvedMbid && !hasWikidataImage
      ? fetchWikidataImageByMbid(resolvedMbid).catch(markIncomplete)
      : Promise.resolve(null),
  ]);
  let imageUrl = wikidataImageUrl;
  if (!imageUrl && !hasWikidataImage && resolvedMbid) {
    const fanartKey = await getFanartApiKey();
    if (fanartKey) imageUrl = await fetchFanartTvImageByMbid(resolvedMbid, fanartKey).catch(markIncomplete);
  }

  // Bio + portrait fallbacks: TheAudioDB and Wikipedia fetched in parallel when Last.fm returns nothing
  let finalBio = info.bio;
  if (!finalBio) {
    const [adbResult, wikiBio] = await Promise.all([
      fetchTheAudioDbArtist(artistName).catch(markIncomplete),
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

  // Last-resort portrait: the server's own getArtistInfo2 scrape. No MBID or API
  // key needed, just the artist's native id, but the server may have nothing on
  // file, so the URL is preflighted before it's trusted (see probeImageLoads).
  let navidromeImageUrl: string | null = null;
  if (!imageUrl && !hasWikidataImage && serverWithCredential) {
    const { server, credential } = serverWithCredential;
    const nativeId = await findNativeArtistId(artistName, server.id).catch(markIncomplete);
    if (nativeId) {
      const url = await getArtistImageFromServer(
        server.url, server.username, credential, nativeId, server.alt_url ?? undefined
      );
      if (url && (await probeImageLoads(url))) navidromeImageUrl = url;
    }
  }

  const db = await getDb();
  // Only stamp enriched_at when Last.fm returned primary data, keeps the row retryable
  // when only a fallback bio (TheAudioDB/Wikipedia) was found, so stats/similar can still be fetched.
  const gotData = !!(info.bio || info.listeners || info.similar.length > 0);
  const hasPortrait = hasWikidataImage || !!imageUrl || !!navidromeImageUrl;
  const enrichedAt = gotData && (hasPortrait || !isPortraitLookupIncomplete) ? Math.floor(Date.now() / 1000) : null;

  await db.execute(
    `INSERT INTO artist_identity
       (artist_name, mb_artist_id, lastfm_artist_name, confirmed_at,
        bio, listeners, playcount, similar_json, top_tags_json, lastfm_image_url,
        wikidata_image_url, navidrome_image_url, enriched_at)
     VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(artist_name) DO UPDATE SET
       mb_artist_id = COALESCE(artist_identity.mb_artist_id, excluded.mb_artist_id),
       bio = excluded.bio,
       listeners = excluded.listeners,
       playcount = excluded.playcount,
       similar_json = excluded.similar_json,
       top_tags_json = excluded.top_tags_json,
       lastfm_image_url = excluded.lastfm_image_url,
       wikidata_image_url = COALESCE(excluded.wikidata_image_url, artist_identity.wikidata_image_url),
       navidrome_image_url = COALESCE(excluded.navidrome_image_url, artist_identity.navidrome_image_url),
       enriched_at = COALESCE(excluded.enriched_at, artist_identity.enriched_at)`,
    [
      artistName,
      resolvedMbid,
      finalBio,
      info.listeners,
      info.playcount,
      info.similar.length > 0 ? JSON.stringify(info.similar) : null,
      info.topTags.length > 0 ? JSON.stringify(info.topTags) : null,
      info.imageUrl,
      imageUrl,
      navidromeImageUrl,
      enrichedAt,
    ]
  );
  return { isIdentityLookupIncomplete };
}

export function useEnrichArtist(
  artistName: string,
  options?: { enabled?: boolean; serverWithCredential?: ServerWithCredential; identifyIfUnidentified?: boolean }
) {
  const enabled = options?.enabled ?? true;
  const identifyIfUnidentified = options?.identifyIfUnidentified ?? false;
  const serverWithCredential = options?.serverWithCredential ?? null;
  const queryClient = useQueryClient();
  const [staleDaysStr] = useSetting("tags.staleness_days", "30");
  const staleDays = Number(staleDaysStr) || 30;
  const [minAutoSelectScoreRaw, , isMinAutoSelectScoreLoaded] = useSetting(
    ARTIST_AUTO_SELECT_SETTING,
    String(DEFAULT_ARTIST_AUTO_SELECT_SCORE),
  );
  const minAutoSelectScore = parseArtistAutoSelectScore(minAutoSelectScoreRaw);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Holds the artist the claim was stamped for: `AlbumDetail` passes `album.artist` and is
  // rendered without a `key`, so an album swap changes the artist inside one mount.
  const ranRef = useRef<string | null>(null);

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
    // Gate on the caller's `enabled` too: grid/similar-artist cards mount dozens at
    // once, and an ungated query here fired one sqlx IPC SELECT per card on mount
    // even for cards never scrolled into view.
    enabled: !!artistName && enabled,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!enabled || query.isLoading || !artistName || !isMinAutoSelectScoreLoaded) return;
    const needsIdentify = identifyIfUnidentified && !query.data?.mb_artist_id && !identifyAttempted.has(artistName);
    if (!isEnrichmentStale(query.data ?? null, staleDays) && !needsIdentify) return;
    if (ranRef.current === artistName) return;
    // Check inFlight before locking ranRef so a failed in-progress run doesn't
    // permanently prevent this mount from retrying.
    if (inFlight.has(artistName)) return;
    ranRef.current = artistName;

    const lastfmName = query.data?.lastfm_artist_name ?? artistName;
    const mbArtistId = query.data?.mb_artist_id ?? null;
    const hasWikidataImage = !!(query.data?.wikidata_image_url);

    if (!mbArtistId) identifyAttempted.add(artistName);

    const promise = (async () => {
      const slot = acquireEnrichSlot();
      if (!slot) {
        // Queue already saturated: skip for now, isEnrichmentStale will retry next visit.
        if (ranRef.current === artistName) ranRef.current = null;
        identifyAttempted.delete(artistName);
        return;
      }
      await slot;
      try {
        const { isIdentityLookupIncomplete } = await enrichArtist({
          artistName, lastfmName, mbArtistId, hasWikidataImage, serverWithCredential, minAutoSelectScore,
        });
        if (isIdentityLookupIncomplete) identifyAttempted.delete(artistName);
        await queryClient.invalidateQueries({ queryKey: QK.artistEnrichment(artistName) });
        // The artists grid/search reads portraits off its own query (joined once, not per-artist),
        // so a fresh portrait doesn't show up there until that list is invalidated too.
        useArtistBrowseSessionStore.getState().bumpRefresh();
      } catch {
        // Nothing here moves a dep, so the claim has to be released or this mount
        // never retries a transient Last.fm failure.
        if (ranRef.current === artistName) ranRef.current = null;
        identifyAttempted.delete(artistName);
      } finally {
        releaseEnrichSlot();
      }
    })().finally(() => inFlight.delete(artistName));
    inFlight.set(artistName, promise);
  }, [
    enabled, query.isLoading, query.data, artistName, staleDays, queryClient, serverWithCredential,
    minAutoSelectScore, isMinAutoSelectScoreLoaded, identifyIfUnidentified,
  ]);

  const refresh = useCallback(async () => {
    if (isRefreshing || !artistName) return;
    setIsRefreshing(true);
    setError(null);
    ranRef.current = null;
    const lastfmName = query.data?.lastfm_artist_name ?? artistName;
    const mbArtistId = query.data?.mb_artist_id ?? null;
    const hasWikidataImage = !!(query.data?.wikidata_image_url);
    try {
      await enrichArtist({
        artistName, lastfmName, mbArtistId, hasWikidataImage, serverWithCredential, minAutoSelectScore,
      });
      await queryClient.invalidateQueries({ queryKey: QK.artistEnrichment(artistName) });
      useArtistBrowseSessionStore.getState().bumpRefresh();
    } catch (e) {
      console.error("[useEnrichArtist] refresh failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsRefreshing(false);
    }
  }, [artistName, isRefreshing, query.data, queryClient, serverWithCredential, minAutoSelectScore]);

  return { data: query.data ?? null, isLoading: query.isLoading, isRefreshing, error, refresh };
}
