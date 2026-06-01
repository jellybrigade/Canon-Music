import { useEffect, useRef } from "react";
import { usePlayerStore } from "../store/player";
import type { CurrentTrack } from "../store/player";
import { getRadioCandidates } from "../lib/radio";
import { fetchSimilarArtists } from "../lib/lastfm";
import { getDb } from "../db";

const LOOKAHEAD_THRESHOLD = 10;
const RECENT_PLAYED_WINDOW_S = 3600;
const CANDIDATE_SAMPLE = 50;
const TOP_PICK_WINDOW = 5;
const MAX_PER_ARTIST = 3;
const MAX_PER_ALBUM = 2;

const UNCAPPED_MODES = new Set(["same-artist", "same-album"]);

async function getRecentlyPlayedIds(serverId: string): Promise<Set<string>> {
  const db = await getDb();
  type Row = { track_id: string };
  const cutoff = Math.floor(Date.now() / 1000) - RECENT_PLAYED_WINDOW_S;
  const rows = await db.select<Row[]>(
    "SELECT track_id FROM scrobble_history WHERE track_id LIKE ? AND timestamp > ?",
    [`${serverId}:%`, cutoff]
  );
  return new Set(rows.map((r) => r.track_id));
}

function pickFromTop(candidates: { id: string; score: number }[]): { id: string; score: number } | null {
  const pool = candidates.slice(0, CANDIDATE_SAMPLE);
  if (pool.length === 0) return null;
  const top = pool.slice(0, Math.min(TOP_PICK_WINDOW, pool.length));
  return top[Math.floor(Math.random() * top.length)] ?? null;
}

export function useRadio() {
  const { currentTrack, queue, queueIndex, radioActive, radioMode, addToQueue, streamUrlFor } = usePlayerStore();
  const fillingRef = useRef(false);

  useEffect(() => {
    if (!radioActive || !currentTrack) return;

    const remaining = queue.length - queueIndex;
    if (remaining >= LOOKAHEAD_THRESHOLD) return;
    if (fillingRef.current) return;

    const serverId = currentTrack.id.split(":")[0] ?? "";

    fillingRef.current = true;
    void (async () => {
      try {
        const excludeIds = new Set<string>(queue.map((t: CurrentTrack) => t.id));
        const recentIds = await getRecentlyPlayedIds(serverId);
        for (const id of recentIds) excludeIds.add(id);

        const needsSimilarArtists = radioMode === "curated" || radioMode === "similar-artists";
        const similarArtists = needsSimilarArtists && currentTrack.artist
          ? await fetchSimilarArtists(currentTrack.artist).catch(() => [])
          : [];

        const candidates = await getRadioCandidates({
          seedTrackId: currentTrack.id,
          mode: radioMode,
          excludeIds,
          similarArtists,
        });

        // same-album mode: picks in track order — take first candidate directly
        if (radioMode === "same-album") {
          const pick = candidates[0] ?? null;
          if (!pick) return;

          const db2 = await getDb();
          type TrackRow2 = {
            id: string; title: string; artist: string | null;
            duration: number | null; artwork_url: string | null;
            album_id: string | null; album_name: string | null;
          };
          const rows2 = await db2.select<TrackRow2[]>(
            `SELECT t.id, t.title, t.artist, t.duration, a.artwork_url, t.album_id, a.name AS album_name
             FROM tracks t LEFT JOIN albums a ON t.album_id = a.id
             WHERE t.id = ?`,
            [pick.id]
          );
          const row2 = rows2[0];
          if (!row2) return;
          const track2: CurrentTrack = {
            id: row2.id, title: row2.title, artist: row2.artist, duration: row2.duration,
            artworkRef: row2.artwork_url, albumId: row2.album_id, album: row2.album_name, coverArtUrl: null,
          };
          const fallbackUrl2 = streamUrlFor ? streamUrlFor(track2) : "";
          addToQueue(track2, streamUrlFor ?? (() => fallbackUrl2));
          return;
        }

        // For all other modes, enforce per-artist and per-album caps over the lookahead window.
        let capped = candidates;
        if (!UNCAPPED_MODES.has(radioMode)) {
          const upcoming = queue.slice(queueIndex);
          const artistCounts = new Map<string, number>();
          const albumCounts = new Map<string, number>();
          for (const t of upcoming) {
            if (t.artist) {
              const k = t.artist.toLowerCase();
              artistCounts.set(k, (artistCounts.get(k) ?? 0) + 1);
            }
            if (t.albumId) albumCounts.set(t.albumId, (albumCounts.get(t.albumId) ?? 0) + 1);
          }
          const filtered = candidates.filter(c => {
            const ak = (c.artist ?? "").toLowerCase();
            if (ak && (artistCounts.get(ak) ?? 0) >= MAX_PER_ARTIST) return false;
            if (c.albumId && (albumCounts.get(c.albumId) ?? 0) >= MAX_PER_ALBUM) return false;
            return true;
          });
          capped = filtered.length > 0 ? filtered : candidates;
        }

        const pick = pickFromTop(capped);

        if (!pick) return;

        const db = await getDb();
        type TrackRow = {
          id: string; title: string; artist: string | null;
          duration: number | null; artwork_url: string | null;
          album_id: string | null; album_name: string | null;
        };
        const rows = await db.select<TrackRow[]>(
          `SELECT t.id, t.title, t.artist, t.duration, a.artwork_url, t.album_id, a.name AS album_name
           FROM tracks t LEFT JOIN albums a ON t.album_id = a.id
           WHERE t.id = ?`,
          [pick.id]
        );
        const row = rows[0];
        if (!row) return;

        const track: CurrentTrack = {
          id: row.id,
          title: row.title,
          artist: row.artist,
          duration: row.duration,
          artworkRef: row.artwork_url,
          albumId: row.album_id,
          album: row.album_name,
          coverArtUrl: null,
        };
        const fallbackUrl = streamUrlFor ? streamUrlFor(track) : "";
        addToQueue(track, streamUrlFor ?? (() => fallbackUrl));
      } finally {
        fillingRef.current = false;
      }
    })();
  }, [radioActive, radioMode, currentTrack, queue, queueIndex, addToQueue]);
}
