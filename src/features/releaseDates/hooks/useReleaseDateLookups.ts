import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getDb } from "../../../db";
import { useSetting } from "../../../hooks/useSetting";
import { QK } from "../../../lib/queryKeys";
import { runReleaseDateLookups } from "../releaseDateLookups";

let isRunning = false;
let isRerunRequested = false;

// A sync that lands mid-pass may have added albums the pass already read past, so it asks for one more.
async function runUntilSettled(queryClient: QueryClient): Promise<void> {
  if (isRunning) {
    isRerunRequested = true;
    return;
  }
  isRunning = true;
  try {
    do {
      isRerunRequested = false;
      const { changed } = await runReleaseDateLookups(await getDb(), new Date());
      if (changed) void queryClient.invalidateQueries({ queryKey: QK.recentlyReleasedAll() });
    } while (isRerunRequested);
  } catch (error) {
    console.warn("[release dates] lookup pass failed:", error);
  } finally {
    isRunning = false;
  }
}

/** After each library sync, looks up release dates for recent albums that have only a year. */
export function useReleaseDateLookups(lastSyncedAt: number | null): void {
  const [autoRefresh, , isAutoRefreshLoaded] = useSetting("tags.auto_refresh", "true");
  const queryClient = useQueryClient();

  useEffect(() => {
    if (lastSyncedAt === null || !isAutoRefreshLoaded || autoRefresh !== "true") return;
    void runUntilSettled(queryClient);
  }, [lastSyncedAt, isAutoRefreshLoaded, autoRefresh, queryClient]);
}
