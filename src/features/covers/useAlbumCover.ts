import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../../db";
import { refreshAlbumCover } from "../../hooks/useCoverCache";
import type { ServerWithCredential } from "../../hooks/useServer";
import { QK } from "../../lib/queryKeys";
import type { AlbumRow } from "../../types/library";
import { readTaggedReleaseMbid } from "../enrichment/hooks/useAlbumIdentity";
import { type CoverChoice, chooseAlbumCover, clearAlbumCover, getAlbumCoverOverride } from "./albumCoverOverrides";
import { findCoverCandidates } from "./coverCandidates";

// Long enough that reopening the picker doesn't ask every source again, short enough that a
// source that was down is asked again within the session.
const CANDIDATES_STALE_MS = 10 * 60 * 1000;

type AlbumCoverTarget = Pick<AlbumRow, "id" | "server_id" | "name" | "artist" | "artwork_url">;

/** MBIDs as of now: a confirmed identity first, then the release the files are tagged with. */
async function readCoverMbids(album: AlbumCoverTarget) {
  const db = await getDb();
  const rows = await db.select<{ mb_release_id: string | null; mb_release_group_id: string | null }[]>(
    "SELECT mb_release_id, mb_release_group_id FROM album_identity WHERE album_id = ?",
    [album.id],
  );
  const identity = rows[0];
  const releaseMbid =
    identity?.mb_release_id ?? (await readTaggedReleaseMbid(db, { albumId: album.id, serverId: album.server_id }));
  return { releaseMbid, releaseGroupMbid: identity?.mb_release_group_id ?? null };
}

export function useCoverCandidates(album: AlbumCoverTarget) {
  return useQuery({
    queryKey: QK.albumCoverCandidates(album.server_id, album.id),
    queryFn: async () =>
      findCoverCandidates({ artist: album.artist ?? "", album: album.name, ...(await readCoverMbids(album)) }),
    staleTime: CANDIDATES_STALE_MS,
  });
}

export function useAlbumCoverOverride(album: AlbumCoverTarget) {
  return useQuery({
    queryKey: QK.albumCoverOverride(album.server_id, album.id),
    queryFn: () => getAlbumCoverOverride({ serverId: album.server_id, albumId: album.id }),
  });
}

/** Choosing (a cover) or clearing (null) also re-reads the album's cached grid cover. */
export function useSetAlbumCover(album: AlbumCoverTarget, serverWithCredential: ServerWithCredential) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (choice: CoverChoice | null) => {
      const ref = { serverId: album.server_id, albumId: album.id };
      if (choice === null) await clearAlbumCover(ref);
      else await chooseAlbumCover({ ...ref, choice });
      if (album.artwork_url) {
        await refreshAlbumCover(queryClient, {
          albumId: album.id,
          artworkUrl: album.artwork_url,
          swc: serverWithCredential,
        });
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: QK.albumCoverOverride(album.server_id, album.id) });
    },
  });
}
