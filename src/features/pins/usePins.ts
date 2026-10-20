import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { getDb } from "../../db";
import { QK } from "../../lib/queryKeys";
import { type Pins, type PinTarget, readPins, setPinned } from "./pins";

export function usePins(serverId: string | undefined) {
  return useQuery<Pins>({
    queryKey: QK.pins(serverId),
    queryFn: async () => readPins(await getDb(), serverId!),
    enabled: !!serverId,
    // Changes only through a pin write or a sync, and both invalidate it; the sidebar and Ctrl+K share the read.
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useSetPinned() {
  const queryClient = useQueryClient();
  return useCallback(
    async (target: PinTarget, isPinned: boolean) => {
      try {
        await setPinned(await getDb(), target, isPinned);
      } finally {
        await queryClient.invalidateQueries({ queryKey: QK.pinsAll() });
      }
    },
    [queryClient],
  );
}
