import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { starAlbum, starTrack, unstarAlbum, unstarTrack } from "../clients/navidrome";
import { getDb } from "../db";
import { stripServerPrefix } from "../lib/ids";
import { type LovedSets, useLovedSessionStore } from "../store/lovedSessionStore";
import type { ServerWithCredential } from "./useServer";

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
        tick,
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

// Toggles for one id chain off any toggle for that id still running, and read love state
// from SQLite: a second click before bumpRefresh's async reload landed used to see stale state.
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

interface LoveKind {
  key: string;
  table: string;
  column: string;
  star: typeof starTrack;
  unstar: typeof unstarTrack;
}

const TRACK_LOVE: LoveKind = {
  key: "track",
  table: "loved_tracks",
  column: "track_id",
  star: starTrack,
  unstar: unstarTrack,
};
const ALBUM_LOVE: LoveKind = {
  key: "album",
  table: "loved_albums",
  column: "album_id",
  star: starAlbum,
  unstar: unstarAlbum,
};

async function writeLove(kind: LoveKind, id: string, loved: boolean): Promise<void> {
  const db = await getDb();
  if (loved) {
    await db.execute(`INSERT OR REPLACE INTO ${kind.table} (${kind.column}) VALUES (?)`, [id]);
  } else {
    await db.execute(`DELETE FROM ${kind.table} WHERE ${kind.column} = ?`, [id]);
  }
}

// The server call is awaited inside the chain: fired and forgotten, a refused love stayed
// lit until the next sync took it away, and a quick love/unlove could reach the server reversed.
function toggleLove(kind: LoveKind, id: string, serverWithCred: ServerWithCredential, bumpRefresh: () => void) {
  return serializeByKey(`${kind.key}:${id}`, async () => {
    const { server, credential } = serverWithCred;
    const db = await getDb();
    const rows = await db.select<unknown[]>(`SELECT 1 FROM ${kind.table} WHERE ${kind.column} = ?`, [id]);
    const wasLoved = rows.length > 0;
    await writeLove(kind, id, !wasLoved);
    bumpRefresh();
    const send = wasLoved ? kind.unstar : kind.star;
    try {
      await send(
        server.url,
        server.username,
        credential,
        stripServerPrefix(id, server.id),
        server.alt_url ?? undefined,
      );
    } catch (err) {
      await writeLove(kind, id, wasLoved);
      bumpRefresh();
      throw err;
    }
  });
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

  const { trackIds: lovedTrackIds, albumIds: lovedAlbumIds, trackAlbumIds: lovedTrackAlbumIds } = sets ?? EMPTY_SETS;

  function toggleTrackLove(trackId: string, serverWithCred: ServerWithCredential) {
    return toggleLove(TRACK_LOVE, trackId, serverWithCred, bumpRefresh);
  }

  function toggleAlbumLove(albumId: string, serverWithCred: ServerWithCredential) {
    return toggleLove(ALBUM_LOVE, albumId, serverWithCred, bumpRefresh);
  }

  return { lovedTrackIds, lovedAlbumIds, lovedTrackAlbumIds, toggleTrackLove, toggleAlbumLove };
}
