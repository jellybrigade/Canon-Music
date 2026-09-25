import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../../../db";
import { QK } from "../../../lib/queryKeys";
import { getCanonTree } from "../lib/canonicalize";
import { findDanglingGenreIds, repairDanglingGenreId } from "../lib/danglingGenreIds";
import { refreshGenreIdReads } from "../lib/genreTreeCarry";

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
    onSuccess: () => refreshGenreIdReads(queryClient),
  });
}
