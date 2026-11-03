import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../../db";
import { refreshAlbumCover } from "../../hooks/useCoverCache";
import type { ServerWithCredential } from "../../hooks/useServer";
import { QK } from "../../lib/queryKeys";
import { useAlbumBrowseSessionStore } from "../../store/albumBrowseSessionStore";
import type { AlbumRow } from "../../types/library";
import { readTaggedReleaseMbid } from "../enrichment/hooks/useAlbumIdentity";
import { type CoverChoice, chooseAlbumCover, clearAlbumCover, getAlbumCoverOverride } from "./albumCoverOverrides";
import { type FanartKeyRead, findCoverCandidates, readFanartKey } from "./coverCandidates";

// Long enough that reopening the picker doesn't ask every source again, short enough that a
// source that was down is asked again within the session.
const CANDIDATES_STALE_MS = 10 * 60 * 1000;

type AlbumCoverTarget = Pick<AlbumRow, "id" | "server_id" | "name" | "artist" | "artwork_url">;

/** What decides which sources can be asked, as of now: a confirmed identity first, then the release
 * the files are tagged with; and the fanart.tv key, read once here so the search doesn't read it again. */
async function readCoverInputs(album: AlbumCoverTarget) {
  const fanartKey = readFanartKey();
  const db = await getDb();
  const rows = await db.select<{ mb_release_id: string | null; mb_release_group_id: string | null }[]>(
    "SELECT mb_release_id, mb_release_group_id FROM album_identity WHERE album_id = ?",
    [album.id],
  );
  const identity = rows[0];
  const releaseMbid =
    identity?.mb_release_id ?? (await readTaggedReleaseMbid(db, { albumId: album.id, serverId: album.server_id }));
  return {
    releaseMbid,
    releaseGroupMbid: identity?.mb_release_group_id ?? null,
    fanartKey: await fanartKey,
  };
}

/** Whether a key is stored, null when the store couldn't be read: the search key names this, never the key. */
function fanartKeyPresence(read: FanartKeyRead | undefined): boolean | null {
  if (read === undefined) return null;
  if (typeof read === "string") return true;
  return read.status === "skipped" ? false : null;
}

/** Searches keyed by the inputs they were made with, so identifying the album or adding a fanart.tv
 * key searches again. */
export function useCoverCandidates(album: AlbumCoverTarget) {
  const inputs = useQuery({
    queryKey: QK.albumCoverInputs(album.server_id, album.id),
    queryFn: () => readCoverInputs(album),
    // Read again on every open: Identify, offered from the picker, changes them between two opens.
    staleTime: 0,
    gcTime: 0,
  });
  const releaseMbid = inputs.data?.releaseMbid ?? null;
  const releaseGroupMbid = inputs.data?.releaseGroupMbid ?? null;
  const fanartKey = inputs.data?.fanartKey;
  const hasFanartKey = fanartKeyPresence(fanartKey);
  const candidates = useQuery({
    queryKey: QK.albumCoverCandidates(album.server_id, album.id, {
      releaseMbid,
      releaseGroupMbid,
      hasFanartKey,
    }),
    queryFn: () => {
      if (fanartKey === undefined) throw new Error("The cover search ran before its inputs were read");
      // The key itself rides here, never in the query key.
      return findCoverCandidates({
        artist: album.artist ?? "",
        album: album.name,
        releaseMbid,
        releaseGroupMbid,
        fanartKey,
      });
    },
    enabled: inputs.isSuccess,
    staleTime: CANDIDATES_STALE_MS,
  });
  return {
    data: candidates.data,
    isPending: inputs.isPending || (inputs.isSuccess && candidates.isPending),
    error: inputs.error ?? candidates.error,
    refetch: () => (inputs.error ? inputs.refetch() : candidates.refetch()),
  };
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
    onSuccess: () => {
      useAlbumBrowseSessionStore.getState().setAccent(album.id, null);
      void queryClient.invalidateQueries({ queryKey: QK.albumById(album.id, album.server_id) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: QK.albumCoverOverride(album.server_id, album.id) });
    },
  });
}
