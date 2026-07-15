import { useEffect, useMemo, useState } from "react";
import { getDb } from "../db";
import type { ServerWithCredential } from "./useServer";
import { starTrack, unstarTrack, starAlbum, unstarAlbum } from "../lib/navidrome";
import { stripServerPrefix } from "../utils/ids";
import { useLovedSessionStore } from "../store/lovedSessionStore";

interface IdRow {
  id: string;
}

export function useLoved() {
  const refreshTick = useLovedSessionStore((s) => s.refreshTick);
  const bumpRefresh = useLovedSessionStore((s) => s.bumpRefresh);

  const [lovedTrackArray, setLovedTrackArray] = useState<string[]>([]);
  const [lovedAlbumArray, setLovedAlbumArray] = useState<string[]>([]);
  const [lovedTrackAlbumArray, setLovedTrackAlbumArray] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const db = await getDb();
      const [trackRows, albumRows, trackAlbumRows] = await Promise.all([
        db.select<IdRow[]>("SELECT track_id as id FROM loved_tracks"),
        db.select<IdRow[]>("SELECT album_id as id FROM loved_albums"),
        db.select<IdRow[]>(
          "SELECT DISTINCT t.album_id as id FROM tracks t INNER JOIN loved_tracks lt ON lt.track_id = t.id WHERE t.album_id IS NOT NULL"
        ),
      ]);
      if (cancelled) return;
      setLovedTrackArray(trackRows.map((r) => r.id));
      setLovedAlbumArray(albumRows.map((r) => r.id));
      setLovedTrackAlbumArray(trackAlbumRows.map((r) => r.id));
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const lovedTrackIds = useMemo(() => new Set(lovedTrackArray), [lovedTrackArray]);
  const lovedAlbumIds = useMemo(() => new Set(lovedAlbumArray), [lovedAlbumArray]);
  const lovedTrackAlbumIds = useMemo(() => new Set(lovedTrackAlbumArray), [lovedTrackAlbumArray]);

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
