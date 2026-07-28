import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../db";
import type { ServerWithCredential } from "./useServer";
import { starTrack, unstarTrack, starAlbum, unstarAlbum } from "../lib/navidrome";
import { stripServerPrefix } from "../utils/ids";
import { useLovedSessionStore, type LovedSets } from "../store/lovedSessionStore";

interface LovedDto {
  trackIds: string[];
  albumIds: string[];
  trackAlbumIds: string[];
}

const EMPTY_SETS: LovedSets = {
  trackIds: new Set(),
  albumIds: new Set(),
  trackAlbumIds: new Set(),
};

// One in-flight load per tick, shared process-wide. useLoved is mounted by roughly
// eight components at once (grid, detail, player bar, now playing, track table,
// playlist detail, home, app root) and each mount used to run its own full read.
let inFlight: { tick: number; promise: Promise<void> } | null = null;

async function loadLoved(tick: number): Promise<void> {
  if (inFlight && inFlight.tick === tick) return inFlight.promise;
  const promise = (async () => {
    try {
      // Wait for tauri-plugin-sql's migrations before reading via rusqlite - both
      // engines share canon.db and this read path has no schema awareness of its own.
      await getDb();
      const dto = await invoke<LovedDto>("get_loved");
      useLovedSessionStore.getState().setSets(
        {
          trackIds: new Set(dto.trackIds),
          albumIds: new Set(dto.albumIds),
          trackAlbumIds: new Set(dto.trackAlbumIds),
        },
        tick
      );
    } catch (err) {
      console.error("useLoved: failed to load loved ids", err);
    } finally {
      if (inFlight?.tick === tick) inFlight = null;
    }
  })();
  inFlight = { tick, promise };
  return promise;
}

export function useLoved() {
  const refreshTick = useLovedSessionStore((s) => s.refreshTick);
  const bumpRefresh = useLovedSessionStore((s) => s.bumpRefresh);
  // Last-loaded sets are kept while a refresh (e.g. right after a love toggle) is in
  // flight, so hearts don't blink off for a frame. Staleness is bounded by the reload
  // the effect below kicks off.
  const sets = useLovedSessionStore((s) => s.sets);

  useEffect(() => {
    const s = useLovedSessionStore.getState();
    if (s.sets && s.cachedTick === refreshTick) return;
    void loadLoved(refreshTick);
  }, [refreshTick]);

  const { trackIds: lovedTrackIds, albumIds: lovedAlbumIds, trackAlbumIds: lovedTrackAlbumIds } =
    sets ?? EMPTY_SETS;

  async function toggleTrackLove(trackId: string, serverWithCred: ServerWithCredential) {
    const { server, credential } = serverWithCred;
    const db = await getDb();
    const loved = lovedTrackIds.has(trackId);
    if (loved) {
      await db.execute("DELETE FROM loved_tracks WHERE track_id = ?", [trackId]);
    } else {
      await db.execute("INSERT OR REPLACE INTO loved_tracks (track_id) VALUES (?)", [trackId]);
    }
    bumpRefresh();
    const nativeId = stripServerPrefix(trackId, server.id);
    const altUrl = server.alt_url ?? undefined;
    if (loved) {
      unstarTrack(server.url, server.username, credential, nativeId, altUrl).catch((err) =>
        console.error("unstar track failed:", err)
      );
    } else {
      starTrack(server.url, server.username, credential, nativeId, altUrl).catch((err) =>
        console.error("star track failed:", err)
      );
    }
  }

  async function toggleAlbumLove(albumId: string, serverWithCred: ServerWithCredential) {
    const { server, credential } = serverWithCred;
    const db = await getDb();
    const loved = lovedAlbumIds.has(albumId);
    if (loved) {
      await db.execute("DELETE FROM loved_albums WHERE album_id = ?", [albumId]);
    } else {
      await db.execute("INSERT OR REPLACE INTO loved_albums (album_id) VALUES (?)", [albumId]);
    }
    bumpRefresh();
    const nativeId = stripServerPrefix(albumId, server.id);
    const altUrl = server.alt_url ?? undefined;
    if (loved) {
      unstarAlbum(server.url, server.username, credential, nativeId, altUrl).catch((err) =>
        console.error("unstar album failed:", err)
      );
    } else {
      starAlbum(server.url, server.username, credential, nativeId, altUrl).catch((err) =>
        console.error("star album failed:", err)
      );
    }
  }

  return { lovedTrackIds, lovedAlbumIds, lovedTrackAlbumIds, toggleTrackLove, toggleAlbumLove };
}
