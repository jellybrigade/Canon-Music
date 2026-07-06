import { useEffect, useRef } from "react";
import { usePlayerStore } from "../store/player";
import type { CurrentTrack } from "../store/player";
import { getRadioCandidates } from "../lib/radio";
import { fetchSimilarArtistsFull, fetchSimilarTracks } from "../lib/lastfm";
import { getDb } from "../db";

const LOOKAHEAD_THRESHOLD = 10;
const RECENT_PLAYED_WINDOW_S = 3600;

// Artist/album repetition is penalized on a decay curve (recently played = near-zero
// multiplier, fully recovered after N radio picks) rather than a hard cap, avoids
// walls that starve thin-library genres and avoids the cap "resetting" as the queue scrolls.
const ARTIST_DECAY_TRACKS = 18;
const ARTIST_DECAY_TRACKS_NARROW = 8; // similar-artists: pool is naturally few artists
const ALBUM_DECAY_TRACKS = 8;

// same-genre should stay tight to genre fidelity; curated is explicitly the "expand a bit" mode.
const MODE_WINDOW_MULTIPLIER: Partial<Record<string, number>> = {
  "same-genre": 0.6,
  curated: 1.0,
  "similar-artists": 0.8,
};

function scaledPickParams(scale: number, mode: string): { candidateSample: number; topPickWindow: number } {
  const s = Math.max(0, Math.min(1, scale));
  const mult = MODE_WINDOW_MULTIPLIER[mode] ?? 1.0;
  return {
    candidateSample: Math.round(30 + 50 * s),
    topPickWindow: Math.max(1, Math.round((10 + 20 * s) * mult)),
  };
}

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

function pickFromTop(
  candidates: { id: string; score: number }[],
  candidateSample: number,
  topPickWindow: number
): { id: string; score: number } | null {
  const pool = candidates.slice(0, candidateSample);
  if (pool.length === 0) return null;
  const top = pool.slice(0, Math.min(topPickWindow, pool.length));
  return top[Math.floor(Math.random() * top.length)] ?? null;
}

export function useRadio() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const radioActive = usePlayerStore((s) => s.radioActive);
  const radioMode = usePlayerStore((s) => s.radioMode);
  const radioSimilarityScale = usePlayerStore((s) => s.radioSimilarityScale);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const streamUrlFor = usePlayerStore((s) => s.streamUrlFor);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const playFromQueueIndex = usePlayerStore((s) => s.playFromQueueIndex);
  const fillingRef = useRef(false);

  // Session-scoped repetition memory: reset whenever a *new* radio session starts
  // (false -> true transition), so decay/exclusion carries across the whole session
  // rather than resetting each lookahead fill.
  const sessionCounterRef = useRef(0);
  const artistLastPlayedRef = useRef(new Map<string, number>());
  const albumLastPlayedRef = useRef(new Map<string, number>());
  const playedTrackIdsRef = useRef(new Set<string>());
  const wasRadioActiveRef = useRef(false);

  useEffect(() => {
    if (radioActive && !wasRadioActiveRef.current) {
      sessionCounterRef.current = 0;
      artistLastPlayedRef.current = new Map();
      albumLastPlayedRef.current = new Map();
      playedTrackIdsRef.current = new Set();
    }
    wasRadioActiveRef.current = radioActive;
  }, [radioActive]);

  function recordPick(artist: string | null, albumId: string | null | undefined, trackId: string) {
    sessionCounterRef.current += 1;
    if (artist) artistLastPlayedRef.current.set(artist.toLowerCase(), sessionCounterRef.current);
    if (albumId) albumLastPlayedRef.current.set(albumId, sessionCounterRef.current);
    playedTrackIdsRef.current.add(trackId);
  }

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
        for (const id of playedTrackIdsRef.current) excludeIds.add(id);

        const needsSimilarArtists = radioMode === "curated" || radioMode === "similar-artists";
        const [similarArtistsFull, similarTracks] = await Promise.all([
          needsSimilarArtists && currentTrack.artist
            ? fetchSimilarArtistsFull(currentTrack.artist).catch(() => [])
            : Promise.resolve([]),
          radioMode === "curated" && currentTrack.artist && currentTrack.title
            ? fetchSimilarTracks(currentTrack.artist, currentTrack.title).catch(() => [])
            : Promise.resolve([]),
        ]);

        const artistSimilarity = new Map<string, number>();
        if (currentTrack.artist) artistSimilarity.set(currentTrack.artist.toLowerCase(), 1.0);
        for (const a of similarArtistsFull) artistSimilarity.set(a.name.toLowerCase(), a.match);

        const trackSimilarity = new Map<string, number>();
        for (const t of similarTracks) {
          trackSimilarity.set(`${t.artist.toLowerCase()}|||${t.title.toLowerCase()}`, t.match);
        }

        const candidates = await getRadioCandidates({
          seedTrackId: currentTrack.id,
          mode: radioMode,
          excludeIds,
          artistSimilarity,
          trackSimilarity,
          similarityScale: radioSimilarityScale,
        });

        // same-album mode: picks in track order, take first candidate directly
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
          const wasAtEnd2 = !isPlaying && !isLoading && queueIndex === queue.length - 1;
          addToQueue(track2, streamUrlFor ?? (() => fallbackUrl2));
          if (wasAtEnd2) void playFromQueueIndex(queue.length);
          recordPick(track2.artist, track2.albumId, track2.id);
          return;
        }

        // For all other modes, apply a decaying repetition penalty instead of a hard cap:
        // recently-played artist/album score near zero, recovering fully after N picks.
        // Soft penalty (vs. hard filter) avoids dead ends when a genre's pool is thin,
        // and persists across the whole radio session instead of resetting per fill cycle.
        let capped = candidates;
        if (!UNCAPPED_MODES.has(radioMode)) {
          const artistDecay = radioMode === "similar-artists" ? ARTIST_DECAY_TRACKS_NARROW : ARTIST_DECAY_TRACKS;
          const counter = sessionCounterRef.current;
          capped = candidates
            .map((c) => {
              const ak = (c.artist ?? "").toLowerCase();
              const artistGap = ak ? counter - (artistLastPlayedRef.current.get(ak) ?? -Infinity) : Infinity;
              const albumGap = c.albumId ? counter - (albumLastPlayedRef.current.get(c.albumId) ?? -Infinity) : Infinity;
              const artistMult = Math.max(0, Math.min(1, artistGap / artistDecay));
              const albumMult = Math.max(0, Math.min(1, albumGap / ALBUM_DECAY_TRACKS));
              return { ...c, score: c.score * artistMult * albumMult };
            })
            .sort((a, b) => b.score - a.score);
        }

        const { candidateSample, topPickWindow } = scaledPickParams(radioSimilarityScale, radioMode);
        const pick = pickFromTop(capped, candidateSample, topPickWindow);

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
        const wasAtEnd = !isPlaying && !isLoading && queueIndex === queue.length - 1;
        addToQueue(track, streamUrlFor ?? (() => fallbackUrl));
        if (wasAtEnd) void playFromQueueIndex(queue.length);
        recordPick(track.artist, track.albumId, track.id);
      } catch (err) {
        console.error("Radio fill failed:", err);
      } finally {
        fillingRef.current = false;
      }
    })();
  }, [radioActive, radioMode, radioSimilarityScale, currentTrack, queue, queueIndex, addToQueue]);
}
