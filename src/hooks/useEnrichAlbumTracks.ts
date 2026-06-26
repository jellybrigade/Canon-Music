/**
 * On-open per-track genre enrichment from Last.fm.
 *
 * When an album view mounts, fetches track.getTopTags for each track whose
 * tags_enriched_at is null or older than tags.staleness_days. Tags are
 * written to track_tags with source='lastfm-track' and canonical_id resolved
 * inline via findCanonicalSync (no pre-existing tag_mappings row required).
 *
 * After all tracks are enriched, normalizeAlbum re-runs so:
 *   - Radio scoring picks up the new per-track canonical_ids immediately.
 *   - Genres shared by ≥50% of tracks are promoted into album_genres chips.
 *
 * Gated by settings key 'tags.enrich_tracks' (default true).
 * Failures are silent — never throws to the UI.
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";
import { fetchTrackTags } from "../lib/lastfm";
import { getCanonTree, findCanonicalSync } from "../lib/canonicalize";
import { normalizeAlbum } from "../lib/tag-normalize";
import { useAlbumIdentity } from "./useAlbumIdentity";
import { useSetting } from "./useSetting";

// Module-level dedupe: one enrichment run per album at a time across all mounts.
const inFlight = new Map<string, Promise<void>>();

interface TrackStub {
  id: string;
  title: string;
  artist: string | null;
  album_artist: string | null;
  tags_enriched_at: number | null;
}

async function enrichAlbumTracks(
  albumId: string,
  albumArtist: string,
  albumName: string,
  staleDays: number,
  identity: { lastfm_artist_name?: string | null; lastfm_album_name?: string | null; combined_genres_json?: string | null; combined_tags_json?: string | null } | null,
): Promise<void> {
  const db = await getDb();

  const tracks = await db.select<TrackStub[]>(
    `SELECT id, title, artist, album_artist, tags_enriched_at
     FROM tracks WHERE album_id = ? ORDER BY disc_number, track_number`,
    [albumId]
  );
  if (tracks.length === 0) return;

  const staleThreshold = Math.floor(Date.now() / 1000) - staleDays * 86400;
  const staleTracks = tracks.filter(
    (t) => t.tags_enriched_at === null || t.tags_enriched_at < staleThreshold
  );
  if (staleTracks.length === 0) return;

  // Load canon tree + manual mappings once for the whole album run.
  const tree = await getCanonTree();
  type MappingRow = { raw_value: string; canonical_id: string; kind: string };
  const manualRows = await db.select<MappingRow[]>(
    "SELECT raw_value, canonical_id, kind FROM tag_mappings WHERE source = 'manual'"
  );
  const manualMap = new Map(manualRows.map((r) => [`${r.raw_value}:${r.kind}`, r.canonical_id]));

  let anySucceeded = false;

  for (const track of staleTracks) {
    const trackArtist = track.artist ?? track.album_artist ?? albumArtist;
    const trackTitle = track.title;
    if (!trackTitle) continue;

    let result: { genres: string[]; moods: string[] };
    try {
      result = await fetchTrackTags(trackArtist, trackTitle);
    } catch {
      // API failure (no key, rate limit, network) — leave tags_enriched_at null so it retries.
      continue;
    }

    // Insert per-track tags with canonical_id resolved inline.
    const allTags: Array<{ raw: string; kind: "genre" | "mood" }> = [
      ...result.genres.map((r) => ({ raw: r, kind: "genre" as const })),
      ...result.moods.map((r) => ({ raw: r, kind: "mood" as const })),
    ];

    for (const { raw, kind } of allTags) {
      const manualId = manualMap.get(`${raw}:${kind}`);
      // Skip tags the user explicitly ignored.
      if (manualId === "__ignored__") continue;
      let canonId: string | null = null;

      if (manualId && manualId !== "__accepted__") {
        canonId = manualId;
      } else {
        const match = findCanonicalSync(raw, kind, tree);
        canonId = match.node?.id ?? null;
      }

      await db.execute(
        `INSERT OR IGNORE INTO track_tags (track_id, kind, raw_value, canonical_id, source)
         VALUES (?, ?, ?, ?, 'lastfm-track')`,
        [track.id, kind, raw, canonId]
      );
    }

    // Stamp only on successful fetch — leaves null for retry on failure.
    await db.execute(
      "UPDATE tracks SET tags_enriched_at = ? WHERE id = ?",
      [Math.floor(Date.now() / 1000), track.id]
    );
    anySucceeded = true;
  }

  if (!anySucceeded) return;

  // Re-run album normalization so consensus promotion + album_genres reflect new track tags.
  let combinedMbGenres: Array<{ name: string; count: number }> | null = null;
  let combinedMbTags: Array<{ name: string; count: number }> | null = null;
  if (identity?.combined_genres_json) {
    try { combinedMbGenres = JSON.parse(identity.combined_genres_json) as Array<{ name: string; count: number }>; } catch { /* ignore */ }
  }
  if (identity?.combined_tags_json) {
    try { combinedMbTags = JSON.parse(identity.combined_tags_json) as Array<{ name: string; count: number }>; } catch { /* ignore */ }
  }
  await normalizeAlbum(albumId, albumArtist, albumName, {
    lastfmArtistName: identity?.lastfm_artist_name ?? null,
    lastfmAlbumName: identity?.lastfm_album_name ?? null,
    combinedMbGenres,
    combinedMbTags,
  });
}

export function useEnrichAlbumTracks(
  albumId: string,
  albumArtist: string,
  albumName: string,
) {
  const queryClient = useQueryClient();
  const [enrichTracks] = useSetting("tags.enrich_tracks", "true");
  const [staleDaysStr] = useSetting("tags.staleness_days", "30");
  const parsed = Number(staleDaysStr);
  const staleDays = Number.isFinite(parsed) && parsed >= 0 ? parsed : 30;
  const { data: identity, isSuccess: identityReady } = useAlbumIdentity(albumId);
  const ranRef = useRef(false);

  useEffect(() => {
    if (enrichTracks !== "true") return;
    if (!albumId || !albumArtist) return;
    // Wait for identity query to settle (may be null for albums with no identity).
    if (!identityReady) return;
    if (ranRef.current) return;
    // Check inFlight before locking ranRef so a failed in-progress run doesn't
    // permanently prevent this mount from retrying.
    if (inFlight.has(albumId)) return;
    ranRef.current = true;

    const promise = enrichAlbumTracks(albumId, albumArtist, albumName, staleDays, identity ?? null)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: QK.tracks(albumId) });
        void queryClient.invalidateQueries({ queryKey: QK.normalizedTags(albumId) });
        void queryClient.invalidateQueries({ queryKey: QK.trackTagsAlbum(albumId) });
      })
      .catch(() => { /* silent */ })
      .finally(() => inFlight.delete(albumId));

    inFlight.set(albumId, promise);
  }, [albumId, albumArtist, albumName, enrichTracks, staleDays, identityReady, identity, queryClient]);
}
