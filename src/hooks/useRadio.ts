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
  const { currentTrack, queue, queueIndex, radioActive, addToQueue, streamUrlFor } = usePlayerStore();
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

        const similarArtists = currentTrack.artist
          ? await fetchSimilarArtists(currentTrack.artist).catch(() => [])
          : [];

        const candidates = await getRadioCandidates(currentTrack.id, excludeIds, similarArtists);
        const pick = pickFromTop(candidates);
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
  }, [radioActive, currentTrack, queue, queueIndex, addToQueue]);
}
