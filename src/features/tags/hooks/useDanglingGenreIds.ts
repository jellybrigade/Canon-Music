import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../../../db";
import { QK } from "../../../lib/queryKeys";
import { bustCanonTreeCache, getCanonTree } from "../lib/canonicalize";
import { findDanglingGenreIds, repairDanglingGenreId } from "../lib/danglingGenreIds";
import { invalidateManualMappings } from "../lib/manualMappings";

export function useDanglingGenreIds() {
  return useQuery({
    queryKey: QK.danglingGenreIds(),
    queryFn: async () => {
      const db = await getDb();
      const tree = await getCanonTree();
      return findDanglingGenreIds(db, new Set(tree.byId.keys()));
    },
  });
}

export function useRepairDanglingGenreId() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: { id: string; name: string } | null }) =>
      repairDanglingGenreId(from, to),
    onSuccess: () => {
      invalidateManualMappings();
      // A custom node's parent list may have changed under the cached tree.
      bustCanonTreeCache();
      void queryClient.invalidateQueries({ queryKey: QK.tagVocab() });
      void queryClient.invalidateQueries({ queryKey: QK.tagMappings() });
      void queryClient.invalidateQueries({ queryKey: QK.trackTagsAll() });
      void queryClient.invalidateQueries({ queryKey: QK.genreDisplayMappings() });
      void queryClient.invalidateQueries({ queryKey: QK.normalizedTagsAll() });
      void queryClient.invalidateQueries({ queryKey: QK.userTreeNodes() });
    },
  });
}
