import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getDb } from "../../db";
import { QK } from "../../lib/queryKeys";
import { type RecentItem, type RecentTarget, readRecents, recordRecent } from "./recents";

export function useRecents(serverId: string | undefined) {
  return useQuery<RecentItem[]>({
    queryKey: QK.recents(serverId),
    queryFn: async () => readRecents(await getDb(), serverId!),
    enabled: !!serverId,
    // Changes only through Ctrl+K opening something or a sync, and both invalidate it.
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useRecordRecent() {
  const queryClient = useQueryClient();
  return useCallback(
    async (target: RecentTarget) => {
      try {
        await recordRecent(await getDb(), target);
      } finally {
        await queryClient.invalidateQueries({ queryKey: QK.recentsAll() });
      }
    },
    [queryClient],
  );
}
