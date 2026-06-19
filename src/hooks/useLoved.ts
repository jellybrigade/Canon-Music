import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import type { ServerWithCredential } from "./useServer";
import { starTrack, unstarTrack, starAlbum, unstarAlbum } from "../lib/navidrome";
import { stripServerPrefix } from "../utils/ids";
import { QK } from "../lib/query-keys";

interface IdRow {
  id: string;
}

export function useLoved() {
  const queryClient = useQueryClient();

  // Return string[] not Set — React Query's structuralSharing uses Object.keys
  // on Sets, returns [], and incorrectly treats all Sets as identical, so
  // updates after the first render never propagate.
  const { data: lovedTrackArray = [] } = useQuery({
    queryKey: QK.loved_tracks(),
    staleTime: Infinity,
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<IdRow[]>("SELECT track_id as id FROM loved_tracks");
      return rows.map((r) => r.id);
    },
  });

  const { data: lovedAlbumArray = [] } = useQuery({
    queryKey: QK.loved_albums(),
    staleTime: Infinity,
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<IdRow[]>("SELECT album_id as id FROM loved_albums");
      return rows.map((r) => r.id);
    },
  });

  const { data: lovedTrackAlbumArray = [] } = useQuery({
    queryKey: QK.loved_track_albums(),
    staleTime: Infinity,
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<IdRow[]>(
        "SELECT DISTINCT t.album_id as id FROM tracks t INNER JOIN loved_tracks lt ON lt.track_id = t.id WHERE t.album_id IS NOT NULL"
      );
      return rows.map((r) => r.id);
    },
  });

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
    void queryClient.invalidateQueries({ queryKey: QK.loved_tracks() });
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
    void queryClient.invalidateQueries({ queryKey: QK.loved_albums() });
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
