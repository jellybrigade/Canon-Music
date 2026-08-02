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

// Toggles for one id run one at a time, chained off whatever toggle for that id is
// still running. The love state a toggle acts on is read from SQLite rather than from
// the render-time sets: bumpRefresh only reloads asynchronously and the session store
// deliberately keeps the previous sets while that reload is in flight, so a second
// click inside the window used to read the same pre-click state as the first, take the
// same branch and leave the heart where it started.
const toggleChains = new Map<string, Promise<void>>();

function serializeByKey(key: string, work: () => Promise<void>): Promise<void> {
  const prev = toggleChains.get(key) ?? Promise.resolve();
  const next = prev.then(work, work).catch((err) => {
    console.error("useLoved: toggle failed", err);
  });
  toggleChains.set(key, next);
  void next.finally(() => {
    if (toggleChains.get(key) === next) toggleChains.delete(key);
  });
  return next;
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

  function toggleTrackLove(trackId: string, serverWithCred: ServerWithCredential) {
    return serializeByKey(`track:${trackId}`, async () => {
      const { server, credential } = serverWithCred;
      const db = await getDb();
      const rows = await db.select<{ track_id: string }[]>(
        "SELECT track_id FROM loved_tracks WHERE track_id = ?",
        [trackId]
      );
      const loved = rows.length > 0;
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
    });
  }

  function toggleAlbumLove(albumId: string, serverWithCred: ServerWithCredential) {
    return serializeByKey(`album:${albumId}`, async () => {
      const { server, credential } = serverWithCred;
      const db = await getDb();
      const rows = await db.select<{ album_id: string }[]>(
        "SELECT album_id FROM loved_albums WHERE album_id = ?",
        [albumId]
      );
      const loved = rows.length > 0;
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
    });
  }

  return { lovedTrackIds, lovedAlbumIds, lovedTrackAlbumIds, toggleTrackLove, toggleAlbumLove };
}
