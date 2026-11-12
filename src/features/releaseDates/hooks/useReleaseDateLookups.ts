import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getDb } from "../../../db";
import { useSetting } from "../../../hooks/useSetting";
import { QK } from "../../../lib/queryKeys";
import { createSettlingRunner } from "../../../lib/settlingRunner";
import { runReleaseDateLookups } from "../releaseDateLookups";

// A pass costs several slow requests per album, so switching lookups off ends it early.
let isEnabled = false;

const runUntilSettled = createSettlingRunner(
  async ({ queryClient, serverId }: { queryClient: QueryClient; serverId: string }) => {
    const { changed } = await runReleaseDateLookups(await getDb(), new Date(), {
      serverId,
      shouldStop: () => !isEnabled,
    });
    if (changed) {
      void queryClient.invalidateQueries({ queryKey: QK.recentlyReleasedAll() });
      void queryClient.invalidateQueries({ queryKey: QK.lookedUpFactsAll() });
    }
  },
);

/** After each library sync, looks up release dates for the server's recent albums that have only a year. */
export function useReleaseDateLookups(lastSyncedAt: number | null, serverId: string | null): void {
  const [autoRefresh, , isAutoRefreshLoaded] = useSetting("tags.auto_refresh", "true");
  const queryClient = useQueryClient();
  const isAllowed = isAutoRefreshLoaded && autoRefresh === "true";

  useEffect(() => {
    isEnabled = isAllowed;
    return () => {
      isEnabled = false;
    };
  }, [isAllowed]);

  useEffect(() => {
    if (lastSyncedAt === null || serverId === null || !isAllowed) return;
    runUntilSettled({ queryClient, serverId }).catch((error: unknown) =>
      console.warn("[release dates] lookup pass failed:", error),
    );
  }, [lastSyncedAt, serverId, isAllowed, queryClient]);
}
