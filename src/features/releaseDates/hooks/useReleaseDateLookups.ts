import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getDb } from "../../../db";
import { useSetting } from "../../../hooks/useSetting";
import { QK } from "../../../lib/queryKeys";
import { createSettlingRunner } from "../../../lib/settlingRunner";
import { runReleaseDateLookups } from "../releaseDateLookups";

const runUntilSettled = createSettlingRunner(async (queryClient: QueryClient) => {
  const { changed } = await runReleaseDateLookups(await getDb(), new Date());
  if (changed) {
    void queryClient.invalidateQueries({ queryKey: QK.recentlyReleasedAll() });
    void queryClient.invalidateQueries({ queryKey: QK.lookedUpFactsAll() });
  }
});

/** After each library sync, looks up release dates for recent albums that have only a year. */
export function useReleaseDateLookups(lastSyncedAt: number | null): void {
  const [autoRefresh, , isAutoRefreshLoaded] = useSetting("tags.auto_refresh", "true");
  const queryClient = useQueryClient();

  useEffect(() => {
    if (lastSyncedAt === null || !isAutoRefreshLoaded || autoRefresh !== "true") return;
    runUntilSettled(queryClient).catch((error: unknown) => console.warn("[release dates] lookup pass failed:", error));
  }, [lastSyncedAt, isAutoRefreshLoaded, autoRefresh, queryClient]);
}
